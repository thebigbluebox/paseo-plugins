import type { PluginTheme } from "@getpaseo/plugin";
import type { Reason } from "./queue";

/** The plugin theme has no appearance flag, so the background's brightness decides. */
function isDark(hex: string): boolean {
  const match = /^#?([0-9a-f]{6})/i.exec(hex);
  if (!match) return true;
  const value = parseInt(match[1], 16);
  const luminance = 0.299 * (value >> 16) + 0.587 * ((value >> 8) & 255) + 0.114 * (value & 255);
  return luminance < 128;
}

/** Paseo's blue for "something new to read", which the plugin theme does not expose. */
export const unreadColor = (background: string) => (isDark(background) ? "#6a9de0" : "#2563eb");

/** A color at low opacity, as rgba. Falls back to transparent for non-hex input. */
export function overlay(hex: string, alpha: number): string {
  const match = /^#?([0-9a-f]{6})/i.exec(hex);
  if (!match) return "transparent";
  const value = parseInt(match[1], 16);
  return `rgba(${value >> 16}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

export function reasonColor(reason: Reason, colors: PluginTheme["colors"]): string {
  switch (reason) {
    case "permission":
      return colors.statusWarning;
    case "error":
      return colors.statusDanger;
    case "finished":
      return unreadColor(colors.surface0);
  }
}
