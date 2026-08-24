import type { ContentDocument } from "document-schema.js";

import type { Package, XmlElement } from "ooxml.js";
import {
  childrenWithTag,
  readDocxContent as readDocxFlat,
  rootElement,
} from "ooxml.js";
import type { OmmlDiagnosticSink } from "./formula";
import { spliceDocxEmbeddedObjects } from "./embedded-objects";

const DOCUMENT_PART_PATH = "word/document.xml";

export interface ReadDocxContentOptions {
  // Reports every OMML construct that degraded or was approximated while an equation was translated back into MathML (see src/omml/read.ts). `sourcePath` is the recovered formula block's own path into the returned ContentDocument, so a caller can name which equation each diagnostic came from -- the exact mirror of buildDocxPackage's own BuildDocxPackageOptions.onMathDiagnostic on the write side.
  readonly onMathDiagnostic?: OmmlDiagnosticSink;
}

function documentBody(pkg: Package): XmlElement | undefined {
  const root = rootElement(pkg.parts[DOCUMENT_PART_PATH]);
  return root === undefined ? undefined : childrenWithTag(root, "w:body")[0];
}

// Package -> ContentDocument (the wordprocessing variant). A thin adapter over ooxml.js's own readDocxContent (imported here as readDocxFlat because this module's own export already holds that name; ooxml.js 4.0.0 renamed this flat reader to readDocxContent and gave the bare readDocx name to its tree-form DocumentTree counterpart): the WordprocessingML style cascade (docDefaults -> named-style basedOn chains -> paragraph-mark run properties -> character styles -> direct formatting), DrawingML theme resolution, and document-order section/block walking all live upstream in ooxml.js (the upstream reader used to be a lossy, geometry-free projection unusable as a layout basis; it no longer is). The upstream reader's own `comments`/`footnotes`/`headerFooterParts`/`sectionHeaderFooters`/`numbering` are not part of ContentDocument's shape and are not carried through here -- ContentDocument only models the section/block content a layout engine needs. They are not dropped outright, though: readDocxExtras (./extras.ts) exposes that same data as its own real return type, for a caller that wants it. LayoutMetadata's own `producer` field (a PDF-only concept) is left unset, exactly as it was before this package read docx metadata itself.
//
// An OOXML math equation IS carried through, as a real ContentEmbeddedObjectBlock holding its own recovered MathML -- the identical shape readOdtContent produces for an ODF embedded formula, so a formula survives docx -> odt, docx -> PDF, and docx -> markdown by exactly the same mechanism an ODF one does. A vector-only w:drawing (see src/ooxml/docx/vector.ts) is carried through the same way, as a 'drawing'-kind embedded object. The upstream reader itself has no m:oMath or vector-geometry handling at all, so this is a second, independent pass over the same word/document.xml (./embedded-objects.ts's spliceDocxEmbeddedObjects), mirroring how src/odf/odt/read.ts recovers both odf.js's own read likewise does not read.
export function readDocxContent(
  pkg: Package,
  options?: ReadDocxContentOptions,
): ContentDocument {
  const docxDoc = readDocxFlat(pkg);
  const body = documentBody(pkg);
  // The upstream reader already threw if word/document.xml has no w:body, so this only guards the type -- there is no reachable "read succeeded but the body is gone" state.
  const sections =
    body === undefined
      ? docxDoc.sections
      : spliceDocxEmbeddedObjects(
          docxDoc.sections,
          body.children,
          options?.onMathDiagnostic,
        );
  return {
    kind: "wordprocessing",
    metadata: { ...docxDoc.metadata },
    sections,
  };
}
