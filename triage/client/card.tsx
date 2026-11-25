import type { PluginTheme } from "@getpaseo/plugin";
import type { AgentRef, PluginScreenProps } from "@getpaseo/plugin/client";
import { useAgent, usePaseo, useWorkspace } from "@getpaseo/plugin/client";
import { Markdown, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import type {
  AgentPermissionRequest,
  AgentPermissionResponse,
  AgentTimelineItem,
} from "@getpaseo/protocol/agent-types";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Keyboard, Platform, Pressable, ScrollView as NativeScrollView, Text, View, type TextInput as NativeTextInput } from "react-native";
import { overlay, reasonColor } from "./colors";
import { useParentWorkspace, useTask } from "./lineage";
import { deck, type Family, type Member } from "./queue";
import { replyTarget } from "./reply";
import { listenForKeys } from "./web";

type Colors = PluginTheme["colors"];

interface CardDetail {
  permission: AgentPermissionRequest | null;
  lastError: string | null;
  message: string | null;
}

/** The latest turn's last message, plus the pending permission or error. */
function useCardDetail(ref: AgentRef, activity: string | null) {
  const paseo = usePaseo();
  return useQuery({
    queryKey: ["triage-card", ref.key, activity],
    staleTime: 15_000,
    queryFn: async (): Promise<CardDetail> => {
      const handle = paseo.agents.ref(ref);
      const [refreshed, timeline] = await Promise.all([
        handle.refresh(),
        handle.timeline.refetch({ direction: "tail", limit: 1, wholeTurns: true }),
      ]);
      const items: AgentTimelineItem[] = timeline.entries.map((entry) => entry.item);
      const message = items.findLast((item) => item.type === "assistant_message");
      const error = items.findLast((item) => item.type === "error");
      const agent = refreshed?.agent;
      return {
        permission: agent?.pendingPermissions?.at(-1) ?? null,
        lastError: agent?.lastError ?? (error?.type === "error" ? error.message : null),
        message: message?.type === "assistant_message" ? message.text : null,
      };
    },
  });
}

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const minutes = Math.floor(Math.max(0, Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

/** The part of a permission request worth reading before allowing it. */
function permissionSubject(request: AgentPermissionRequest): { mono: boolean; text: string } | null {
  const detail = request.detail;
  if (detail) {
    switch (detail.type) {
      case "shell":
        return { mono: true, text: detail.command };
      case "edit":
      case "write":
      case "read":
        return { mono: true, text: detail.filePath };
      case "fetch":
        return { mono: true, text: detail.url };
      case "search":
        return { mono: true, text: detail.query };
    }
  }
  const input = request.input as Record<string, unknown> | undefined;
  if (typeof input?.plan === "string") return { mono: false, text: input.plan };
  if (typeof input?.command === "string") return { mono: true, text: input.command };
  return null;
}

/** Question prompts carry their questions in the input; answering them needs the agent view. */
function isQuestion(request: AgentPermissionRequest): boolean {
  return Array.isArray((request.input as { questions?: unknown } | undefined)?.questions);
}

interface Question {
  question: string;
  header: string;
  options: { label: string; description?: string }[];
  multiSelect?: boolean;
  allowOther?: boolean;
  allowEmpty?: boolean;
}

function readQuestions(request: AgentPermissionRequest): Question[] {
  const raw = (request.input as { questions?: unknown } | undefined)?.questions;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is Question =>
      typeof item === "object" && item !== null && typeof item.question === "string" && Array.isArray(item.options),
  );
}

/**
 * The answers object Paseo's own question form sends: each question's header mapped to the
 * chosen labels (joined with ", " for several), or to the typed answer when there is one.
 */
function buildAnswers(questions: Question[], picked: Set<number>[], other: string[]): Record<string, string> {
  const answers: Record<string, string> = {};
  questions.forEach((question, index) => {
    const labels = [...picked[index]].sort((a, b) => a - b).map((option) => question.options[option].label);
    const typed = other[index]?.trim();
    if (question.allowOther && typed) {
      answers[question.header] = question.multiSelect ? [...labels, typed].join(", ") : typed;
    } else if (question.allowEmpty && question.options.length === 0) {
      answers[question.header] = "";
    } else if (labels.length) {
      answers[question.header] = labels.join(", ");
    }
  });
  return answers;
}

/** A question the agent asked mid-turn, answered right on the card. */
function QuestionForm({
  request,
  busy,
  onAnswer,
  colors,
}: {
  request: AgentPermissionRequest;
  busy: boolean;
  onAnswer(answers: Record<string, string>): void;
  colors: Colors;
}) {
  const questions = readQuestions(request);
  const [picked, setPicked] = useState<Set<number>[]>(() => questions.map(() => new Set()));
  const [other, setOther] = useState<string[]>(() => questions.map(() => ""));
  const toggle = (questionIndex: number, option: number) =>
    setPicked((previous) =>
      previous.map((set, index) => {
        if (index !== questionIndex) return set;
        if (!questions[index].multiSelect) return new Set([option]);
        const next = new Set(set);
        if (next.has(option)) next.delete(option);
        else next.add(option);
        return next;
      }),
    );
  const complete = questions.every(
    (question, index) =>
      picked[index].size > 0 ||
      (question.allowOther && other[index].trim()) ||
      (question.allowEmpty && question.options.length === 0),
  );
  return (
    <View style={{ gap: 14 }}>
      {questions.map((question, questionIndex) => (
        <View key={`${question.header}-${questionIndex}`} style={{ gap: 8 }}>
          <Text style={{ color: colors.foreground, fontSize: 14, lineHeight: 20 }}>{question.question}</Text>
          {question.options.map((option, optionIndex) => {
            const selected = picked[questionIndex].has(optionIndex);
            return (
              <Pressable
                key={option.label}
                accessibilityRole={question.multiSelect ? "checkbox" : "radio"}
                accessibilityState={{ checked: selected }}
                accessibilityLabel={option.label}
                disabled={busy}
                onPress={() => toggle(questionIndex, optionIndex)}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  gap: 10,
                  padding: 10,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: selected ? colors.accent : colors.border,
                  backgroundColor: selected
                    ? overlay(colors.accent, 0.12)
                    : pressed
                      ? overlay(colors.foreground, 0.06)
                      : "transparent",
                })}
              >
                <View
                  style={{
                    width: 16,
                    height: 16,
                    marginTop: 2,
                    borderRadius: question.multiSelect ? 4 : 8,
                    borderWidth: selected ? 5 : 1.5,
                    borderColor: selected ? colors.accent : colors.foregroundMuted,
                  }}
                />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "600" }}>{option.label}</Text>
                  {option.description ? (
                    <Text style={{ color: colors.foregroundMuted, fontSize: 13, lineHeight: 18 }}>{option.description}</Text>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
          {question.allowOther ? (
            <TextInput
              value={other[questionIndex]}
              onChangeText={(text) => setOther((previous) => previous.map((value, i) => (i === questionIndex ? text : value)))}
              editable={!busy}
              placeholder="Something else…"
              placeholderTextColor={colors.foregroundMuted}
              style={{
                minHeight: 38,
                paddingHorizontal: 12,
                paddingVertical: 9,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.surface0,
                color: colors.foreground,
                fontSize: 14,
              }}
            />
          ) : null}
        </View>
      ))}
      <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
        <Button
          label="Answer"
          tone="primary"
          disabled={busy || !complete}
          onPress={() => onAnswer(buildAnswers(questions, picked, other))}
          colors={colors}
        />
      </View>
    </View>
  );
}

function Button({
  label,
  tone = "plain",
  disabled,
  onPress,
  colors,
}: {
  label: string;
  tone?: "ghost" | "plain" | "primary" | "danger";
  disabled?: boolean;
  onPress(): void;
  colors: Colors;
}) {
  const fill = { ghost: "transparent", plain: overlay(colors.foreground, 0.07), primary: colors.accent, danger: "transparent" }[tone];
  const ink = {
    ghost: colors.foregroundMuted,
    plain: colors.foreground,
    primary: colors.accentForeground,
    danger: colors.statusDanger,
  }[tone];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 8,
        backgroundColor: fill,
        opacity: disabled ? 0.5 : pressed ? 0.75 : 1,
      })}
    >
      <Text style={{ color: ink, fontSize: 13, fontWeight: "500" }}>{label}</Text>
    </Pressable>
  );
}

/**
 * The card's full content in a scroll area. A message opens at its end, where the ask is, and
 * sits against the reply box when it is short, like a chat; a command, plan or error opens at its
 * start.
 */
function Body({ from, children }: { from: "start" | "end"; children: ReactNode }) {
  const scroll = useRef<NativeScrollView>(null);
  const end = from === "end";
  return (
    <NativeScrollView
      ref={scroll}
      style={{ flex: 1, minHeight: 0 }}
      contentContainerStyle={{ flexGrow: 1, justifyContent: end ? "flex-end" : "flex-start", gap: 8 }}
      onContentSizeChange={() => {
        if (end) scroll.current?.scrollToEnd({ animated: false });
      }}
      // Swiping the message down puts the keyboard away, as in a Paseo chat.
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      // Keep the end in view when the card is resized, as when the window changes.
      onLayout={() => {
        if (end) scroll.current?.scrollToEnd({ animated: false });
      }}
    >
      {children}
    </NativeScrollView>
  );
}

interface PaneProps {
  member: Member;
  family: Family;
  view: PluginScreenProps;
  /** Selects the family member above (-1) or below (1); false at either end. */
  onMove(delta: 1 | -1): boolean;
  canSkip: boolean;
}

/** One agent's header, content and actions, inside its family's card. */
function AgentPane({ member, family, view, onMove, canSkip }: PaneProps) {
  const { ref, reason } = member;
  const inFamily = family.members.length > 1;
  const { theme, layout, navigation } = view;
  const colors = theme.colors;
  const paseo = usePaseo();
  const toast = useToast();
  const replyRef = useRef<NativeTextInput>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  const title = useAgent(ref, (a) => a.title?.trim() || "Untitled agent") ?? "Untitled agent";
  const activity = useAgent(ref, (a) => a.lastActivityAt);
  const workspaceRef = useAgent(ref, (a) => a.workspace);
  const workspaceName = useWorkspace(workspaceRef ?? "", (w) => w.title || w.name);
  const parent = useParentWorkspace(workspaceRef);
  const task = useTask(ref);
  const [taskOpen, setTaskOpen] = useState(false);
  const detail = useCardDetail(ref, activity);
  const permission = reason === "permission" ? (detail.data?.permission ?? null) : null;
  const question = permission ? isQuestion(permission) : false;
  const pad = layout.compact ? 14 : 18;

  async function act(name: string, run: () => Promise<unknown>, success?: string) {
    if (busy) return;
    setBusy(true);
    deck.markHandled(ref.key);
    try {
      await run();
      if (success) toast.show(success);
    } catch (error) {
      deck.unmarkHandled(ref.key);
      toast.error(`${name} failed: ${error instanceof Error ? error.message : String(error)}`);
      setBusy(false);
    }
  }

  const handle = () => paseo.agents.ref(ref);
  const skip = () => deck.skip(family.key);
  const open = navigation ? () => navigation.openAgent({ agentId: ref.id, serverId: ref.hostId }) : null;
  const openParent =
    navigation && parent
      ? () => navigation.openWorkspace({ workspaceId: parent.id, serverId: parent.hostId })
      : undefined;
  const respond = (response: AgentPermissionResponse) =>
    permission &&
    act(response.behavior === "allow" ? "Allow" : "Deny", () =>
      handle().respondToPermission({ requestId: permission.id, response }),
    );
  const allowAction = permission?.actions?.find((action) => action.behavior === "allow");
  const denyAction = permission?.actions?.find((action) => action.behavior === "deny");
  const allow = () => respond({ behavior: "allow", selectedActionId: allowAction?.id });
  const deny = () => respond({ behavior: "deny", selectedActionId: denyAction?.id });
  const sendReply = () => {
    const text = reply.trim();
    if (text) void act("Reply", () => handle().send(text), `Sent to ${title}`);
  };

  // Latest handlers in a ref, so the key listener is installed once per card.
  const keys = useRef<(key: string) => boolean>(() => false);
  keys.current = (key) => {
    switch (key.toLowerCase()) {
      case "arrowright":
      case "s":
        if (!canSkip) return false;
        skip();
        return true;
      case "arrowup":
      case "k":
        return onMove(-1);
      case "arrowdown":
      case "j":
        return onMove(1);
      case "o":
        if (!open) return false;
        open();
        return true;
      case "r":
        if (permission) return false;
        replyRef.current?.focus();
        return true;
      case "y":
        if (!permission || question) return false;
        void allow();
        return true;
      case "n":
        if (!permission) return false;
        void deny();
        return true;
      default:
        return false;
    }
  };
  useEffect(() => listenForKeys((key) => keys.current(key)), []);
  // End editing before the reply box is removed (sent, skipped, handled, or the screen closed).
  // Removed while focused, iOS drops the keyboard without a proper end, which can leave Paseo's
  // own keyboard layout pushed up. A layout effect's cleanup runs while the box still exists.
  useLayoutEffect(
    () => () => {
      if (replyTarget.focused || replyRef.current?.isFocused()) {
        replyRef.current?.blur();
        Keyboard.dismiss();
      }
      replyTarget.focused = false;
    },
    [],
  );

  const muted = { color: colors.foregroundMuted, fontSize: 12 };
  const box = { padding: 10, borderRadius: 8, backgroundColor: colors.surface2 };
  const mono = { color: colors.foreground, fontFamily: "Menlo", fontSize: 12 };

  const subject = permission ? permissionSubject(permission) : null;
  const errorText = reason === "error" ? (detail.data?.lastError ?? null) : null;
  const message = permission || errorText ? null : (detail.data?.message ?? null);

  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <View style={{ paddingHorizontal: pad, paddingTop: pad - 4, paddingBottom: 10, gap: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ ...muted, flex: 1 }} numberOfLines={1}>
            {parent ? (
              <Text onPress={openParent}>
                {parent.name}
                {"  ›  "}
              </Text>
            ) : null}
            <Text style={{ color: colors.foreground }}>{workspaceName ?? ""}</Text>
          </Text>
          <Text style={muted}>{timeAgo(activity)}</Text>
        </View>
        <Text style={{ color: colors.foreground, fontSize: layout.compact ? 16 : 18, fontWeight: "600" }} numberOfLines={1}>
          {title}
        </Text>
        {task ? (
          <Text
            accessibilityRole="button"
            accessibilityLabel={taskOpen ? "Collapse task" : "Expand task"}
            onPress={() => setTaskOpen((open) => !open)}
            numberOfLines={taskOpen ? 6 : 1}
            style={{ ...muted, lineHeight: 17 }}
          >
            <Text style={{ fontWeight: "600" }}>Task </Text>
            {taskOpen ? task : task.replace(/\s+/g, " ")}
          </Text>
        ) : null}
      </View>

      <View style={{ flex: 1, minHeight: 0, paddingHorizontal: pad, paddingBottom: pad - 4, gap: 8 }}>
        {detail.isPending ? <Text style={muted}>Loading…</Text> : null}
        {detail.isError ? (
          <Text style={{ ...muted, color: colors.statusDanger }}>Could not load this agent.</Text>
        ) : null}
        {permission && !question ? (
          <Text style={{ color: colors.foreground, fontSize: 14 }}>{permission.title ?? permission.name}</Text>
        ) : null}
        {permission && question ? (
          <Body from="start">
            <QuestionForm
              key={permission.id}
              request={permission}
              busy={busy}
              onAnswer={(answers) =>
                void respond({ behavior: "allow", updatedInput: { ...(permission.input ?? {}), answers } })
              }
              colors={colors}
            />
          </Body>
        ) : permission ? (
          <Body from="start">
            {subject?.mono ? (
              <View style={box}>
                <Text style={mono} selectable>
                  {subject.text}
                </Text>
              </View>
            ) : subject ? (
              <Markdown>{subject.text}</Markdown>
            ) : permission.description ? (
              <Markdown>{permission.description}</Markdown>
            ) : null}
          </Body>
        ) : errorText ? (
          <Body from="start">
            <View style={{ ...box, backgroundColor: overlay(colors.statusDanger, 0.1) }}>
              <Text style={{ ...mono, color: colors.statusDanger }} selectable>
                {errorText}
              </Text>
            </View>
            {detail.data?.message ? <Markdown>{detail.data.message}</Markdown> : null}
          </Body>
        ) : message ? (
          <Body from="end">
            <Markdown>{message}</Markdown>
          </Body>
        ) : detail.data ? (
          <Text style={muted}>No message in the latest turn.</Text>
        ) : null}
      </View>

      <View
        ref={(node) => {
          replyTarget.footer = node;
        }}
        style={{ borderTopWidth: 1, borderTopColor: colors.border, padding: 10, gap: 8 }}
      >
        {permission ? null : (
          <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
            <TextInput
              ref={replyRef}
              // Marked on touch: iOS announces the keyboard before the box reports focus.
              onPressIn={() => {
                replyTarget.focused = true;
              }}
              onFocus={() => {
                replyTarget.focused = true;
              }}
              onBlur={() => {
                replyTarget.focused = false;
              }}
              value={reply}
              onChangeText={setReply}
              editable={!busy}
              multiline
              placeholder={inFamily ? `Reply to ${title}…` : "Reply…"}
              placeholderTextColor={colors.foregroundMuted}
              style={{
                flex: 1,
                minHeight: 38,
                maxHeight: 96,
                paddingHorizontal: 12,
                paddingVertical: 9,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.surface0,
                color: colors.foreground,
                fontSize: 14,
              }}
              onKeyPress={(event) => {
                // Web: Enter sends, Shift+Enter adds a line, Escape hands keys back to the deck.
                // Phones keep Return for new lines and send with the button.
                if (Platform.OS !== "web") return;
                const native = event.nativeEvent as { key: string; shiftKey?: boolean };
                if (native.key === "Enter" && !native.shiftKey) {
                  (event as unknown as { preventDefault?: () => void }).preventDefault?.();
                  sendReply();
                } else if (native.key === "Escape") {
                  replyRef.current?.blur();
                }
              }}
            />
            {reply.trim() ? (
              <Button label="Send" tone="primary" disabled={busy} onPress={sendReply} colors={colors} />
            ) : null}
          </View>
        )}

        {permission ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ flex: 1 }} />
            <Button label={denyAction?.label ?? (question ? "Dismiss" : "Deny")} tone="danger" disabled={busy} onPress={() => void deny()} colors={colors} />
            {question ? null : (
              <Button label={allowAction?.label ?? "Allow"} tone="primary" disabled={busy} onPress={() => void allow()} colors={colors} />
            )}
          </View>
        ) : null}
      </View>


    </View>
  );
}

function TreeRow({
  member,
  selected,
  onPress,
  colors,
}: {
  member: Member;
  selected: boolean;
  onPress(): void;
  colors: Colors;
}) {
  const title = useAgent(member.ref, (a) => a.title?.trim() || "Untitled agent") ?? "Untitled agent";
  const activity = useAgent(member.ref, (a) => a.lastActivityAt);
  // The agent right above this one, when it is not waiting itself and so has no row.
  const via = member.via.at(-1);
  const viaTitle = useAgent(via ?? "", (a) => a.title?.trim() || "an agent");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Show ${title}`}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        height: 28,
        paddingLeft: 10 + member.depth * 18,
        paddingRight: 10,
        borderRadius: 7,
        backgroundColor: pressed
          ? overlay(colors.foreground, 0.12)
          : selected
            ? overlay(colors.foreground, 0.09)
            : hovered
              ? overlay(colors.foreground, 0.05)
              : "transparent",
      })}
    >
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: reasonColor(member.reason, colors) }} />
      <Text
        style={{ color: colors.foreground, fontSize: 13, fontWeight: selected ? "600" : "400", flexShrink: 1 }}
        numberOfLines={1}
      >
        {title}
      </Text>
      {via ? (
        <Text style={{ color: colors.foregroundMuted, fontSize: 12, flexShrink: 2 }} numberOfLines={1}>
          via {viaTitle ?? "an agent"}
          {member.via.length > 1 ? ` +${member.via.length - 1}` : ""}
        </Text>
      ) : null}
      <View style={{ flex: 1 }} />
      <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{timeAgo(activity)}</Text>
    </Pressable>
  );
}

const TREE_ROWS = 5;

/** The family's waiting agents as a small tree; pressing a row shows that agent below. */
function FamilyTree({
  family,
  selectedKey,
  onSelect,
  colors,
}: {
  family: Family;
  selectedKey: string;
  onSelect(key: string): void;
  colors: Colors;
}) {
  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <NativeScrollView style={{ maxHeight: TREE_ROWS * 28 + 12 }} contentContainerStyle={{ padding: 6 }}>
        {family.members.map((member) => (
          <TreeRow
            key={member.ref.key}
            member={member}
            selected={member.ref.key === selectedKey}
            onPress={() => onSelect(member.ref.key)}
            colors={colors}
          />
        ))}
      </NativeScrollView>
    </View>
  );
}

export interface CardProps {
  family: Family;
  /** The member shown below the tree; the deck owns it so its buttons act on the same agent. */
  selected: Member;
  onSelect(key: string): void;
  /** False with one card left, where skipping would deal the same card again. */
  canSkip: boolean;
  view: PluginScreenProps;
}

/**
 * A family's card: the tree of its waiting agents when there is more than one, and the selected
 * agent below. Everything in the card answers the agent; moving through the deck happens outside.
 */
export function Card({ family, selected, onSelect, canSkip, view }: CardProps) {
  const colors = view.theme.colors;
  const move = (delta: 1 | -1) => {
    const next = family.members[family.members.indexOf(selected) + delta];
    if (!next) return false;
    onSelect(next.ref.key);
    return true;
  };
  return (
    <View
      style={{
        borderRadius: 14,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface1,
        overflow: "hidden",
        // Fills the deck, so every card is the same size whatever it holds.
        flex: 1,
        minHeight: 0,
      }}
    >
      <View style={{ height: 3, backgroundColor: reasonColor(selected.reason, colors) }} />
      {family.members.length > 1 ? (
        <FamilyTree family={family} selectedKey={selected.ref.key} onSelect={onSelect} colors={colors} />
      ) : null}
      <AgentPane
        key={selected.ref.key}
        member={selected}
        family={family}
        view={view}
        onMove={move}
        canSkip={canSkip}
      />
    </View>
  );
}
