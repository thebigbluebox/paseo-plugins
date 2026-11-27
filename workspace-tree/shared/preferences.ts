import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/** Which projects and parent workspaces are folded. Layout only, so it stays on this device. */
export const treeLayout = defineSettings({
  id: "tree-layout",
  scope: "device",
  version: 1,
  schema: z.object({ collapsed: z.array(z.string()).default([]) }),
});

/**
 * Parents the user chose by moving a workspace, keyed by workspace node key. A string is the new
 * parent's node key; null puts the workspace at the top level. Kept on the host so every device
 * shows the same tree. A workspace without an entry uses the parent Paseo recorded.
 */
export const treeParents = defineSettings({
  id: "tree-parents",
  scope: "host",
  version: 1,
  schema: z.object({
    overrides: z.record(z.string(), z.string().nullable()).default({}),
  }),
});

/**
 * The last parent links read from the daemon, kept on this device so the tree can draw families
 * at once after an app restart instead of waiting on the daemon, then refresh quietly.
 */
export const parentsCache = defineSettings({
  id: "parents-cache",
  scope: "device",
  version: 1,
  schema: z.object({
    parents: z.record(z.string(), z.string().nullable()).default({}),
  }),
});

/**
 * Which hosts and projects the tree shows. Empty lists show everything. A view choice, so it
 * stays on this device: a phone can show one project while the desktop shows all.
 */
export const treeFilter = defineSettings({
  id: "tree-filter",
  scope: "device",
  version: 1,
  schema: z.object({
    /** Host server IDs. */
    hosts: z.array(z.string()).default([]),
    /** Project keys. */
    projects: z.array(z.string()).default([]),
  }),
});

/**
 * What the Reviews panel lists. Repositories are stored as the hidden ones ("owner/name"), so a
 * repository seen for the first time shows. Kept on the host so every device lists the same.
 */
export const reviewSettings = defineSettings({
  id: "review-settings",
  scope: "host",
  version: 1,
  schema: z.object({
    hiddenRepos: z.array(z.string()).default([]),
    showDrafts: z.boolean().default(true),
    showReapprovals: z.boolean().default(true),
  }),
});
