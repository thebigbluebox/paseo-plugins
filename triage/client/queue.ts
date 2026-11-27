import type { PluginAgentSnapshot } from "@getpaseo/plugin";
import type { AgentRef } from "@getpaseo/plugin/client";
import { useAgents, usePaseo, useWorkspaces } from "@getpaseo/plugin/client";
import { useQueries } from "@tanstack/react-query";
import { buildFamilies, busyKeys, type Family } from "./families";
export type { Family, Member } from "./families";
import { useEffect, useMemo, useSyncExternalStore } from "react";

export type Reason = "permission" | "error" | "finished";

/** Most urgent first: a blocked agent, then a broken one, then one with something to read. */
const URGENCY: Record<Reason, number> = { permission: 0, error: 1, finished: 2 };

/** How long a card stays hidden after an action, if the agent's attention flag never clears. */
const HANDLED_GRACE_MS = 30_000;

/**
 * Status is not checked: Paseo closes an agent's process once it goes idle, so a finished agent
 * you have not read is usually "closed" while it still requires attention.
 */
export function needsTriage(agent: PluginAgentSnapshot): boolean {
  return agent.requiresAttention && !agent.background;
}

export function reasonOf(agent: Pick<PluginAgentSnapshot, "attentionReason" | "status">): Reason {
  if (agent.attentionReason) return agent.attentionReason;
  return agent.status === "error" ? "error" : "finished";
}

/**
 * Skips and handled cards live for the app session, outside any component, so leaving the
 * triage screen to open an agent and coming back keeps the deck in the same order.
 */
class DeckState {
  /** Agent key to the time it was skipped; skipped cards go to the back in skip order. */
  private skipped = new Map<string, number>();
  /** Agent key to the time an action was taken; hidden until the agent leaves the queue. */
  private handled = new Map<string, number>();
  private listeners = new Set<() => void>();
  private version = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = () => this.version;

  skipTime(key: string) {
    return this.skipped.get(key);
  }

  isHandled(key: string) {
    const at = this.handled.get(key);
    return at !== undefined && Date.now() - at < HANDLED_GRACE_MS;
  }

  skip(key: string) {
    this.skipped.delete(key);
    this.skipped.set(key, Date.now());
    this.emit();
  }

  markHandled(key: string) {
    this.handled.set(key, Date.now());
    this.skipped.delete(key);
    this.emit();
    if (this.timer) clearTimeout(this.timer);
    // Re-render once the grace runs out, so a card whose flag never cleared comes back.
    this.timer = setTimeout(() => this.emit(), HANDLED_GRACE_MS + 50);
  }

  unmarkHandled(key: string) {
    if (this.handled.delete(key)) this.emit();
  }

  /** Forgets agents that left the queue, so a new request for attention starts fresh. */
  prune(present: ReadonlySet<string>) {
    let changed = false;
    for (const map of [this.skipped, this.handled]) {
      for (const key of map.keys()) {
        if (!present.has(key)) {
          map.delete(key);
          changed = true;
        }
      }
    }
    if (changed) this.emit();
  }

  private emit() {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }
}

export const deck = new DeckState();

/**
 * Who spawned each agent: its own parent agent, else the agent that spawned its workspace.
 * Selected from live snapshots by grouping on the link, so it stays current without fetching.
 */
function useSpawners(): (agentKey: string) => AgentRef | null {
  const agentGroups = useAgents({
    groupBy: (agent) => JSON.stringify([agent.parentAgent?.key ?? null, agent.workspace.key]),
  });
  const workspaceGroups = useWorkspaces({ groupBy: (workspace) => workspace.parentAgent?.key ?? "" });
  return useMemo(() => {
    const refs = new Map<string, AgentRef>();
    const links = new Map<string, { parent: string | null; workspace: string }>();
    for (const group of agentGroups) {
      const [parent, workspace] = JSON.parse(group.key) as [string | null, string];
      for (const ref of group.items) {
        refs.set(ref.key, ref);
        links.set(ref.key, { parent, workspace });
      }
    }
    const workspaceSpawner = new Map<string, string>();
    for (const group of workspaceGroups) {
      if (group.key) for (const ref of group.items) workspaceSpawner.set(ref.key, group.key);
    }
    return (agentKey: string) => {
      const link = links.get(agentKey);
      if (!link) return null;
      const parent = link.parent ?? workspaceSpawner.get(link.workspace) ?? null;
      return parent && parent !== agentKey ? (refs.get(parent) ?? null) : null;
    };
  }, [agentGroups, workspaceGroups]);
}

/** Running, starting, or idle with shells or monitors it left running. */
function isWorking(agent: PluginAgentSnapshot): boolean {
  return agent.status === "running" || agent.status === "initializing" || agent.backgroundWork.count > 0;
}

/**
 * Waiting agents, by reason, without the ones held back: a "finished" agent with work still
 * running in it or under it. Permission requests and errors are never held.
 */
function useWaiting() {
  const groups = useAgents({
    where: needsTriage,
    orderBy: "lastActivityAt",
    groupBy: (agent) => reasonOf(agent),
  });
  const working = useAgents({ where: isWorking });
  const spawnerOf = useSpawners();
  return useMemo(() => {
    const busy = busyKeys(working, spawnerOf);
    let held = 0;
    const shown = groups.map((group) => {
      if (group.key !== "finished") return group;
      const items = group.items.filter((ref) => !busy.has(ref.key));
      held += group.items.length - items.length;
      return { ...group, items };
    });
    return { groups: shown, held, spawnerOf };
  }, [groups, working, spawnerOf]);
}

/** How often to recheck an agent in a yellow workspace for a pending question or permission. */
const PENDING_POLL_MS = 15_000;

/**
 * Agents stopped mid-turn on a question or permission request. Paseo does not set the attention
 * flag for these: the agent stays "running" and only its workspace turns yellow (`needs_input`).
 * The snapshots do not say which agent is waiting, so each running agent in a yellow workspace is
 * asked for its pending requests.
 */
function usePendingRequests(): AgentRef[] {
  const paseo = usePaseo();
  // Keyed by when the workspace turned yellow, so a new request is noticed at once.
  const yellow = useWorkspaces({
    where: (workspace) => workspace.indicator === "needs_input",
    groupBy: (workspace) => workspace.statusEnteredAt ?? "",
  });
  const candidates = useAgents({
    where: (agent) => !agent.background && !agent.requiresAttention && agent.status === "running",
    groupBy: (agent) => agent.workspace.key,
  });
  const asks = useMemo(() => {
    const enteredAt = new Map<string, string>();
    for (const group of yellow) for (const ref of group.items) enteredAt.set(ref.key, group.key);
    return candidates.flatMap((group) =>
      enteredAt.has(group.key) ? group.items.map((ref) => ({ ref, since: enteredAt.get(group.key)! })) : [],
    );
  }, [yellow, candidates]);
  const results = useQueries({
    queries: asks.map(({ ref, since }) => ({
      queryKey: ["triage-pending", ref.key, since],
      refetchInterval: PENDING_POLL_MS,
      queryFn: async () => {
        const refreshed = await paseo.agents.ref(ref).refresh();
        return (refreshed?.agent.pendingPermissions?.length ?? 0) > 0;
      },
    })),
  });
  return useMemo(
    () => asks.filter((_, index) => results[index]?.data === true).map((ask) => ask.ref),
    // `results` is a new array each render; its data is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [asks, results.map((result) => result.data).join(",")],
  );
}

export interface TriageQueue {
  families: Family[];
  /** Finished agents held back while work is still running under them. */
  held: number;
}

/** Every agent that needs attention, across connected hosts, grouped into families and dealt in order. */
export function useTriageQueue(): TriageQueue {
  const waiting = useWaiting();
  const pending = usePendingRequests();
  const { held, spawnerOf } = waiting;
  // Mid-turn requests join the permission cards.
  const groups = useMemo(() => {
    if (!pending.length) return waiting.groups;
    const known = new Set(waiting.groups.flatMap((group) => group.items.map((ref) => ref.key)));
    const extra = pending.filter((ref) => !known.has(ref.key));
    if (!extra.length) return waiting.groups;
    const permission = waiting.groups.find((group) => group.key === "permission");
    return permission
      ? waiting.groups.map((group) => (group === permission ? { ...group, items: [...extra, ...group.items] } : group))
      : [...waiting.groups, { key: "permission", title: null, color: null, items: extra }];
  }, [waiting.groups, pending]);
  const version = useSyncExternalStore(deck.subscribe, deck.getVersion, deck.getVersion);

  const present = useMemo(() => {
    const keys = new Set<string>();
    for (const group of groups) for (const ref of group.items) keys.add(ref.key);
    return keys;
  }, [groups]);

  useEffect(() => deck.prune(present), [present]);

  return useMemo(() => {
    // Waiting agents, most urgent first and oldest first within a reason.
    const waiting: { ref: AgentRef; reason: Reason }[] = [];
    const ordered = [...groups].sort((a, b) => URGENCY[a.key as Reason] - URGENCY[b.key as Reason]);
    for (const group of ordered) {
      for (const ref of group.items) {
        if (!deck.isHandled(ref.key)) waiting.push({ ref, reason: group.key as Reason });
      }
    }
    return { families: buildFamilies(waiting, spawnerOf, (key) => deck.skipTime(key)), held };
    // `version` re-runs this when skips or handled cards change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, held, spawnerOf, version]);
}

/**
 * Count for the sidebar row: waiting agents, not counting held ones or session skips, plus one
 * for each yellow workspace whose question or permission request did not set the attention flag.
 * From snapshots only, so the row never fetches.
 */
export function useTriageCount(): number {
  const waiting = useWaiting().groups.reduce((total, group) => total + group.items.length, 0);
  const flaggedWorkspaces = useAgents({ where: needsTriage, groupBy: (agent) => agent.workspace.key });
  const yellow = useWorkspaces({ where: (workspace) => workspace.indicator === "needs_input" });
  const covered = new Set(flaggedWorkspaces.map((group) => group.key));
  return waiting + yellow.filter((ref) => !covered.has(ref.key)).length;
}
