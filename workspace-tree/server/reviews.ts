/**
 * Open pull requests waiting for you, from one GitHub GraphQL query through `gh`: those that
 * request your review, and those you approved that have new commits since, or whose review was
 * dismissed. Adapted from Peter's work-status plugin (psvitz/paseo-plugins).
 */
import { execFile } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ReviewItem } from "../shared/reviews";

const run = promisify(execFile);
/** How old the saved answer may get before a background lookup replaces it. */
const STALE_MS = 120_000;
// The daemon may start without a login shell's PATH; gh usually lives here on macOS.
const PATH = [process.env.PATH, "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"].filter(Boolean).join(":");

const QUERY = `query {
  viewer { login }
  requested: search(query: "is:pr is:open archived:false user-review-requested:@me", type: ISSUE, first: 50) {
    nodes { ... on PullRequest { number title url isDraft updatedAt mergeable reviewDecision repository { nameWithOwner } author { login }
      commits(last: 1) { nodes { commit { committedDate statusCheckRollup { state } } } } } }
  }
  reviewed: search(query: "is:pr is:open archived:false reviewed-by:@me", type: ISSUE, first: 50) {
    nodes { ... on PullRequest { number title url isDraft updatedAt mergeable reviewDecision repository { nameWithOwner } author { login }
      commits(last: 1) { nodes { commit { committedDate statusCheckRollup { state } } } }
      reviews(last: 50) { nodes { author { login } state submittedAt } } } }
  }
}`;

interface PullRequestNode {
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  updatedAt: string;
  reviewDecision?: string | null;
  mergeable?: "MERGEABLE" | "CONFLICTING" | "UNKNOWN" | null;
  repository: { nameWithOwner: string };
  author: { login: string } | null;
  commits?: { nodes: { commit: { committedDate: string; statusCheckRollup?: { state: string } | null } }[] };
  reviews?: { nodes: { author: { login: string } | null; state: string; submittedAt: string | null }[] };
}

/** GitHub's combined state for a commit's checks and statuses. */
function checksOf(state: string | null | undefined): ReviewItem["checks"] {
  switch ((state ?? "").toUpperCase()) {
    case "SUCCESS":
      return "success";
    case "FAILURE":
    case "ERROR":
      return "failure";
    case "PENDING":
    case "EXPECTED":
      return "pending";
    default:
      return "none";
  }
}

function reviewOf(decision: string | null | undefined): ReviewItem["review"] {
  if (decision === "APPROVED") return "approved";
  if (decision === "CHANGES_REQUESTED") return "changes_requested";
  if (decision === "REVIEW_REQUIRED") return "pending";
  return null;
}

interface ReviewSnapshot {
  items: ReviewItem[];
  fetchedAt: string;
  error: string | null;
}

/*
 * The last answer, also saved beside the PR snapshot in this plugin's folder under the daemon
 * home, so a reload or restart starts from it instead of an empty panel, as the PR chips do.
 */
const CACHE_FILE = join(
  process.env.PASEO_HOME || join(homedir(), ".paseo"),
  "plugin-settings",
  "paseo-workspace-tree",
  "reviews.cache",
);

let snapshot: ReviewSnapshot | null = null;
let loaded: Promise<void> | null = null;
let refreshing: Promise<ReviewSnapshot> | null = null;

function loadFromDisk(): Promise<void> {
  loaded ??= readFile(CACHE_FILE, "utf8")
    .then((text) => {
      const saved = JSON.parse(text) as ReviewSnapshot;
      if (saved && Array.isArray(saved.items)) snapshot ??= saved;
    })
    .catch(() => undefined);
  return loaded;
}

async function saveToDisk(value: ReviewSnapshot): Promise<void> {
  try {
    await mkdir(join(CACHE_FILE, ".."), { recursive: true });
    const temporary = `${CACHE_FILE}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(value));
    await rename(temporary, CACHE_FILE);
  } catch (error) {
    console.error("[workspace-tree] Could not save the review snapshot", error);
  }
}

async function readFromGitHub(): Promise<ReviewItem[]> {
  const { stdout } = await run("gh", ["api", "graphql", "-f", `query=${QUERY}`], {
    env: { ...process.env, PATH, GH_PROMPT_DISABLED: "1" },
    timeout: 30_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const data = JSON.parse(stdout).data as {
    viewer: { login: string };
    requested: { nodes: PullRequestNode[] };
    reviewed: { nodes: PullRequestNode[] };
  };
  const me = data.viewer.login;
  const items = new Map<string, ReviewItem>();
  const add = (node: PullRequestNode, kind: ReviewItem["kind"]) => {
    if (!node.url || node.author?.login === me) return;
    items.set(node.url, {
      repo: node.repository.nameWithOwner,
      number: node.number,
      title: node.title,
      url: node.url,
      author: node.author?.login ?? "ghost",
      draft: node.isDraft,
      updatedAt: node.updatedAt,
      kind,
      checks: checksOf(node.commits?.nodes[0]?.commit.statusCheckRollup?.state),
      conflicting: node.mergeable === "CONFLICTING",
      review: reviewOf(node.reviewDecision),
    });
  };
  for (const node of data.requested.nodes) add(node, "review");
  for (const node of data.reviewed.nodes) {
    if (items.has(node.url) || node.reviewDecision === "APPROVED") continue;
    const mine = (node.reviews?.nodes ?? []).filter(
      (review) =>
        review.author?.login === me && ["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(review.state),
    );
    const last = mine[mine.length - 1];
    if (!last) continue;
    const lastCommit = node.commits?.nodes[0]?.commit.committedDate;
    const dismissed = last.state === "DISMISSED";
    const stale = last.state === "APPROVED" && lastCommit && last.submittedAt && lastCommit > last.submittedAt;
    if (dismissed || stale) add(node, "reapprove");
  }
  return [...items.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function startRefresh(): Promise<ReviewSnapshot> {
  refreshing ??= readFromGitHub()
    .then((items): ReviewSnapshot => {
      const fresh = { items, fetchedAt: new Date().toISOString(), error: null };
      void saveToDisk(fresh);
      return fresh;
    })
    // A failed lookup keeps the last good list and says why.
    .catch((error: unknown): ReviewSnapshot => ({
      items: snapshot?.items ?? [],
      fetchedAt: snapshot?.fetchedAt ?? new Date().toISOString(),
      error: error instanceof Error ? error.message.split("\n")[0] : String(error),
    }))
    .then((next) => {
      snapshot = next;
      return next;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/**
 * The saved answer at once, refreshed in the background once it is older than STALE_MS. Only the
 * first lookup ever, with nothing saved, and an explicit refresh wait for GitHub.
 */
export async function readPendingReviews(force = false): Promise<ReviewSnapshot> {
  await loadFromDisk();
  const age = snapshot ? Date.now() - Date.parse(snapshot.fetchedAt) : Infinity;
  if (force || !snapshot) return startRefresh();
  if (age > STALE_MS) void startRefresh();
  return snapshot;
}
