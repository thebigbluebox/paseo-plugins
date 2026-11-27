import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { Text, View } from "react-native";
import { overlay } from "./client/colors";
import { useTriageCount } from "./client/queue";
import { TriageScreen } from "./client/screen";

const SCREEN = "deck";

/**
 * The waiting count as a small rounded badge, like the folded-project counts in the workspace
 * tree. It sits in the row's right-hand slot (the label can only be text), inset from the slot's
 * edge so it stays clear of the row's highlight.
 */
function CountBadge({ count, theme }: { count: number; theme: PluginSidebarItemProps["theme"] }) {
  return (
    <View
      accessibilityLabel={`${count} waiting`}
      style={{
        marginLeft: 6,
        marginRight: 4,
        minWidth: 18,
        height: 16,
        paddingHorizontal: 5,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: overlay(theme.colors.foreground, 0.08),
      }}
    >
      <Text
        style={{
          color: theme.colors.foregroundMuted,
          fontSize: 10,
          fontWeight: "600",
          fontVariant: ["tabular-nums"],
        }}
      >
        {count}
      </Text>
    </View>
  );
}

function TriageItem({ theme, currentScreen, openScreen }: PluginSidebarItemProps) {
  const count = useTriageCount();
  return (
    <SidebarRow
      icon="Layers"
      label="Triage"
      active={currentScreen?.screenId === SCREEN}
      onPress={() => openScreen({ screenId: SCREEN })}
      trailing={count > 0 ? <CountBadge count={count} theme={theme} /> : undefined}
    />
  );
}

export default function contribute(client: PluginClientContext) {
  const removers = [
    client.addScreen({ id: SCREEN, title: "Triage", Component: TriageScreen }),
    client.addSidebarHeaderItem({ id: SCREEN, title: "Triage", Component: TriageItem }),
    client.addCommandCenterItem({
      id: "open-triage",
      title: "Open triage",
      icon: "Layers",
      keywords: ["attention", "inbox", "agents", "permission", "unread"],
      context: "global",
      onSelect({ openScreen }) {
        openScreen({ screenId: SCREEN });
      },
    }),
  ];
  return () => {
    for (const remove of removers) remove();
  };
}
