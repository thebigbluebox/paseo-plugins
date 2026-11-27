/**
 * Families of waiting agents: everything under the highest waiting ancestor is dealt as one card,
 * so a parent watching its children does not show up as a second card for the same work.
 * Pure, so it can be tested without the app.
 */
import type { AgentRef } from "@getpaseo/plugin/client";
import type { Reason } from "./queue";

const MAX_DEPTH = 32;

/** One waiting agent in a family, placed under its nearest waiting ancestor. */
export interface Member {
  ref: AgentRef;
  reason: Reason;
  /** 0 for the family's top agent. */
  depth: number;
  /** Agents between this one and the member above it that do not need attention. */
  via: AgentRef[];
}

export interface Family {
  /** The top member's agent key; skips and pulls apply to the whole family through it. */
  key: string;
  /** Tree order: the top agent first, each member followed by its own descendants. */
  members: Member[];
  /** The most urgent member's reason. */
  reason: Reason;
  skipped: boolean;
}

/**
 * Groups waiting agents (already in dealing order) into families under their highest waiting
 * ancestor, and orders the families: by their first member, skipped ones last.
 */
export function buildFamilies(
  waiting: readonly { ref: AgentRef; reason: Reason }[],
  spawnerOf: (agentKey: string) => AgentRef | null,
  skipTime: (key: string) => number | undefined,
): Family[] {
  const waitingKeys = new Set(waiting.map((item) => item.ref.key));

  // Place each waiting agent under its nearest waiting ancestor, noting who it skips over.
  const above = new Map<string, { parent: string | null; via: AgentRef[] }>();
  for (const { ref } of waiting) {
    const via: AgentRef[] = [];
    const seen = new Set([ref.key]);
    let parent: string | null = null;
    for (let up = spawnerOf(ref.key); up && via.length < MAX_DEPTH && !seen.has(up.key); up = spawnerOf(up.key)) {
      if (waitingKeys.has(up.key)) {
        parent = up.key;
        break;
      }
      seen.add(up.key);
      via.unshift(up);
    }
    above.set(ref.key, { parent, via: parent ? via : [] });
  }

  // Break any loop in the parent links (bad data), so no agent lands in two families.
  for (const { ref } of waiting) {
    const seen = new Set<string>();
    for (let key = above.get(ref.key)?.parent; key; key = above.get(key)?.parent) {
      if (key === ref.key) {
        above.set(ref.key, { parent: null, via: [] });
        break;
      }
      if (seen.has(key)) break;
      seen.add(key);
    }
  }

  const children = new Map<string, string[]>();
  for (const { ref } of waiting) {
    const parent = above.get(ref.key)?.parent;
    if (parent) children.set(parent, [...(children.get(parent) ?? []), ref.key]);
  }
  const byKey = new Map(waiting.map((item) => [item.ref.key, item]));
  const rootOf = (key: string) => {
    const seen = new Set<string>();
    let current = key;
    while (above.get(current)?.parent && !seen.has(current)) {
      seen.add(current);
      current = above.get(current)!.parent!;
    }
    return current;
  };

  // Families in the order their first member comes up.
  const fresh: Family[] = [];
  const skipped: { family: Family; at: number }[] = [];
  const placed = new Set<string>();
  for (const item of waiting) {
    const root = rootOf(item.ref.key);
    if (placed.has(root)) continue;
    placed.add(root);
    const members: Member[] = [];
    const visit = (key: string, depth: number, trail: Set<string>) => {
      const member = byKey.get(key);
      if (!member || trail.has(key)) return;
      trail.add(key);
      members.push({ ref: member.ref, reason: member.reason, depth, via: depth ? (above.get(key)?.via ?? []) : [] });
      for (const child of children.get(key) ?? []) visit(child, depth + 1, trail);
    };
    visit(root, 0, new Set());
    const at = skipTime(root);
    const family: Family = { key: root, members, reason: item.reason, skipped: at !== undefined };
    if (at === undefined) fresh.push(family);
    else skipped.push({ family, at });
  }
  skipped.sort((a, b) => a.at - b.at);
  return [...fresh, ...skipped.map((item) => item.family)];
}

/**
 * Agents with work still going on in them or under them: each working agent, and every agent
 * above it. A "finished" agent in this set is usually reporting progress ("the other two are
 * still working"), not asking for anything, so the deck holds it until that work is done.
 */
export function busyKeys(
  working: readonly AgentRef[],
  spawnerOf: (agentKey: string) => AgentRef | null,
): Set<string> {
  const busy = new Set<string>();
  for (const ref of working) {
    busy.add(ref.key);
    const seen = new Set([ref.key]);
    for (let up = spawnerOf(ref.key); up && !seen.has(up.key); up = spawnerOf(up.key)) {
      seen.add(up.key);
      busy.add(up.key);
    }
  }
  return busy;
}
