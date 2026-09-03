import { readCompoundFile } from "archive-codec";
import type {
  ContentBlock,
  ContentDocument,
  ContentParagraph,
  ContentRun,
  Margins,
  PageSize,
} from "document-schema.js";
import { slice } from "./bytes";
import { WORD_DOCUMENT_STREAM } from "./detect";
import { DocFormatError } from "./errors";
import { parseFib, tableStreamName, type Fib } from "./fib/fib";
import { applyCharacterSprms, type CharacterProperties } from "./prop/chp";
import { PropertyBinTable } from "./prop/fkp";
import { applyParagraphSprms, type ParagraphProperties } from "./prop/pap";
import { readGrpprl } from "./prop/sprm";
import { headingLevelFromIstd, parseStsh, type StyleSheet } from "./style/stsh";
import { readTextRange } from "./text/characters";
import { parseClx } from "./text/piece-table";
import {
  FIELD_BEGIN,
  FIELD_END,
  FIELD_SEPARATOR,
  LINE_BREAK,
  endsParagraph,
  isAnchorOnly,
} from "./text/special";

// The top-level read: a .doc's bytes to a ContentDocument. Every step below is one of [MS-DOC]'s own algorithms, in the order the specification chains them -- the compound-file container gives the WordDocument and Table streams, the FIB gives the offsets, the piece table turns character positions into bytes, and the two bin tables turn byte offsets into formatting.
//
// What this does NOT do is as important as what it does, and is stated in full in the README's scope section rather than only here: no tables, no images, no footnotes/headers/endnotes, no section geometry, no numbering definitions, no style-inherited formatting, no writing, and no decryption. Each of those is a genuine layer of the format, and each is absent rather than approximated.

/** The page geometry every section is given, because this reader does not yet read a document's own. US Letter with one-inch margins is Word's own default for a new document; a document that states otherwise is not yet consulted, so this is a placeholder the schema requires rather than a fact read from the file. */
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
}

// Pulls the two streams every later step reads from, and the FIB that says which of "1Table" and "0Table" is the one in play. Both names always exist as candidates in the container; only the one FibBase.fWhichTblStm selects holds the structures the FIB's offsets address, and reading the other yields offsets into unrelated bytes.
export function readDocStreams(bytes: Uint8Array<ArrayBuffer>): DocStreams {
  const streams = readCompoundFile(bytes);
  const wordDocument = streams.find(
    (stream) => stream.path === WORD_DOCUMENT_STREAM,
  );
  if (wordDocument === undefined) {
    throw new DocFormatError(
      `this compound file has no "${WORD_DOCUMENT_STREAM}" stream, so it is not a Word Binary File (it holds: ${streams.map((stream) => stream.path).join(", ")})`,
    );
  }
  const fib = parseFib(wordDocument.bytes);
  const wanted = tableStreamName(fib);
  const table = streams.find((stream) => stream.path === wanted);
  if (table === undefined) {
    throw new DocFormatError(
      `FibBase.fWhichTblStm selects the "${wanted}" stream, which this compound file does not contain`,
    );
  }
  return { wordDocument: wordDocument.bytes, table: table.bytes, fib };
}

export function readDocContent(
  bytes: Uint8Array<ArrayBuffer>,
): ContentDocument {
  const { wordDocument, table, fib } = readDocStreams(bytes);

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

  // The main document is the first subdocument: it starts at character position 0 and runs for ccpText characters, with the footnote, header, comment, endnote and textbox subdocuments following it in the order FibRgLw97 declares them. Only the main document is converted here; the rest are left for the subdocument support the README's scope section describes as absent.
  const range = readTextRange(wordDocument, pieceTable, 0, fib.ccpText);

  const blocks = readParagraphs(range.text, range.fcs, {
    chpxTable,
    papxTable,
    styles,
    characterProperties: new Map(),
  });

  return {
    kind: "wordprocessing",
    // Empty rather than populated from the SummaryInformation property-set streams: those are [MS-OLEPS] property sets rather than [MS-DOC] structures, and this package does not read them yet. An absent title is honest; a fabricated one is not.
    metadata: {},
    sections: [
      {
        pageSize: DEFAULT_PAGE_SIZE,
        margins: DEFAULT_MARGINS,
        blocks,
      },
    ],
  };
}

interface ReadContext {
  readonly chpxTable: PropertyBinTable;
  readonly papxTable: PropertyBinTable;
  readonly styles: StyleSheet | undefined;
  // Character properties already folded out of one Chpx, keyed by that Chpx's own position and length in the WordDocument stream. It belongs to the whole read rather than to one paragraph because a Chpx routinely spans many paragraphs -- a document in one font is one exception covering all of it -- so a per-paragraph cache would re-parse the same grpprl once per paragraph and never hit.
  readonly characterProperties: Map<string, CharacterProperties>;
}

// Splits the logical text stream into paragraphs at the marks [MS-DOC] 2.4.2 names as paragraph ends, and each paragraph into runs at the boundaries of the character-formatting exceptions covering it.
function readParagraphs(
  text: string,
  fcs: readonly number[],
  context: ReadContext,
): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (!endsParagraph(code)) continue;
    // The mark's own byte offset is what the paragraph's PAPX is keyed on, and the mark itself is structure rather than text, so it ends the range without joining it.
    const markFc = fcs[index];
    if (markFc === undefined) {
      throw new DocFormatError(
        `character ${index} has no byte offset, so its paragraph's properties cannot be located`,
      );
    }
    blocks.push(
      buildParagraph(
        text.slice(start, index),
        fcs.slice(start, index),
        markFc,
        context,
      ),
    );
    start = index + 1;
  }
  // A document whose last character is not a paragraph mark is malformed by [MS-DOC]'s own account, but its trailing text is real and the honest thing is to keep it rather than drop content on a technicality. Its properties are located from its first character instead of a mark it does not have.
  if (start < text.length) {
    const firstFc = fcs[start];
    if (firstFc === undefined) {
      throw new DocFormatError(
        `character ${start} has no byte offset, so the trailing paragraph's properties cannot be located`,
      );
    }
    blocks.push(
      buildParagraph(text.slice(start), fcs.slice(start), firstFc, context),
    );
  }
  return blocks;
}

function buildParagraph(
  text: string,
  fcs: readonly number[],
  propertyFc: number,
  context: ReadContext,
): ContentParagraph {
  const papx = context.papxTable.papx(propertyFc);
  const properties: ParagraphProperties = {};
  if (papx !== undefined) {
    // The istd comes from the GrpPrlAndIstd's own field, and a sprmPIstd inside the grpprl can then replace it -- so it is seeded first and the fold is allowed to overwrite it.
    properties.istd = papx.istd;
    applyParagraphSprms(readGrpprl(papx.grpprl), properties);
  }

  const paragraph: ContentParagraph = {
    kind: "paragraph",
    runs: buildRuns(text, fcs, context),
  };
  return { ...paragraph, ...paragraphAttributes(properties, context) };
}

function paragraphAttributes(
  properties: ParagraphProperties,
  context: ReadContext,
): Partial<ContentParagraph> {
  const attributes: Partial<ContentParagraph> = {};
  const istd = properties.istd;
  if (istd !== undefined) {
    const style = context.styles?.styles[istd];
    if (style !== undefined && style.name !== "") {
      attributes.styleId = style.name;
    }
    const headingLevel = headingLevelFromIstd(istd);
    if (headingLevel !== undefined) attributes.headingLevel = headingLevel;
  }
  // sprmPOutLvl states an outline level directly and is the more specific statement where both are present, so it wins over the istd-derived one. [MS-DOC] makes the reverse precedence explicit -- sprmPOutLvl "MUST be ignored if the paragraph has an istd that is greater than or equal to 0x1 and less than or equal to 0x9" -- so it only applies where the istd did not already supply a level.
  if (
    attributes.headingLevel === undefined &&
    properties.outlineLevel !== undefined
  ) {
    attributes.headingLevel = properties.outlineLevel + 1;
  }
  if (properties.alignment !== undefined)
    attributes.alignment = properties.alignment;
  if (properties.spacingBeforePt !== undefined) {
    attributes.spacingBeforePt = properties.spacingBeforePt;
  }
  if (properties.spacingAfterPt !== undefined) {
    attributes.spacingAfterPt = properties.spacingAfterPt;
  }
  if (properties.lineSpacing !== undefined) {
    attributes.lineSpacing = properties.lineSpacing;
  }
  if (properties.indentLeftPt !== undefined) {
    attributes.indentLeftPt = properties.indentLeftPt;
  }
  if (properties.indentFirstLinePt !== undefined) {
    attributes.indentFirstLinePt = properties.indentFirstLinePt;
  }
  if (properties.pageBreakBefore === true) attributes.pageBreakBefore = true;
  if (properties.listId !== undefined) {
    attributes.list = {
      numId: String(properties.listId),
      level: properties.listLevel ?? 0,
    };
  }
  return attributes;
}

// Groups the paragraph's characters into runs of identical direct character formatting. The grouping key is the identity of the Chpx covering each character -- its position and length within the WordDocument stream -- rather than the resolved properties, so two runs that happen to resolve to the same values but come from different exceptions stay distinct, exactly as the file states them.
function buildRuns(
  text: string,
  fcs: readonly number[],
  context: ReadContext,
): ContentRun[] {
  const runs: ContentRun[] = [];
  let currentKey: string | undefined;
  let currentText = "";
  let currentProperties: CharacterProperties = {};
  // Field state, per [MS-DOC] 2.8.25's field characters: everything between a begin (0x13) and a separator (0x14) is the field's instruction rather than its displayed result, and a field with no separator displays nothing at all.
  //
  // A stack rather than a depth counter, because fields nest and the enclosing field's own state has to survive the inner one. A nested field appears inside the OUTER field's instruction as often as inside its result, so on reaching the inner field's end, whether text resumes depends on which side of its own separator the outer field had reached -- a counter cannot express that, and would resume in instruction mode (dropping real text) whenever an inner field closed inside an outer field's result.
  const enclosingInstruction: boolean[] = [];
  let inInstruction = false;

  const flush = (): void => {
    if (currentText !== "") {
      runs.push({ text: currentText, ...currentProperties });
    }
    currentText = "";
  };

  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code === FIELD_BEGIN) {
      flush();
      enclosingInstruction.push(inInstruction);
      inInstruction = true;
      continue;
    }
    if (code === FIELD_SEPARATOR) {
      inInstruction = false;
      continue;
    }
    if (code === FIELD_END) {
      // An unmatched end -- one the text carries with no begin before it -- pops nothing and leaves the state alone rather than flipping it, so malformed field nesting cannot swallow the rest of the paragraph.
      inInstruction = enclosingInstruction.pop() ?? inInstruction;
      continue;
    }
    if (inInstruction || isAnchorOnly(code)) continue;

    const fc = fcs[index];
    if (fc === undefined) {
      throw new DocFormatError(
        `character ${index} of a paragraph has no byte offset, so its formatting cannot be located`,
      );
    }
    const grpprl = context.chpxTable.chpxGrpprl(fc);
    const key =
      grpprl === undefined
        ? "none"
        : `${grpprl.byteOffset}:${grpprl.byteLength}`;
    if (key !== currentKey) {
      flush();
      currentKey = key;
      let properties = context.characterProperties.get(key);
      if (properties === undefined) {
        properties = {};
        if (grpprl !== undefined) {
          applyCharacterSprms(readGrpprl(grpprl), properties);
        }
        context.characterProperties.set(key, properties);
      }
      currentProperties = properties;
    }
    // A line break inside a paragraph is a real break in the text rather than a paragraph boundary, so it survives as a newline instead of being dropped as a control character. Rebuilt from the code unit already in hand rather than indexed back out of the string, which the loop bound has established is present but the type of an indexed read cannot.
    currentText += String.fromCharCode(code === LINE_BREAK ? 0x0a : code);
  }
  flush();
  return runs;
}
