import type { Box, ContentVector } from "document-schema.js";
import type { XmlElement } from "ooxml.js";
import { attr, childrenWithTag, textContent } from "ooxml.js";
import { readDrawingMlVector } from "../../edit/drawingml/vector";
import { emuToPt } from "../../model/units";

// Detects a paragraph's own recovered-vector runs -- the read-side counterpart to src/edit/docx/paragraph.ts's own appendVectorAnchors/src/edit/docx/vector.ts's buildAnchoredVectorDrawing. A vector-only w:drawing/wp:anchor leaves no trace in ooxml.js's own readDocxContent at all (see this repo's own README gotcha on the reader-side gap this closes), so this is a second, independent pass over the same w:p this package's own reader already produced a ContentParagraph block from.

export interface DetectedParagraphVector {
  readonly drawingElement: XmlElement;
  readonly vector: ContentVector;
}

// The wordprocessingShape extension part -- the only DrawingML vocabulary WordprocessingML has for a non-picture shape (see src/edit/docx/vector.ts's own top-of-file comment on why this, not VML, is what this package writes and therefore what this reader looks for).
const WORDPROCESSING_SHAPE_URI =
  "http://schemas.microsoft.com/office/word/2010/wordprocessingShape";

function parseEmuInt(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

// A shape's own true position lives on the wrapping wp:anchor, not on wps:spPr's own a:xfrm (see src/edit/drawingml/vector.ts's own readDrawingMlVector doc comment on why the anchor is authoritative) -- undefined for anything this reader cannot place with certainty: no position/extent at all, or an anchor not relative to the page on both axes. This package's own writer always writes relativeFrom="page" on both wp:positionH and wp:positionV (buildAnchoredVectorDrawing); a real file anchoring some other way (to a margin, a column, a paragraph) carries coordinates this reader has no basis for translating back into the page-absolute space a recovered ContentVector's own frame is defined in, so it is left alone rather than guessed at.
function anchorFrame(anchor: XmlElement): Box | undefined {
  const positionH = childrenWithTag(anchor, "wp:positionH")[0];
  const positionV = childrenWithTag(anchor, "wp:positionV")[0];
  const extent = childrenWithTag(anchor, "wp:extent")[0];
  if (
    positionH === undefined ||
    positionV === undefined ||
    extent === undefined
  ) {
    return undefined;
  }
  if (
    attr(positionH, "relativeFrom") !== "page" ||
    attr(positionV, "relativeFrom") !== "page"
  ) {
    return undefined;
  }
  const offsetHEl = childrenWithTag(positionH, "wp:posOffset")[0];
  const offsetVEl = childrenWithTag(positionV, "wp:posOffset")[0];
  if (offsetHEl === undefined || offsetVEl === undefined) {
    return undefined;
  }
  const xEmu = parseEmuInt(textContent(offsetHEl).trim());
  const yEmu = parseEmuInt(textContent(offsetVEl).trim());
  const cx = parseEmuInt(attr(extent, "cx"));
  const cy = parseEmuInt(attr(extent, "cy"));
  if (
    xEmu === undefined ||
    yEmu === undefined ||
    cx === undefined ||
    cy === undefined
  ) {
    return undefined;
  }
  return {
    xPt: emuToPt(xEmu),
    yPt: emuToPt(yEmu),
    widthPt: emuToPt(cx),
    heightPt: emuToPt(cy),
  };
}

// True when wsp carries a non-empty wps:txbx -- real text, out of scope for this pass (see this module's own top comment: recovering a vector-only shape is a narrower, already-well-defined problem than recovering an arbitrary text-carrying shape too).
function hasRealText(wsp: XmlElement): boolean {
  for (const txbx of childrenWithTag(wsp, "wps:txbx")) {
    for (const txBodyContent of childrenWithTag(txbx, "w:txbxContent")) {
      if (textContent(txBodyContent).trim().length > 0) {
        return true;
      }
    }
  }
  return false;
}

// Every recovered vector found directly among this paragraph's own w:r children, in document order -- paintOrder resets per paragraph, matching buildDrawingBlock's own fixture-relative numbering (see src/test-support/vectors.ts and src/edit/docx/paragraph.ts's own appendVectorAnchors, which is this function's exact write-side counterpart).
export function collectParagraphVectors(
  paragraph: XmlElement,
): readonly DetectedParagraphVector[] {
  const out: DetectedParagraphVector[] = [];
  for (const run of childrenWithTag(paragraph, "w:r")) {
    for (const drawing of childrenWithTag(run, "w:drawing")) {
      for (const anchor of childrenWithTag(drawing, "wp:anchor")) {
        const frame = anchorFrame(anchor);
        if (frame === undefined) {
          continue;
        }
        for (const graphic of childrenWithTag(anchor, "a:graphic")) {
          for (const graphicData of childrenWithTag(graphic, "a:graphicData")) {
            if (attr(graphicData, "uri") !== WORDPROCESSING_SHAPE_URI) {
              continue;
            }
            for (const wsp of childrenWithTag(graphicData, "wps:wsp")) {
              if (hasRealText(wsp)) {
                continue;
              }
              const spPr = childrenWithTag(wsp, "wps:spPr")[0];
              if (spPr === undefined) {
                continue;
              }
              const vector = readDrawingMlVector(spPr, frame);
              if (vector === undefined) {
                continue;
              }
              out.push({
                drawingElement: drawing,
                vector: { ...vector, paintOrder: out.length },
              });
            }
          }
        }
      }
    }
  }
  return out;
}
