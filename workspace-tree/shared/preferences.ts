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
