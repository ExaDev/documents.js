import {
  hasSummaryInformationFields,
  writeCompoundFile,
  writeSummaryInformationStream,
} from "archive-codec";
import type { ContentDocument } from "document-schema.js";
import { SUMMARY_INFORMATION_STREAM, WORD_DOCUMENT_STREAM } from "./detect";
import { DocFormatError, DocUnsupportedError } from "./errors";
import { buildFib } from "./fib/write";
import { buildNumberingTables, gatherListUsage } from "./list/numbering-write";
import { layoutMetadataToSummaryInformation } from "./metadata";
import { encodeCharacterGrpprl } from "./prop/chp-write";
import { FKP_PAGE_SIZE } from "./prop/fkp";
import {
  buildChpxPages,
  buildPapxPages,
  buildPropertyBinTable,
  firstFcOfPage,
  type ChpxRunToWrite,
  type PapxParagraphToWrite,
} from "./prop/fkp-write";
import { encodeParagraphGrpprl } from "./prop/pap-write";
import { buildPlcfSed, buildSepx, encodeSectionGrpprl } from "./prop/sep-write";
import { buildFontTable } from "./style/fonts";
import { buildEmptyStsh } from "./style/stsh";
import { flattenSectionBlocks, type WriteWarning } from "./table/write";
import { buildTextClx } from "./text/piece-table-write";
import { PARAGRAPH_MARK } from "./text/special";

// The top-level write: a wordprocessing ContentDocument to real [MS-DOC] bytes, wrapped in a real [MS-CFB] compound file. Every step below inverts one of read.ts's own -- the text stream is laid out and the paragraph/character formatting encoded into grpprls first (write.ts, prop/chp-write.ts, prop/pap-write.ts, table/write.ts), then packed into the piece table, the two property bin tables and their formatted disk pages, an empty-but-conformant style sheet, and (when a run names one) a font table (text/piece-table-write.ts, prop/fkp-write.ts, style/stsh.ts, style/fonts.ts) -- the identical structures readDocContent (read.ts) consumes, so a document this writer produces is verified by reading it back through this package's own reader rather than by inspecting its bytes in isolation. A ContentTable block is expanded by table/write.ts's flattenSectionBlocks into the same flat paragraph sequence every other block already is, each with its own terminator (a cell/row mark's own cell-mark character rather than the ordinary paragraph mark) and extra grpprl bytes (sprmPFInTable, and on a row's own mark, sprmPFTtp plus its whole TAP) -- so table paragraphs flow through the identical Chpx/Papx paging logic below as every other paragraph, not a separate table-only path.
//
// What this writer does NOT do is stated in full in the README's own scope section, not only here: no images, no footnotes/headers/endnotes, no section boundaries beyond refusing more than one section (the one section's own page size and margins are written for real -- see below), no numbering, no paragraph styles (every paragraph is istd 0, "Normal", with every property carried as a direct exception), and no hyperlinks or fields. Each is a genuine layer of the format this writer does not implement; none is silently approximated. Tables are written, but only at depth 1 (see table/write.ts) and without cell shading/borders or any other TAP layer document-schema.js's own ContentTable/ContentTableCell has no field for.

/** Where the text is written in the WordDocument stream: past the FIB (which needs under 900 bytes for the fields this writer populates), on a page boundary though not required to be. */
const TEXT_FC = 0x400;
/** This writer only ever emits 16-bit (uncompressed) text -- see text/piece-table-write.ts. */
const BYTES_PER_CHARACTER = 2;

interface FormattedRun {
  readonly text: string;
  /** Empty means no direct character formatting at all. */
  readonly grpprl: readonly number[];
}

interface FormattedParagraph {
  readonly runs: readonly FormattedRun[];
  readonly grpprl: readonly number[];
}

export interface WriteDocContentOptions {
  /** Reports a non-fatal write-time degradation -- today, only table/write.ts's own per-row lost-boundary-budget fallback (ExaDev/documents.js#1013), the same `onWarning` shape byte-codec's PNG decoder and pdf-codec already use for a recoverable, non-fatal defect. Not a guarantee the write itself goes on to succeed: when a row's own assigned lost boundaries can't be trimmed down to a split that fits at all, this still fires once -- reporting that the row's boundaries could not be stated and that its fully-unsplit encoding is being attempted instead -- before writeDocContent can discover, further down the same pipeline, that even that unsplit encoding overflows the row's own byte budget and throws its usual DocFormatError; the warning describes what this fallback could not recover, not a promise that a hard failure won't immediately follow it. It is never called in place of a genuine refusal this writer makes outright (an unsupported block kind, more than one section, and so on) -- those always throw DocFormatError/DocUnsupportedError directly, with no warning first. */
  readonly onWarning?: WriteWarning;
}

export function writeDocContent(
  document: ContentDocument,
  options: WriteDocContentOptions = {},
): Uint8Array<ArrayBuffer> {
  if (document.kind !== "wordprocessing") {
    throw new DocUnsupportedError(
      `doc-codec writes wordprocessing documents only; got a '${document.kind}' document`,
    );
  }
  if (document.sections.length !== 1) {
    throw new DocUnsupportedError(
      `doc-codec's reader never distinguishes more than one section within a document (see README's "Section properties" scope note): writeDocContent refuses ${document.sections.length} sections rather than silently merging their content into what would read back as one`,
    );
  }
  const [section] = document.sections;
  if (section === undefined) {
    throw new DocFormatError("a wordprocessing document must carry a section");
  }

  const writeParagraphs = flattenSectionBlocks(
    section.blocks,
    options.onWarning,
  );
  // The Main Document's own last character MUST be an ordinary paragraph mark ([MS-DOC]'s own "Main Document" glossary entry: "The last character in the main document MUST be a paragraph mark (Unicode 0x000D)") -- never a table's own cell/TTP mark (0x0007), even though a row-ending mark is itself a perfectly legal paragraph-boundary terminator everywhere else ([MS-DOC] 2.4.2's "Determining Paragraph Boundaries": "The character at the end character position of a paragraph MUST be a paragraph mark, an end-of-section character, a cell mark, or a TTP mark"). An otherwise-empty section and a section whose very last block is a table both leave the flattened sequence's own last terminator short of that stronger, main-document-wide requirement, so both need one trailing empty ordinary paragraph appended -- confirmed against a real producer (LibreOffice 26.2.5.2): a table it writes as a document's own last content is always followed by a genuine 0x000D, and a written .doc lacking one is not merely missing a property but is not recognised as carrying a table at all by LibreOffice's own .doc import filter (see the README's Tables section for the full finding, ExaDev/documents.js#892).
  const lastTerminator =
    writeParagraphs[writeParagraphs.length - 1]?.terminator;
  if (lastTerminator !== PARAGRAPH_MARK) {
    writeParagraphs.push({
      runs: [],
      properties: {},
      extraGrpprl: [],
      terminator: PARAGRAPH_MARK,
    });
  }

  // 1. Assign every distinct font name its own font-table index, in first-use order.
  const fontNames: string[] = [];
  const fontIndexByName = new Map<string, number>();
  const fontIndexOf = (name: string): number => {
    const existing = fontIndexByName.get(name);
    if (existing !== undefined) return existing;
    const index = fontNames.length;
    fontNames.push(name);
    fontIndexByName.set(name, index);
    return index;
  };

  // 1b. Gather every distinct numId the document's paragraphs use into a real NumberingDefinitions (list/numbering-write.ts's own gatherListUsage), minting the one-based ilfo each numId writes as its own sprmPIlfo -- one map built once up front, since a paragraph using numId "3" needs to resolve to the identical ilfo regardless of which other numIds the rest of the document also uses.
  const listUsage = gatherListUsage(
    writeParagraphs.map((entry) => entry.properties.list),
  );
  const ilfoOf = (numId: string): number => {
    const ilfo = listUsage.ilfoByNumId.get(numId);
    if (ilfo === undefined) {
      throw new DocFormatError(
        `internal defect: writeDocContent's own list-usage map has no ilfo minted for numId ${JSON.stringify(numId)}`,
      );
    }
    return ilfo;
  };
  const numberingTables = buildNumberingTables(listUsage.definitions);

  // 2. Encode every run's and paragraph's own direct formatting up front: a run's byte-identical grpprl is what decides whether it merges with its neighbour into one Chpx exception below, so the encoding has to exist before the text stream is laid out. A table paragraph's own extraGrpprl (sprmPFInTable, and on a row's own mark, sprmPFTtp plus its TAP) is appended after its ordinary direct formatting -- table/write.ts already ordered the two so a later table sprm never has to fight an earlier paragraph one for the same property.
  const formatted: FormattedParagraph[] = writeParagraphs.map((entry) => ({
    runs: entry.runs.map((run) => ({
      text: run.text,
      grpprl: encodeCharacterGrpprl(run, fontIndexOf),
    })),
    grpprl: [
      ...encodeParagraphGrpprl(entry.properties, ilfoOf),
      ...entry.extraGrpprl,
    ],
  }));

  // 3. Lay out the logical text stream: every run's characters, each paragraph closed by its own mark -- an ordinary paragraph mark, or, for a table cell/row mark, its own cell mark (writeParagraphs' own terminator). Adjacent stretches with byte-identical formatting merge into one Chpx exception -- what a real producer writes, and what read.ts's own buildRuns must already split back apart at every paragraph boundary regardless of how many paragraphs one exception spans.
  let text = "";
  const paragraphStarts: number[] = [];
  const chpxRuns: {
    start: number;
    end: number;
    grpprl: readonly number[] | undefined;
  }[] = [];
  formatted.forEach((paragraph, paragraphIndex) => {
    paragraphStarts.push(text.length);
    for (const run of paragraph.runs) {
      const runStart = text.length;
      text += run.text;
      if (text.length > runStart) {
        chpxRuns.push({
          start: runStart,
          end: text.length,
          grpprl: run.grpprl.length > 0 ? run.grpprl : undefined,
        });
      }
    }
    const terminator =
      writeParagraphs[paragraphIndex]?.terminator ?? PARAGRAPH_MARK;
    text += String.fromCharCode(terminator);
    // The mark shares the paragraph's own last run's formatting, matching what a real producer writes (test-support/doc.ts's buildDoc makes the identical choice, for the identical reason): extending that run keeps the Chpx's own ranges contiguous instead of adding a second, separately-tracked one-character exception.
    const lastRun = chpxRuns[chpxRuns.length - 1];
    if (lastRun?.end === text.length - 1) {
      lastRun.end = text.length;
    } else {
      chpxRuns.push({
        start: text.length - 1,
        end: text.length,
        grpprl: undefined,
      });
    }
  });

  const mergedChpxRuns: typeof chpxRuns = [];
  for (const run of chpxRuns) {
    const previous = mergedChpxRuns[mergedChpxRuns.length - 1];
    if (
      previous?.end === run.start &&
      sameGrpprl(previous.grpprl, run.grpprl)
    ) {
      previous.end = run.end;
      continue;
    }
    mergedChpxRuns.push({ ...run });
  }

  // 4. Place the text, then the character- and paragraph-formatting pages immediately after it.
  const characterFc = (cp: number): number =>
    TEXT_FC + cp * BYTES_PER_CHARACTER;
  const textFcLim = characterFc(text.length);
  const chpxPageStart = Math.ceil(textFcLim / FKP_PAGE_SIZE);

  const chpxRunSpecs: ChpxRunToWrite[] = mergedChpxRuns.map((run) => ({
    fc: characterFc(run.start),
    grpprl: run.grpprl,
  }));
  const chpxPages = buildChpxPages(chpxRunSpecs, textFcLim);

  const papxPageStart = chpxPageStart + chpxPages.length;
  const papxParagraphSpecs: PapxParagraphToWrite[] = formatted.map(
    (paragraph, index) => {
      const start = paragraphStarts[index];
      if (start === undefined) {
        throw new DocFormatError(
          "internal defect: writeDocContent lost a paragraph's own start position",
        );
      }
      return { fc: characterFc(start), istd: 0, grpprl: paragraph.grpprl };
    },
  );
  const papxPages = buildPapxPages(papxParagraphSpecs, textFcLim);

  // The one section's own Sepx, [MS-DOC] 2.9.279 -- not an FKP-paged structure like the Chpx/Papx pages above, so it needs no page alignment and is simply appended after them.
  const sepx = buildSepx(encodeSectionGrpprl(section));
  const fcSepx = (papxPageStart + papxPages.length) * FKP_PAGE_SIZE;

  const wordDocument = new Uint8Array(fcSepx + sepx.length);
  const wordView = new DataView(wordDocument.buffer);
  for (let index = 0; index < text.length; index += 1) {
    wordView.setUint16(characterFc(index), text.charCodeAt(index), true);
  }
  chpxPages.forEach((page, index) => {
    wordDocument.set(page, (chpxPageStart + index) * FKP_PAGE_SIZE);
  });
  papxPages.forEach((page, index) => {
    wordDocument.set(page, (papxPageStart + index) * FKP_PAGE_SIZE);
  });
  wordDocument.set(sepx, fcSepx);

  // 5. The Table stream: the Clx, the two bin tables (keyed on each page's own first fc, read back out of the page itself so the key and the page's content can never disagree), an empty-but-conformant style sheet, when at least one run names a font the font table, and, when the document uses at least one list, the numbering tables (PlfLst/PlfLfo).
  const clx = buildTextClx(text.length, TEXT_FC);
  const chpxBinTable = buildPropertyBinTable(
    [...chpxPages.map(firstFcOfPage), textFcLim],
    chpxPages.map((_, index) => chpxPageStart + index),
  );
  const papxBinTable = buildPropertyBinTable(
    [...papxPages.map(firstFcOfPage), textFcLim],
    papxPages.map((_, index) => papxPageStart + index),
  );
  const stsh = buildEmptyStsh();
  const fontTable =
    fontNames.length > 0 ? buildFontTable(fontNames) : undefined;
  const plcfSed = buildPlcfSed(text.length, fcSepx);

  let cursor = 0;
  const place = (bytes: Uint8Array): number => {
    const offset = cursor;
    cursor += bytes.length;
    return offset;
  };
  const fcClx = place(clx);
  const fcPlcfBteChpx = place(chpxBinTable);
  const fcPlcfBtePapx = place(papxBinTable);
  const fcStshf = place(stsh);
  const fcPlcfSed = place(plcfSed);
  const fcSttbfFfn = fontTable !== undefined ? place(fontTable) : 0;
  const fcPlfLst =
    numberingTables !== undefined ? place(numberingTables.plfLst) : 0;
  const fcPlfLfo =
    numberingTables !== undefined ? place(numberingTables.plfLfo) : 0;
  const table = new Uint8Array(cursor);
  table.set(clx, fcClx);
  table.set(chpxBinTable, fcPlcfBteChpx);
  table.set(papxBinTable, fcPlcfBtePapx);
  table.set(stsh, fcStshf);
  table.set(plcfSed, fcPlcfSed);
  if (fontTable !== undefined) table.set(fontTable, fcSttbfFfn);
  if (numberingTables !== undefined) {
    table.set(numberingTables.plfLst, fcPlfLst);
    table.set(numberingTables.plfLfo, fcPlfLfo);
  }

  const fib = buildFib({
    ccpText: text.length,
    cbMac: wordDocument.length,
    fcClx,
    lcbClx: clx.length,
    fcPlcfSed,
    lcbPlcfSed: plcfSed.length,
    fcPlcfBteChpx,
    lcbPlcfBteChpx: chpxBinTable.length,
    fcPlcfBtePapx,
    lcbPlcfBtePapx: papxBinTable.length,
    fcStshf,
    lcbStshf: stsh.length,
    fcSttbfFfn,
    lcbSttbfFfn: fontTable?.length ?? 0,
    fcPlfLst,
    lcbPlfLst: numberingTables?.lcbPlfLst ?? 0,
    fcPlfLfo,
    lcbPlfLfo: numberingTables?.plfLfo.length ?? 0,
  });
  wordDocument.set(fib, 0);

  const streams = [
    { path: WORD_DOCUMENT_STREAM, bytes: wordDocument },
    { path: "1Table", bytes: table },
  ];
  // Only when there is something SummaryInformation can actually hold: an input whose metadata carries nothing beyond creator/producer/language (or nothing at all) should read back exactly as it would with no stream present, not force an empty-but-present one into existence.
  if (hasSummaryInformationFields(document.metadata)) {
    streams.push({
      path: SUMMARY_INFORMATION_STREAM,
      bytes: writeSummaryInformationStream(
        layoutMetadataToSummaryInformation(document.metadata),
      ),
    });
  }
  return writeCompoundFile(streams);
}

function sameGrpprl(
  a: readonly number[] | undefined,
  b: readonly number[] | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}
