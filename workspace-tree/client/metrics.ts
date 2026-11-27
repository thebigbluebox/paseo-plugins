// macOS / VS Code sidebar sizing: 13pt titles on an 18pt line, 11pt secondary text and headings.
// Shared by the tree and the Reviews panel so their rows line up.
export const INDENT = 14;
export const ROW_HEIGHT = 26;
export const TITLE_SIZE = 13;
export const TITLE_LINE = 18;
/** Box matching the title's first line (4pt padding + 18pt line), for items that sit beside it. */
export const titleLine = { height: TITLE_LINE, marginTop: 4, justifyContent: "center", alignItems: "center" } as const;
/** Width of the fold arrow's column, kept empty on rows that do not fold so titles line up. */
export const CHEVRON_WIDTH = 16;
/** Section headings: small uppercase, as on project headers. */
export const headingText = { fontSize: 11, fontWeight: "600", letterSpacing: 0.4, textTransform: "uppercase" } as const;
