// The presentation and drawing reconstruction family, split from reconstruct.ts: reconstructPresentation (slide/shape clustering, block frames, image mapping), reconstructDrawing (vector mapping, page-vector recovery), and the spreadsheet direction's own page-to-sheet tail (reconstructSheet, RecoveredTable). The line-clustering and structure helpers they share stay in reconstruct.ts and are imported back; the import cycle is evaluation-safe because every cross binding is called at reconstruct time, after both modules finish evaluating.
import type {
  ContentBlock,
  ContentDocument,
  Box,
  ContentDrawPage,
  ContentEmbeddedObjectBlock,
  ContentParagraph,
  ContentPathPoint,
  ContentShape,
  ContentSheet,
  ContentSheetPrintSettings,
  ContentSlide,
  ContentSubpath,
  ContentTable,
  ContentVector,
} from "document-schema.js";
import type {
  LayoutImage,
  LayoutImageAsset,
  LayoutItem,
  LayoutPage,
  LayoutText,
  LayoutDocument,
  LayoutEllipse,
  LayoutLine,
  LayoutPath,
  LayoutRect,
  LayoutSubpath,
} from "pdf-codec";
import { flipY } from "../model/geometry";
import { buildDrawingBlock } from "../model/embedded-drawing";
import { stampFrame } from "./shared";
import type { CellTypeInferenceSink } from "./cell-typing";
import { throwIfAborted } from "../ports/abort";
import type { ReconstructOptions } from "./reconstruct";
import { indexStructure, ZERO_MARGINS } from "./reconstruct";
import {
  clusterIntoLines,
  fontSizesClose,
  gapExceeds,
  LARGE_GAP_EM_MULTIPLIER,
  LEFT_ALIGN_TOLERANCE_PT,
  lineBox,
  PARAGRAPH_GAP_MULTIPLIER,
  pushRunsForLine,
  textBoxOfItem,
  textItemToContentRun,
  textItemVerticalExtent,
} from "./reconstruct-lines";
import type { TextLine } from "./reconstruct-lines";
import type { StructureIndex } from "./reconstruct";
import { recoverTables } from "./reconstruct-tables";
import type { CellTypingContext } from "./reconstruct-tables";
import { detectGridLattice } from "./lattice";
import {
  buildGridFromLattice,
  buildGridFromTextClustering,
} from "./reconstruct-tables";

export function reconstructPresentation(
  doc: LayoutDocument,
  options?: ReconstructOptions,
): ContentDocument {
  const signal = options?.signal;
  const structure = indexStructure(doc);
  const slides = doc.pages.map((page, pageIndex) => {
    throwIfAborted(signal);
    return reconstructSlide(page, pageIndex, doc.images, structure);
  });
  return { kind: "presentation", metadata: doc.metadata, slides };
}

// Table and vector recovery run here on exactly the same terms as in reconstructPageBlocks above — same detector, same gates, same exclusions — differing only in the container each result has to be wrapped in: a slide holds nothing but ContentShapes, so a recovered table and a recovered drawing each become a shape framed at the geometry they were recovered from, rather than a bare block placed in a flow.
function reconstructSlide(
  page: LayoutPage,
  pageIndex: number,
  images: Record<string, LayoutImageAsset>,
  structure: StructureIndex | undefined,
): ContentSlide {
  const recoveredTables = recoverTables(page, pageIndex, structure);
  const consumedText = new Set<LayoutText>();
  const claimedItems = new Set<LayoutItem>();
  for (const recovered of recoveredTables) {
    for (const item of recovered.consumedText) {
      consumedText.add(item);
    }
    for (const item of recovered.latticeItems) {
      claimedItems.add(item);
    }
  }
  const textItems = page.items.filter(
    (i): i is LayoutText => i.kind === "text" && !consumedText.has(i),
  );
  const imageItems = page.items.filter(
    (i): i is LayoutImage => i.kind === "image",
  );

  const lines = clusterIntoLines(textItems);
  const blocks = clusterIntoBlocks(lines);
  const textShapes = blocks.map((block) =>
    blockToShape(block, page.heightPt, pageIndex),
  );
  const imageShapes: ContentShape[] = [];
  for (const img of imageItems) {
    const shape = imageToShape(img, page.heightPt, pageIndex, images);
    if (shape !== undefined) {
      imageShapes.push(shape);
    }
  }
  const recoveredVectors = recoverPageVectors(page, pageIndex, claimedItems);
  // Vectors paint behind everything else, matching src/layout/drawing.ts's own documented vectors-then-shapes fallback for a page whose true interleaving is unknown — and it is unknown here for the same reason: a slide's shapes array carries no ordering field relating it to content recovered outside it.
  const vectorShapes: ContentShape[] =
    recoveredVectors === undefined
      ? []
      : [
          wrapBlockInShape(
            recoveredVectors.block,
            { xPt: 0, yPt: 0, widthPt: page.widthPt, heightPt: page.heightPt },
            page.heightPt,
            pageIndex,
          ),
        ];
  const tableShapes: ContentShape[] = recoveredTables.map((recovered) =>
    wrapBlockInShape(
      recovered.table,
      recovered.frame,
      page.heightPt,
      pageIndex,
    ),
  );

  // Images before text shapes in z-order (plan Step 10). notes recovers LayoutPage's own private page-dictionary entry (see pdf/write.ts/read.ts) when the source PDF was produced by this package's own pptxToPdf — absent (falls back to '') for a PDF from any other producer, since nothing else would ever write it.
  return {
    size: { widthPt: page.widthPt, heightPt: page.heightPt },
    shapes: [...vectorShapes, ...imageShapes, ...tableShapes, ...textShapes],
    notes: page.notes ?? "",
  };
}

// A single recovered block as its own containing shape, with the zero insets and no rotation every other shape this module produces already uses — a slide has no container for a bare block, and a table or a drawing recovered from a page is exactly one block. The wrapper shape's frame records where the wrapped content sat (frame arrives y-down; the stamped frame is its PDF-space flip).
function wrapBlockInShape(
  block: ContentBlock,
  frame: Box,
  pageHeightPt: number,
  pageIndex: number,
): ContentShape {
  const shape: ContentShape = {
    frame,
    insetLeftPt: 0,
    insetTopPt: 0,
    insetRightPt: 0,
    insetBottomPt: 0,
    blocks: [block],
  };
  stampFrame(shape, pageIndex, flipY(frame, pageHeightPt));
  return shape;
}

interface TextBlock {
  readonly lines: TextLine[];
}

export function splitLineByLargeGaps(line: TextLine): TextLine[] {
  const segments: TextLine[] = [];
  let current: LayoutText[] = [];
  line.items.forEach((item, i) => {
    if (i > 0) {
      const prev = line.items[i - 1]!;
      if (gapExceeds(prev, item, LARGE_GAP_EM_MULTIPLIER * item.sizePt)) {
        segments.push({ items: current, baselineY: line.baselineY });
        current = [];
      }
    }
    current.push(item);
  });
  if (current.length > 0) {
    segments.push({ items: current, baselineY: line.baselineY });
  }
  return segments;
}

// Consecutive lines merge into one text block when their left edges align, the baseline gap still looks like ordinary single-line spacing (not a paragraph-sized jump — reusing PARAGRAPH_GAP_MULTIPLIER, the same "still the same flow" signal the docx path uses), and their dominant font sizes are close (plan Step 10). Each merged line keeps its own ContentParagraph within the shape, rather than being joined into one paragraph the way docx lines are — pptx text boxes commonly hold several genuinely distinct short paragraphs (list items, separate sentences), and there is no reliable signal from geometry alone for whether two stacked lines were one wrapped paragraph or two.
function clusterIntoBlocks(pageLines: readonly TextLine[]): TextBlock[] {
  const segments = pageLines.flatMap(splitLineByLargeGaps);
  const blocks: TextBlock[] = [];
  for (const segment of segments) {
    const leftX = segment.items[0]!.xPt;
    const sizePt = segment.items[0]!.sizePt;
    const matched = blocks.find((block) => {
      const lastLine = block.lines[block.lines.length - 1]!;
      const lastLeftX = lastLine.items[0]!.xPt;
      const lastSizePt = lastLine.items[0]!.sizePt;
      const gap = lastLine.baselineY - segment.baselineY;
      if (gap <= 0) {
        return false; // only extend downward, in reading order
      }
      const leftAligned =
        Math.abs(leftX - lastLeftX) <= LEFT_ALIGN_TOLERANCE_PT;
      return (
        leftAligned &&
        fontSizesClose(sizePt, lastSizePt) &&
        gap <= PARAGRAPH_GAP_MULTIPLIER * lastSizePt
      );
    });
    if (matched !== undefined) {
      matched.lines.push(segment);
    } else {
      blocks.push({ lines: [segment] });
    }
  }
  return blocks;
}

function computeBlockFrame(block: TextBlock, slideHeightPt: number): Box {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const line of block.lines) {
    for (const item of line.items) {
      const { ascentPt, descentPt } = textItemVerticalExtent(item);
      minX = Math.min(minX, item.xPt);
      maxX = Math.max(maxX, item.xPt + (item.widthPt ?? 0));
      minY = Math.min(minY, item.yPt - descentPt);
      maxY = Math.max(maxY, item.yPt + ascentPt);
    }
  }
  return flipY(
    { xPt: minX, yPt: minY, widthPt: maxX - minX, heightPt: maxY - minY },
    slideHeightPt,
  );
}

export function lineToParagraph(
  line: TextLine,
  pageIndex: number,
): ContentParagraph {
  const paragraph: ContentParagraph = { kind: "paragraph", runs: [] };
  stampFrame(paragraph, pageIndex, lineBox(line, pageIndex));
  pushRunsForLine(paragraph.runs, line, pageIndex);
  return paragraph;
}

// A recovered text block's own shape frame is stamped from the PDF-space bounding box of exactly the items clustered into it — computeBlockFrame returns that same box flipped into top-left/y-down space for the shape's own frame field, so the stamp records the pre-flip original.
function blockToShape(
  block: TextBlock,
  slideHeightPt: number,
  pageIndex: number,
): ContentShape {
  const shape: ContentShape = {
    frame: computeBlockFrame(block, slideHeightPt),
    insetLeftPt: 0,
    insetTopPt: 0,
    insetRightPt: 0,
    insetBottomPt: 0,
    blocks: block.lines.map((line) => lineToParagraph(line, pageIndex)),
  };
  stampFrame(shape, pageIndex, flipY(shape.frame, slideHeightPt));
  return shape;
}

// The inverse of content-write.ts's own placement convention: LayoutImage.rotationDeg is counter-clockwise-positive (matrix.ts's convention, via matrixRotationDegrees), while ContentShape.rotationDeg is clockwise (DrawingML's a:xfrm/@rot convention) — negated here, the one place PDF-space image rotation crosses into OOXML-space.
function imageToShape(
  img: LayoutImage,
  slideHeightPt: number,
  pageIndex: number,
  images: Record<string, LayoutImageAsset>,
): ContentShape | undefined {
  const asset = images[img.imageId];
  if (asset === undefined) {
    return undefined;
  }
  const frame = flipY(
    {
      xPt: img.xPt,
      yPt: img.yPt,
      widthPt: img.widthPt,
      heightPt: img.heightPt,
    },
    slideHeightPt,
  );
  const block: ContentBlock = {
    kind: "image",
    format: asset.format,
    base64: asset.base64,
    widthPt: img.widthPt,
    heightPt: img.heightPt,
  };
  stampFrame(block, pageIndex, {
    xPt: img.xPt,
    yPt: img.yPt,
    widthPt: img.widthPt,
    heightPt: img.heightPt,
  });
  const shape: ContentShape = {
    frame,
    rotationDeg: img.rotationDeg !== undefined ? -img.rotationDeg : undefined,
    insetLeftPt: 0,
    insetTopPt: 0,
    insetRightPt: 0,
    insetBottomPt: 0,
    blocks: [block],
  };
  stampFrame(shape, pageIndex, {
    xPt: img.xPt,
    yPt: img.yPt,
    widthPt: img.widthPt,
    heightPt: img.heightPt,
  });
  return shape;
}

// ---------------------------------------------------------------------------
// PDF -> odg (drawing): deliberately more tractable than reconstructWordprocessing/reconstructPresentation above, because a drawing has no semantic structure to infer at all — no baseline clustering, no paragraph inference. Every painted LayoutItem maps close to 1:1 back onto an ODF construct, in the same z-order (array position) it was painted.
// ---------------------------------------------------------------------------

export function reconstructDrawing(
  doc: LayoutDocument,
  options?: ReconstructOptions,
): ContentDocument {
  const signal = options?.signal;
  const pages: ContentDrawPage[] = doc.pages.map((page, pageIndex) => {
    throwIfAborted(signal);
    return reconstructDrawPage(page, pageIndex, doc.images);
  });
  return { kind: "drawing", metadata: doc.metadata, pages };
}

// ContentDrawPageSchema still keeps shapes and vectors as two separate arrays, but both ContentVector and ContentShape carry a shared `paintOrder` recording their true relative position — the field drawing.ts's own convertDrawingToLayout merges by when going the other direction. reconstructDrawPage produces exactly that field here: it already walked page.items once in real paint order (a LayoutPage's items ARE its paint order, front-to-back by array position) and bucketed each into whichever array its own kind belongs to, so recording the walk position as it goes is all that is needed for the relative order between the two arrays to survive at all. A page that genuinely interleaves the two consequently round-trips its interleaving exactly, rather than collapsing to all-vectors-then-all-shapes the way it had to before the schema carried the field. 'link' items have no drawing-page equivalent and are dropped, matching reconstructPageBlocks/reconstructSlide's own existing precedent above of ignoring link items entirely — a dropped item consumes no paintOrder slot either, so the stamped values stay a dense 0..n-1 run over what was actually recovered.
function reconstructDrawPage(
  page: LayoutPage,
  pageIndex: number,
  images: Record<string, LayoutImageAsset>,
): ContentDrawPage {
  const vectors: ContentVector[] = [];
  const shapes: ContentShape[] = [];
  let paintOrder = 0;
  for (const item of page.items) {
    const vector = layoutItemToVector(item, page.heightPt);
    if (vector !== undefined) {
      stampVectorFrame(vector, item, pageIndex);
      vectors.push({ ...vector, paintOrder: paintOrder++ });
      continue;
    }
    if (item.kind === "text") {
      const shape = layoutTextToShape(item, page.heightPt, pageIndex);
      stampFrame(shape, pageIndex, flipY(shape.frame, page.heightPt));
      shapes.push({ ...shape, paintOrder: paintOrder++ });
    } else if (item.kind === "image") {
      const shape = imageToShape(item, page.heightPt, pageIndex, images);
      if (shape !== undefined) {
        shapes.push({ ...shape, paintOrder: paintOrder++ });
      }
    }
  }
  return {
    size: { widthPt: page.widthPt, heightPt: page.heightPt },
    shapes,
    vectors,
  };
}

// Stamps a recovered vector's frame from the exact item it was recovered from — the PDF-space box that item painted, so the vector node carries its own rendered position exactly the way an engine-laid-out vector does. Rect/ellipse items carry their own box; a line's is the bounding box of its two endpoints; a path's is the tight hull of every point including cubic controls (collectPathPoints, the same hull rule pathBoundingFrame documents).
function stampVectorFrame(
  vector: ContentVector,
  item: LayoutItem,
  pageIndex: number,
): void {
  if (item.kind === "rect" || item.kind === "ellipse") {
    stampFrame(vector, pageIndex, {
      xPt: item.xPt,
      yPt: item.yPt,
      widthPt: item.widthPt,
      heightPt: item.heightPt,
    });
    return;
  }
  if (item.kind === "line") {
    stampFrame(vector, pageIndex, {
      xPt: Math.min(item.x1Pt, item.x2Pt),
      yPt: Math.min(item.y1Pt, item.y2Pt),
      widthPt: Math.abs(item.x2Pt - item.x1Pt),
      heightPt: Math.abs(item.y2Pt - item.y1Pt),
    });
    return;
  }
  if (item.kind !== "path") {
    return; // unreachable from both call sites, which invoke this only once layoutItemToVector proved the item is a vector kind — the guard exists solely to narrow item to LayoutPath for collectPathPoints.
  }
  const points = collectPathPoints(item.subpaths);
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.xPt);
    maxX = Math.max(maxX, point.xPt);
    minY = Math.min(minY, point.yPt);
    maxY = Math.max(maxY, point.yPt);
  }
  stampFrame(vector, pageIndex, {
    xPt: minX,
    yPt: minY,
    widthPt: maxX - minX,
    heightPt: maxY - minY,
  });
}

// The ONE LayoutItem -> ContentVector classification in this package, shared verbatim by all three reconstruction directions: reconstructDrawing (above), and — via recoverPageVectors below — reconstructWordprocessing and reconstructPresentation. Which items reach it at all is a per-direction decision; what a rect/ellipse/line/path becomes once it does is not, and deliberately has no second implementation anywhere. Returns undefined for every non-vector kind (text/image/link), so a caller can use it as the "is this vector geometry?" test and its own converter in one step.
//
// How much this actually recovers is a property of pdf-codec's own content-stream interpreter, not of this function: its shape-pattern detection recognises an axis-aligned closed four-corner subpath as a real LayoutRect (any fill/stroke combination, and a 90-degree-rotated CTM as well as an unrotated one), a closed four-cubic kappa-ratio subpath as a real LayoutEllipse, and an open single-straight-segment stroke-only subpath as a real LayoutLine. Anything outside those patterns — an off-axis rotation, a freeform curve, a multi-subpath figure — stays a generic LayoutPath and is recovered as a 'path' vector, which is an honest narrowing of KIND only: the recovered geometry itself is exact either way.
export function layoutItemToVector(
  item: LayoutItem,
  pageHeightPt: number,
): ContentVector | undefined {
  if (item.kind === "rect") {
    return layoutRectToVector(item, pageHeightPt);
  }
  if (item.kind === "ellipse") {
    return layoutEllipseToVector(item, pageHeightPt);
  }
  if (item.kind === "line") {
    return layoutLineToVector(item, pageHeightPt);
  }
  if (item.kind === "path") {
    return layoutPathToVector(item, pageHeightPt);
  }
  return undefined;
}

// The exact inverse of drawing.ts's own convertRectVector/convertEllipseVector: flipY is its own exact inverse (see model/geometry.ts's own doc comment), so re-flipping a LayoutRect/LayoutEllipse's bottom-left/y-up box recovers the identical top-left/y-down frame convertDrawingToLayout started from.
function layoutRectToVector(
  item: LayoutRect,
  pageHeightPt: number,
): ContentVector {
  const frame = flipY(
    {
      xPt: item.xPt,
      yPt: item.yPt,
      widthPt: item.widthPt,
      heightPt: item.heightPt,
    },
    pageHeightPt,
  );
  return {
    kind: "rect",
    frame,
    fill: item.fill,
    stroke: item.stroke,
    sourcePath: item.sourcePath,
  };
}

function layoutEllipseToVector(
  item: LayoutEllipse,
  pageHeightPt: number,
): ContentVector {
  const frame = flipY(
    {
      xPt: item.xPt,
      yPt: item.yPt,
      widthPt: item.widthPt,
      heightPt: item.heightPt,
    },
    pageHeightPt,
  );
  return {
    kind: "ellipse",
    frame,
    fill: item.fill,
    stroke: item.stroke,
    sourcePath: item.sourcePath,
  };
}

// The exact inverse of drawing.ts's own convertLineVector: a bare point flip (pageHeightPt - yPt), not a box flip, since a line's two endpoints carry no independent width/height to preserve.
function layoutLineToVector(
  item: LayoutLine,
  pageHeightPt: number,
): ContentVector {
  return {
    kind: "line",
    from: { xPt: item.x1Pt, yPt: pageHeightPt - item.y1Pt },
    to: { xPt: item.x2Pt, yPt: pageHeightPt - item.y2Pt },
    stroke: { color: item.color, widthPt: item.widthPt },
    sourcePath: item.sourcePath,
  };
}

interface PathPointRef {
  readonly xPt: number;
  readonly yPt: number;
}

function collectPathPoints(subpaths: readonly LayoutSubpath[]): PathPointRef[] {
  const points: PathPointRef[] = [];
  for (const subpath of subpaths) {
    points.push({ xPt: subpath.startXPt, yPt: subpath.startYPt });
    for (const segment of subpath.segments) {
      if (segment.kind === "cubic") {
        points.push({ xPt: segment.c1xPt, yPt: segment.c1yPt });
        points.push({ xPt: segment.c2xPt, yPt: segment.c2yPt });
      }
      points.push({ xPt: segment.xPt, yPt: segment.yPt });
    }
  }
  return points;
}

// Unlike a rect/ellipse/line item, a LayoutPath carries no frame of its own — drawing.ts's own convertPathVector resolves each point through the ORIGINAL ContentVector frame, information a PDF's recovered geometry no longer carries at all. The frame reconstructed here is instead the tight bounding box of every point in the path, including cubic control points, not just line/curve endpoints: a cubic Bezier curve is guaranteed to lie within the convex hull of its four control points, so including them guarantees the frame fully contains the rendered curve rather than clipping it. A cubic segment's own control points are never on the curve itself, so this frame is not necessarily identical to whatever frame the path originally had in a hand-authored ODF file — it is the tightest one derivable from the recovered geometry alone, an honest, bounded reconstruction choice rather than an attempt at exactly recovering an original frame that no longer exists anywhere in a PDF's own geometry.
function pathBoundingFrame(
  points: readonly PathPointRef[],
  pageHeightPt: number,
): Box {
  if (points.length === 0) {
    return { xPt: 0, yPt: 0, widthPt: 0, heightPt: 0 };
  }
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minYDown = Number.POSITIVE_INFINITY;
  let maxYDown = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    const yDown = pageHeightPt - point.yPt;
    minX = Math.min(minX, point.xPt);
    maxX = Math.max(maxX, point.xPt);
    minYDown = Math.min(minYDown, yDown);
    maxYDown = Math.max(maxYDown, yDown);
  }
  return {
    xPt: minX,
    yPt: minYDown,
    widthPt: maxX - minX,
    heightPt: maxYDown - minYDown,
  };
}

// The exact inverse of drawing.ts's own placePathPoint (frame.xPt + point.xPt, pageHeightPt - frame.yPt - point.yPt): solved for point.xPt/point.yPt given an absolute PDF-space point and the frame computed above.
function localizePathPoint(
  frame: Box,
  point: PathPointRef,
  pageHeightPt: number,
): ContentPathPoint {
  return {
    xPt: point.xPt - frame.xPt,
    yPt: pageHeightPt - frame.yPt - point.yPt,
  };
}

function layoutPathToVector(
  item: LayoutPath,
  pageHeightPt: number,
): ContentVector {
  const points = collectPathPoints(item.subpaths);
  const frame = pathBoundingFrame(points, pageHeightPt);
  const subpaths: ContentSubpath[] = item.subpaths.map((subpath) => ({
    start: localizePathPoint(
      frame,
      { xPt: subpath.startXPt, yPt: subpath.startYPt },
      pageHeightPt,
    ),
    closed: subpath.closed,
    segments: subpath.segments.map((segment) => {
      if (segment.kind === "line") {
        return {
          kind: "line" as const,
          to: localizePathPoint(
            frame,
            { xPt: segment.xPt, yPt: segment.yPt },
            pageHeightPt,
          ),
        };
      }
      return {
        kind: "cubic" as const,
        control1: localizePathPoint(
          frame,
          { xPt: segment.c1xPt, yPt: segment.c1yPt },
          pageHeightPt,
        ),
        control2: localizePathPoint(
          frame,
          { xPt: segment.c2xPt, yPt: segment.c2yPt },
          pageHeightPt,
        ),
        to: localizePathPoint(
          frame,
          { xPt: segment.xPt, yPt: segment.yPt },
          pageHeightPt,
        ),
      };
    }),
  }));
  return {
    kind: "path",
    frame,
    subpaths,
    fill: item.fill,
    fillRule: item.fillRule,
    stroke: item.stroke,
    sourcePath: item.sourcePath,
  };
}

// A single LayoutText item maps to exactly one ContentShape holding one single-run paragraph — reuses computeBlockFrame/textItemToContentRun verbatim rather than inventing a second frame-estimation approach (the same real AFM ascent/descent math reconstructPresentation's own blockToShape already uses above, degenerating correctly to a one-line, one-item block). Unlike blockToShape (which can merge several LayoutText items into one block and therefore cannot assign a single rotation to the merged result), this mapping is genuinely 1:1, so item.rotationDeg carries straight across, negated — the same LayoutImage counter-clockwise -> ContentShape clockwise convention imageToShape already applies below.
function layoutTextToShape(
  item: LayoutText,
  pageHeightPt: number,
  pageIndex: number,
): ContentShape {
  const frame = computeBlockFrame(
    { lines: [{ items: [item], baselineY: item.yPt }] },
    pageHeightPt,
  );
  const run = textItemToContentRun(item);
  stampFrame(run, pageIndex, textBoxOfItem(item, pageIndex));
  const paragraph: ContentParagraph = { kind: "paragraph", runs: [run] };
  stampFrame(paragraph, pageIndex, textBoxOfItem(item, pageIndex));
  return {
    frame,
    rotationDeg: item.rotationDeg !== undefined ? -item.rotationDeg : undefined,
    insetLeftPt: 0,
    insetTopPt: 0,
    insetRightPt: 0,
    insetBottomPt: 0,
    blocks: [paragraph],
  };
}

// ---------------------------------------------------------------------------
// Shared: VECTOR and TABLE recovery for the wordprocessing and presentation directions.
//
// reconstructDrawing has always mapped every painted rect/ellipse/line/path back onto a ContentVector, because a drawing page has an array to put one in. reconstructWordprocessing and reconstructPresentation used to drop that geometry on the floor entirely — filtering each page down to its text and image items and ignoring every stroke and fill — purely because ContentSection.blocks and ContentSlide.shapes have no vector vocabulary of their own. That is a container gap, not a recovery gap: the classification is identical whichever direction asked for it, so both directions now run the SAME layoutItemToVector above and carry the result in a ContentEmbeddedObjectBlock (see src/model/embedded-drawing.ts for why that is the schema's own answer here rather than a widening of it).
//
// HONEST CONSEQUENCE, stated because it is a change in what these two directions emit: a PDF does not distinguish a stroke drawn to decorate from a stroke drawn as structure. A rule under a heading, an underline (pdf-codec writes one as a filled rectangle), and a table cell's own background fill are all genuine painted geometry, and are all now recovered as vectors rather than silently discarded. That is the intended behaviour — discarding real content because it might be incidental is exactly the silent loss this package's conventions rule out — but it does mean a reconstructed document carries more than its text alone. The one case deliberately NOT double-counted is a table's own gridlines: when the table recovery below claims a lattice, the strokes that formed it are excluded from vector recovery, so the structure is reported once, as a table, rather than twice.
//
// WRITE-SIDE STATUS: both recoveries now reach the output bytes for every target. The recovered table becomes a real table (buildDocxPackage/buildOdtPackage append one to the body, buildPptxPackage/buildOdpPackage add a slide table). The recovered VECTORS become real vector shapes — DrawingML preset and custom geometry for docx and pptx (src/edit/drawingml/vector.ts, wrapped as a page-anchored w:drawing by src/edit/docx/vector.ts and as a p:sp by src/edit/pptx/vector.ts), and draw:rect/draw:ellipse/draw:line/draw:path for odt and odp (src/edit/odg/vector.ts's writer, reused wholesale rather than reimplemented, since ODF's vector vocabulary is identical in a text document, a presentation, and a drawing).
//
// What that does NOT make lossless is the reading back: readDocxContent/readPptxContent are thin adapters over ooxml.js's own readDocx/readPptx, neither of which reads vector geometry into a ContentDocument, and readOdtContent/readOdpContent are the same over odf.js's readOdt/readOdp, where ContentSection.blocks and ContentSlide.shapes have no vector vocabulary to read one into. So a written vector survives into the file and into any real consumer of it, but re-reading that file through this package's own readers does not produce the block back. Closing that is reader-side work — the OOXML/ODF mirror of the second pass src/odf/formula/detect.ts already runs for embedded formulas — and is genuinely separate from the writing above.
// ---------------------------------------------------------------------------

// A vector's own topmost edge in PDF space (y up), for positioning a recovered drawing among the text blocks around it. Every kind but 'line' carries a top-left/y-down frame; a line carries two bare endpoints instead.
function vectorTopYDownPt(vector: ContentVector): number {
  return vector.kind === "line"
    ? Math.min(vector.from.yPt, vector.to.yPt)
    : vector.frame.yPt;
}

interface RecoveredVectors {
  readonly block: ContentEmbeddedObjectBlock;
  readonly topYPt: number; // PDF-space y of the topmost recovered vector, for ordering against the page's other content
}

// Every vector primitive on a page, in paint order, as one embedded drawing block — or undefined when the page has none, so a text-only page's output is byte-identical to what it was before this recovery existed. `excluded` carries the items already claimed as a table's own gridlines.
export function recoverPageVectors(
  page: LayoutPage,
  pageIndex: number,
  excluded: ReadonlySet<LayoutItem>,
): RecoveredVectors | undefined {
  const vectors: ContentVector[] = [];
  for (const item of page.items) {
    if (excluded.has(item)) {
      continue;
    }
    const vector = layoutItemToVector(item, page.heightPt);
    if (vector !== undefined) {
      stampVectorFrame(vector, item, pageIndex);
      // paintOrder is the recovery index, exactly as reconstructDrawPage stamps it: a LayoutPage's items ARE its paint order, front-to-back by array position.
      vectors.push({ ...vector, paintOrder: vectors.length });
    }
  }
  if (vectors.length === 0) {
    return undefined;
  }
  const topYDownPt = Math.min(...vectors.map(vectorTopYDownPt));
  const block = buildDrawingBlock(
    { widthPt: page.widthPt, heightPt: page.heightPt },
    vectors,
  );
  // The wrapper block sat across the whole page — the vectors inside it are page-anchored by construction (see buildDrawingBlock's own doc), so its own placement is the page itself.
  stampFrame(block, pageIndex, {
    xPt: 0,
    yPt: 0,
    widthPt: page.widthPt,
    heightPt: page.heightPt,
  });
  return { block, topYPt: page.heightPt - topYDownPt };
}

// --- Table recovery, gated on an unambiguously detected gridline lattice ---------------------------------
//
// A ContentTable is synthesized ONLY from a real, drawn gridline lattice — the identical detector, thresholds and span-consistency check reconstructSpreadsheet already gates its own cell-boundary recovery on (src/layout/lattice.ts). Text alignment and wide inter-word gaps are deliberately NOT accepted as evidence: several left-aligned lines with a tab-sized gap between their columns are indistinguishable, from geometry alone, from a genuinely tabbed paragraph, an indented code sample, or a two-column page layout, so building a table out of one would be inventing structure the source never had rather than recovering structure it did. That distinction is the whole point of the gate: a drawn lattice IS the table's structure, present in the file as real geometry; alignment merely resembles one.
//
// A lattice with no text inside it at all is rejected too. A grid of empty boxes is far more likely a decorative frame, a chart's plot area, or a form's field outlines than a table, and recovering it as an empty table would add a structure carrying nothing.

export interface RecoveredTable {
  readonly table: ContentTable;
  readonly frame: Box; // top-left/y-down, for the presentation direction's own containing shape
  readonly topYPt: number; // PDF-space y of the lattice's top edge, for the wordprocessing direction's own block ordering
  readonly consumedText: ReadonlySet<LayoutText>; // text now living inside the table, and therefore removed from paragraph/block clustering
  readonly latticeItems: ReadonlySet<LayoutItem>; // the strokes that formed the lattice, excluded from vector recovery
}

// A PDF page carries no sheet name, and no trace of whether the source spreadsheet's own column/row banding split one sheet across several printed pages — there is no principled way to re-merge pages back into fewer sheets from geometry alone, so this maps one page to one sheet, exactly as reconstructPresentation maps one page to one slide.
export function reconstructSheet(
  page: LayoutPage,
  pageIndex: number,
  sink: CellTypeInferenceSink | undefined,
): ContentSheet {
  const textItems = page.items.filter(
    (i): i is LayoutText => i.kind === "text",
  );
  const lattice = detectGridLattice(page.items);
  const context: CellTypingContext = { sheetIndex: pageIndex, sink };
  const grid =
    lattice !== undefined
      ? buildGridFromLattice(textItems, lattice, pageIndex, context)
      : buildGridFromTextClustering(textItems, pageIndex, context);

  // Margins have no PDF equivalent to recover, mirroring buildSection's own ZERO_MARGINS reasoning above. gridlines reflects whichever detection path actually ran; headers is always false — a header-gutter row-number/column-letter label has no reliable geometric signal distinguishing it from an ordinary short cell, so this makes no attempt to detect one (any such label sitting outside the detected grid lattice is simply dropped by findRowIndex/findColumnIndex returning undefined for it, rather than being misread as real cell content). No print range/scale/fit-to-page/repeat-rows/repeat-columns/manual-breaks assumption is made at all — a rendered page carries no trace of print INTENT, only what was visually printed.
  const printSettings: ContentSheetPrintSettings = {
    pageSize: { widthPt: page.widthPt, heightPt: page.heightPt },
    margins: ZERO_MARGINS,
    gridlines: grid.gridlines,
    headers: false,
    pageOrder: "downThenOver",
  };

  return {
    name: `Sheet${pageIndex + 1}`,
    cells: grid.cells,
    columns: grid.columns,
    rows: grid.rows,
    images: [],
    printSettings,
  };
}
