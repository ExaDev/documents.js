import { style } from "@vanilla-extract/css";

import { vars } from "../theme.css";

// Shared block/run-level styles consumed by every flowing-document preview component (MarkdownPreview, WordProcessingPreview, SlidesPreview). Format-specific paragraph styles (blockquote, code block, hr, markdown list markers) live in each component's own .css.ts.
export const paragraph = style({ margin: "0.4em 0", lineHeight: 1.5 });

export const heading = style({ marginBlock: "0.6em 0.3em" });

export const inlineCode = style({
  background: vars.colors.default,
  padding: "1px 4px",
  borderRadius: 3,
});

export const table = style({ borderCollapse: "collapse", marginBlock: 12 });

export const tableCell = style({
  border: `1px solid ${vars.colors.defaultBorder}`,
  padding: "4px 8px",
});

export const image = style({ maxWidth: "100%" });

// Standard list style for <ol>/<ul> when the list kind IS known (ordered: or bullet: prefix in numId). Same margins/indentation as MarkdownPreview's own list style.
export const list = style({ margin: "0.3em 0", paddingLeft: 24 });

// Blockquote, code block, and horizontal rule styles -- shared by every flowing-document preview (Markdown, WordProcessing, Slides) since all detect these via the same router-side styleId convention.
export const blockquote = style({
  margin: "0.6em 0",
  paddingLeft: 12,
  borderLeft: `3px solid ${vars.colors.defaultBorder}`,
  color: vars.colors.dimmed,
});

export const codeBlock = style({
  background: vars.colors.default,
  padding: 12,
  borderRadius: 4,
  overflowX: "auto",
});

export const hr = style({
  border: "none",
  borderTop: `1px solid ${vars.colors.defaultBorder}`,
  margin: "1em 0",
});
export const neutralList = style({
  margin: "0.3em 0",
  paddingLeft: 24,
  listStyle: "none",
});

export const neutralListItem = style({
  "::before": {
    content: '"-"',
    marginRight: "0.5em",
    color: vars.colors.dimmed,
  },
});
