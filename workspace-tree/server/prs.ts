/**
 * Finds every pull request a workspace produced, not only the one for its current branch.
 *
 * Paseo's own PR status follows the branch a worktree has checked out right now, so a workspace
 * that opened several PRs shows whichever branch it ended on. Here a workspace owns every branch
 * its worktree's HEAD has been on, read from that worktree's reflog. Each repository's PRs come
 * from one `gh pr list` call, matched to workspaces by head branch.
 */
import type { PaseoApi } from "@getpaseo/client";
import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { PullRequest } from "../shared/prs";

const run = promisify(execFile);
const PR_CACHE_MS = 60_000;
const PR_LIMIT = 150;
const OPEN_LIMIT = 50;
const IGNORED_BRANCHES = new Set(["main", "master", "HEAD", "develop"]);
// The daemon may start without a login shell's PATH; gh and git usually live here on macOS.
const PATH = [process.env.PATH, "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"]
  .filter(Boolean)
  .join(":");

async function exec(command: string, args: string[], cwd: string): Promise<string> {
  const { stdout } = await run(command, args, {
    cwd,
    env: { ...process.env, PATH, GH_PROMPT_DISABLED: "1" },
    timeout: 30_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

/** Branches this worktree's HEAD has been on, current branch first. */
async function branchesOf(cwd: string): Promise<{ current: string | null; branches: string[] }> {
  const [current, reflog] = await Promise.all([
    exec("git", ["branch", "--show-current"], cwd).then((out) => out.trim() || null),
    exec("git", ["reflog", "--format=%gs", "-n", "500"], cwd).catch(() => ""),
  ]);
  const branches = new Set<string>();
  if (current) branches.add(current);
  for (const line of reflog.split("\n")) {
    const moved = /^checkout: moving from (\S+) to (\S+)/.exec(line);
    if (moved) {
      branches.add(moved[1]);
      branches.add(moved[2]);
    }
    const renamed = /^Branch: renamed refs\/heads\/\S+ to refs\/heads\/(\S+)/.exec(line);
    if (renamed) branches.add(renamed[1]);
  }
  const usable = [...branches].filter(
    (name) =>
      !IGNORED_BRANCHES.has(name) && !name.startsWith("origin/") && !/^[0-9a-f]{7,40}$/.test(name),
  );
  return { current, branches: usable };
}

interface GhPullRequest {
  number: number;
  title: string;
  url: string;
  state: "OPEN" | "MERGED" | "CLOSED";
  isDraft: boolean;
  headRefName: string;
  author?: { login?: string } | null;
  reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | "" | null;
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  statusCheckRollup: Array<{ status?: string | null; conclusion?: string | null; state?: string | null }> | null;
}

function checksOf(rollup: GhPullRequest["statusCheckRollup"]): PullRequest["checks"] {
  if (!rollup?.length) return "none";
  let pending = false;
  for (const check of rollup) {
    // Check runs report status + conclusion; commit statuses report state.
    const result = (check.conclusion || check.state || "").toUpperCase();
    if (["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"].includes(result))
      return "failure";
    const status = (check.status || "").toUpperCase();
    if (!result || ["PENDING", "EXPECTED"].includes(result) || (status && status !== "COMPLETED"))
      pending = true;
  }
  return pending ? "pending" : "success";
}

function reviewOf(decision: GhPullRequest["reviewDecision"]): PullRequest["review"] {
  if (decision === "APPROVED") return "approved";
  if (decision === "CHANGES_REQUESTED") return "changes_requested";
  if (decision === "REVIEW_REQUIRED") return "pending";
  return null;
}

interface GhOpenStatus {
  number: number;
  reviewDecision: GhPullRequest["reviewDecision"];
  mergeable: GhPullRequest["mergeable"];
  statusCheckRollup: GhPullRequest["statusCheckRollup"];
}

let viewerLogin: Promise<string | null> | null = null;

/** The GitHub login gh is signed in as, so PRs the user opened can be told from ones they reviewed. */
function viewer(cwd: string): Promise<string | null> {
  viewerLogin ??= exec("gh", ["api", "user", "--jq", ".login"], cwd)
    .then((out) => out.trim() || null)
    .catch(() => {
      viewerLogin = null;
      return null;
    });
  return viewerLogin;
}

const repoCache = new Map<string, { at: number; byBranch: Promise<Map<string, GhPullRequest[]>> }>();
/**
 * The last answer GitHub gave per repository. GitHub's API times out now and then (HTTP 502/504);
 * serving this instead of nothing keeps the chips from vanishing until the next refresh.
 */
const lastGood = new Map<string, Map<string, GhPullRequest[]>>();

/**
 * Two queries, because asking GitHub for check results on every PR times out on busy repos:
 * a light list of recent PRs in any state, and review, mergeability and checks for open PRs only.
 */
function pullRequestsOf(repoRoot: string, refresh: boolean): Promise<Map<string, GhPullRequest[]>> {
  const cached = repoCache.get(repoRoot);
  if (cached && !refresh && Date.now() - cached.at < PR_CACHE_MS) return cached.byBranch;
  const all = exec(
    "gh",
    ["pr", "list", "--state", "all", "--limit", String(PR_LIMIT), "--json", "number,title,url,state,isDraft,headRefName,author"],
    repoRoot,
  );
  const open = exec(
    "gh",
    ["pr", "list", "--state", "open", "--limit", String(OPEN_LIMIT), "--json", "number,reviewDecision,mergeable,statusCheckRollup"],
    repoRoot,
  );
  const byBranch = Promise.all([all, open]).then(([allOut, openOut]) => {
    const status = new Map<number, GhOpenStatus>();
    for (const item of JSON.parse(openOut) as GhOpenStatus[]) status.set(item.number, item);
    const map = new Map<string, GhPullRequest[]>();
    for (const base of JSON.parse(allOut) as GhPullRequest[]) {
      const extra = status.get(base.number);
      const pr: GhPullRequest = {
        ...base,
        reviewDecision: extra?.reviewDecision ?? null,
        mergeable: extra?.mergeable ?? "UNKNOWN",
        statusCheckRollup: extra?.statusCheckRollup ?? null,
      };
      const list = map.get(pr.headRefName) ?? [];
      list.push(pr);
      map.set(pr.headRefName, list);
    }
    return map;
  });
  const served = byBranch.then(
    (map) => {
      lastGood.set(repoRoot, map);
      return map;
    },
    (error: unknown) => {
      // Retry on the next request rather than caching the failure.
      repoCache.delete(repoRoot);
      const previous = lastGood.get(repoRoot);
      if (previous) {
        const stderr = (error as { stderr?: string }).stderr?.trim();
        console.error(`[workspace-tree] GitHub lookup failed, serving last good PRs: ${stderr || error}`);
        return previous;
      }
      throw error;
    },
  );
  repoCache.set(repoRoot, { at: Date.now(), byBranch: served });
  return served;
}

function rank(pr: PullRequest): number {
  if (pr.current) return 0;
  return pr.state === "open" ? 1 : 2;
}

export interface PullRequestSnapshot {
  workspaces: Record<string, PullRequest[]>;
  error: string | null;
  /** When GitHub was last read, ISO time; null before the first read. */
  refreshedAt: string | null;
}

/** Reads every workspace's PRs from GitHub. A workspace whose lookup fails keeps `previous`. */
async function readFromGitHub(
  paseo: PaseoApi,
  refresh: boolean,
  previous: PullRequestSnapshot | null,
): Promise<PullRequestSnapshot> {
  const workspaces: Array<{ id: string; cwd: string }> = [];
  let cursor: string | undefined;
  do {
    const page = await paseo.workspaces.list({ page: { limit: 200, cursor } });
    for (const workspace of page.entries) {
      if (workspace.projectKind === "git") {
        workspaces.push({ id: workspace.id, cwd: workspace.workspaceDirectory });
      }
    }
    cursor = page.pageInfo.hasMore ? (page.pageInfo.nextCursor ?? undefined) : undefined;
  } while (cursor);

  const result: Record<string, PullRequest[]> = {};
  const errors = new Set<string>();
  await Promise.all(
    workspaces.map(async ({ id, cwd }) => {
      try {
        const repoRoot = (
          await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd)
        ).trim();
        const [{ current, branches }, byBranch, me] = await Promise.all([
          branchesOf(cwd),
          pullRequestsOf(repoRoot.replace(/\/\.git$/, ""), refresh),
          viewer(cwd),
        ]);
        const found: PullRequest[] = [];
        for (const branch of branches) {
          for (const pr of byBranch.get(branch) ?? []) {
            // A branch the worktree has moved off counts only if the user opened its PR, so a
            // teammate's PR checked out for review does not stick to the workspace. The current
            // branch's PR always shows, as in Paseo's own sidebar.
            const mine = !me || pr.author?.login?.toLowerCase() === me.toLowerCase();
            if (branch !== current && !mine) continue;
            found.push({
              number: pr.number,
              title: pr.title,
              url: pr.url,
              state: pr.state === "OPEN" ? "open" : pr.state === "MERGED" ? "merged" : "closed",
              draft: pr.isDraft,
              checks: checksOf(pr.statusCheckRollup),
              review: reviewOf(pr.reviewDecision),
              conflicting: pr.mergeable === "CONFLICTING",
              current: branch === current,
            });
          }
        }
        found.sort((a, b) => rank(a) - rank(b) || b.number - a.number);
        if (found.length) result[id] = found;
      } catch (error) {
        const stderr = (error as { stderr?: string }).stderr?.trim();
        const message = stderr || (error instanceof Error ? error.message.split("\n")[0] : String(error));
        errors.add(message);
        // Keep what this workspace showed before rather than dropping its chips.
        const kept = previous?.workspaces[id];
        if (kept) result[id] = kept;
        console.error(`[workspace-tree] PR lookup failed for ${cwd}: ${message}`);
      }
    }),
  );
  return {
    workspaces: result,
    error: errors.size ? [...errors][0] : null,
    refreshedAt: new Date().toISOString(),
  };
}

/*
 * The sidebar never waits on GitHub. Each request gets the latest snapshot at once, and a stale
 * snapshot starts one background refresh. The snapshot is written to disk, so a plugin reload or
 * daemon restart starts from the last answer instead of blank chips. Before this, every restart
 * and every GitHub timeout showed no PRs until a full lookup (about 5 seconds) succeeded.
 */
const STALE_MS = 60_000;
/*
 * Kept in this plugin's folder under the daemon home, which Paseo deletes when the plugin is
 * removed, so uninstalling leaves nothing behind. Not a .json name, so it is never taken for a
 * settings document. Older builds used ~/.cache/paseo-workspace-tree; that copy is removed.
 */
const PLUGIN_ID = "paseo-workspace-tree";
const CACHE_DIR = join(process.env.PASEO_HOME || join(homedir(), ".paseo"), "plugin-settings", PLUGIN_ID);
const CACHE_FILE = join(CACHE_DIR, "pull-requests.cache");
const LEGACY_CACHE_DIR = join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), PLUGIN_ID);

let snapshot: PullRequestSnapshot | null = null;
let loaded: Promise<void> | null = null;
let refreshing: Promise<PullRequestSnapshot> | null = null;

/** Removes the old cache location and any temporary file a crash left mid-save. */
async function removeLeftovers(): Promise<void> {
  await rm(LEGACY_CACHE_DIR, { recursive: true, force: true }).catch(() => undefined);
  const names = await readdir(CACHE_DIR).catch(() => [] as string[]);
  await Promise.all(
    names
      .filter((name) => name.startsWith("pull-requests.cache.") && name.endsWith(".tmp"))
      .map((name) => rm(join(CACHE_DIR, name), { force: true }).catch(() => undefined)),
  );
}

function loadFromDisk(): Promise<void> {
  loaded ??= removeLeftovers()
    .then(() => readFile(CACHE_FILE, "utf8"))
    .then((text) => {
      const saved = JSON.parse(text) as PullRequestSnapshot;
      if (saved && typeof saved.workspaces === "object") snapshot ??= saved;
    })
    .catch(() => undefined);
  return loaded;
}

async function saveToDisk(value: PullRequestSnapshot): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    const temporary = `${CACHE_FILE}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(value));
    await rename(temporary, CACHE_FILE);
  } catch (error) {
    console.error("[workspace-tree] Could not save the PR snapshot", error);
  }
}

function startRefresh(paseo: PaseoApi, force: boolean): Promise<PullRequestSnapshot> {
  refreshing ??= readFromGitHub(paseo, force, snapshot)
    .then((fresh) => {
      snapshot = fresh;
      void saveToDisk(fresh);
      return fresh;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export async function listWorkspacePullRequests(
  paseo: PaseoApi,
  refresh: boolean,
): Promise<PullRequestSnapshot> {
  await loadFromDisk();
  const age = snapshot?.refreshedAt ? Date.now() - Date.parse(snapshot.refreshedAt) : Infinity;
  if (refresh || age > STALE_MS) {
    const pending = startRefresh(paseo, refresh);
    // Only the very first lookup, with nothing saved, has to wait.
    if (!snapshot) return pending;
    pending.catch((error) => console.error("[workspace-tree] Background PR refresh failed", error));
  }
  return snapshot!;
}
