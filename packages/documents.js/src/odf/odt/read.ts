import type { ContentDocument } from 'document-schema.js';
import { CONTENT_FORMAT_VERSION } from 'document-schema.js';
import type { Package } from 'odf.js';
import { findChildElement, readOdt, rootElement } from 'odf.js';
import { buildFormulaBlock } from '../../model/formula';
import { detectEmbeddedFormulaFrames } from '../formula/detect';

// Package -> ContentDocument (the wordprocessing variant). A thin adapter over odf.js's own readOdt, mirroring src/ooxml/docx/read.ts's readDocxContent exactly: odf.js's OdtDocument is already { metadata, sections }, the identical shape readDocx produces, so this is nothing more than the envelope wrap. This is the concrete, load-bearing proof that odt and docx genuinely share one pivot and one layout engine -- convertWordprocessingToLayout (src/layout/engine.ts) takes a WordprocessingContentDocument and has no idea, and no way to tell, which format produced it.
//
// An embedded formula is a real ContentEmbeddedObjectBlock in the returned document, carrying its own MathML inside a 'formula'-kind ContentDocument (see src/model/formula.ts) -- there is no side-channel map returned alongside, and no caller needs to thread one anywhere.
//
// Embedded-formula detection is a second, independent pass over the SAME package's own raw content.xml, run after readOdt itself: odf.js's own readOdt (readDrawFrameContent, specifically) does not yet recognise a draw:frame containing a draw:object at all -- it reads a frame's own table/text-box/image content but silently produces no block whatsoever for anything else, including a formula. This adapter finds every top-level draw:frame directly under office:text (a formula nested inside a paragraph's own inline run content, or inside a draw:g group, is not detected -- a documented, bounded scope narrowing, not a silent gap) and appends each one's own block to the END of the single ContentSection's own blocks array, in the order the frames themselves appear in the document -- NOT interleaved at its true original position among the paragraphs/tables odf.js already read. True positional interleaving would need per-element block-count bookkeeping this adapter doesn't have (a text:list, for instance, unwraps into many ContentParagraph blocks from a single raw XML element -- see src/edit/odt/content.ts's own note on list writing -- so "one raw child = one block" doesn't hold in general), so this is the same "documented, honest simplification" choice this package makes elsewhere rather than either skipping formulas entirely or risking a wrong interleave.
//
// Detection is skipped outright for a document odf.js reads into more than one ContentSection: ODF itself has no notion of a docx-style w:sectPr page-setup boundary, so readOdt should never actually produce more than one -- this is a defensive guard against that assumption changing under this module, not an expected real-world case.
export function readOdtContent(pkg: Package): ContentDocument {
  const odtDoc = readOdt(pkg);

  const contentPart = pkg.parts['content.xml'];
  if (contentPart?.kind === 'xml' && odtDoc.sections.length === 1) {
    const root = rootElement(contentPart.nodes);
    const body = root === undefined ? undefined : findChildElement(root.children, 'office:body');
    const text = body === undefined ? undefined : findChildElement(body.children, 'office:text');
    if (text !== undefined) {
      const detected = detectEmbeddedFormulaFrames(text.children, pkg);
      if (detected.length > 0) {
        const section = odtDoc.sections[0]!;
        const blocks = [...section.blocks];
        for (const found of detected) {
          blocks.push(buildFormulaBlock(found.formula, found.frame, `sections[0].blocks[${blocks.length}]`));
        }
        odtDoc.sections[0] = { ...section, blocks };
      }
    }
  }

  return { kind: 'wordprocessing', formatVersion: CONTENT_FORMAT_VERSION, metadata: { ...odtDoc.metadata }, sections: odtDoc.sections };
}
