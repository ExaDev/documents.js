import { concatBytes } from "./bytes/writer";
import type { PdfDiagnosticSink } from "./diagnostics";
import { decodeStream } from "./filters";
import type { PdfObjectResolver } from "./interpret-types";
import type { LayoutItem } from "./layout";
import type { Matrix } from "./matrix";
import {
  applyMatrix,
  multiplyMatrices,
  rotatePointAboutCenter,
  translationMatrix,
} from "./matrix";
import type { PdfDict } from "./objects";
import { asArray, asNumber, dictGet } from "./objects";

// A page's visible region and the matrix placing its content in it, split from read.ts so every reader that walks a page's content (readPdf, and the image listing in read-images.ts) places items identically: the crop box as the visible region (ISO 32000-1 14.11.2), /Rotate applied, and every position made relative to the visible region's lower-left corner. Kept free of the text pipeline's modules (font resolution and its glyph tables), which the image listing never needs: loading them costs a Worker isolate about 12 MB before it reads anything.

// US Letter (ISO 32000-1's own example default, and the overwhelming common fallback in practice): used only when a page has no /MediaBox at all, even after page-tree inheritance — a genuinely malformed file.
const DEFAULT_PAGE_WIDTH_PT = 612;
const DEFAULT_PAGE_HEIGHT_PT = 792;

export interface PageBoxRect {
  readonly llx: number;
  readonly lly: number;
  readonly urx: number;
  readonly ury: number;
}

// One of the five page-boundary rectangles (ISO 32000-1 14.11.2), normalised to lower-left/upper-right corners — a producer may write either corner order. Undefined when the page does not declare the entry; only /MediaBox has a fallback (the malformed-file letter default below).
function readDeclaredPageBox(
  page: PdfDict,
  key: string,
): PageBoxRect | undefined {
  const arr = asArray(dictGet(page, key));
  if (arr === undefined) {
    return undefined;
  }
  const a = asNumber(arr[0]) ?? 0;
  const b = asNumber(arr[1]) ?? 0;
  const c = asNumber(arr[2]) ?? 0;
  const d = asNumber(arr[3]) ?? 0;
  return {
    llx: Math.min(a, c),
    lly: Math.min(b, d),
    urx: Math.max(a, c),
    ury: Math.max(b, d),
  };
}

function readMediaBox(page: PdfDict): PageBoxRect {
  return (
    readDeclaredPageBox(page, "MediaBox") ?? {
      llx: 0,
      lly: 0,
      urx: DEFAULT_PAGE_WIDTH_PT,
      ury: DEFAULT_PAGE_HEIGHT_PT,
    }
  );
}

// The axis-aligned bounds of a page rectangle after a rotation transform — all four corners transformed, then min/max, because a rotation that is not about the box's own corner does not preserve which corner is lower-left (and /Rotate's matrix is built for the media box's frame, not the crop box's).
interface RotatedRectBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

function rotatedRectBounds(
  rect: PageBoxRect,
  matrix: Matrix,
): RotatedRectBounds {
  const corners: readonly (readonly [number, number])[] = [
    [rect.llx, rect.lly],
    [rect.urx, rect.lly],
    [rect.llx, rect.ury],
    [rect.urx, rect.ury],
  ];
  const transformed = corners.map(([x, y]) => applyMatrix(matrix, { x, y }));
  const xs = transformed.map((point) => point.x);
  const ys = transformed.map((point) => point.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

export type PageRotation = 0 | 90 | 180 | 270;
type NonZeroPageRotation = 90 | 180 | 270;

// The three non-zero values ISO 32000-1 7.7.3.3's /Rotate can normalize to.
const QUARTER_TURN_DEG = 90;
const HALF_TURN_DEG = 180;
const THREE_QUARTER_TURN_DEG = 270;
const DEGREES_PER_TURN = 360;

// A user-defined type guard, rather than a plain boolean check, because `PageRotation` needs `normalized` narrowed to `NonZeroPageRotation` below: comparing against QUARTER_TURN_DEG/HALF_TURN_DEG/THREE_QUARTER_TURN_DEG (typed as plain `number`, since that is what a bare `const` initializer widens to) would not narrow the way comparing against inline literals does, and this predicate's own declared return type supplies that narrowing instead.
function isNonZeroPageRotation(n: number): n is NonZeroPageRotation {
  return (
    n === QUARTER_TURN_DEG ||
    n === HALF_TURN_DEG ||
    n === THREE_QUARTER_TURN_DEG
  );
}

export function normalizeRotation(rotate: number | undefined): PageRotation {
  if (rotate === undefined) {
    return 0;
  }
  const normalized =
    (((Math.round(rotate / QUARTER_TURN_DEG) * QUARTER_TURN_DEG) %
      DEGREES_PER_TURN) +
      DEGREES_PER_TURN) %
    DEGREES_PER_TURN;
  return isNonZeroPageRotation(normalized) ? normalized : 0;
}

export interface PageRotationResult {
  readonly matrix: Matrix;
  readonly widthPt: number;
  readonly heightPt: number;
}

// Each case derived and verified independently by tracking where all four MediaBox corners land after physically rotating the rendered page clockwise by the given angle (ISO 32000-1 7.7.3.3's own definition of /Rotate) — e.g. for 90, the original bottom-left corner (0,0) becomes the new page's top-left corner (0, w), and solving the resulting four-corner system gives (x,y) -> (y, w-x).
export function pageRotationTransform(
  rotation: PageRotation,
  w: number,
  h: number,
): PageRotationResult {
  if (rotation === QUARTER_TURN_DEG) {
    return { matrix: [0, -1, 1, 0, 0, w], widthPt: h, heightPt: w };
  }
  if (rotation === HALF_TURN_DEG) {
    return { matrix: [-1, 0, 0, -1, w, h], widthPt: w, heightPt: h };
  }
  if (rotation === THREE_QUARTER_TURN_DEG) {
    return { matrix: [0, 1, -1, 0, h, 0], widthPt: h, heightPt: w };
  }
  return { matrix: [1, 0, 0, 1, 0, 0], widthPt: w, heightPt: h };
}

/** A page's visible region, in output points, and the matrix that maps its content's user space into it. */
export interface PageFrame {
  readonly mediaBox: PageBoxRect;
  readonly cropBox: PageBoxRect;
  readonly widthPt: number;
  readonly heightPt: number;
  readonly pageMatrix: Matrix;
}

/**
 * Reads a page's visible region and the matrix placing its content there.
 * @param pageIndex - The page's source position, for diagnostics.
 * @param page - The page dictionary, inheritance already applied.
 * @param sink - Receives a degenerate crop box's diagnostic.
 * @returns The page's frame.
 */
export function readPageFrame(
  pageIndex: number,
  page: PdfDict,
  sink: PdfDiagnosticSink,
): PageFrame {
  const mediaBox = readMediaBox(page);
  // The crop box is the visible region (ISO 32000-1 14.11.2: a viewer displays and prints it, and it defaults to the media box), so it — not the media box — is the page geometry this package reports, and content outside it is not visible at all. Inherited through the page tree like /MediaBox (one of 7.7.3.4's four inheritable attributes); /BleedBox /TrimBox /ArtBox are ordinary page-direct entries and are quarantined as residue, never clipped to.
  let cropBox = readDeclaredPageBox(page, "CropBox") ?? mediaBox;
  if (cropBox.urx - cropBox.llx <= 0 || cropBox.ury - cropBox.lly <= 0) {
    sink({
      code: "pdf/invalid-crop-box",
      severity: "warning",
      pageIndex,
      message:
        "page /CropBox is degenerate (zero width or height); falling back to the /MediaBox as the visible region",
    });
    cropBox = mediaBox;
  }
  const rotation = normalizeRotation(asNumber(dictGet(page, "Rotate")));
  // Only the rotation's matrix is used below, never its own widthPt/heightPt fields — and the matrix's rotation/reflection component (a, b, c, d) never depends on the w/h arguments at all, only its translation component (e, f) does. That translation is provably canceled by the origin renormalization below (translationMatrix(-visibleRect.minX, -visibleRect.minY) subtracts out exactly the offset any w/h value would have introduced), so the real mediaBox width/height would produce a byte-identical pageMatrix and visibleRect to passing 0 for both — confirmed directly against an asymmetric MediaBox/CropBox pair under every rotation, not merely the aligned case. Passing 0 rather than the real (but unobservable) mediaBox dimensions removes an arithmetic expression whose result genuinely never reaches any output.
  const rotationMatrix = pageRotationTransform(rotation, 0, 0).matrix;
  // The crop rect rotated into output space, then used as the origin: every item position is relative to the visible region's own lower-left corner, exactly as a viewer presents it.
  const visibleRect = rotatedRectBounds(cropBox, rotationMatrix);
  return {
    mediaBox,
    cropBox,
    widthPt: visibleRect.maxX - visibleRect.minX,
    heightPt: visibleRect.maxY - visibleRect.minY,
    pageMatrix: multiplyMatrices(
      rotationMatrix,
      translationMatrix(-visibleRect.minX, -visibleRect.minY),
    ),
  };
}

// ISO 32000-1 7.8.2: when /Contents is an array, readers must treat the concatenation of the referenced streams as if they were one stream, "as though they were preceded and followed by white-space characters". Inserted here as a defensive LINE FEED, so a token straddling the end of one chunk and the start of the next can never merge into one, even when a producer omitted trailing whitespace of its own.
const CONTENT_STREAM_JOIN_BYTE = 0x0a;

export function readPageContentBytes(
  page: PdfDict,
  resolver: Readonly<PdfObjectResolver>,
  sink: PdfDiagnosticSink,
): Uint8Array<ArrayBuffer> {
  const contentsObj = resolver.resolve(dictGet(page, "Contents"));
  if (contentsObj?.kind === "stream") {
    return decodeStream(contentsObj.raw, contentsObj.dict, sink).bytes;
  }
  if (contentsObj?.kind === "array") {
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    for (const item of contentsObj.items) {
      const streamObj = resolver.resolve(item);
      if (streamObj?.kind === "stream") {
        chunks.push(
          decodeStream(streamObj.raw, streamObj.dict, sink).bytes,
          new Uint8Array([CONTENT_STREAM_JOIN_BYTE]),
        );
      }
    }
    return concatBytes(chunks);
  }
  return new Uint8Array(0);
}

// A content item's axis-aligned bounds in output page space — the crop-visibility filter's input. Link and internalLink kinds report undefined: an annotation is an anchored construct, not painted stream content, so the visibility filter must not claim it (the same line the optional-content filter draws, treating annotation kinds as not layer-governed content).
function contentItemBounds(item: LayoutItem): RotatedRectBounds | undefined {
  if (item.kind === "link" || item.kind === "internalLink") {
    return undefined;
  }
  const frameBounds = (
    xPt: number,
    yPt: number,
    widthPt: number,
    heightPt: number,
  ): RotatedRectBounds => ({
    minX: xPt,
    minY: yPt,
    maxX: xPt + widthPt,
    maxY: yPt + heightPt,
  });
  if (
    item.kind === "text" ||
    item.kind === "image" ||
    item.kind === "rect" ||
    item.kind === "ellipse"
  ) {
    if (
      item.kind !== "text" ||
      item.rotationDeg === undefined ||
      item.rotationDeg % HALF_TURN_DEG === 0
    ) {
      // widthPt is optional on text (reported, not measured, on some paths) — a missing width still bounds the run to its anchor plus size, never an unbounded extent.
      return frameBounds(
        item.xPt,
        item.yPt,
        item.widthPt ?? 0,
        item.kind === "text" ? item.sizePt : item.heightPt,
      );
    }
    // An obliquely rotated run's frame no longer bounds it: rotate the (width x size) frame's corners about the run's own anchor, which the conversion places invariantly, and take the hull. Generous by construction (the glyph ink stays within the em box), which errs toward keeping an edge-straddling run — the right direction for a visibility filter.
    const rotationDeg = item.rotationDeg;
    const anchorX = item.xPt;
    const anchorY = item.yPt;
    const corners: readonly (readonly [number, number])[] = [
      [0, 0],
      [item.widthPt ?? 0, 0],
      [0, item.sizePt],
      [item.widthPt ?? 0, item.sizePt],
    ];
    const rotated = corners.map(([dx, dy]) =>
      rotatePointAboutCenter(
        { x: anchorX + dx, y: anchorY + dy },
        { x: anchorX, y: anchorY },
        rotationDeg,
      ),
    );
    const xs = rotated.map((point) => point.x);
    const ys = rotated.map((point) => point.y);
    return {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    };
  }
  if (item.kind === "line") {
    return {
      minX: Math.min(item.x1Pt, item.x2Pt),
      minY: Math.min(item.y1Pt, item.y2Pt),
      maxX: Math.max(item.x1Pt, item.x2Pt),
      maxY: Math.max(item.y1Pt, item.y2Pt),
    };
  }
  // A path's bounds cover every subpath's start point, every segment endpoint, and every cubic control point — a Bezier can extend beyond its endpoint hull, and a visibility filter errs towards keeping, never towards inventing a tighter box the geometry does not state.
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const include = (x: number, y: number): void => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const subpath of item.subpaths) {
    include(subpath.startXPt, subpath.startYPt);
    for (const segment of subpath.segments) {
      include(segment.xPt, segment.yPt);
      if (segment.kind === "cubic") {
        include(segment.c1xPt, segment.c1yPt);
        include(segment.c2xPt, segment.c2yPt);
      }
    }
  }
  return { minX, minY, maxX, maxY };
}

// Whether an item's bounds touch the visible page rectangle at all — touching the boundary counts as visible (a hairline rule exactly on the crop edge shows); only an item whose whole extent lies strictly beyond the edge is not visible.
export function itemIntersectsVisibleRegion(
  item: LayoutItem,
  widthPt: number,
  heightPt: number,
): boolean {
  if (item.kind === "link" || item.kind === "internalLink") {
    return true;
  }
  const bounds = contentItemBounds(item);
  if (bounds === undefined) {
    return true;
  }
  return (
    bounds.maxX >= 0 &&
    bounds.minX <= widthPt &&
    bounds.maxY >= 0 &&
    bounds.minY <= heightPt
  );
}
