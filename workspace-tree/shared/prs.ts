import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const pullRequestSchema = z.object({
  number: z.number(),
  title: z.string(),
  url: z.string(),
  state: z.enum(["open", "merged", "closed"]),
  draft: z.boolean(),
  checks: z.enum(["success", "pending", "failure", "none"]),
  review: z.enum(["approved", "changes_requested", "pending"]).nullable(),
  conflicting: z.boolean(),
  /** The PR for the branch the worktree has checked out right now. */
  current: z.boolean(),
});

export type PullRequest = z.infer<typeof pullRequestSchema>;

/** Every PR opened from a branch each workspace has had checked out, keyed by workspace ID. */
export const workspacePullRequests = defineRpc({
  name: "workspace-tree.pull-requests",
  input: z.object({ refresh: z.boolean().default(false) }),
  output: z.object({
    workspaces: z.record(z.string(), z.array(pullRequestSchema)),
    error: z.string().nullable(),
    refreshedAt: z.string().nullable().default(null),
  }),
});
