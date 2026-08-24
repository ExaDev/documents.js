import type {
  Color,
  ContentDocument,
  ContentDrawPage,
  ContentShape,
  ContentSubpath,
  ContentVector,
} from "document-schema.js";
import { colorToRgbHex } from "document-schema.js";
import {
  buildSvgPathData,
  buildSvgViewBox,
  formatPathNumber,
} from "../edit/odg/svg-path";
import { mergeByPaintOrder } from "../model/paint-order";
import type { SvgDiagnosticSink } from "./diagnostics";
import { encodeXmlText } from "odf.js";

// The svg write half: a drawing ContentDocument -> SVG text, the inverse of src/svg/read.ts. One user unit is written as one point (root width/height carry explicit pt units and viewBox is the identical 1:1 "0 0 W H" via buildSvgViewBox), so every ContentVector coordinate -- itself page-point space in the drawing variant's y-down convention -- lands in the output unchanged: no rescaling arithmetic on write, and readSvgContent parses the same numbers back. Vectors render as the six shape primitives; ContentShapes (draw:frame text/image/table content) have no SVG vector representation in this scope and are skipped under svg/shape-unsupported, never silently dropped.

export class SvgUnsupportedDocumentKindError extends Error {
  readonly kind: ContentDocument["kind"];

  constructor(kind: ContentDocument["kind"]) {
    super(
      `buildSvgText: expected a drawing ContentDocument, got kind '${kind}'`,
    );
    this.name = "SvgUnsupportedDocumentKindError";
    this.kind = kind;
  }
}

// svg has no second page, so writing a multi-page source is a caller decision, never a silent truncation -- the identical contract buildCsvText holds for sheets, carried by page INDEX here because drawing pages are anonymous (a sheet has a name; a page does not).
export class SvgMultiPageNotSpecifiedError extends Error {
  readonly pageCount: number;

  constructor(pageCount: number) {
    super(
      `buildSvgText: this document has more than one page (${pageCount}) -- pass { page: <index> } to select one`,
    );
    this.name = "SvgMultiPageNotSpecifiedError";
    this.pageCount = pageCount;
  }
}

export class SvgPageNotFoundError extends Error {
  readonly page: number;
  readonly pageCount: number;

  constructor(page: number, pageCount: number) {
    super(
      `buildSvgText: page index ${page} not found -- the document has ${pageCount} page(s)`,
    );
    this.name = "SvgPageNotFoundError";
    this.page = page;
    this.pageCount = pageCount;
  }
}

// Named BuildSvgTextOptions rather than SvgWriteOptions because convert.ts declares its own SvgWriteOptions as the ergonomic intersection type the named svg-targeted conversions expose -- the identical split csv holds between BuildCsvTextOptions and CsvWriteOptions, so the two layers never collide on this package's export surface.
export interface BuildSvgTextOptions {
  // Selects which page of a multi-page document is written. Optional only when the document has exactly one page.
  readonly page?: number;
  readonly onSvgDiagnostic?: SvgDiagnosticSink;
}

function selectPage(
  pages: readonly ContentDrawPage[],
  page: number | undefined,
): ContentDrawPage {
  if (page !== undefined) {
    const found = pages[page];
    if (found === undefined) {
      throw new SvgPageNotFoundError(page, pages.length);
    }
    return found;
  }
  if (pages.length === 0) {
    throw new SvgPageNotFoundError(0, 0);
  }
  if (pages.length > 1) {
    throw new SvgMultiPageNotSpecifiedError(pages.length);
  }
  return pages[0]!;
}

// The two dash patterns map onto the two stroke styles this ecosystem's writers share: "6 4" and "1 3" are the same constants src/edit/odg's own graphic writer uses, in user units -- here 1pt each, so a written dashed/dotted stroke round-trips at the same visual weight the ODF writers produce. A dotted pattern additionally needs round linecaps, or the dashes render as hairline rectangles rather than dots.
const DASHED_PATTERN = "6 4";
const DOTTED_PATTERN = "1 3";

// colorToRgbHex returns the bare six-digit hex (no '#'), which is not a colour any CSS/SVG parser accepts -- the '#' is this format's own spelling of the value.
function svgColor(fill: Color): string {
  return `#${colorToRgbHex(fill)}`;
}

function fillAttr(fill: Color | undefined): string {
  return fill === undefined ? ' fill="none"' : ` fill="${svgColor(fill)}"`;
}

function strokeAttr(
  vector: ContentVector,
  stroke: {
    readonly color: Color;
    readonly widthPt: number;
    readonly style?: "solid" | "dashed" | "dotted" | "double";
  },
  sink: SvgDiagnosticSink | undefined,
): string {
  let attrs = ` stroke="${svgColor(stroke.color)}" stroke-width="${formatPathNumber(stroke.widthPt)}"`;
  if (stroke.style === "dashed") {
    attrs += ` stroke-dasharray="${DASHED_PATTERN}"`;
  } else if (stroke.style === "dotted") {
    attrs += ` stroke-dasharray="${DOTTED_PATTERN}" stroke-linecap="round"`;
  } else if (stroke.style === "double") {
    // SVG strokes are single -- the schema's 'double' style has no construct to map onto, so it writes solid under a diagnostic rather than being silently flattened.
    sink?.({
      code: "svg/stroke-style-unsupported",
      detail: `${vector.sourcePath ?? vector.kind}: stroke style 'double' written as solid`,
    });
  }
  return attrs;
}

// ContentVector.rotationDeg is clockwise-on-screen in the drawing variant's y-down space, which is exactly SVG's own rotate() convention -- so the transform is a direct transcription about the frame's own centre, the same centre src/layout/drawing.ts rotates about on the render side.
function rotationAttr(
  rotationDeg: number | undefined,
  frame: {
    readonly xPt: number;
    readonly yPt: number;
    readonly widthPt: number;
    readonly heightPt: number;
  },
): string {
  if (rotationDeg === undefined || rotationDeg === 0) {
    return "";
  }
  const cx = frame.xPt + frame.widthPt / 2;
  const cy = frame.yPt + frame.heightPt / 2;
  return ` transform="rotate(${formatPathNumber(rotationDeg)} ${formatPathNumber(cx)} ${formatPathNumber(cy)})"`;
}

// A path's own subpaths are local to its frame (the ContentVector path variant contract), so writing absolute d coordinates is one offset: frame origin added to every point, reusing buildSvgPathData unchanged for the grammar itself.
function offsetSubpaths(
  subpaths: readonly ContentSubpath[],
  offsetX: number,
  offsetY: number,
): ContentSubpath[] {
  const offsetPoint = (point: {
    readonly xPt: number;
    readonly yPt: number;
  }) => ({ xPt: point.xPt + offsetX, yPt: point.yPt + offsetY });
  return subpaths.map((subpath) => ({
    start: offsetPoint(subpath.start),
    closed: subpath.closed,
    segments: subpath.segments.map((segment) =>
      segment.kind === "line"
        ? { kind: "line" as const, to: offsetPoint(segment.to) }
        : {
            kind: "cubic" as const,
            control1: offsetPoint(segment.control1),
            control2: offsetPoint(segment.control2),
            to: offsetPoint(segment.to),
          },
    ),
  }));
}

function vectorElement(
  vector: ContentVector,
  sink: SvgDiagnosticSink | undefined,
): string {
  switch (vector.kind) {
    case "rect":
      return `<rect x="${formatPathNumber(vector.frame.xPt)}" y="${formatPathNumber(vector.frame.yPt)}" width="${formatPathNumber(vector.frame.widthPt)}" height="${formatPathNumber(vector.frame.heightPt)}"${fillAttr(vector.fill)}${vector.stroke === undefined ? "" : strokeAttr(vector, vector.stroke, sink)}${rotationAttr(vector.rotationDeg, vector.frame)}/>`;
    case "ellipse": {
      const cx = vector.frame.xPt + vector.frame.widthPt / 2;
      const cy = vector.frame.yPt + vector.frame.heightPt / 2;
      const rx = vector.frame.widthPt / 2;
      const ry = vector.frame.heightPt / 2;
      return `<ellipse cx="${formatPathNumber(cx)}" cy="${formatPathNumber(cy)}" rx="${formatPathNumber(rx)}" ry="${formatPathNumber(ry)}"${fillAttr(vector.fill)}${vector.stroke === undefined ? "" : strokeAttr(vector, vector.stroke, sink)}${rotationAttr(vector.rotationDeg, vector.frame)}/>`;
    }
    case "line":
      return `<line x1="${formatPathNumber(vector.from.xPt)}" y1="${formatPathNumber(vector.from.yPt)}" x2="${formatPathNumber(vector.to.xPt)}" y2="${formatPathNumber(vector.to.yPt)}"${strokeAttr(vector, vector.stroke, sink)}/>`;
    case "path": {
      const d = buildSvgPathData(
        offsetSubpaths(vector.subpaths, vector.frame.xPt, vector.frame.yPt),
      );
      const fillRule =
        vector.fillRule === "evenodd" ? ' fill-rule="evenodd"' : "";
      return `<path d="${d}"${fillAttr(vector.fill)}${vector.stroke === undefined ? "" : strokeAttr(vector, vector.stroke, sink)}${fillRule}${rotationAttr(vector.rotationDeg, vector.frame)}/>`;
    }
  }
}

function shapeDetail(shape: ContentShape): string {
  return shape.name ?? shape.sourcePath ?? "shape";
}

export function buildSvgText(
  content: ContentDocument,
  options?: BuildSvgTextOptions,
): string {
  if (content.kind !== "drawing") {
    throw new SvgUnsupportedDocumentKindError(content.kind);
  }
  const sink = options?.onSvgDiagnostic;
  const page = selectPage(content.pages, options?.page);

  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${formatPathNumber(page.size.widthPt)}pt" height="${formatPathNumber(page.size.heightPt)}pt" viewBox="${buildSvgViewBox(page.size.widthPt, page.size.heightPt)}">`,
  );
  if (content.metadata.title !== undefined && content.metadata.title !== "") {
    lines.push(`  <title>${encodeXmlText(content.metadata.title)}</title>`);
  }
  for (const entry of mergeByPaintOrder(page.vectors, page.shapes)) {
    if (entry.kind === "vector") {
      lines.push(`  ${vectorElement(entry.value, sink)}`);
    } else {
      sink?.({
        code: "svg/shape-unsupported",
        detail: `${shapeDetail(entry.value)}: draw:frame text/image/table content has no SVG vector representation`,
      });
    }
  }
  lines.push("</svg>");
  return `${lines.join("\n")}\n`;
}
