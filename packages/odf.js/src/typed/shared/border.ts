import type { ContentBorder, ContentStrokeStyle } from "document-schema.js";
import { formatOdfLength, parseOdfLength } from "./units";
import { formatOdfColor, parseOdfColor } from "./color";

// The shared XSL-FO border-shorthand grammar every ODF fo:border-applicable element uses -- fo:border and its four per-edge siblings (fo:border-left/right/top/bottom) share exactly THREE space-separated tokens, "<length> <border-style> <color>", in that fixed order (this is XSL-FO's own <border> shorthand, not CSS's permutation-tolerant one; e.g. `fo:border="0.05pt solid #000000"`). Originally lived only in this package's own table-cell reader/writer (typed/shared/table.ts); moved here once a second content leaf (paragraph-level borders, styles/properties.ts) and a second format (ods sheet cells, typed/ods/write.ts) both needed the identical grammar -- one parser, one formatter, reused by every caller rather than each reimplementing the same three-token split.
const BORDER_STYLE_MAP: Readonly<Partial<Record<string, ContentStrokeStyle>>> =
  { solid: "solid", dashed: "dashed", dotted: "dotted", double: "double" };

export type BorderEdgeKey = "left" | "right" | "top" | "bottom";
export const BORDER_EDGE_KEYS: readonly BorderEdgeKey[] = [
  "left",
  "right",
  "top",
  "bottom",
];
export const BORDER_EDGE_ATTRS: Readonly<Record<BorderEdgeKey, string>> = {
  left: "fo:border-left",
  right: "fo:border-right",
  top: "fo:border-top",
  bottom: "fo:border-bottom",
};

// One edge's own parsed fo:border(-*) value: a real border, an explicit "no border" (style token "none"/"hidden"), or undefined for anything this reader cannot interpret (a malformed value, a token count other than three, an unparseable length/colour) -- undefined is deliberately treated by every caller as "this attribute said nothing usable", never as "clear this edge", so a malformed override can never silently erase a perfectly good inherited border. A border-style token ODF allows but ContentBorderSchema's own vocabulary has no member for (groove/ridge/inset/outset) still yields a real border -- width and colour are both genuine values read straight off the attribute -- just with `style` left unset (ContentBorderSchema's own documented "absent means 'solid'" default), the same "read what's real, leave what doesn't map unmapped rather than fabricating or discarding" precedent typed/draw/shapes.ts's own readOdfFillAndStroke already established for draw:stroke.
export function parseBorderEdge(
  value: string,
): { border: ContentBorder } | { none: true } | undefined {
  const tokens = value.trim().split(/\s+/);
  if (tokens.length !== 3) {
    return undefined;
  }
  const [widthToken, styleToken, colorToken] = tokens;
  if (
    widthToken === undefined ||
    styleToken === undefined ||
    colorToken === undefined
  ) {
    return undefined;
  }
  if (styleToken === "none" || styleToken === "hidden") {
    return { none: true };
  }
  const widthPt = parseOdfLength(widthToken);
  const color = parseOdfColor(colorToken);
  if (widthPt === undefined || widthPt <= 0 || color === undefined) {
    return undefined;
  }
  const style = BORDER_STYLE_MAP[styleToken];
  return {
    border:
      style === undefined ? { color, widthPt } : { color, widthPt, style },
  };
}

// The inverse of parseBorderEdge, for every writer that emits this shorthand (typed/shared/table.ts for table-cell borders, typed/ods/write.ts for sheet-cell borders). An absent ContentBorder.style is written as "solid", which is what ContentBorderSchema already documents an absent style to mean, so the value written says what the value read says.
export function formatBorderEdge(border: ContentBorder): string {
  return `${formatOdfLength(border.widthPt)} ${border.style ?? "solid"} ${formatOdfColor(border.color)}`;
}
