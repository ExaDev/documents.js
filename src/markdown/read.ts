import type { ReadMarkdownOptions } from 'markdown-codec';
import { readMarkdown } from 'markdown-codec';
import type { ContentDocument } from 'document-schema.js';

// markdown text -> ContentDocument (the wordprocessing variant). A thin adapter over markdown-codec's own readMarkdown, mirroring src/ooxml/docx/read.ts's readDocxContent / src/odf/ods/read.ts's readOdsContent: markdown-codec's own readMarkdown already produces a full document-schema.js ContentDocument (kind/formatVersion/metadata/sections) directly -- the same ContentDocument this package imports and re-exports -- so, unlike those two adapters (which build a ContentDocument envelope from a narrower, format-specific `{ metadata, sections }` shape ooxml.js/odf.js hand back), there is nothing here to build: the narrowed value is returned as-is.
//
// There is no formulas map returned here, unlike readOdtContent/readOdpContent's own OdtContentResult/OdpContentResult: markdown has no embedded-object or formula concept of its own for a second detection pass to find -- CommonMark/GFM have no construct that maps onto EmbeddedFormula, so there is nothing this adapter could populate even speculatively.
export function readMarkdownContent(text: string, options?: ReadMarkdownOptions): ContentDocument {
  const { document } = readMarkdown(text, options);
  // readMarkdown's declared return type is the full ContentDocument union, even though it always produces the wordprocessing variant in practice (markdown has no presentation/spreadsheet/drawing equivalent to lower into) -- this both documents and enforces that, mirroring every other readXContent adapter's own kind guard in this package (readDocxContent, readOdtContent, readOdsContent, readOdgContent).
  if (document.kind !== 'wordprocessing') {
    throw new Error('readMarkdown returned a non-wordprocessing ContentDocument');
  }
  return document;
}
