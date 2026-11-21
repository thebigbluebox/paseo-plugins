import type { PluginCleanup } from "@getpaseo/plugin";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { dark, light, type Background, type Foreground } from "./shared/palettes";

/**
 * `top` at `alpha` over `base`, as hex. Paseo theme colors must be plain hex, but Gruvbox
 * Material's selection colors are translucent, so they are flattened onto the background.
 */
function blend(top: string, base: string, alpha: number): string {
  const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [a, b] = [channels(top), channels(base)];
  return `#${a
    .map((value, i) => Math.round(value * alpha + b[i] * (1 - alpha)).toString(16).padStart(2, "0"))
    .join("")}`;
}

/**
 * Maps a palette onto Paseo's theme contract the way the extension's default "material"
 * workbench maps it onto VS Code: a flat sidebar the same color as the editor, grey secondary
 * text, bg5 borders, and bg5 selection at the extension's list opacities. The accent is the
 * palette's green, which the extension uses for links and progress.
 */
function theme(background: Background, foreground: Foreground) {
  const { bg, bg2, bg4, bg5, bg6 } = background;
  return {
    background: bg,
    foreground: foreground.fg,
    raised: bg2,
    control: bg4,
    border: bg5,
    accent: foreground.green,
    mutedForeground: foreground.grey2,
    ring: foreground.grey0,
    sidebar: bg,
    // list.hoverBackground is transparent in the extension; a light wash keeps hover visible.
    sidebarHover: blend(bg5, bg, 0.3),
    // list.activeSelectionBackground: bg5 at 0x60.
    sidebarSelected: blend(bg5, bg, 0x60 / 0xff),
    surface3: bg4,
    surface4: bg6,
    foregroundExtraMuted: foreground.grey1,
  };
}

const CONTRASTS = [
  ["medium", ""],
  ["hard", " Hard"],
  ["soft", " Soft"],
] as const;

export default function contribute(client: PluginClientContext) {
  const removers: PluginCleanup[] = [];
  for (const [appearance, palette, label] of [
    ["dark", dark, "Dark"],
    ["light", light, "Light"],
  ] as const) {
    for (const [contrast, suffix] of CONTRASTS) {
      removers.push(
        client.addTheme({
          id: `${appearance}-${contrast}`,
          name: `Gruvbox Material ${label}${suffix}`,
          appearance,
          colors: theme(palette.backgrounds[contrast], palette.foreground),
        }),
      );
    }
  }
  return () => {
    for (const remove of removers) void remove();
  };
}
