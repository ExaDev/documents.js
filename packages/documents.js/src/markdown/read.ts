import type { ReadMarkdownOptions } from 'markdown-codec';
import { readMarkdown } from 'markdown-codec';
import type { ContentDocument } from '../model/content';
import { CONTENT_FORMAT_VERSION } from '../model/content';

// markdown text -> ContentDocument (the wordprocessing variant). A thin adapter over markdown-codec's own readMarkdown, mirroring src/ooxml/docx/read.ts's readDocxContent / src/odf/ods/read.ts's readOdsContent exactly: markdown-codec's own readMarkdown already produces a full ContentDocument (kind/formatVersion/metadata/sections), built entirely from document-schema.js's own ContentSection/ContentBlock vocabulary -- the identical vocabulary this package's own local ContentDocumentSchema (src/model/content.ts) wraps for its wordprocessing variant. But it is document-schema.js's OWN ContentDocument type/schema, a structurally-identical but nominally separate declaration from this package's local one (see src/model/content.ts's own module comment on why the two stay independently versioned), so -- exactly like every other readXContent adapter in this package -- this function re-stamps documents.js's own CONTENT_FORMAT_VERSION onto a fresh envelope rather than passing markdown-codec's return value through directly. src/model/content.ts's own CONTENT_FORMAT_VERSION was NOT removed in favour of document-schema.js's version by any earlier schema work (checked directly against that file's current state before writing this adapter), so this follows the "re-stamp" template exactly as readOdtContent/readDocxContent already do, rather than the alternative (pass the value straight through) a hypothetical de-duplicated CONTENT_FORMAT_VERSION would have allowed.
//
// There is no formulas map returned here, unlike readOdtContent/readOdpContent's own OdtContentResult/OdpContentResult: markdown has no embedded-object or formula concept of its own for a second detection pass to find -- CommonMark/GFM have no construct that maps onto EmbeddedFormula, so there is nothing this adapter could populate even speculatively.
export function readMarkdownContent(text: string, options?: ReadMarkdownOptions): ContentDocument {
  const { document } = readMarkdown(text, options);
  // readMarkdown's declared return type wraps document-schema.js's full ContentDocument union, even though it always produces the wordprocessing variant in practice (markdown has no presentation/spreadsheet/drawing equivalent to lower into) -- this both documents and enforces that, mirroring every other readXContent adapter's own kind guard in this package (readDocxContent, readOdtContent, readOdsContent, readOdgContent).
  if (document.kind !== 'wordprocessing') {
    throw new Error('readMarkdown returned a non-wordprocessing ContentDocument');
  }
  return { kind: 'wordprocessing', formatVersion: CONTENT_FORMAT_VERSION, metadata: { ...document.metadata }, sections: document.sections };
}
