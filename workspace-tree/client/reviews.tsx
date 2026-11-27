import { openExternalUrl, useRpc, useSettings, type PluginSidebarViewProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState, type RefObject } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { pendingReviews, type ReviewItem } from "../shared/reviews";
import { reviewSettings } from "../shared/preferences";
import { shades } from "./colors";
import { CountBadge } from "./badge";
import { CHEVRON_WIDTH, ROW_HEIGHT, TITLE_LINE, TITLE_SIZE, headingText, titleLine } from "./metrics";
import { Heading, OptionRow } from "./filter";
import { PullRequestBadges } from "./prs";
import { Popover } from "./popover";
import { useSyncedSettings } from "./synced";

type Colors = PluginSidebarViewProps["theme"]["colors"];

/**
 * How often to ask the daemon. It answers from its saved list and asks GitHub at most every two
 * minutes, so asking often is cheap and gets a background refresh onto the screen quickly.
 */
const POLL_MS = 30_000;
const REVIEWS_KEY = ["workspace-tree", "reviews"];
const EMPTY: ReviewItem[] = [];

interface ReviewSettingsValue {
  hiddenRepos: string[];
  showDrafts: boolean;
  showReapprovals: boolean;
}
const DEFAULT_SETTINGS: ReviewSettingsValue = { hiddenRepos: [], showDrafts: true, showReapprovals: true };

/**
 * Open pull requests waiting for your review or re-approval, under the tree, sorted by
 * repository. A row opens the PR in the browser. Adapted from Peter's work-status plugin
 * (psvitz/paseo-plugins).
 */
export function ReviewsPanel({
  colors,
  compact,
}: {
  colors: Colors;
  /** Phones and narrow windows, where settings open in a sheet. */
  compact: boolean;
}) {
  const menuButton = useRef<View>(null);
  const list = useRpc(pendingReviews);
  // One shared query, like the PR chips: a redrawn sidebar shows the last list at once.
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: REVIEWS_KEY,
    queryFn: () => list({ force: false }),
    refetchInterval: POLL_MS,
    staleTime: POLL_MS / 2,
    placeholderData: (previous) => previous,
  });
  const [forcing, setForcing] = useState(false);
  const refresh = useCallback(async () => {
    setForcing(true);
    try {
      queryClient.setQueryData(REVIEWS_KEY, await list({ force: true }));
    } catch {
      // The query keeps its last answer; the next poll tries again.
    } finally {
      setForcing(false);
    }
  }, [list, queryClient]);
  const items = query.data?.items ?? EMPTY;
  const error = query.data?.error ?? (query.error ? String(query.error) : null);
  // Only a refresh you asked for shows as loading; background polls update silently.
  const loading = forcing || (query.isFetching && !query.data);
  const [open, setOpen] = useState(true);
  const [configuring, setConfiguring] = useState(false);
  const settingsSync = useSyncedSettings(useSettings(reviewSettings));
  const settings = settingsSync.value ?? DEFAULT_SETTINGS;
  const update = (patch: Partial<ReviewSettingsValue>) => {
    if (settingsSync.value) settingsSync.set({ ...settingsSync.value, ...patch });
  };


  // What the settings let through; the header counts exactly this.
  const shown = useMemo(
    () =>
      items.filter(
        (item) =>
          !settings.hiddenRepos.includes(item.repo) &&
          (settings.showDrafts || !item.draft) &&
          (settings.showReapprovals || item.kind !== "reapprove"),
      ),
    [items, settings],
  );
  // One list, by repository name; within a repository, newest first as the items arrive.
  const sorted = useMemo(
    () => [...shown].sort((a, b) => a.repo.toLowerCase().localeCompare(b.repo.toLowerCase())),
    [shown],
  );
  // Every repository with requests, plus hidden ones with none right now, so each can be ticked back.
  const allRepos = useMemo(
    () => [...new Set([...items.map((item) => item.repo), ...settings.hiddenRepos])],
    [items, settings.hiddenRepos],
  );

  const reapprove = shown.filter((item) => item.kind === "reapprove").length;
  const line = shades(colors.foreground).line;
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: line }}>
      {/* Laid out like a project header, so the panel reads as one more section of the tree. */}
      <View style={{ flexDirection: "row", alignItems: "center", minHeight: ROW_HEIGHT, marginTop: 2, paddingHorizontal: 8 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${open ? "Hide" : "Show"} reviews, ${shown.length} waiting`}
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen((value) => !value)}
          style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 6, minHeight: ROW_HEIGHT }}
        >
          <Text style={{ width: CHEVRON_WIDTH, textAlign: "center", color: colors.foregroundMuted, fontSize: 10 }}>
            {open ? "▾" : "▸"}
          </Text>
          <Text accessibilityRole="header" style={{ ...headingText, color: colors.foregroundMuted }}>
            Reviews
          </Text>
          <CountBadge
            count={shown.length}
            colors={colors}
            color={shown.length ? colors.statusWarning : undefined}
            label={`${shown.length} waiting`}
          />
          {reapprove ? (
            <CountBadge count={reapprove} colors={colors} color={colors.statusDanger} label={`${reapprove} to re-approve`} />
          ) : null}
        </Pressable>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
          <HeaderButton
            icon="RefreshCw"
            label="Refresh reviews"
            dim={loading}
            onPress={() => void refresh()}
            colors={colors}
          />
          <HeaderButton
            anchor={menuButton}
            icon="Ellipsis"
            label={configuring ? "Close review settings" : "Review settings"}
            active={configuring}
            onPress={() => setConfiguring((value) => !value)}
            colors={colors}
          />
        </View>
      </View>
      <Popover
        anchor={menuButton}
        open={configuring}
        onClose={() => setConfiguring(false)}
        title="Reviews"
        compact={compact}
        colors={colors}
      >
          <Heading colors={colors}>Repositories</Heading>
          {allRepos.length === 0 ? (
            <Text style={{ color: colors.foregroundMuted, fontSize: 12, paddingHorizontal: 8, paddingVertical: 4 }}>
              None yet
            </Text>
          ) : (
            allRepos.map((repo) => (
              <OptionRow
                key={repo}
                option={{ key: repo, label: repo }}
                checked={!settings.hiddenRepos.includes(repo)}
                onPress={() =>
                  update({
                    hiddenRepos: settings.hiddenRepos.includes(repo)
                      ? settings.hiddenRepos.filter((item) => item !== repo)
                      : [...settings.hiddenRepos, repo],
                  })
                }
                colors={colors}
              />
            ))
          )}
          <Heading colors={colors}>Show</Heading>
          <OptionRow
            option={{ key: "drafts", label: "Drafts" }}
            checked={settings.showDrafts}
            onPress={() => update({ showDrafts: !settings.showDrafts })}
            colors={colors}
          />
          <OptionRow
            option={{ key: "reapprovals", label: "Re-approvals" }}
            checked={settings.showReapprovals}
            onPress={() => update({ showReapprovals: !settings.showReapprovals })}
            colors={colors}
          />
      </Popover>
      {open ? (
        <ScrollView style={{ maxHeight: 240 }} contentContainerStyle={{ paddingBottom: 6 }}>
          {error ? (
            <Text numberOfLines={2} style={{ color: colors.statusDanger, fontSize: 11, paddingLeft: ROW_TEXT_LEFT, paddingRight: 8 }}>
              {error}
            </Text>
          ) : null}
          {/* Nothing until the first answer, so a cold start does not flash "Nothing waiting". */}
          {!error && query.data && shown.length === 0 ? (
            <Text style={{ color: colors.foregroundMuted, fontSize: 11, paddingLeft: ROW_TEXT_LEFT, paddingRight: 8, paddingBottom: 4 }}>
              Nothing waiting.
            </Text>
          ) : null}
          {sorted.map((item) => (
            <ReviewRow key={item.url} item={item} colors={colors} />
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

/** Where row text starts: past the padding, the fold column and the dot, as on workspace rows. */
const ROW_TEXT_LEFT = 8 + CHEVRON_WIDTH + 8 + 6 + 8;

function HeaderButton({
  icon,
  label,
  onPress,
  colors,
  active,
  dim,
  anchor,
}: {
  icon: string;
  label: string;
  onPress(): void;
  colors: Colors;
  active?: boolean;
  dim?: boolean;
  anchor?: RefObject<View | null>;
}) {
  const shade = shades(colors.foreground);
  return (
    <Pressable
      ref={anchor}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => ({
        width: 22,
        height: 20,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 5,
        opacity: dim ? 0.4 : 1,
        backgroundColor: pressed || active ? shade.pressed : hovered ? shade.hover : "transparent",
      })}
    >
      <Icon name={icon} size={13} color={active ? colors.foreground : colors.foregroundMuted} />
    </Pressable>
  );
}

/** A review, laid out like a workspace row: dot on the title's line, details underneath. */
function ReviewRow({ item, colors }: { item: ReviewItem; colors: Colors }) {
  const reapprove = item.kind === "reapprove";
  const color = reapprove ? colors.statusDanger : colors.statusWarning;
  const shade = shades(colors.foreground);
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${reapprove ? "Re-approve" : "Review"} ${item.repo} pull request ${item.number}: ${item.title}, by ${item.author}`}
      onPress={() => void openExternalUrl(item.url)}
      style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => ({
        minHeight: ROW_HEIGHT,
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 8,
        paddingLeft: 8,
        paddingRight: 8,
        borderRadius: 4,
        opacity: item.draft ? 0.55 : 1,
        backgroundColor: pressed ? shade.pressed : hovered ? shade.hover : undefined,
      })}
    >
      <View style={{ ...titleLine, width: CHEVRON_WIDTH }} />
      <View style={titleLine}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
      </View>
      <View style={{ flex: 1, paddingVertical: 4, gap: 2 }}>
        <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: TITLE_SIZE, lineHeight: TITLE_LINE }}>
          {item.title}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
          <Text numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: 11, flexShrink: 1 }}>
            {item.repo.split("/")[1] ?? item.repo}#{item.number} · {item.author}
            {item.draft ? " · draft" : ""}
          </Text>
          {reapprove ? <Text style={{ color: colors.statusDanger, fontSize: 11 }}> · re-approve</Text> : null}
          <PullRequestBadges pr={item} colors={colors} />
        </View>
      </View>
    </Pressable>
  );
}
