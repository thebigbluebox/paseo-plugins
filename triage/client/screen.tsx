import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Card } from "./card";
import { useBottomInset } from "./inset";
import { useKeepReplyVisible } from "./reply";
import { overlay } from "./colors";
import { deck, useTriageQueue, type Family, type Member } from "./queue";

/** Wide enough to use the window, narrow enough that the message stays readable. */
const MAX_WIDTH = 960;

function Empty({ view }: { view: PluginScreenProps }) {
  const colors = view.theme.colors;
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 10 }}>
      <Icon name="CircleCheck" size={28} color={colors.statusSuccess} />
      <Text style={{ color: colors.foreground, fontSize: 16, fontWeight: "500" }}>Nothing needs you</Text>
      <Text style={{ color: colors.foregroundMuted, fontSize: 13, textAlign: "center" }}>
        Agents that finish, hit an error, or ask for permission show up here.
      </Text>
    </View>
  );
}

/**
 * The top card with the next two peeking out beneath it, so the queue reads as a deck. Takes
 * all the height it is given, so the card is the same size whatever it holds.
 */
function Deck({
  queue,
  selected,
  onSelect,
  view,
}: {
  queue: Family[];
  selected: Member;
  onSelect(key: string): void;
  view: PluginScreenProps;
}) {
  const colors = view.theme.colors;
  const top = queue[0];
  const depth = Math.min(queue.length - 1, 2);
  // Sheet 1 sits right under the card, sheet 2 under that; each peeks 6pt below the one above.
  const sheet = (level: 1 | 2, opacity: number) => (
    <View
      style={{
        position: "absolute",
        left: level * 12,
        right: level * 12,
        top: level * 12,
        bottom: (depth - level) * 6,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface1,
        opacity,
      }}
    />
  );
  return (
    <View style={{ flex: 1, minHeight: 0, paddingBottom: depth * 6 }}>
      {depth >= 2 ? sheet(2, 0.5) : null}
      {depth >= 1 ? sheet(1, 0.8) : null}
      <Card
        key={top.key}
        family={top}
        selected={selected}
        onSelect={onSelect}
        canSkip={queue.length > 1}
        view={view}
      />
    </View>
  );
}

function RoundButton({
  icon,
  label,
  size,
  tone,
  disabled,
  onPress,
  view,
}: {
  icon: string;
  label: string;
  size: number;
  tone: "plain" | "primary";
  disabled?: boolean;
  onPress(): void;
  view: PluginScreenProps;
}) {
  const colors = view.theme.colors;
  const primary = tone === "primary";
  return (
    <View style={{ alignItems: "center", gap: 4, opacity: disabled ? 0.35 : 1 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        disabled={disabled}
        onPress={onPress}
        style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => ({
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: "center",
          justifyContent: "center",
          borderWidth: primary ? 0 : 1,
          borderColor: colors.border,
          backgroundColor: primary
            ? colors.accent
            : pressed
              ? overlay(colors.foreground, 0.12)
              : hovered
                ? overlay(colors.foreground, 0.06)
                : colors.surface1,
          transform: [{ scale: pressed ? 0.94 : 1 }],
        })}
      >
        <Icon name={icon} size={Math.round(size * 0.42)} color={primary ? colors.accentForeground : colors.foreground} />
      </Pressable>
      <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{label}</Text>
    </View>
  );
}

const GAP = 36;

/** Under the card: skip it, or open the agent shown. */
function ActionBar({
  canSkip,
  onSkip,
  onOpen,
  view,
}: {
  /** False with one card left: skipping would deal the same card again. */
  canSkip: boolean;
  onSkip(): void;
  onOpen: (() => void) | null;
  view: PluginScreenProps;
}) {
  const size = view.layout.compact ? 56 : 52;
  return (
    <View style={{ flexDirection: "row", justifyContent: "center", alignItems: "flex-end", gap: GAP, paddingTop: 4 }}>
      <RoundButton icon="X" label="Skip" size={size} tone="plain" disabled={!canSkip} onPress={onSkip} view={view} />
      {onOpen ? <RoundButton icon="ArrowUpRight" label="Open" size={size} tone="primary" onPress={onOpen} view={view} /> : null}
    </View>
  );
}

/**
 * Fits the window on every device: nothing here scrolls. Only the message inside the card does,
 * and the family tree when it is long.
 */
export function TriageScreen(view: PluginScreenProps) {
  const { theme, layout } = view;
  const colors = theme.colors;
  const { families: queue, held } = useTriageQueue();
  // Which member of the top family is shown; the card and the Open button follow it.
  const [selection, setSelection] = useState<{ family: string; key: string } | null>(null);
  const top = queue[0];
  const selected = top
    ? ((selection?.family === top.key && top.members.find((member) => member.ref.key === selection.key)) ||
      top.members[0])
    : null;
  const navigation = view.navigation;
  const open =
    navigation && selected
      ? () => navigation.openAgent({ agentId: selected.ref.id, serverId: selected.ref.hostId })
      : null;
  // Agents, not cards, so it matches the sidebar row.
  const agents = queue.reduce((total, family) => total + family.members.length, 0);
  const screen = useRef<View>(null);
  const [viewport, setViewport] = useState(0);
  const scroll = useRef<ScrollView>(null);
  const content = useRef<View>(null);
  const contentTop = layout.compact ? 10 : 16;
  const reply = useKeepReplyVisible(scroll, content, contentTop, screen);
  const space = useBottomInset(screen);
  const pad = layout.compact ? 12 : 16;

  return (
    <View
      ref={screen}
      onLayout={() => {
        space.onLayout();
        reply.onLayout();
      }}
      style={{ flex: 1, backgroundColor: colors.surface0 }}
    >
      {/*
        A scroll view the user cannot scroll, so iOS can handle the keyboard natively: it adds
        the keyboard's height as an inset and slides the screen up to keep the focused reply box
        in view, in step with the keyboard. Nothing is measured or laid out again in JavaScript.
      */}
      <ScrollView
        ref={scroll}
        style={{ flex: 1 }}
        onLayout={(event) => setViewport(Math.round(event.nativeEvent.layout.height))}
        scrollEnabled={false}
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          // Exactly the visible height: content in a scroll view is otherwise unbounded, and a
          // long message would stretch the card past the screen.
          height: viewport || undefined,
          alignItems: "center",
          paddingHorizontal: layout.compact ? 10 : 16,
          paddingTop: contentTop,
          paddingBottom: pad + space.bottom,
        }}
      >
      {/* Drawn once the height is known, so the card never shows at its unbounded size. */}
      {viewport ? (
      <View ref={content} style={{ flex: 1, minHeight: 0, width: "100%", maxWidth: MAX_WIDTH, gap: 8 }}>
        {agents || held ? (
          <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>
            {[agents ? `${agents} waiting` : null, held ? `${held} reported in, still working` : null]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        ) : null}
        {top && selected ? (
          <>
            <Deck
              queue={queue}
              selected={selected}
              onSelect={(key) => setSelection({ family: top.key, key })}
              view={view}
            />
            <ActionBar canSkip={queue.length > 1} onSkip={() => deck.skip(top.key)} onOpen={open} view={view} />
          </>
        ) : (
          <Empty view={view} />
        )}
      </View>
      ) : null}
      </ScrollView>
    </View>
  );
}
