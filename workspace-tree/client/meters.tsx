/**
 * Context use of the agent you are on, and Claude plan usage (5-hour and weekly), as bars under the
 * tree. A press opens every usage window with its reset time and when it runs out at the current
 * rate. Adapted from Peter's work-status plugin (psvitz/paseo-plugins).
 */
import {
  useAgents,
  usePaseo,
  type AgentRef,
  type PluginSidebarViewProps,
  type WorkspaceRef,
} from "@getpaseo/plugin/client";
import { Modal } from "@getpaseo/plugin/client/ui";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { mergedColor, shades, unreadColor } from "./colors";

type Colors = PluginSidebarViewProps["theme"]["colors"];

const USAGE_POLL_MS = 60_000;
const CONTEXT_POLL_MS = 5_000;

interface UsageWindow {
  id: string;
  label: string;
  usedPct: number;
  resetsAt?: string | null;
  durationSeconds?: number | null;
}

interface ClaudeUsage {
  title: string;
  account: string | null;
  planLabel: string | null;
  windows: UsageWindow[];
  details: { id: string; label: string; value: string }[];
  fetchedAt: string;
}

interface ContextReading {
  pct: number;
  used: number;
  max: number;
}

export function Meters({
  colors,
  workspace,
  agent,
}: {
  colors: Colors;
  workspace: WorkspaceRef | null;
  /** The agent tab on screen, if any; its context is shown in preference to the newest agent. */
  agent: AgentRef | null;
}) {
  const { usage, refresh, refreshing } = useClaudeUsage();
  const context = useAgentContext(workspace, agent);
  const [open, setOpen] = useState(false);
  const session = usage?.windows.find((window) => window.id === "five_hour");
  const weekly = usage?.windows.find((window) => window.id === "weekly");
  const contextColor = !context
    ? colors.foregroundMuted
    : context.pct >= 80
      ? colors.statusDanger
      : context.pct >= 50
        ? colors.statusWarning
        : colors.statusSuccess;

  return (
    <>
      <Modal title="Usage" open={open} onOpenChange={setOpen}>
        <Modal.Content>
          <UsageDetails usage={usage} refreshing={refreshing} onRefresh={refresh} colors={colors} />
        </Modal.Content>
      </Modal>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Show usage details"
        onPress={() => {
          setOpen(true);
          refresh();
        }}
        style={{
          borderTopWidth: 1,
          borderTopColor: shades(colors.foreground).line,
          paddingHorizontal: 12,
          paddingVertical: 8,
          gap: 4,
        }}
      >
        <Bar
          label="Context"
          pct={context?.pct ?? null}
          color={contextColor}
          note={context ? `${short(context.used)} / ${short(context.max)}` : "no agent"}
          dangerAt={80}
          colors={colors}
        />
        <Bar
          label="5h"
          pct={session?.usedPct ?? null}
          color={unreadColor(colors.surface0)}
          note={session?.resetsAt ? `resets in ${until(session.resetsAt)}` : "no data"}
          colors={colors}
        />
        <Bar
          label="Weekly"
          pct={weekly?.usedPct ?? null}
          color={mergedColor(colors.surface0)}
          note={weekly?.resetsAt ? `resets in ${until(weekly.resetsAt)}` : "no data"}
          colors={colors}
        />
      </Pressable>
    </>
  );
}

function Bar({
  label,
  pct: raw,
  color,
  note,
  dangerAt = 90,
  colors,
}: {
  label: string;
  pct: number | null;
  color: string;
  note: string;
  dangerAt?: number;
  colors: Colors;
}) {
  const pct = raw === null ? null : Math.max(0, Math.min(100, raw));
  const fill = pct !== null && pct >= dangerAt ? colors.statusDanger : color;
  return (
    <View
      accessibilityLabel={`${label} ${pct === null ? "unknown" : `${Math.round(pct)} percent used`}, ${note}`}
      style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
    >
      <Text numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: 11, width: 48 }}>
        {label}
      </Text>
      <View style={{ width: 56, height: 6, borderRadius: 3, backgroundColor: shades(colors.foreground).button, overflow: "hidden" }}>
        <View style={{ width: `${pct ?? 0}%`, height: 6, borderRadius: 3, backgroundColor: fill }} />
      </View>
      <Text style={{ color: pct === null ? colors.foregroundMuted : fill, fontSize: 11, width: 32 }}>
        {pct === null ? "–" : `${Math.round(pct)}%`}
      </Text>
      <Text numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: 10, flex: 1 }}>
        {note}
      </Text>
    </View>
  );
}

function UsageDetails({
  usage,
  refreshing,
  onRefresh,
  colors,
}: {
  usage: ClaudeUsage | null;
  refreshing: boolean;
  onRefresh(): void;
  colors: Colors;
}) {
  if (!usage) return <Text style={{ color: colors.foregroundMuted, fontSize: 13 }}>No Claude usage data.</Text>;
  return (
    <View style={{ gap: 16 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "600" }}>{usage.title}</Text>
        {usage.planLabel ? (
          <Text
            style={{
              color: colors.foregroundMuted,
              fontSize: 11,
              backgroundColor: colors.surface2,
              borderRadius: 6,
              paddingHorizontal: 6,
              paddingVertical: 2,
            }}
          >
            {usage.planLabel}
          </Text>
        ) : null}
        <View style={{ flex: 1 }} />
        <Pressable accessibilityRole="button" accessibilityLabel="Refresh usage" onPress={onRefresh} hitSlop={8}>
          <Text style={{ color: colors.foregroundMuted, fontSize: 14 }}>{refreshing ? "…" : "↻"}</Text>
        </Pressable>
      </View>
      {usage.windows.map((window) => (
        <WindowRow key={window.id} window={window} colors={colors} />
      ))}
      {usage.details.map((detail) => (
        <View key={detail.id} style={{ flexDirection: "row" }}>
          <Text style={{ color: colors.foregroundMuted, fontSize: 12, flex: 1 }}>{detail.label}</Text>
          <Text style={{ color: colors.foreground, fontSize: 12 }}>{detail.value}</Text>
        </View>
      ))}
      {usage.account ? <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{usage.account}</Text> : null}
      <Text style={{ color: colors.foregroundMuted, fontSize: 10 }}>Updated {clock(usage.fetchedAt)}</Text>
    </View>
  );
}

function WindowRow({ window, colors }: { window: UsageWindow; colors: Colors }) {
  const pct = Math.max(0, Math.min(100, window.usedPct));
  const color = pct >= 75 ? colors.statusDanger : pct >= 30 ? colors.statusWarning : colors.statusSuccess;
  const parts: string[] = [];
  if (window.resetsAt) {
    parts.push(`resets in ${until(window.resetsAt)}`, resetClock(window.resetsAt));
    const runsOut = runOut(window);
    if (runsOut) parts.push(`runs out ${clock(runsOut)}`);
  }
  return (
    <View style={{ gap: 6 }} accessibilityLabel={`${window.label}, ${Math.round(pct)} percent used, ${parts.join(", ")}`}>
      <View style={{ flexDirection: "row" }}>
        <Text style={{ color: colors.foreground, fontSize: 13, flex: 1 }}>{window.label}</Text>
        <Text style={{ color: colors.foreground, fontSize: 13 }}>{Math.round(pct)}% used</Text>
      </View>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.surface2, overflow: "hidden" }}>
        <View style={{ width: `${pct}%`, height: 6, borderRadius: 3, backgroundColor: color }} />
      </View>
      {parts.length ? <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{parts.join(" · ")}</Text> : null}
    </View>
  );
}

function useClaudeUsage(): { usage: ClaudeUsage | null; refresh(): void; refreshing: boolean } {
  const paseo = usePaseo();
  const [usage, setUsage] = useState<ClaudeUsage | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let stopped = false;
    // Only a refresh you asked for shows as loading; the minutely poll updates silently.
    const load = async (shown: boolean) => {
      if (shown) setRefreshing(true);
      try {
        const result = await paseo.providers.listUsage();
        const claude = result.providers.find(
          (provider) => provider.providerId === "claude" && provider.status === "available",
        );
        if (stopped) return;
        setUsage(
          claude
            ? {
                title: claude.displayName.replace(/\s*\([^)]*\)\s*$/, "") || "Claude",
                account: claude.displayName.match(/\(([^)]+)\)\s*$/)?.[1] ?? null,
                planLabel: claude.planLabel ?? null,
                windows: (claude.windows ?? []) as UsageWindow[],
                details: (claude.details ?? []) as ClaudeUsage["details"],
                fetchedAt: result.fetchedAt,
              }
            : null,
        );
      } finally {
        if (!stopped) setRefreshing(false);
      }
    };
    const run = (shown: boolean) =>
      load(shown).catch((error: unknown) => console.error("[workspace-tree] usage read failed", error));
    run(tick > 0);
    const timer = setInterval(() => run(false), USAGE_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [paseo, tick]);
  return { usage, refresh: () => setTick((value) => value + 1), refreshing };
}

function useAgentContext(workspace: WorkspaceRef | null, active: AgentRef | null): ContextReading | null {
  const paseo = usePaseo();
  const agents = useAgents({
    where: (agent) => !agent.background && workspace !== null && agent.workspace.key === workspace.key,
    orderBy: ["lastActivityAt", "desc"],
  });
  const onScreen = active && agents.some((ref) => ref.key === active.key) ? active : null;
  const target = onScreen ?? agents[0] ?? null;
  const targetKey = target?.key ?? null;
  const [reading, setReading] = useState<ContextReading | null>(null);
  useEffect(() => {
    setReading(null);
    if (!target) return undefined;
    let stopped = false;
    const handle = paseo.agents.ref(target);
    const load = async () => {
      await handle.refresh();
      const usage = handle.lastUsage;
      if (stopped) return;
      if (!usage?.contextWindowMaxTokens || usage.contextWindowUsedTokens === undefined) return setReading(null);
      setReading({
        pct: (usage.contextWindowUsedTokens / usage.contextWindowMaxTokens) * 100,
        used: usage.contextWindowUsedTokens,
        max: usage.contextWindowMaxTokens,
      });
    };
    const tick = () => load().catch((error: unknown) => console.error("[workspace-tree] context read failed", error));
    tick();
    const timer = setInterval(tick, CONTEXT_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
    // The key identifies the agent; the ref object may be rebuilt with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paseo, targetKey]);
  return reading;
}

function short(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return String(tokens);
}

function until(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 60_000));
  if (minutes >= 24 * 60) return `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** Time only when the reset is within a day; else weekday and time. */
function resetClock(iso: string): string {
  const date = new Date(iso);
  if (date.getTime() - Date.now() < 24 * 3600_000) return clock(iso);
  return `${date.toLocaleDateString([], { weekday: "short" })} ${clock(iso)}`;
}

/** When the window reaches 100% at the current rate, if that is before it resets; else null. */
function runOut(window: UsageWindow): string | null {
  if (!window.resetsAt || !window.durationSeconds || window.usedPct <= 0 || window.usedPct >= 100) return null;
  const reset = Date.parse(window.resetsAt);
  const start = reset - window.durationSeconds * 1000;
  const elapsed = Date.now() - start;
  if (elapsed <= 0) return null;
  const at = Date.now() + ((100 - window.usedPct) / window.usedPct) * elapsed;
  return at < reset ? new Date(at).toISOString() : null;
}
