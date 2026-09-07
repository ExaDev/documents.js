import type { ContentDocument } from "document-schema.js";

import type { Package } from "ooxml.js";
import {
  attr,
  childrenWithTag,
  readPptxContent as readPptxFlat,
  resolveRelationships,
  rootElement,
} from "ooxml.js";
import type { OmmlDiagnosticSink } from "./formula";
import { spliceSlideFormulas } from "./formula";
import { collapseVectorShapeRuns } from "./vector";
import { spliceSlideLegacyEmbeddedObjects } from "./legacy-embedded";

export interface ReadPptxContentOptions {
  readonly onMathDiagnostic?: OmmlDiagnosticSink;
}

const PRESENTATION_PART = "ppt/presentation.xml";

// Every slide's own part path, in p:sldIdLst document order -- the same order the upstream reader itself resolves slides in (see ooxml.js's own readSlidePathsInOrder), needed here only to locate each slide's raw p:sld root for the second, vector-detecting pass below.
function slidePathsInOrder(pkg: Package): readonly string[] {
  const presentationRoot = rootElement(pkg.parts[PRESENTATION_PART]);
  if (presentationRoot === undefined) {
    return [];
  }
  const sldIdLst = childrenWithTag(presentationRoot, "p:sldIdLst")[0];
  if (sldIdLst === undefined) {
    return [];
  }
  const rels = resolveRelationships(pkg, PRESENTATION_PART);
  const paths: string[] = [];
  for (const sldId of childrenWithTag(sldIdLst, "p:sldId")) {
    const rId = attr(sldId, "r:id");
    const rel = rId === undefined ? undefined : rels.get(rId);
    if (rel !== undefined) {
      paths.push(rel.target);
    }
  }
  return paths;
}

// Package -> ContentDocument (the presentation variant). A thin adapter over ooxml.js's own readPptxContent (imported here as readPptxFlat because this module's own export already holds that name; ooxml.js 4.0.0 renamed this flat reader to readPptxContent and gave the bare readPptx name to its tree-form DocumentTree counterpart): placeholder -> layout -> master -> theme inheritance, the run-property cascade, group-transform flattening, and slide ordering via p:sldIdLst all live upstream in ooxml.js (the upstream reader used to be a lossy, geometry-free projection unusable as a layout basis; it no longer is).
//
// An embedded OOXML equation (ExaDev/documents.js#563), a legacy-OLE-compound-file embedding (ExaDev/documents.js#921), and a vector-only p:sp -- one the upstream reader itself always reads as an ordinary, empty ContentShape regardless of content -- are each carried through too, as second, independent passes over each slide's own raw p:sld: ./formula.ts's own spliceSlideFormulas (a real 'formula'-kind embedded object) and ./legacy-embedded.ts's own spliceSlideLegacyEmbeddedObjects (a real 'wordprocessing'/'spreadsheet'/'presentation'-kind embedded object, appended to whichever p:graphicFrame shape's own OLE payload turned out to be a classic compound file ooxml.js's own ZIP/CFB-Package-stream decoding cannot place) run FIRST, then ./vector.ts's own collapseVectorShapeRuns (a real 'drawing'-kind embedded object collapsing the run of shape slots it occupied) -- that ordering is load-bearing, not incidental, since the vector pass can shrink the shapes array and would invalidate the other two passes' own shape-index correspondence if it ran first (see spliceSlideFormulas's own comment). Formula and legacy-embedding recovery can run in either order relative to each other: a formula-only shape is always a p:sp and a legacy embedding always a p:graphicFrame, so the two detectors never target the same shape slot. The upstream reader has no vector-geometry or embedded-equation handling at all, mirroring how src/ooxml/docx/vector.ts and src/odf/vector/detect.ts recover the same geometry ooxml.js's/odf.js's own readers do not.
export function readPptxContent(
  pkg: Package,
  options?: ReadPptxContentOptions,
): ContentDocument {
  const pptxDoc = readPptxFlat(pkg);
  const slidePaths = slidePathsInOrder(pkg);
  const slides = pptxDoc.slides.map((slide, slideIndex) => {
    const slidePath = slidePaths[slideIndex];
    if (slidePath === undefined) {
      return slide;
    }
    const slideRoot = rootElement(pkg.parts[slidePath]);
    const cSld =
      slideRoot === undefined
        ? undefined
        : childrenWithTag(slideRoot, "p:cSld")[0];
    const spTree =
      cSld === undefined ? undefined : childrenWithTag(cSld, "p:spTree")[0];
    if (spTree === undefined) {
      return slide;
    }
    const withFormulas = spliceSlideFormulas(
      slide,
      slideIndex,
      spTree.children,
      options?.onMathDiagnostic,
    );
    const withLegacyEmbeddings = spliceSlideLegacyEmbeddedObjects(
      withFormulas,
      spTree.children,
      resolveRelationships(pkg, slidePath),
      pkg,
    );
    return collapseVectorShapeRuns(
      withLegacyEmbeddings,
      slideIndex,
      spTree.children,
    );
  });
  return { kind: "presentation", metadata: { ...pptxDoc.metadata }, slides };
}
