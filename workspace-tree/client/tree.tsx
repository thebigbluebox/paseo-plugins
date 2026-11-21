import type { WorkspaceIndicator } from "@getpaseo/plugin";
import {
  useSettings,
  useWorkspace,
  useWorkspaces,
  type Group,
  type PluginSidebarViewProps,
  type WorkspaceRef,
} from "@getpaseo/plugin/client";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { treeLayout, treeParents } from "../shared/preferences";
import {
  DragController,
  useDragHandlers,
  useDragState,
  useRowDragState,
  type DropTarget,
} from "./drag";
import { shades, unreadColor } from "./colors";
import { confirmGone, nodeKey, useParents } from "./parents";
import { RowActions } from "./actions";
import { useSyncedSettings } from "./synced";
import { PullRequestLine } from "./prs";

// macOS / VS Code sidebar sizing: 13pt titles on an 18pt line, 11pt secondary text and headings.
const INDENT = 14;
const ROW_HEIGHT = 26;
const TITLE_SIZE = 13;
const TITLE_LINE = 18;
/** Box matching the title's first line (4pt padding + 18pt line), for items that sit beside it. */
const titleLine = { height: TITLE_LINE, marginTop: 4, justifyContent: "center", alignItems: "center" } as const;
const projectKey = (groupKey: string) => `project:${groupKey}`;
const HOVER_GRACE_MS = 100;

type Colors = PluginSidebarViewProps["theme"]["colors"];

interface TreeNode {
  key: string;
  ref: WorkspaceRef;
  children: TreeNode[];
}

interface Placement {
  ref: WorkspaceRef;
  project: string;
  /** Parent as drawn: null when the workspace sits at the top level of its project. */
  parent: string | null;
}

/** Nests a project's workspaces under their parents. A parent outside the list makes a root. */
function buildForest(
  refs: readonly WorkspaceRef[],
  parents: ReadonlyMap<string, string | null>,
): TreeNode[] {
  const nodes = new Map<string, TreeNode>();
  for (const ref of refs) {
    const key = nodeKey(ref.hostId, ref.id);
    nodes.set(key, { key, ref, children: [] });
  }
  const roots: TreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = nodes.get(parents.get(node.key) ?? "");
    if (parent && !isAncestor(node.key, parent.key, parents)) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/** True when `candidate` is `of` or one of its ancestors. Stops on a loop in stored data. */
function isAncestor(
  candidate: string,
  of: string,
  parents: ReadonlyMap<string, string | null>,
): boolean {
  const seen = new Set<string>();
  for (let key: string | null | undefined = of; key; key = parents.get(key)) {
    if (key === candidate) return true;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return false;
}

function place(nodes: TreeNode[], project: string, parent: string | null, out: Map<string, Placement>) {
  for (const node of nodes) {
    out.set(node.key, { ref: node.ref, project, parent });
    place(node.children, project, node.key, out);
  }
}

/** Whether the open workspace is inside this node's children, to highlight that family's guide. */
function containsActive(node: TreeNode, activeKey: string | undefined): boolean {
  if (!activeKey) return false;
  return node.children.some((child) => child.ref.key === activeKey || containsActive(child, activeKey));
}

function countDescendants(node: TreeNode): number {
  return node.children.reduce((total, child) => total + 1 + countDescendants(child), 0);
}

function indicatorColor(indicator: WorkspaceIndicator, colors: Colors): string | null {
  switch (indicator) {
    // Green while an agent works, blue once there is something new to read, so the two
    // never look alike whatever the theme's accent is.
    case "running":
      return colors.statusSuccess;
    case "needs_input":
      return colors.statusWarning;
    case "attention":
      return unreadColor(colors.surface0);
    case "failed":
      return colors.statusDanger;
    default:
      return null;
  }
}

/** Most urgent first; a folded parent shows the most urgent status hidden inside it. */
const URGENCY: Record<WorkspaceIndicator, number> = {
  failed: 4,
  needs_input: 3,
  attention: 2,
  running: 1,
  done: 0,
};

function hiddenStatus(
  node: TreeNode,
  indicators: ReadonlyMap<string, WorkspaceIndicator>,
): WorkspaceIndicator | null {
  let worst: WorkspaceIndicator | null = null;
  const visit = (nodes: TreeNode[]) => {
    for (const child of nodes) {
      const indicator = indicators.get(child.key);
      if (indicator && indicator !== "done" && (!worst || URGENCY[indicator] > URGENCY[worst])) {
        worst = indicator;
      }
      visit(child.children);
    }
  };
  visit(node.children);
  return worst;
}

interface Layout {
  collapsed: ReadonlySet<string>;
  toggle(key: string): void;
}

interface TreeContext {
  view: PluginSidebarViewProps;
  layout: Layout;
  controller: DragController;
  dragEnabled: boolean;
  indicators: ReadonlyMap<string, WorkspaceIndicator>;
}

function Chevron({
  open,
  label,
  onPress,
  color,
}: {
  open: boolean | null;
  label: string;
  onPress?: () => void;
  color: string;
}) {
  if (open === null) return <View style={{ ...titleLine, width: 16 }} />;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${open ? "Collapse" : "Expand"} ${label}`}
      accessibilityState={{ expanded: open }}
      onPress={onPress}
      hitSlop={6}
      style={{ ...titleLine, width: 16 }}
    >
      <Text style={{ color, fontSize: 10 }}>{open ? "▾" : "▸"}</Text>
    </Pressable>
  );
}

/** Accent line showing where a "before" or "after" drop lands. */
function InsertLine({ edge, left, color }: { edge: "top" | "bottom"; left: number; color: string }) {
  return (
    <View
      pointerEvents="none"
      style={{ position: "absolute", left, right: 8, height: 2, [edge]: -1, backgroundColor: color }}
    />
  );
}

const WorkspaceNode = memo(function WorkspaceNode({
  node,
  depth,
  context,
}: {
  node: TreeNode;
  depth: number;
  context: TreeContext;
}) {
  const { view, layout, controller, dragEnabled, indicators } = context;
  const { colors } = view.theme;
  const shade = useMemo(() => shades(colors.foreground), [colors.foreground]);
  const row = useWorkspace(node.ref, (workspace) => ({
    label: workspace.title ?? workspace.name,
    indicator: workspace.indicator,
    indicatorLabel: workspace.indicatorLabel,
  }));
  const drag = useRowDragState(controller, node.key);
  const handlers = useDragHandlers(controller, node.key, dragEnabled);
  const register = useCallback(
    (element: View | null) => controller.register(node.key, "workspace", element),
    [controller, node.key],
  );
  const hasChildren = node.children.length > 0;
  const open = hasChildren ? !layout.collapsed.has(node.key) : null;
  const selected = view.active.workspace?.key === node.ref.key;
  // The highlight follows the pointer at once. Only the buttons linger briefly after the pointer
  // leaves: crossing from the row onto a button can report a hover-out first, which used to hide
  // the button just as the pointer reached it. Delaying the highlight too made hovering feel laggy.
  const [hovered, setHovered] = useState(false);
  const [showButtons, setShowButtons] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverIn = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
    setHovered(true);
    setShowButtons(true);
  }, []);
  const hoverOut = useCallback(() => {
    setHovered(false);
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setShowButtons(false), HOVER_GRACE_MS);
  }, []);
  useEffect(
    () => () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
    },
    [],
  );

  const press = useCallback(() => {
    if (drag.picking) {
      if (drag.isSource) controller.cancel();
      else controller.place({ key: node.key, mode: "inside" });
      return;
    }
    view.navigation.openWorkspace(node.ref);
  }, [drag.picking, drag.isSource, controller, node.key, node.ref, view.navigation]);
  const pick = useCallback(() => controller.pick(node.key), [controller, node.key]);
  const toggle = useCallback(() => layout.toggle(node.key), [layout, node.key]);

  if (!row) return null;
  const dot = indicatorColor(row.indicator, colors);
  const hidden = open === false ? countDescendants(node) : 0;
  const hiddenDot = hidden > 0 ? indicatorColor(hiddenStatus(node, indicators) ?? "done", colors) : null;
  const indent = 8 + depth * INDENT;
  const inside = drag.dropMode === "inside";

  return (
    <View>
      <View ref={register} {...handlers}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            drag.picking
              ? `Move into ${row.label}`
              : `Open ${row.label}${row.indicatorLabel ? `, ${row.indicatorLabel}` : ""}`
          }
          accessibilityHint="Long press to move this workspace"
          onPress={press}
          onLongPress={pick}
          onHoverIn={hoverIn}
          onHoverOut={hoverOut}
          style={({ pressed }) => ({
            minHeight: ROW_HEIGHT,
            flexDirection: "row",
            // Top-aligned so the chevron and dot sit on the title's line, not centered on the PR line.
            alignItems: "flex-start",
            gap: 8,
            paddingLeft: indent,
            paddingRight: 8,
            opacity: drag.isSource ? 0.45 : 1,
            borderWidth: 1,
            borderRadius: 4,
            borderColor: inside ? colors.accent : "transparent",
            backgroundColor:
              inside || selected ? shade.selected : pressed ? shade.pressed : hovered ? shade.hover : undefined,
          })}
        >
          <Chevron open={open} label={row.label} onPress={toggle} color={colors.foregroundMuted} />
          <View style={titleLine}>
            <View
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: dot ?? "transparent",
                borderWidth: dot ? 0 : 1,
                borderColor: shade.lineStrong,
              }}
            />
          </View>
          <View style={{ flex: 1, paddingVertical: 4, gap: 2 }}>
            <Text
              numberOfLines={1}
              style={{ color: colors.foreground, fontSize: TITLE_SIZE, lineHeight: TITLE_LINE }}
            >
              {row.label}
            </Text>
            <PullRequestLine workspaceId={node.ref.id} colors={colors} />
          </View>
          {hidden > 0 ? (
            <View
              style={{ ...titleLine, flexDirection: "row", gap: 4 }}
              accessibilityLabel={`${hidden} hidden workspaces`}
            >
              {hiddenDot ? (
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: hiddenDot }} />
              ) : null}
              <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{hidden}</Text>
            </View>
          ) : null}
          <RowActions
            reference={node.ref}
            colors={colors}
            showControls={showButtons}
            inline={view.layout.compact}
            onMove={pick}
            childCount={node.children.length}
          />
        </Pressable>
        {selected ? (
          // The open workspace gets an accent bar as well as its fill, so it is never confused
          // with a hovered row or a family group.
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: 0,
              top: 3,
              bottom: 3,
              width: 3,
              borderRadius: 1.5,
              backgroundColor: colors.accent,
            }}
          />
        ) : null}
        {drag.dropMode === "before" ? (
          <InsertLine edge="top" left={indent} color={colors.accent} />
        ) : null}
        {drag.dropMode === "after" ? (
          <InsertLine edge="bottom" left={indent} color={colors.accent} />
        ) : null}
      </View>
      {open ? (
        <View>
          {node.children.map((child) => (
            <WorkspaceNode key={child.key} node={child} depth={depth + 1} context={context} />
          ))}
          {/* Guide line linking children to their parent, like an editor's file tree. Drawn after
              the rows so a hovered or selected row's background cannot cover it. It is
              brighter for the family holding the open workspace, as VS Code does. */}
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              zIndex: 1,
              left: indent + 8,
              top: 0,
              bottom: 4,
              width: 1,
              backgroundColor: colors.foregroundMuted,
              opacity: containsActive(node, view.active.workspace?.key) ? 0.9 : 0.55,
            }}
          />
        </View>
      ) : null}
    </View>
  );
});

function ProjectSection({
  group,
  forest,
  context,
  first,
}: {
  group: Group<WorkspaceRef>;
  forest: TreeNode[];
  context: TreeContext;
  first: boolean;
}) {
  const { view, layout, controller } = context;
  const { colors } = view.theme;
  const key = projectKey(group.key);
  const drag = useRowDragState(controller, key);
  const register = useCallback(
    (element: View | null) => controller.register(key, "project", element),
    [controller, key],
  );
  const open = !layout.collapsed.has(key);
  const title = group.title ?? "Workspaces";
  const press = useCallback(() => {
    if (drag.picking) controller.place({ key, mode: "top" });
    else layout.toggle(key);
  }, [drag.picking, controller, layout, key]);
  const target = drag.dropMode === "top";

  return (
    <View
      style={{
        paddingBottom: 6,
        // A rule between projects, so each project reads as its own block.
        ...(first
          ? null
          : { marginTop: 6, paddingTop: 4, borderTopWidth: 1, borderTopColor: shades(colors.foreground).line }),
      }}
    >
      <View ref={register}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            drag.picking ? `Move to the top level of ${title}` : `${open ? "Collapse" : "Expand"} ${title}`
          }
          accessibilityState={drag.picking ? undefined : { expanded: open }}
          onPress={press}
          style={{
            minHeight: ROW_HEIGHT,
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingHorizontal: 8,
            marginTop: 2,
            borderWidth: 1,
            borderRadius: 4,
            borderColor: target ? colors.accent : "transparent",
            backgroundColor: target ? shades(colors.foreground).selected : undefined,
          }}
        >
          <Text style={{ width: 16, textAlign: "center", color: colors.foregroundMuted, fontSize: 10 }}>
            {open ? "▾" : "▸"}
          </Text>
          <Text
            accessibilityRole="header"
            numberOfLines={1}
            style={{
              flex: 1,
              color: colors.foregroundMuted,
              fontSize: 11,
              fontWeight: "600",
              letterSpacing: 0.4,
              textTransform: "uppercase",
            }}
          >
            {title}
          </Text>
          {drag.picking ? (
            <Text style={{ color: colors.accent, fontSize: 11 }}>Top level</Text>
          ) : !open ? (
            <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{group.items.length}</Text>
          ) : null}
        </Pressable>
      </View>
      {open
        ? forest.map((node) =>
            node.children.length > 0 ? (
              // Each family sits in an outlined card, so a parent and everything it spawned read as
              // one group. Outline only: a fill is how the open workspace is marked, and a filled
              // card looked like the whole family was selected.
              <View
                key={node.key}
                style={{
                  marginVertical: 4,
                  marginHorizontal: 4,
                  paddingVertical: 2,
                  borderRadius: 6,
                  borderWidth: 1,
                  borderColor: shades(colors.foreground).lineStrong,
                  overflow: "hidden",
                }}
              >
                <WorkspaceNode node={node} depth={0} context={context} />
              </View>
            ) : (
              <WorkspaceNode key={node.key} node={node} depth={0} context={context} />
            ),
          )
        : null}
    </View>
  );
}

/** Shown while a picked workspace waits for a destination tap. */
function PickBanner({
  context,
  placements,
  overrides,
  restore,
}: {
  context: TreeContext;
  placements: ReadonlyMap<string, Placement>;
  overrides: Readonly<Record<string, string | null>> | null;
  restore: (key: string) => void;
}) {
  const state = useDragState(context.controller);
  const source = state.gesture === "pick" ? state.source : null;
  const ref = source ? placements.get(source)?.ref : undefined;
  if (!source || !ref) return null;
  return (
    <PickBannerBody
      context={context}
      source={source}
      reference={ref}
      moved={!!overrides && source in overrides}
      restore={restore}
    />
  );
}

function PickBannerBody({
  context,
  source,
  reference,
  moved,
  restore,
}: {
  context: TreeContext;
  source: string;
  reference: WorkspaceRef;
  moved: boolean;
  restore: (key: string) => void;
}) {
  const { controller, view } = context;
  const { colors } = view.theme;
  const name = useWorkspace(reference, (workspace) => workspace.title ?? workspace.name);
  const button = (label: string, onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={{ paddingVertical: 4, paddingHorizontal: 8, borderRadius: 4, backgroundColor: shades(colors.foreground).button }}
    >
      <Text style={{ color: colors.foreground, fontSize: 11 }}>{label}</Text>
    </Pressable>
  );
  return (
    <View
      style={{
        margin: 8,
        padding: 8,
        gap: 6,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: colors.accent,
        backgroundColor: shades(colors.foreground).hover,
      }}
    >
      <Text numberOfLines={2} style={{ color: colors.foreground, fontSize: 12 }}>
        Moving {name ?? "workspace"}
      </Text>
      <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>
        Tap a workspace to nest it there, or a project heading to move it to the top level.
      </Text>
      <View style={{ flexDirection: "row", gap: 6 }}>
        {moved
          ? button("Restore original", () => {
              restore(source);
              controller.cancel();
            })
          : null}
        {button("Cancel", () => controller.cancel())}
      </View>
    </View>
  );
}

/**
 * Says so when saved moves or folds cannot be read or written, instead of the tree quietly
 * ignoring drags and folds.
 */
function SettingsProblem({
  what,
  state,
  saveFailed,
  colors,
}: {
  what: string;
  state: { status: string; error?: string; reload(): Promise<void>; reset(): Promise<boolean> };
  saveFailed: boolean;
  colors: Colors;
}) {
  const unreadable = state.status === "error" || state.status === "invalid";
  if (!unreadable && !saveFailed) return null;
  const message = unreadable
    ? `Could not load ${what}${state.error ? `: ${state.error}` : ""}. Changes will not be saved.`
    : `Could not save ${what}. Your last change may be lost.`;
  const button = (label: string, onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={{ paddingVertical: 3, paddingHorizontal: 8, borderRadius: 4, backgroundColor: shades(colors.foreground).button }}
    >
      <Text style={{ color: colors.foreground, fontSize: 11 }}>{label}</Text>
    </Pressable>
  );
  return (
    <View
      style={{
        marginHorizontal: 8,
        marginVertical: 4,
        padding: 8,
        gap: 6,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: colors.statusDanger,
      }}
    >
      <Text style={{ color: colors.statusDanger, fontSize: 11 }}>{message}</Text>
      <View style={{ flexDirection: "row", gap: 6 }}>
        {button("Retry", () => void state.reload())}
        {state.status === "invalid" ? button("Reset", () => void state.reset()) : null}
      </View>
    </View>
  );
}

export function WorkspaceTree(view: PluginSidebarViewProps) {
  const layoutSettings = useSettings(treeLayout);
  const parentSettings = useSettings(treeParents);
  const controller = useRef(new DragController()).current;
  const groups = useWorkspaces({
    where: (workspace) => !workspace.background && !workspace.archivingAt,
    orderBy: ["createdAt", "desc"],
    groupBy: (workspace) => ({ key: workspace.project.key, title: workspace.projectDisplayName }),
  });
  const refs = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const { parents: recorded, ready: parentsReady } = useParents(refs);

  const parentsSync = useSyncedSettings(parentSettings);
  const layoutSync = useSyncedSettings(layoutSettings);
  const overrides = parentsSync.value?.overrides ?? null;
  const byIndicator = useWorkspaces({
    where: (workspace) => !workspace.background && !workspace.archivingAt,
    groupBy: (workspace) => workspace.indicator,
  });
  const indicators = useMemo(() => {
    const map = new Map<string, WorkspaceIndicator>();
    for (const group of byIndicator) {
      for (const ref of group.items) map.set(nodeKey(ref.hostId, ref.id), group.key as WorkspaceIndicator);
    }
    return map;
  }, [byIndicator]);
  const { forests, placements } = useMemo(() => {
    const effective = new Map(recorded);
    for (const [key, parent] of Object.entries(overrides ?? {})) effective.set(key, parent);
    const forests = new Map<string, TreeNode[]>();
    const placements = new Map<string, Placement>();
    for (const group of groups) {
      const forest = buildForest(group.items, effective);
      forests.set(group.key, forest);
      place(forest, projectKey(group.key), null, placements);
    }
    return { forests, placements };
  }, [groups, recorded, overrides]);

  // Read through refs so gesture handlers created once always see the current tree.
  const latest = useRef({ placements, recorded, overrides, parentsSync });
  latest.current = { placements, recorded, overrides, parentsSync };

  const saveParent = useCallback((source: string, parent: string | null | "recorded") => {
    const { recorded, overrides, parentsSync } = latest.current;
    if (overrides === null) return;
    const next = { ...overrides };
    if (parent === "recorded" || parent === (recorded.get(source) ?? null)) delete next[source];
    else next[source] = parent;
    parentsSync.set({ overrides: next });
  }, []);

  controller.policy = useMemo(
    () => ({
      resolve(source: string, target: DropTarget) {
        const { placements } = latest.current;
        const from = placements.get(source);
        if (!from) return undefined;
        let parent: string | null;
        if (target.mode === "top") {
          if (target.key !== from.project) return undefined;
          parent = null;
        } else {
          const to = placements.get(target.key);
          if (!to || to.project !== from.project) return undefined;
          parent = target.mode === "inside" ? target.key : to.parent;
        }
        if (parent === from.parent) return undefined;
        if (parent !== null) {
          // A workspace cannot move into itself or anything nested under it.
          for (let key: string | null = parent; key; key = placements.get(key)?.parent ?? null) {
            if (key === source) return undefined;
          }
        }
        return parent;
      },
      commit: saveParent,
    }),
    [saveParent],
  );

  const collapsedList = layoutSync.value?.collapsed ?? null;
  const setLayout = layoutSync.set;
  const layout = useMemo<Layout>(() => {
    const collapsed = new Set(collapsedList ?? []);
    return {
      collapsed,
      toggle(key) {
        if (collapsedList === null) return;
        const next = new Set(collapsed);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        setLayout({ collapsed: [...next] });
      },
    };
  }, [collapsedList, setLayout]);

  const context = useMemo<TreeContext>(
    () => ({ view, layout, controller, dragEnabled: !view.layout.compact, indicators }),
    [view, layout, controller, indicators],
  );
  const restore = useCallback((key: string) => saveParent(key, "recorded"), [saveParent]);

  // Once per session, forget saved moves and folds for workspaces their host confirms no longer
  // exist. A workspace that is only missing from a list (slow or offline host) keeps its state,
  // so pruning can never make a family jump.
  const pruned = useRef(false);
  useEffect(() => {
    if (pruned.current || !parentsReady || overrides === null || collapsedList === null) return;
    const isWorkspaceKey = (key: string) => !key.startsWith("project:") && key.includes("/");
    const candidates = new Set<string>();
    for (const [key, parent] of Object.entries(overrides)) {
      if (!recorded.has(key)) candidates.add(key);
      if (parent && !recorded.has(parent)) candidates.add(parent);
    }
    for (const key of collapsedList) if (isWorkspaceKey(key) && !recorded.has(key)) candidates.add(key);
    pruned.current = true;
    if (candidates.size === 0) return;
    void confirmGone([...candidates]).then((gone) => {
      if (gone.size === 0) return;
      const { overrides: currentOverrides, collapsedList: currentCollapsed } = latestPrune.current;
      if (currentOverrides) {
        const kept = Object.fromEntries(
          Object.entries(currentOverrides).filter(([key, parent]) => !gone.has(key) && !(parent && gone.has(parent))),
        );
        if (Object.keys(kept).length !== Object.keys(currentOverrides).length) parentsSync.set({ overrides: kept });
      }
      if (currentCollapsed) {
        const kept = currentCollapsed.filter((key) => !gone.has(key));
        if (kept.length !== currentCollapsed.length) layoutSync.set({ collapsed: kept });
      }
    });
  }, [parentsReady, overrides, collapsedList, recorded, parentsSync, layoutSync]);
  const latestPrune = useRef({ overrides, collapsedList });
  latestPrune.current = { overrides, collapsedList };

  // Wait for saved state and parent links the first time only, so folded folders and families do
  // not jump into place. After that keep drawing the last known tree: a settings reload (a save
  // retry, a reconnect) used to blank the whole view for a moment.
  const loaded = useRef(false);
  if (layoutSettings.status !== "loading" && parentSettings.status !== "loading" && parentsReady) {
    loaded.current = true;
  }
  if (!loaded.current) return null;

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 4 }}>
      <PickBanner context={context} placements={placements} overrides={overrides} restore={restore} />
      <SettingsProblem
        what="workspace moves"
        state={parentSettings}
        saveFailed={parentsSync.failed}
        colors={view.theme.colors}
      />
      <SettingsProblem
        what="folded folders"
        state={layoutSettings}
        saveFailed={layoutSync.failed}
        colors={view.theme.colors}
      />
      {groups.length === 0 ? (
        <Text style={{ color: view.theme.colors.foregroundMuted, fontSize: 12, padding: 12 }}>
          No workspaces yet.
        </Text>
      ) : null}
      {groups.map((group, index) => (
        <ProjectSection
          key={group.key}
          first={index === 0}
          group={group}
          forest={forests.get(group.key) ?? []}
          context={context}
        />
      ))}
    </ScrollView>
  );
}
