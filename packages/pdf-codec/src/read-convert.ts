// The extracted-item conversion family, split from read.ts: turning interpret.ts Extracted* items into document-schema.js Layout* items (text, rect, ellipse, line, path, image placement and registration), together with the box transforms and paint-field copies they share.
import { bytesToBase64 } from "byte-codec";
import { crc32 } from "./bytes/crc32";
import type { FontResolverService } from "./font-read";
import { decodePdfString } from "./pdf-text";
import { NOTES_ANNOTATION_AUTHOR } from "./notes-annotation-author";
import { readImageXObject } from "./images-read";
import type { PdfDiagnosticSink } from "./diagnostics";
import type { Color as LayoutColor, LayoutFont } from "document-schema.js";
import type { ExtractedPdfImage } from "./images-read";
import type {
  LayoutEllipse,
  LayoutImageAsset,
  LayoutInternalLink,
  LayoutItem,
  LayoutLink,
  LayoutLine,
  LayoutPath,
  LayoutPathSegment,
  LayoutRect,
  LayoutSubpath,
  LayoutText,
} from "./layout";

import type {
  PdfObjectResolver,
  ExtractedEllipse,
  ExtractedImage,
  ExtractedItem,
  ExtractedInlineImage,
  ExtractedLine,
  ExtractedPaint,
  ExtractedPath,
  ExtractedRect,
  ExtractedSubpath,
  ExtractedTextRun,
} from "./interpret";
import type { PdfDict } from "./objects";
import { asArray, asName, asNumber } from "./objects";
import { dictGet } from "./objects";
import type { Matrix } from "./matrix";
import type { DestinationRegistry } from "./navigation";
import {
  applyMatrix,
  matrixScaleX,
  multiplyMatrices,
  matrixRotationDegrees,
  matrixScaleY,
} from "./matrix";
export function convertExtractedItem(
  item: ExtractedItem,
  pageMatrix: Matrix,
  fontResolver: FontResolverService,
  images: Record<string, LayoutImageAsset>,
  imageIdCache: Map<PdfDict, string | null>,
  resolver: Readonly<PdfObjectResolver>,
  sink: PdfDiagnosticSink,
): LayoutItem | undefined {
  if (item.kind === "text") {
    return convertText(item, pageMatrix, fontResolver);
  }
  if (item.kind === "rect") {
    return convertRect(item, pageMatrix);
  }
  if (item.kind === "ellipse") {
    return convertEllipse(item, pageMatrix);
  }
  if (item.kind === "line") {
    return convertLine(item, pageMatrix);
  }
  if (item.kind === "path") {
    return convertPath(item, pageMatrix);
  }
  if (item.kind === "image") {
    return convertImage(item, pageMatrix, images, imageIdCache, resolver, sink);
  }
  return convertInlineImage(item, pageMatrix, images, resolver, sink);
}

export function convertText(
  item: ExtractedTextRun,
  pageMatrix: Matrix,
  fontResolver: FontResolverService,
): LayoutText | undefined {
  const font = fontResolver.resolve(item.fontResourceName, item.resources);
  const text = font?.decodeToUnicode(item.codes) ?? "";
  if (text.length === 0) {
    return undefined;
  }
  const startTrm = multiplyMatrices(item.startMatrix, pageMatrix);
  const endTrm = multiplyMatrices(item.endMatrix, pageMatrix);
  const widthPt = Math.hypot(endTrm[4] - startTrm[4], endTrm[5] - startTrm[5]);
  // hypot(Trm[0], Trm[1]): the device-space length of one unit of text-space X under the composed matrix — wrong under rotation if taken from Trm[3] alone, and the same quantity the write path's own text placement is built from in reverse.
  const sizePt = matrixScaleX(startTrm);
  const rotationDeg = matrixRotationDegrees(startTrm);
  const layoutFont: LayoutFont = {
    family: font?.family ?? "Helvetica",
    weight: font?.bold === true ? "bold" : "normal",
    style: font?.italic === true ? "italic" : "normal",
  };
  return {
    kind: "text",
    text,
    xPt: startTrm[4],
    yPt: startTrm[5],
    font: layoutFont,
    sizePt: sizePt > 0 ? sizePt : item.sizePt,
    color: item.color,
    widthPt,
    rotationDeg: rotationDeg !== 0 ? rotationDeg : undefined,
    ...(item.vertical === true ? { writingMode: "vertical" as const } : {}),
    ...(item.layerName !== undefined ? { layer: item.layerName } : {}),
    ...(item.actualText !== undefined ? { actualText: item.actualText } : {}),
    ...(item.alt !== undefined ? { alt: item.alt } : {}),
  };
}

// fill/stroke are each omitted rather than written as an explicit `undefined`, matching convertPath's own convention and keeping a recovered item structurally identical to the LayoutRect/LayoutEllipse a caller would have written by hand.
export function paintFields(paint: ExtractedPaint): {
  fill?: LayoutColor;
  stroke?: { readonly color: LayoutColor; readonly widthPt: number };
} {
  return {
    ...(paint.fill !== undefined ? { fill: paint.fill } : {}),
    ...(paint.stroke !== undefined ? { stroke: paint.stroke } : {}),
  };
}

// A CTM composed only of 90-degree-multiple rotations (the only kind pageMatrix ever carries) maps an axis-aligned box to another axis-aligned box — transforming just the two opposite corners and re-deriving min/max is enough, no general polygon handling needed. An ellipse's bounding box transforms by exactly the same rule (a 90-degree rotation swaps its two radii and leaves it axis-aligned), so both kinds share this helper.
export function transformBox(
  item: Readonly<{
    xPt: number;
    yPt: number;
    widthPt: number;
    heightPt: number;
  }>,
  pageMatrix: Matrix,
): { xPt: number; yPt: number; widthPt: number; heightPt: number } {
  const p1 = applyMatrix(pageMatrix, { x: item.xPt, y: item.yPt });
  const p2 = applyMatrix(pageMatrix, {
    x: item.xPt + item.widthPt,
    y: item.yPt + item.heightPt,
  });
  return {
    xPt: Math.min(p1.x, p2.x),
    yPt: Math.min(p1.y, p2.y),
    widthPt: Math.abs(p2.x - p1.x),
    heightPt: Math.abs(p2.y - p1.y),
  };
}

export function convertRect(
  item: ExtractedRect,
  pageMatrix: Matrix,
): LayoutRect {
  return {
    kind: "rect",
    ...transformBox(item, pageMatrix),
    ...paintFields(item),
    ...(item.layerName !== undefined ? { layer: item.layerName } : {}),
  };
}

export function convertEllipse(
  item: ExtractedEllipse,
  pageMatrix: Matrix,
): LayoutEllipse {
  return {
    kind: "ellipse",
    ...transformBox(item, pageMatrix),
    ...paintFields(item),
    ...(item.layerName !== undefined ? { layer: item.layerName } : {}),
  };
}

// Both endpoints transform individually: unlike a box, a line has no axis-alignment to preserve, and its two ends are exactly the two points that define it.
export function convertLine(
  item: ExtractedLine,
  pageMatrix: Matrix,
): LayoutLine {
  const p1 = applyMatrix(pageMatrix, { x: item.x1Pt, y: item.y1Pt });
  const p2 = applyMatrix(pageMatrix, { x: item.x2Pt, y: item.y2Pt });
  return {
    kind: "line",
    x1Pt: p1.x,
    y1Pt: p1.y,
    x2Pt: p2.x,
    y2Pt: p2.y,
    color: item.color,
    widthPt: item.widthPt,
    ...(item.style !== undefined ? { style: item.style } : {}),
    ...(item.layerName !== undefined ? { layer: item.layerName } : {}),
  };
}

// Unlike convertRect, a general path carries no axis-aligned-only assumption, so every point of every subpath (start point, and each segment's own endpoint plus, for a cubic, both control points) is transformed individually through pageMatrix — correct under rotation because an affine transform distributes over a Bezier curve's control points exactly as it does over a straight line's endpoints.
export function transformSubpath(
  subpath: ExtractedSubpath,
  pageMatrix: Matrix,
): LayoutSubpath {
  const start = applyMatrix(pageMatrix, {
    x: subpath.startXPt,
    y: subpath.startYPt,
  });
  const segments: LayoutPathSegment[] = subpath.segments.map((segment) => {
    if (segment.kind === "line") {
      const p = applyMatrix(pageMatrix, { x: segment.xPt, y: segment.yPt });
      return { kind: "line", xPt: p.x, yPt: p.y };
    }
    const c1 = applyMatrix(pageMatrix, { x: segment.c1xPt, y: segment.c1yPt });
    const c2 = applyMatrix(pageMatrix, { x: segment.c2xPt, y: segment.c2yPt });
    const p = applyMatrix(pageMatrix, { x: segment.xPt, y: segment.yPt });
    return {
      kind: "cubic",
      c1xPt: c1.x,
      c1yPt: c1.y,
      c2xPt: c2.x,
      c2yPt: c2.y,
      xPt: p.x,
      yPt: p.y,
    };
  });
  return {
    startXPt: start.x,
    startYPt: start.y,
    segments,
    closed: subpath.closed,
  };
}

// fillRule is only kept when there's actually a fill to apply it to — a stroke-only path's fillRule (always 'nonzero', see interpret.ts's paintFillRuleFor) is real but meaningless, so it's dropped here rather than round-tripped as noise, mirroring content-write.ts's own "fillRule only ever matters when fill is set" convention.
export function convertPath(
  item: ExtractedPath,
  pageMatrix: Matrix,
): LayoutPath {
  return {
    kind: "path",
    subpaths: item.subpaths.map((subpath) =>
      transformSubpath(subpath, pageMatrix),
    ),
    ...(item.fill !== undefined ? { fill: item.fill } : {}),
    ...(item.fill !== undefined && item.fillRule === "evenodd"
      ? { fillRule: "evenodd" as const }
      : {}),
    ...(item.stroke !== undefined ? { stroke: item.stroke } : {}),
    ...(item.style !== undefined ? { style: item.style } : {}),
    ...(item.layerName !== undefined ? { layer: item.layerName } : {}),
  };
}

// The inverse of content-write.ts's writeImage: that function places the unit square via scale(w,h) x rotate(deg) x translate(x,y), so the composed CTM's own translation, scale, and rotation are exactly the placement this recovers — x/y from the CTM's own e/f, width/height from its axis scales, rotation from its angle.
export function imagePlacementFrom(matrix: Matrix): {
  xPt: number;
  yPt: number;
  widthPt: number;
  heightPt: number;
  rotationDeg: number | undefined;
} {
  const rotationDeg = matrixRotationDegrees(matrix);
  return {
    xPt: matrix[4],
    yPt: matrix[5],
    widthPt: matrixScaleX(matrix),
    heightPt: matrixScaleY(matrix),
    rotationDeg: rotationDeg !== 0 ? rotationDeg : undefined,
  };
}

const HEX_RADIX = 16;

export function registerExtractedImage(
  format: "png" | "jpeg",
  bytes: Uint8Array<ArrayBuffer>,
  widthPx: number,
  heightPx: number,
  images: Record<string, LayoutImageAsset>,
  original: ExtractedPdfImage["original"],
): string {
  // The imageId is a crc32 of the DECODED canonical bytes (a JBIG2/JPX original must not fold into it: two different producers' compressed streams of the same raster content would then mint two ids for what every consumer sees as the same image, while a re-encoded canonical would mint a different id than the source's own re-read of the same file produced before this write — the canonical is the identity, the original is a re-emission spelling of it).
  const imageId = `img${crc32(bytes).toString(HEX_RADIX)}`;
  if (!(imageId in images)) {
    images[imageId] = {
      format,
      base64: bytesToBase64(bytes),
      widthPx,
      heightPx,
      ...(original !== undefined
        ? {
            original: {
              filter: original.filter,
              base64: bytesToBase64(original.bytes),
              ...(original.globalsBytes !== undefined
                ? { jbig2GlobalsBase64: bytesToBase64(original.globalsBytes) }
                : {}),
            },
          }
        : {}),
    };
  }
  return imageId;
}

export function resolveCachedImageId(
  dict: PdfDict,
  raw: Uint8Array<ArrayBuffer>,
  images: Record<string, LayoutImageAsset>,
  cache: Map<PdfDict, string | null>,
  resolver: Readonly<PdfObjectResolver>,
  sink: PdfDiagnosticSink,
): string | undefined {
  if (cache.has(dict)) {
    return cache.get(dict) ?? undefined;
  }
  const decoded = readImageXObject(dict, raw, resolver, sink);
  if (decoded === undefined) {
    cache.set(dict, null);
    return undefined;
  }
  const imageId = registerExtractedImage(
    decoded.format,
    decoded.bytes,
    decoded.widthPx,
    decoded.heightPx,
    images,
    decoded.original,
  );
  cache.set(dict, imageId);
  return imageId;
}

export function convertImage(
  item: ExtractedImage,
  pageMatrix: Matrix,
  images: Record<string, LayoutImageAsset>,
  cache: Map<PdfDict, string | null>,
  resolver: Readonly<PdfObjectResolver>,
  sink: PdfDiagnosticSink,
) {
  const xobjects = resolver.resolveDict(dictGet(item.resources, "XObject"));
  const xobj =
    xobjects !== undefined
      ? resolver.resolve(dictGet(xobjects, item.resourceName))
      : undefined;
  if (xobj?.kind !== "stream") {
    return undefined;
  }
  const imageId = resolveCachedImageId(
    xobj.dict,
    xobj.raw,
    images,
    cache,
    resolver,
    sink,
  );
  if (imageId === undefined) {
    return undefined;
  }
  const composed = multiplyMatrices(item.matrix, pageMatrix);
  return {
    kind: "image" as const,
    imageId,
    ...imagePlacementFrom(composed),
    ...(item.layerName !== undefined ? { layer: item.layerName } : {}),
  };
}

function convertInlineImage(
  item: ExtractedInlineImage,
  pageMatrix: Matrix,
  images: Record<string, LayoutImageAsset>,
  resolver: Readonly<PdfObjectResolver>,
  sink: PdfDiagnosticSink,
) {
  const decoded = readImageXObject(item.dict, item.data, resolver, sink);
  if (decoded === undefined) {
    return undefined;
  }
  const imageId = registerExtractedImage(
    decoded.format,
    decoded.bytes,
    decoded.widthPx,
    decoded.heightPx,
    images,
    decoded.original,
  );
  const composed = multiplyMatrices(item.matrix, pageMatrix);
  return {
    kind: "image" as const,
    imageId,
    ...imagePlacementFrom(composed),
    ...(item.layerName !== undefined ? { layer: item.layerName } : {}),
  };
}

// --- Link annotations: /Annots walk for /Subtype /Link — external /A /S /URI actions as LayoutLink items, internal /Dest (direct or named) and /A /GoTo targets as internalLink items naming a destinations-table entry. ---

export function readLinkAnnotations(
  page: PdfDict,
  pageMatrix: Matrix,
  resolver: Readonly<PdfObjectResolver>,
  destinationRegistry: DestinationRegistry,
): (LayoutLink | LayoutInternalLink)[] {
  const annotsArr = asArray(dictGet(page, "Annots"));
  if (annotsArr === undefined) {
    return [];
  }
  const links: (LayoutLink | LayoutInternalLink)[] = [];
  for (const annotRef of annotsArr) {
    const annot = resolver.resolveDict(annotRef);
    if (annot === undefined || asName(dictGet(annot, "Subtype")) !== "Link") {
      continue;
    }
    const rectArr = asArray(dictGet(annot, "Rect"));
    if (rectArr === undefined) {
      continue;
    }
    const uri = readLinkUri(annot, resolver);
    // A link with no external action may still carry an internal destination: /Dest directly, or a /A /GoTo action's /D.
    const destination =
      uri === undefined
        ? readInternalDestination(annot, resolver, destinationRegistry)
        : undefined;
    if (uri === undefined && destination === undefined) {
      continue;
    }
    const x1 = asNumber(rectArr[0]) ?? 0;
    const y1 = asNumber(rectArr[1]) ?? 0;
    const x2 = asNumber(rectArr[2]) ?? 0;
    const y2 = asNumber(rectArr[3]) ?? 0;
    const p1 = applyMatrix(pageMatrix, {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
    });
    const p2 = applyMatrix(pageMatrix, {
      x: Math.max(x1, x2),
      y: Math.max(y1, y2),
    });
    const contentsObj = dictGet(annot, "Contents");
    const title =
      contentsObj?.kind === "string"
        ? decodePdfString(contentsObj.bytes)
        : undefined;
    const box = {
      xPt: Math.min(p1.x, p2.x),
      yPt: Math.min(p1.y, p2.y),
      widthPt: Math.abs(p2.x - p1.x),
      heightPt: Math.abs(p2.y - p1.y),
      ...(title !== undefined ? { title } : {}),
    };
    if (uri !== undefined) {
      links.push({ kind: "link", uri, ...box });
    } else if (destination !== undefined) {
      links.push({ kind: "internalLink", destination, ...box });
    }
  }
  return links;
}

function readLinkUri(
  annot: PdfDict,
  resolver: Readonly<PdfObjectResolver>,
): string | undefined {
  const action = resolver.resolveDict(dictGet(annot, "A"));
  if (action === undefined || asName(dictGet(action, "S")) !== "URI") {
    return undefined;
  }
  const uriObj = dictGet(action, "URI");
  return uriObj?.kind === "string" ? decodePdfString(uriObj.bytes) : undefined;
}

function readInternalDestination(
  annot: PdfDict,
  resolver: Readonly<PdfObjectResolver>,
  destinationRegistry: DestinationRegistry,
): string | undefined {
  const dest = dictGet(annot, "Dest");
  if (dest !== undefined) {
    return destinationRegistry.intern(dest);
  }
  const action = resolver.resolveDict(dictGet(annot, "A"));
  if (action !== undefined && asName(dictGet(action, "S")) === "GoTo") {
    return destinationRegistry.intern(dictGet(action, "D"));
  }
  return undefined;
}

// pptx speaker notes carried as a hidden /Subtype /Text annotation (see write.ts's buildNotesAnnotDict) — the /T marker distinguishes an annotation this package's own writer produced from a genuine sticky note a human or another tool left on the page, which would also be /Subtype /Text but authored by someone/something else. Returns undefined (not '') when no such annotation exists, so reconstructPresentation's own page.notes ?? '' fallback is the one place that decides what "no notes" means for a ContentSlide.
export function readPageNotes(
  page: PdfDict,
  resolver: Readonly<PdfObjectResolver>,
): string | undefined {
  const annotsArr = asArray(dictGet(page, "Annots"));
  if (annotsArr === undefined) {
    return undefined;
  }
  for (const annotRef of annotsArr) {
    const annot = resolver.resolveDict(annotRef);
    if (annot === undefined || asName(dictGet(annot, "Subtype")) !== "Text") {
      continue;
    }
    const titleObj = dictGet(annot, "T");
    const title =
      titleObj?.kind === "string" ? decodePdfString(titleObj.bytes) : undefined;
    if (title !== NOTES_ANNOTATION_AUTHOR) {
      continue;
    }
    const contentsObj = dictGet(annot, "Contents");
    if (contentsObj?.kind === "string") {
      return decodePdfString(contentsObj.bytes);
    }
  }
  return undefined;
}
