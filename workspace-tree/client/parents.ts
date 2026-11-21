/**
 * Maps each workspace to the workspace it was spawned from.
 *
 * View snapshots expose only `parentAgent`, but the daemon's workspace descriptor keeps
 * `parentWorkspaceId`, which survives the parent agent being archived.
 *
 * The map is cached three ways so the tree never flashes flat: in memory for the session (the
 * view remounts whenever it is reopened), on the device (an app restart draws from the last
 * known links), and each host is still re-read once per session so a re-parented workspace is
 * picked up.
 */
import {
  getPaseoClient,
  useHosts,
  useSettings,
  type WorkspaceRef,
} from "@getpaseo/plugin/client";
import { useEffect, useMemo, useRef, useState } from "react";
import { parentsCache } from "../shared/preferences";
import { useSyncedSettings } from "./synced";

const PAGE_SIZE = 200;

export function nodeKey(hostId: string, workspaceId: string): string {
  return `${hostId}/${workspaceId}`;
}

async function readHost(hostId: string): Promise<Map<string, string | null>> {
  const paseo = getPaseoClient(hostId);
  const parents = new Map<string, string | null>();
  let cursor: string | undefined;
  do {
    const page = await paseo.workspaces.list({
      filter: { includeBackground: true },
      page: { limit: PAGE_SIZE, cursor },
    });
    for (const workspace of page.entries) {
      parents.set(
        nodeKey(hostId, workspace.id),
        workspace.parentWorkspaceId ? nodeKey(hostId, workspace.parentWorkspaceId) : null,
      );
    }
    cursor = page.pageInfo.hasMore ? (page.pageInfo.nextCursor ?? undefined) : undefined;
  } while (cursor);
  return parents;
}

/**
 * Of `keys`, the workspaces their host confirms no longer exist (archived or deleted). A key is
 * included only when the host answers that it has no such workspace; an error, an offline host,
 * or any answer naming the workspace keeps it out, so saved state is never dropped on a guess.
 */
export async function confirmGone(keys: readonly string[]): Promise<Set<string>> {
  const gone = new Set<string>();
  await Promise.all(
    keys.map(async (key) => {
      const slash = key.indexOf("/");
      if (slash <= 0) return;
      try {
        const workspace = await getPaseoClient(key.slice(0, slash))
          .workspaces.ref(key.slice(slash + 1))
          .refresh();
        if (workspace === null) gone.add(key);
      } catch {
        // Unknown: keep it.
      }
    }),
  );
  return gone;
}

// Session caches, shared by every mount of the view.
let known: ReadonlyMap<string, string | null> = new Map();
const readThisSession = new Set<string>();

export function useParents(workspaces: readonly WorkspaceRef[]): {
  parents: ReadonlyMap<string, string | null>;
  ready: boolean;
} {
  const hosts = useHosts();
  const cacheSettings = useSettings(parentsCache);
  const cache = useSyncedSettings(cacheSettings);
  const [parents, setParentsState] = useState<ReadonlyMap<string, string | null>>(known);
  const [readDone, setReadDone] = useState(false);

  // Seed from the device cache on the first mount of an app session.
  const seeded = useRef(known.size > 0);
  useEffect(() => {
    if (seeded.current || !cache.value) return;
    seeded.current = true;
    const entries = Object.entries(cache.value.parents);
    if (entries.length > 0 && known.size === 0) {
      known = new Map(entries);
      setParentsState(known);
    }
  }, [cache.value]);

  const onlineHosts = useMemo(
    () =>
      hosts
        .filter((host) => host.status === "online")
        .map((host) => host.serverId)
        .sort()
        .join(","),
    [hosts],
  );
  // Read each online host once per session, and again when a workspace appears it has not listed.
  const toRead = useMemo(() => {
    const online = new Set(onlineHosts ? onlineHosts.split(",") : []);
    const hostsToRead = new Set([...online].filter((hostId) => !readThisSession.has(hostId)));
    for (const ref of workspaces) {
      if (online.has(ref.hostId) && !parents.has(nodeKey(ref.hostId, ref.id))) {
        hostsToRead.add(ref.hostId);
      }
    }
    return [...hostsToRead].sort().join(",");
  }, [workspaces, parents, onlineHosts]);

  const saveCache = cache.set;
  useEffect(() => {
    if (!toRead) return;
    let cancelled = false;
    const hostIds = toRead.split(",");
    void Promise.all(
      hostIds.map((hostId) =>
        readHost(hostId).catch((error) => {
          console.error(`[workspace-tree] Could not read workspaces on ${hostId}`, error);
          return null;
        }),
      ),
    ).then((results) => {
      if (cancelled) return;
      setReadDone(true);
      const answered = hostIds.filter((_, i) => results[i] !== null);
      if (answered.length === 0) return;
      for (const hostId of answered) readThisSession.add(hostId);

      const next = new Map(known);
      for (const result of results) if (result) for (const [key, parent] of result) next.set(key, parent);
      // A workspace its host did not list at all is recorded as a root so it is not re-read
      // forever. Only for hosts that answered: a failed read must not flatten families.
      for (const ref of workspaces) {
        const key = nodeKey(ref.hostId, ref.id);
        if (answered.includes(ref.hostId) && !next.has(key)) next.set(key, null);
      }
      known = next;
      setParentsState(next);
      saveCache({ parents: Object.fromEntries(next) });
    });
    return () => {
      cancelled = true;
    };
  }, [toRead, workspaces, saveCache]);

  // Draw as soon as there is anything to draw from: the daemon's answer, or the cached links.
  const ready = readDone || parents.size > 0 || (cacheSettings.status !== "loading" && toRead === "");
  return { parents, ready };
}
