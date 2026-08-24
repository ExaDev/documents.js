import type { ContentVector } from "document-schema.js";
import type { XmlElement } from "ooxml.js";
import { childrenWithTag } from "ooxml.js";
import { readDrawingMlVector as readDrawingMlVectorOrUndefined } from "../edit/drawingml/vector";

// A thin, throwing wrapper over the real production reader (src/edit/drawingml/vector.ts's own readDrawingMlVector) -- the read-side inverse of that module's own writer, for tests that need to prove a rect/ellipse/line/path survived buildDocxPackage/buildPptxPackage as real, correctly-valued markup rather than merely as a string that looks about right.
//
// WHY THIS LIVES IN test-support AND NOT ONLY IN src/edit/drawingml/vector.ts: the production reader is deliberately non-throwing (readDocxContent/readPptxContent must tolerate an unrecognised shape rather than abort the whole document), but this file's own callers -- collectDrawingMlVectors below -- are oracles over a writer whose exact output shape IS the thing under test, so a surprise here is a failure, never something to tolerate. Throwing on `undefined` is what makes that distinction visible in a test failure rather than a silently-empty result.
//
// The ODF side needs no equivalent: odf.js's own readDrawPageContent already reads draw:rect/draw:ellipse/draw:line/draw:path into real ContentVectors, so the odt and odp round-trip tests verify against a genuinely independent reader rather than against an inverse written alongside the writer. That asymmetry is real and worth knowing when reading what each test actually proves.
function readDrawingMlVector(spPr: XmlElement): ContentVector {
  const vector = readDrawingMlVectorOrUndefined(spPr);
  if (vector === undefined) {
    throw new Error(`unrecognised DrawingML vector shape: ${spPr.tag}`);
  }
  return vector;
}

// Every vector-carrying shape under `root`, in document order -- which is paint order in both a w:body and a p:spTree. `spPrTag` selects the format: 'wps:spPr' for a docx w:drawing/wp:anchor shape, 'p:spPr' for a pptx p:sp.
//
// An explicit a:ln child is what distinguishes a vector shape from the other shapes a package can hold. src/edit/drawingml/vector.ts always writes one (a:noFill inside it when the vector has no stroke); this package's own text-box and picture writers -- which do write an a:prstGeom prst="rect" of their own, so geometry alone is not a discriminator -- never do, leaving the outline to be inherited. A document mixing in shapes from some other producer that DOES write an a:ln would need a narrower test, which is exactly the sort of assumption a test-support oracle over known-shaped input is entitled to make.
export function collectDrawingMlVectors(
  root: XmlElement,
  spPrTag: "wps:spPr" | "p:spPr",
): ContentVector[] {
  const out: ContentVector[] = [];
  const visit = (element: XmlElement): void => {
    if (
      element.tag === spPrTag &&
      childrenWithTag(element, "a:ln").length > 0
    ) {
      // Stamped from the walk position, exactly as odf.js's own readDrawPageContent stamps an ODF page's vectors: document order IS paint order here, and recording it is what lets a test compare a DrawingML-recovered vector against an ODF-recovered one on identical terms.
      out.push({ ...readDrawingMlVector(element), paintOrder: out.length });
      return;
    }
    for (const child of element.children) {
      if (child.type === "element") {
        visit(child);
      }
    }
  };
  visit(root);
  return out;
}
