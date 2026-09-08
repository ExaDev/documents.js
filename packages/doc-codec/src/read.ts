import {
  readCompoundFile,
  readSummaryInformation,
  summaryInformationToLayoutMetadata,
} from "archive-codec";
import type { ContentDocument, Margins, PageSize } from "document-schema.js";
import { slice } from "./bytes";
import {
  DATA_STREAM,
  SUMMARY_INFORMATION_STREAM,
  WORD_DOCUMENT_STREAM,
} from "./detect";
import { decryptDocStreams } from "./encryption";
import { DocFormatError, DocUnsupportedError } from "./errors";
import { parseFib, peekFibBaseFlags, type Fib } from "./fib/fib";
import type { HeaderFooterStories } from "./headers-footers";
import { readHeaderFooterStories } from "./headers-footers";
import {
  readNumberingDefinitions,
  type NumberingDefinitions,
} from "./list/numbering";
import type { NoteBodies } from "./notes";
import { readNoteBodies } from "./notes";
import { PropertyBinTable } from "./prop/fkp";
import { readAllSectionProperties } from "./prop/sep";
import { parseFontTable } from "./style/fonts";
import { parseStsh } from "./style/stsh";
import { assembleBlocks } from "./table/read";
import {
  readParagraphs,
  type ParagraphEntry,
  type ReadContext,
} from "./text/paragraphs";
import { readTextRange } from "./text/characters";
import { parseClx } from "./text/piece-table";

// The top-level read: a .doc's bytes to a ContentDocument. Every step below is one of [MS-DOC]'s own algorithms, in the order the specification chains them -- the compound-file container gives the WordDocument and Table streams, the FIB gives the offsets, the piece table turns character positions into bytes, and the two bin tables turn byte offsets into formatting. text/paragraphs.ts's readParagraphs itself only ever produces flat ParagraphEntry values (one per paragraph/cell/row mark, whatever its own table depth) for whichever document-stream range it is handed; table/read.ts's assembleBlocks is what folds a contiguous run of table-depth paragraphs into a real ContentTable, so this module carries no table-specific logic of its own.
//
// What this does NOT do is as important as what it does, and is stated in full in the README's scope section rather than only here: an inline picture (U+0001, sprmCPicLocation) resolves to a real ContentImageBlock when its own OfficeArtBlip is JPEG or PNG (pictures.ts) -- a floating/anchored drawn object (U+0008, PlcfSpa) and every other blip format (WMF/EMF/PICT metafiles, a raw DIB, TIFF) are genuinely different, unimplemented structures, and text boxes are absent for the identical reason (they ride the same OfficeArt drawing layer a floating object does). No table/numbering style formatting either. RC4-encrypted documents are read given a password (encryption.ts), but XOR obfuscation and RC4 CryptoAPI stay refused. Each of those absences is a genuine layer of the format, and each is absent rather than approximated. A paragraph or character style's own formatting IS resolved, up its full istdBase inheritance chain (style/stsh.ts's resolveStyleFormatting, ExaDev/documents.js#1005). Tables are read at every depth a document states, a table nested inside a table cell included (table/read.ts). Every section PlcfSed states resolves to its own real ContentSection, each with its own page size and margins. Footnotes, endnotes, and comments are read as plain text (notes.ts); headers and footers are read as real block flow, per section and per even/odd/first slot (headers-footers.ts) -- see DocContent's own comment below for how all four ride outside ContentDocument's shared shape, the same way numbering definitions already do. Numbering definitions (list/numbering.ts's readNumberingDefinitions) resolve what a paragraph's own listId/listLevel membership looks like.

/** Word's own default for a new document (US Letter, one-inch margins) -- what a field this reader resolves from PlcfSed/Sepx (prop/sep.ts's readAllSectionProperties) falls back to when the file states nothing for it, exactly as it would fall back to Word's own implementation-dependent default for that one unstated sprm. */
const DEFAULT_PAGE_SIZE: PageSize = { widthPt: 612, heightPt: 792 };
const DEFAULT_MARGINS: Margins = {
  topPt: 72,
  rightPt: 72,
  bottomPt: 72,
  leftPt: 72,
};

export interface DocStreams {
  readonly wordDocument: Uint8Array;
  readonly table: Uint8Array;
  readonly fib: Fib;
  /** The raw "\x05SummaryInformation" stream bytes, or undefined when the container carries none -- a valid, spec-conformant Word Binary File need not carry document properties at all. */
  readonly metadata: Uint8Array<ArrayBuffer> | undefined;
  /** The raw "Data" stream bytes, or undefined when the container carries none -- a valid Word Binary File with no pictures need not have one. sprmCPicLocation's operand addresses this stream (pictures.ts). */
  readonly data: Uint8Array<ArrayBuffer> | undefined;
}

// Pulls the two streams every later step reads from, the FIB that says which of "1Table" and "0Table" is the one in play, and the optional metadata stream. Both WordDocument and Table names always exist as candidates in the container; only the one FibBase.fWhichTblStm selects holds the structures the FIB's offsets address, and reading the other yields offsets into unrelated bytes.
//
// fWhichTblStm (and, for an encrypted document, fEncrypted/fObfuscated) is read via fib/fib.ts's own peekFibBaseFlags rather than a full parseFib, since all three sit within the 68-byte prefix [MS-DOC] 2.2.6.2 leaves unencrypted regardless of the document's own encryption status -- parseFib's own later reads do not, so it cannot run at all until decryption (when needed) has already happened. `password` decrypts a document protected by [MS-DOC] 2.2.6.2's RC4 encryption header under the same [MS-OFFCRYPTO] 2.3.6.1 scheme xls-codec's own FilePass reading uses -- see encryption.ts. It is ignored for an unencrypted document, and a missing or incorrect password against an encrypted one throws rather than returning a partial or garbled document.
export function readDocStreams(
  bytes: Uint8Array<ArrayBuffer>,
  password?: string,
): DocStreams {
  const streams = readCompoundFile(bytes);
  const wordDocumentStream = streams.find(
    (stream) => stream.path === WORD_DOCUMENT_STREAM,
  );
  if (wordDocumentStream === undefined) {
    throw new DocFormatError(
      `this compound file has no "${WORD_DOCUMENT_STREAM}" stream, so it is not a Word Binary File (it holds: ${streams.map((stream) => stream.path).join(", ")})`,
    );
  }
  const flags = peekFibBaseFlags(wordDocumentStream.bytes);
  const wanted = flags.fWhichTblStm === 1 ? "1Table" : "0Table";
  const tableStream = streams.find((stream) => stream.path === wanted);
  if (tableStream === undefined) {
    throw new DocFormatError(
      `FibBase.fWhichTblStm selects the "${wanted}" stream, which this compound file does not contain`,
    );
  }

  let wordDocument = wordDocumentStream.bytes;
  let table = tableStream.bytes;
  if (flags.fEncrypted) {
    if (flags.fObfuscated) {
      throw new DocUnsupportedError(
        "this document is XOR-obfuscated ([MS-DOC] 2.2.6.1); doc-codec cannot decrypt it, and reading its streams as plaintext would produce arbitrary text rather than the document's own",
      );
    }
    const decrypted = decryptDocStreams(wordDocument, table, password);
    wordDocument = decrypted.wordDocument;
    table = decrypted.table;
  }

  const fib = parseFib(wordDocument);
  const metadata = streams.find(
    (stream) => stream.path === SUMMARY_INFORMATION_STREAM,
  );
  const data = streams.find((stream) => stream.path === DATA_STREAM);
  return {
    wordDocument,
    table,
    fib,
    metadata: metadata?.bytes,
    data: data?.bytes,
  };
}

/** readDocContent's own return type: a ContentDocument (kind 'wordprocessing') plus numbering, footnotes, endnotes, comments, and headerFooterStories -- constructs [MS-DOC] carries outside the main document's own text and document-schema.js's ContentDocument has nowhere to hold. Mirrors ooxml.js's own DocxDocument in field name and shape wherever the two formats' own constructs genuinely agree (numbering/NumberingDefinitions, footnotes/endnotes/comments as plain-text `Footnote`/`Comment`); headerFooterStories is doc-codec's own shape rather than DocxDocument's path-addressed HeaderFooterPart, since [MS-DOC] has no named parts of its own for a header or footer to be identified by, only a (section, slot) position (see headers-footers.ts's own top comment). Unlike DocxDocument, DocContent stays a genuine ContentDocument subtype (an intersection, not a fresh shape) since readDocContent already had one return type to widen rather than several to reconcile. */
export type DocContent = ContentDocument & {
  readonly numbering: NumberingDefinitions;
  readonly footnotes: NoteBodies["footnotes"];
  readonly endnotes: NoteBodies["endnotes"];
  readonly comments: NoteBodies["comments"];
  readonly headerFooterStories: HeaderFooterStories;
};

export function readDocContent(
  bytes: Uint8Array<ArrayBuffer>,
  password?: string,
): DocContent {
  const { wordDocument, table, fib, metadata, data } = readDocStreams(
    bytes,
    password,
  );

  const pieceTable = parseClx(
    slice(table, fib.fcClx, fib.lcbClx, "Clx in the Table stream"),
  );
  const styles =
    fib.lcbStshf > 0
      ? parseStsh(
          slice(table, fib.fcStshf, fib.lcbStshf, "STSH in the Table stream"),
        )
      : undefined;
  const chpxTable = new PropertyBinTable(
    wordDocument,
    slice(
      table,
      fib.fcPlcfBteChpx,
      fib.lcbPlcfBteChpx,
      "PlcBteChpx in the Table stream",
    ),
    "PlcBteChpx",
  );
  const papxTable = new PropertyBinTable(
    wordDocument,
    slice(
      table,
      fib.fcPlcfBtePapx,
      fib.lcbPlcfBtePapx,
      "PlcBtePapx in the Table stream",
    ),
    "PlcBtePapx",
  );
  const fonts =
    fib.lcbSttbfFfn > 0
      ? parseFontTable(
          slice(
            table,
            fib.fcSttbfFfn,
            fib.lcbSttbfFfn,
            "SttbfFfn in the Table stream",
          ),
        )
      : undefined;

  const context: ReadContext = {
    chpxTable,
    papxTable,
    styles,
    dataStream: data,
    fonts,
    // Shared across every document-stream range read below -- see ReadContext's own comment on why this is safe: a Chpx's identity is its byte position in the WordDocument stream, which means the same thing regardless of which subdocument's CP space led to it.
    characterProperties: new Map(),
  };

  // The main document is the first subdocument: it starts at character position 0 and runs for ccpText characters.
  const range = readTextRange(wordDocument, pieceTable, 0, fib.ccpText);
  const entries = readParagraphs(range.text, range.fcs, context);
  const numbering = readNumberingDefinitions(table, fib);
  const sectionProperties = readAllSectionProperties(wordDocument, table, fib);
  const entriesBySection = splitIntoSections(entries, sectionProperties);
  const { footnotes, endnotes, comments } = readNoteBodies(
    wordDocument,
    table,
    pieceTable,
    context,
    fib,
  );
  const headerFooterStories = readHeaderFooterStories(
    wordDocument,
    table,
    pieceTable,
    context,
    fib,
    sectionProperties.length,
  );

  return {
    kind: "wordprocessing",
    // Absent when the container carries no "\x05SummaryInformation" stream at all -- a valid, spec-conformant Word Binary File need not have one -- and mapped from it through summaryInformationToLayoutMetadata (see src/metadata.ts) otherwise.
    metadata:
      metadata === undefined
        ? {}
        : summaryInformationToLayoutMetadata(readSummaryInformation(metadata)),
    sections: sectionProperties.map((properties, index) => ({
      pageSize: {
        widthPt: properties.pageWidthPt ?? DEFAULT_PAGE_SIZE.widthPt,
        heightPt: properties.pageHeightPt ?? DEFAULT_PAGE_SIZE.heightPt,
      },
      margins: {
        leftPt: properties.marginLeftPt ?? DEFAULT_MARGINS.leftPt,
        rightPt: properties.marginRightPt ?? DEFAULT_MARGINS.rightPt,
        topPt: properties.marginTopPt ?? DEFAULT_MARGINS.topPt,
        bottomPt: properties.marginBottomPt ?? DEFAULT_MARGINS.bottomPt,
      },
      blocks: assembleBlocks(entriesBySection[index] ?? []),
    })),
    numbering,
    footnotes,
    endnotes,
    comments,
    headerFooterStories,
  };
}

// Groups the main document's flat paragraph entries by which section (PlcfSed.aCp boundary) they fall in, per [MS-DOC] 2.8.26: section i covers entries up to and including the one whose own terminator sits at (or crosses) the next section's startCp -- exactly the entry carrying the end-of-section character (0x000C) itself, since that character IS the boundary [MS-DOC] states. `sections` always has at least one entry (readAllSectionProperties' own fallback for a file with no PlcfSed at all), so every entry lands somewhere; entries past the last real boundary all join the final section, matching "the last CP does not begin a new section."
function splitIntoSections(
  entries: readonly ParagraphEntry[],
  sections: readonly { readonly startCp: number }[],
): ParagraphEntry[][] {
  const groups: ParagraphEntry[][] = sections.map(() => []);
  let sectionIndex = 0;
  for (const entry of entries) {
    const group = groups[sectionIndex];
    if (group === undefined) {
      throw new DocFormatError(
        `internal defect: section index ${sectionIndex} has no group despite ${sections.length} sections`,
      );
    }
    group.push(entry);
    if (entry.endCp === sections[sectionIndex + 1]?.startCp) {
      sectionIndex += 1;
    }
  }
  return groups;
}
