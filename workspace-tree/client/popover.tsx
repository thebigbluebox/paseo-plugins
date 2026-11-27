import type { PluginSidebarViewProps } from "@getpaseo/plugin/client";
import { Modal as Sheet } from "@getpaseo/plugin/client/ui";
import type { ReactNode, RefObject } from "react";
import { useEffect, useState } from "react";
import { Dimensions, Modal, Pressable, ScrollView, View } from "react-native";

type Colors = PluginSidebarViewProps["theme"]["colors"];

const WIDTH = 260;
const GAP = 6;
const MARGIN = 8;

/**
 * A small panel anchored to a button, for sidebar views, which get no popover from Paseo. Opens
 * above the button when there is more room there, as near the bottom of the sidebar. On phones
 * it is Paseo's own sheet instead, where a floating panel would be cramped.
 */
export function Popover({
  anchor,
  open,
  onClose,
  title,
  compact,
  colors,
  children,
}: {
  anchor: RefObject<View | null>;
  open: boolean;
  onClose(): void;
  /** The sheet's title on phones. */
  title: string;
  compact: boolean;
  colors: Colors;
  children: ReactNode;
}) {
  const [frame, setFrame] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

  useEffect(() => {
    if (!open || compact) return;
    anchor.current?.measureInWindow((x, y, width, height) => setFrame({ x, y, width, height }));
  }, [open, compact, anchor]);

  if (compact) {
    return (
      <Sheet title={title} open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
        <Sheet.Content>{children}</Sheet.Content>
      </Sheet>
    );
  }
  if (!open || !frame) return null;

  const window = Dimensions.get("window");
  const above = frame.y;
  const below = window.height - (frame.y + frame.height);
  const upward = above > below;
  const left = Math.max(MARGIN, Math.min(frame.x + frame.width - WIDTH, window.width - WIDTH - MARGIN));
  const maxHeight = Math.max(120, (upward ? above : below) - GAP - MARGIN);

  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close" onPress={onClose} style={{ flex: 1 }}>
        <Pressable
          // Taps inside the panel stay inside it.
          onPress={() => undefined}
          style={{
            position: "absolute",
            left,
            width: WIDTH,
            maxHeight,
            ...(upward
              ? { bottom: window.height - frame.y + GAP }
              : { top: frame.y + frame.height + GAP }),
            borderRadius: 10,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.surface1,
            shadowColor: "#000",
            shadowOpacity: 0.25,
            shadowRadius: 16,
            shadowOffset: { width: 0, height: 6 },
            overflow: "hidden",
          }}
        >
          <ScrollView contentContainerStyle={{ paddingVertical: 4 }}>{children}</ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
