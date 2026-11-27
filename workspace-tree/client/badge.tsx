import type { PluginSidebarViewProps } from "@getpaseo/plugin/client";
import { Text, View } from "react-native";
import { shades } from "./colors";

type Colors = PluginSidebarViewProps["theme"]["colors"];

/** A small rounded count, as beside a folded project's name. `color` tints the number. */
export function CountBadge({ count, colors, color, label }: { count: number; colors: Colors; color?: string; label?: string }) {
  return (
    <View
      accessibilityLabel={label ?? String(count)}
      style={{
        minWidth: 18,
        height: 16,
        paddingHorizontal: 5,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: shades(colors.foreground).button,
      }}
    >
      <Text
        style={{
          color: color ?? colors.foregroundMuted,
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
