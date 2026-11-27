/**
 * Where a card's work came from: the workspace it was spawned from, and the task the agent was
 * first given.
 */
import type { AgentRef, WorkspaceRef } from "@getpaseo/plugin/client";
import { getPaseoClient, usePaseo } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";

export interface ParentWorkspace {
  hostId: string;
  id: string;
  name: string;
}

/**
 * Read from the daemon's workspace record, whose `parentWorkspaceId` survives the spawning agent
 * being archived (view snapshots only carry the spawning agent).
 */
export function useParentWorkspace(workspace: WorkspaceRef | null) {
  return useQuery({
    queryKey: ["triage-parent", workspace?.key ?? null],
    enabled: !!workspace,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ParentWorkspace | null> => {
      const workspaces = getPaseoClient(workspace!.hostId).workspaces;
      const own = await workspaces.ref(workspace!.id).refresh();
      if (!own?.parentWorkspaceId) return null;
      const parent = await workspaces.ref(own.parentWorkspaceId).refresh();
      if (!parent) return null;
      return { hostId: workspace!.hostId, id: parent.id, name: parent.title || parent.name };
    },
  }).data ?? null;
}

/**
 * The first prompt an agent was given: what the work is, when the latest prompt is only
 * "continue". Reads from the start of its history.
 */
/**
 * Messages delivered on the user's side by Paseo or another agent, not typed by the user: a
 * subagent's report (`<agent-message …>`), a system reminder, a slash command's expansion. They
 * open with a markup tag, which a real prompt practically never does.
 */
export function isInjected(text: string): boolean {
  return /^\s*<[a-zA-Z][\w-]*[\s>]/.test(text);
}

export function useTask(agent: AgentRef) {
  const paseo = usePaseo();
  return useQuery({
    queryKey: ["triage-task", 3, agent.key],
    staleTime: Infinity,
    queryFn: async (): Promise<string | null> => {
      const timeline = paseo.agents.ref(agent).timeline;
      const tail = await timeline.refetch({ direction: "tail", limit: 1 });
      const start = await timeline.refetch({ direction: "after", cursor: { epoch: tail.epoch, seq: 0 }, limit: 50 });
      let items = start.entries.map((entry) => entry.item);
      // Covers histories that number from 0, where "after 0" skips the first row.
      if (start.hasOlder && start.startCursor) {
        const before = await timeline.refetch({ direction: "before", cursor: start.startCursor, limit: 5 });
        items = [...before.entries.map((entry) => entry.item), ...items];
      }
      // The first prompt the user actually wrote, if it says enough to name the work: a bare
      // "yes" or "go ahead" does not. None found means no Task line.
      for (const item of items) {
        if (item.type !== "user_message" || isInjected(item.text)) continue;
        const text = item.text.trim();
        if (text.split(/\s+/).length >= 3) return text;
      }
      return null;
    },
  }).data ?? null;
}
