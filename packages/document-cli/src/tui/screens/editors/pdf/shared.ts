import type { LayoutColor, LayoutSubpath } from "documents.js";
import type {
  CsvOpenDocument,
  OpenDocument,
  PdfOpenDocument,
  RtfOpenDocument,
  SvgOpenDocument,
  XlsxOpenDocument,
} from "../../../state/types.js";
import {
  parseColorField,
  parseStrokeField,
} from "../../shared/vector-fields.js";

export { parseColorField, parseStrokeField };
export { parseNumberField } from "../../shared/text.js";

// Every screen in this directory is only ever reached from `pdfPageList`, the root screen `rootScreenForFormat` produces for an open PDF document or for one of the four formats opened read-only as a converted PDF preview (an xlsx workbook, a csv sheet, an svg drawing, an rtf document -- see state/types.ts's own XlsxOpenDocument/CsvOpenDocument/SvgOpenDocument/RtfOpenDocument doc comments) -- so `state.openDocument` is always one of these five by the time any screen here renders. All five carry the identical `.layout: LayoutDocument` field this whole screen group reads from, and nothing else, which is exactly what lets one screen family serve all of them with no per-format branch anywhere in page-list.tsx/page-items.tsx/item-detail.tsx. This throws rather than falling back to an empty view because a mismatch would mean the app router itself is broken, not a recoverable, user-facing condition.
export function requirePdfDocument(
  openDocument: OpenDocument | undefined,
):
  | PdfOpenDocument
  | XlsxOpenDocument
  | CsvOpenDocument
  | SvgOpenDocument
  | RtfOpenDocument {
  if (
    openDocument?.format !== "pdf" &&
    openDocument?.format !== "xlsx" &&
    openDocument?.format !== "csv" &&
    openDocument?.format !== "svg" &&
    openDocument?.format !== "rtf"
  ) {
    throw new Error(
      "A PDF inspection screen rendered without an open PDF, xlsx, csv, svg, or rtf document; the app router only reaches this screen group from pdfPageList, which is only ever the root screen of one of those five formats.",
    );
  }
  return openDocument;
}

// The editing-capable narrowing of the above: an xlsx workbook, csv sheet, svg drawing, or rtf document opens as a fixed, one-shot PDF preview with no live `PdfEditor` behind it at all (see those formats' own OpenDocument doc comments -- each carries `layout`/`bytes`, never an `editor`), so add/edit/delete only ever make sense for a genuine `'pdf'`-format document. Screens call this only from the code paths that mutate (the add-item flow, item-detail's field editor); the plain read-only list/dump views keep using `requirePdfDocument` above so an opened preview format still browses exactly like a real PDF.
export function isEditablePdfDocument(
  doc:
    | PdfOpenDocument
    | XlsxOpenDocument
    | CsvOpenDocument
    | SvgOpenDocument
    | RtfOpenDocument,
): doc is PdfOpenDocument {
  return doc.format === "pdf";
}

// Shared between the page list (a page's own size) and the item detail dump (an image/rect/ellipse/link item's own size) -- both display a plain widthPt×heightPt pair with no further unit conversion.
export function formatSize(widthPt: number, heightPt: number): string {
  return `${widthPt.toFixed(0)}×${heightPt.toFixed(0)}pt`;
}

export function formatPt(value: number): string {
  return value.toFixed(1);
}

// documents.js re-exports `rgbHexToColor` (hex string -> Color) at its top level but not that conversion's own inverse, `colorToRgbHex` -- this is display-only formatting, not a reimplementation of that (unexported) function.
export function formatColor(color: LayoutColor): string {
  const byte = (component: number): string =>
    Math.round(component * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${byte(color.r)}${byte(color.g)}${byte(color.b)}`;
}

export function formatStroke(stroke: {
  readonly color: LayoutColor;
  readonly widthPt: number;
}): string {
  return `${formatColor(stroke.color)} @ ${stroke.widthPt.toFixed(1)}pt`;
}

// `LayoutText.color`/`LayoutLine.color` are both REQUIRED fields (unlike a rect/ellipse/path's own optional `fill`), so a blank or unparseable entry falls back to the item's current colour rather than clearing it -- there is nowhere in either item's own type for "no colour" to live.
export function parseRequiredColorField(
  raw: string,
  fallback: LayoutColor,
): LayoutColor {
  return parseColorField(raw) ?? fallback;
}

export function parseFontWeight(raw: string): "normal" | "bold" {
  return raw.trim().toLowerCase() === "bold" ? "bold" : "normal";
}

export function parseFontStyle(raw: string): "normal" | "italic" {
  return raw.trim().toLowerCase() === "italic" ? "italic" : "normal";
}

// Blank-to-clear parse for the optional numeric fields (text/image rotationDeg, text widthPt) -- distinct from parseNumberField's own "blank falls back to the pre-filled default" convention, since these fields are genuinely optional on the underlying LayoutItem and a caller needs a real way to clear them back to unset.
export function parseOptionalNumberField(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

// A hand-rolled triangle spanning the given frame, in `LayoutSubpath`'s own flat startXPt/startYPt shape -- NOT `ContentSubpath` (the nested `{ start: { xPt, yPt } }` shape `screens/shared/vector-fields.ts`'s own `defaultTriangleSubpaths` builds for odg/odp's `ContentVector`), a genuinely different type for the identical geometric idea, since the PDF pivot and the ODF content pivot each declare their own subpath schema in document-schema.js. Local coordinates, matching `PdfPathInit.subpaths`' own convention (no page-space translation applied here).
export function defaultTriangleLayoutSubpaths(
  widthPt: number,
  heightPt: number,
): readonly LayoutSubpath[] {
  return [
    {
      startXPt: 0,
      startYPt: heightPt,
      segments: [
        { kind: "line", xPt: widthPt / 2, yPt: 0 },
        { kind: "line", xPt: widthPt, yPt: heightPt },
      ],
      closed: true,
    },
  ];
}

export function inferImageFormat(path: string): "png" | "jpeg" | undefined {
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  if (extension === "png") {
    return "png";
  }
  if (extension === "jpg" || extension === "jpeg") {
    return "jpeg";
  }
  return undefined;
}
