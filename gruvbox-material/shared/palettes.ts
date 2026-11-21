/**
 * Gruvbox Material palettes, copied from sainnhe's gruvbox-material-vscode (MIT, archived):
 * src/palette/{dark,light}/background/{hard,medium,soft}.ts and foreground/material.ts.
 * Only the colors Paseo's theme contract can use are kept.
 */

export interface Background {
  bg: string;
  bg2: string;
  bg3: string;
  bg4: string;
  bg5: string;
  bg6: string;
  bg9: string;
}

export interface Foreground {
  fg: string;
  grey0: string;
  grey1: string;
  grey2: string;
  green: string;
}

export const dark = {
  foreground: {
    fg: "#d4be98",
    grey0: "#7c6f64",
    grey1: "#928374",
    grey2: "#a89984",
    green: "#a9b665",
  },
  backgrounds: {
    hard: {
      bg: "#202020",
      bg2: "#2a2827",
      bg3: "#2e2c2b",
      bg4: "#32302f",
      bg5: "#3d3835",
      bg6: "#46403d",
      bg9: "#665c54",
    },
    medium: {
      bg: "#292828",
      bg2: "#32302f",
      bg3: "#383432",
      bg4: "#3c3836",
      bg5: "#45403d",
      bg6: "#504945",
      bg9: "#7c6f64",
    },
    soft: {
      bg: "#32302f",
      bg2: "#3c3836",
      bg3: "#403c3a",
      bg4: "#45403d",
      bg5: "#504945",
      bg6: "#5a524c",
      bg9: "#928374",
    },
  },
} satisfies { foreground: Foreground; backgrounds: Record<string, Background> };

export const light = {
  foreground: {
    fg: "#654735",
    grey0: "#a89984",
    grey1: "#928374",
    grey2: "#7c6f64",
    green: "#6c782e",
  },
  backgrounds: {
    hard: {
      bg: "#f9f5d7",
      bg2: "#fbf1c7",
      bg3: "#f2e5bc",
      bg4: "#f2e5bc",
      bg5: "#ebdbb2",
      bg6: "#e0cfa9",
      bg9: "#bdae93",
    },
    medium: {
      bg: "#fbf1c7",
      bg2: "#f2e5bc",
      bg3: "#eee0b7",
      bg4: "#ebdbb2",
      bg5: "#e0cfa9",
      bg6: "#d5c4a1",
      bg9: "#a89984",
    },
    soft: {
      bg: "#f2e5bc",
      bg2: "#ebdbb2",
      bg3: "#e6d5ae",
      bg4: "#e0cfa9",
      bg5: "#d5c4a1",
      bg6: "#c9b99a",
      bg9: "#928374",
    },
  },
} satisfies { foreground: Foreground; backgrounds: Record<string, Background> };
