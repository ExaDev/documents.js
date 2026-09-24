import { style, styleVariants } from "@vanilla-extract/css";

// The cap on a tool page's own content. 54rem is roughly 90 characters of body text: past the comfortable measure for prose, but right for the label/value pairs, two- and three-column tables and short forms these pages actually hold.
export const PANEL_MEASURE = "54rem";

// The cap on a page's heading block. Narrower than the page itself, so a one-sentence description breaks where prose should break rather than running the full width of a table below it.
export const HEADER_MEASURE = "42rem";

// The one measure a tool page's content is laid out in. Left-aligned rather than centred (no `margin: auto`): the page already sits to the right of a fixed sidebar and under a full-width open-document bar, so a centred column would align with neither, and the three widths this replaces each floated to a different place.
//
// A page whose content is a rendered document or a wide table opts out with `canvas` instead of being squeezed into a measure that was never about it.
export const width = styleVariants({
  panel: { width: "100%", maxWidth: PANEL_MEASURE },
  canvas: { width: "100%" },
});

export const header = style({ maxWidth: HEADER_MEASURE });
