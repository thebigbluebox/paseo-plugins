import { Platform } from "react-native";

// This plugin typechecks without the DOM library. Declare only what this module uses.
interface KeyEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  target: unknown;
  preventDefault(): void;
}
declare const window: {
  addEventListener(type: "keydown", listener: (event: KeyEvent) => void): void;
  removeEventListener(type: "keydown", listener: (event: KeyEvent) => void): void;
};

function isTyping(target: unknown): boolean {
  const element = target as { tagName?: string; isContentEditable?: boolean } | null;
  if (!element) return false;
  const tag = element.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || element.isContentEditable === true;
}

/**
 * Single-key shortcuts for the deck on web and desktop. Ignores keys typed into a field and
 * keys held with a modifier, so the reply box and the app's own shortcuts keep working.
 * A no-op on native, where there is no hardware keyboard to count on.
 */
export function listenForKeys(onKey: (key: string) => boolean): () => void {
  if (Platform.OS !== "web") return () => {};
  const listener = (event: KeyEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
    if (onKey(event.key)) event.preventDefault();
  };
  window.addEventListener("keydown", listener);
  return () => window.removeEventListener("keydown", listener);
}
