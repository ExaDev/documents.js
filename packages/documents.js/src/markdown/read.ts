import type { ReadMarkdownOptions } from "markdown-codec";
import {
  HTML_PREFORMATTED_STYLE_ID,
  readMarkdownContent as readMarkdownFlat,
} from "markdown-codec";
import type { ContentBlock, ContentDocument } from "document-schema.js";
import { lowerMarkdownMath } from "./math";
import type { MarkdownMathLoweringOptions } from "./math";
import { PAGE_BREAK_MARKER } from "./write";

// markdown text -> ContentDocument (the wordprocessing variant). A thin adapter over markdown-codec's own readMarkdownContent, mirroring src/ooxml/docx/read.ts's readDocxContent / src/odf/ods/read.ts's readOdsContent: markdown-codec's own readMarkdownContent produces a document-schema.js ContentDocument (kind/formatVersion/metadata/sections) directly. This used to be two nominally distinct ContentDocument types (markdown-codec independently pinned document-schema.js at ^1.5.3, a pre-2.0.0 release, one major behind the 2.0.0+ this package depends on directly), which forced a re-parse through this package's own ContentDocumentSchema to sidestep the recursively-nested mismatch. That version skew is gone: markdown-codec now depends on document-schema.js@^2.2.4, the same range this package depends on directly, and pnpm resolves both to the single installed copy (`pnpm why document-schema.js` shows exactly one) -- so the reader's return value is now genuinely, nominally the same ContentDocument type this function returns, and the plain pass-through this comment used to anticipate is what's below. markdown-codec 4.0.0 renamed this flat reader to readMarkdownContent and gave the bare readMarkdown name to its tree-form DocumentTree counterpart -- the import is aliased here only because this module's own export is itself named readMarkdownContent.
//
// Unlike readOdtContent/readOdpContent, this adapter runs no second embedded-formula detection pass over its own source: CommonMark/GFM has no embedded-object or formula construct at all for one to find, so there is nothing to detect even speculatively. (A formula reaching markdown from the OTHER direction still degrades to its own plain-text stand-in -- see src/markdown/write.ts's own markdownBlock.) What this adapter DOES add is the math-lowering pass (src/markdown/math.ts): markdown-codec hands $$ display blocks and \( \) inline spans through as raw LaTeX text, and the pass lowers that LaTeX into the two-layer ContentFormula every format in this family shares -- the model-level placement documents.js#563 settled on -- so markdown-carried math typesets, edits, and computes like math from any other format.
export function readMarkdownContent(
  text: string,
  options?: ReadMarkdownOptions,
  math?: MarkdownMathLoweringOptions,
): ContentDocument {
  const { document } = readMarkdownFlat(text, {
    frontMatter: true,
    ...options,
  });
  // readMarkdownContent's declared return type is the full ContentDocument union, even though it always produces the wordprocessing variant in practice (markdown has no presentation/spreadsheet/drawing/formula equivalent to lower into) -- this both documents and enforces that, mirroring every other readXContent adapter's own kind guard in this package (readDocxContent, readOdtContent, readOdsContent, readOdgContent).
  if (document.kind !== "wordprocessing") {
    throw new Error(
      "readMarkdownContent returned a non-wordprocessing ContentDocument",
    );
  }
  return lowerMarkdownMath(promotePageBreakMarkers(document), math);
}

// The read-side inverse of src/markdown/write.ts's PAGE_BREAK_MARKER: markdown-codec lowers an `<!-- page break -->` HTML comment to an HTMLPreformatted paragraph carrying that literal text, and this pass promotes exactly that paragraph -- the whole paragraph's text equal to the marker, nothing less -- back to the pageBreak block it spelled, so a marker in markdown means a page boundary in the ContentDocument (markdownToPdf renders one; buildDocxPackage/buildOdtPackage write one). The match is deliberately exact rather than substring-based: a longer comment merely CONTAINING the marker is a genuine comment, not this package's page-break directive, and stays a paragraph. Runs before lowerMarkdownMath because a marker paragraph carries no math to lower either way. The walk is top-level only by structure, not oversight: GFM table cells hold inline content, so markdown-codec lowers a cell's `<!-- page break -->` to plain literal text runs -- never the HTMLPreformatted paragraph shape this pass matches -- and a marker inside a table cell can therefore never be promoted; it reads back as its literal text, the one-way annotation src/markdown/write.ts's own recursion emits it as.
type WordprocessingContent = Extract<
  ContentDocument,
  { kind: "wordprocessing" }
>;

function promotePageBreakMarkers(
  document: WordprocessingContent,
): WordprocessingContent {
  return {
    ...document,
    sections: document.sections.map((section) => ({
      ...section,
      blocks: section.blocks.map(promoteBlock),
    })),
  };
}

function promoteBlock(block: ContentBlock): ContentBlock {
  if (
    block.kind !== "paragraph" ||
    block.styleId !== HTML_PREFORMATTED_STYLE_ID
  ) {
    return block;
  }
  return block.runs.map((run) => run.text).join("") === PAGE_BREAK_MARKER
    ? { kind: "pageBreak" }
    : block;
}
