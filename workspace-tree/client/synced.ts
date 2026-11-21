/**
 * Saves a settings document without losing quick successive changes.
 *
 * Every save must name the revision it replaces. Two folds in a row used to send the second save
 * with the revision the first had already replaced, so it failed silently. Here the change shows
 * at once, saves run one at a time against the newest revision, and a conflict reloads and
 * retries.
 */
import { useCallback, useEffect, useRef, useState } from "react";

type Synced<V> = (
  | { status: "ready"; values: V; revision: string }
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "invalid"; error: string; revision: string }
) & {
  save(values: V, revision: string): Promise<boolean>;
  reload(): Promise<void>;
};

const RETRIES = 3;
const nextTick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export function useSyncedSettings<V>(state: Synced<V>): {
  value: V | null;
  set(next: V): void;
  failed: boolean;
} {
  const [local, setLocal] = useState<V | null>(null);
  const [failed, setFailed] = useState(false);
  const latest = useRef(state);
  latest.current = state;
  const pending = useRef<V | null>(null);
  const flushing = useRef(false);

  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      let attempts = 0;
      while (pending.current !== null && attempts < RETRIES) {
        const target = pending.current;
        const current = latest.current;
        if (current.status !== "ready") break;
        const saved = await current.save(target, current.revision);
        if (saved) {
          if (pending.current === target) pending.current = null;
          attempts = 0;
        } else {
          attempts += 1;
          await latest.current.reload();
        }
        // Let the new revision render before saving anything queued behind this one.
        await nextTick();
      }
      setFailed(pending.current !== null);
    } finally {
      flushing.current = false;
    }
  }, []);

  const set = useCallback(
    (next: V) => {
      setLocal(next);
      pending.current = next;
      void flush();
    },
    [flush],
  );

  // Keep the last values seen while a reload is in flight; reporting none for that moment made
  // moved workspaces and folded folders jump back and forth.
  const lastSaved = useRef<V | null>(null);
  if (state.status === "ready") lastSaved.current = state.values;
  const saved = lastSaved.current;

  // Drop the local copy once the saved document matches, so changes from other devices show.
  useEffect(() => {
    if (local === null || pending.current !== null || saved === null) return;
    if (JSON.stringify(saved) === JSON.stringify(local)) setLocal(null);
  }, [saved, local]);

  return { value: local ?? saved, set, failed };
}
