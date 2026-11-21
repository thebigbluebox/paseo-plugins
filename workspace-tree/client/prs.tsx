import { openExternalUrl, useRpc, type PluginSidebarViewProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { memo, useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { mergedColor, shades } from "./colors";
import { workspacePullRequests, type PullRequest } from "../shared/prs";

type Colors = PluginSidebarViewProps["theme"]["colors"];

const VISIBLE = 3;
// The daemon answers from its saved snapshot at once and refreshes GitHub in the background,
// so polling often is cheap and picks up a background refresh soon after it lands.
const REFRESH_MS = 20_000;

/** One shared query for every row; the plugin's query client is shared across its components. */
export function usePullRequests() {
  const list = useRpc(workspacePullRequests);
  return useQuery({
    queryKey: ["workspace-tree", "pull-requests"],
    queryFn: () => list({ refresh: false }),
    refetchInterval: REFRESH_MS,
    staleTime: REFRESH_MS / 2,
    // Never trade shown chips for an empty or failed answer mid-refresh.
    placeholderData: (previous) => previous,
  });
}

function stateIcon(pr: PullRequest): string {
  if (pr.state === "merged") return "GitMerge";
  if (pr.state === "closed") return "GitPullRequestClosed";
  return pr.draft ? "GitPullRequestDraft" : "GitPullRequest";
}

/**
 * Paseo's default sidebar colors: open green, merged purple, closed red. The plugin theme has no
 * merged token, so this uses Paseo's own statusMerged values for light and dark backgrounds.
 */
function stateColor(pr: PullRequest, colors: Colors): string {
  if (pr.state === "merged") return mergedColor(colors.surface0);
  if (pr.state === "closed") return colors.statusDanger;
  return pr.draft ? colors.foregroundMuted : colors.statusSuccess;
}

const STATE_WORD: Record<PullRequest["state"], string> = { open: "", merged: " Merged", closed: " Closed" };

interface Badge {
  icon: string;
  /** Short word beside the icon; omitted for the quiet "all good" case. */
  text?: string;
  color: string;
  label: string;
}

/**
 * CI and merge conflicts as separate badges, so a PR that fails CI and conflicts shows both.
 * A single icon used to show only the conflict, and bare symbols were hard to tell apart.
 */
function badges(pr: PullRequest, colors: Colors): Badge[] {
  if (pr.state !== "open") return [];
  const list: Badge[] = [];
  switch (pr.checks) {
    case "failure":
      list.push({ icon: "X", text: "CI", color: colors.statusDanger, label: "CI failing" });
      break;
    case "pending":
      list.push({ icon: "Clock", text: "CI", color: colors.statusWarning, label: "CI running" });
      break;
    case "success":
      list.push({ icon: "Check", color: colors.statusSuccess, label: "CI passed" });
      break;
  }
  if (pr.conflicting) {
    list.push({ icon: "TriangleAlert", text: "Conflict", color: colors.statusWarning, label: "merge conflicts" });
  }
  if (pr.review === "approved") {
    list.push({ icon: "ThumbsUp", color: colors.statusSuccess, label: "approved" });
  } else if (pr.review === "changes_requested") {
    list.push({ icon: "MessageSquareWarning", color: colors.statusWarning, label: "changes requested" });
  }
  return list;
}

function describe(pr: PullRequest, list: Badge[]): string {
  return [`Pull request ${pr.number}`, pr.title, pr.draft ? "draft" : pr.state, ...list.map((b) => b.label)].join(", ");
}

const Chip = memo(function Chip({ pr, colors }: { pr: PullRequest; colors: Colors }) {
  const open = useCallback(() => void openExternalUrl(pr.url), [pr.url]);
  const [hovered, setHovered] = useState(false);
  const list = badges(pr, colors);
  const done = pr.state !== "open";
  const color = done ? colors.foregroundMuted : colors.foreground;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={describe(pr, list)}
      onPress={open}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      hitSlop={4}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 3,
        paddingHorizontal: 4,
        paddingVertical: 1,
        borderRadius: 4,
        borderWidth: pr.current ? 1 : 0,
        borderColor: shades(colors.foreground).lineStrong,
        backgroundColor: pressed ? shades(colors.foreground).pressed : undefined,
        opacity: pr.state === "closed" && !hovered ? 0.7 : 1,
      })}
    >
      {/* Like the default sidebar, hovering swaps the state icon for an external-link arrow. */}
      <Icon
        name={hovered ? "ExternalLink" : stateIcon(pr)}
        size={11}
        color={hovered ? colors.foreground : stateColor(pr, colors)}
      />
      <Text style={{ color: hovered ? colors.foreground : color, fontSize: 11, lineHeight: 14 }}>
        #{pr.number}
        {STATE_WORD[pr.state]}
      </Text>
      {list.map((badge) => (
        <View key={badge.label} style={{ flexDirection: "row", alignItems: "center", gap: 2, marginLeft: 2 }}>
          <Icon name={badge.icon} size={11} color={badge.color} />
          {badge.text ? (
            <Text style={{ color: badge.color, fontSize: 11, lineHeight: 14 }}>{badge.text}</Text>
          ) : null}
        </View>
      ))}
    </Pressable>
  );
});

/** Every PR the workspace opened, current branch first, then open, then newest. */
export function PullRequestLine({ workspaceId, colors }: { workspaceId: string; colors: Colors }) {
  const { data } = usePullRequests();
  const prs = data?.workspaces[workspaceId];
  if (!prs?.length) return null;
  const extra = prs.length - VISIBLE;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 2, marginLeft: -4 }}>
      {prs.slice(0, VISIBLE).map((pr) => (
        <Chip key={pr.number} pr={pr} colors={colors} />
      ))}
      {extra > 0 ? (
        <Text
          accessibilityLabel={`${extra} more pull requests`}
          style={{ color: colors.foregroundMuted, fontSize: 11, paddingHorizontal: 2 }}
        >
          +{extra}
        </Text>
      ) : null}
    </View>
  );
}
