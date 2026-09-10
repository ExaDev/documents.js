import {
  hasSummaryInformationFields,
  writeCompoundFile,
  writeSummaryInformationStream,
} from "archive-codec";
import type { ContentDocument } from "document-schema.js";
import { DataStreamBuilder } from "./data-stream";
import {
  DATA_STREAM,
  SUMMARY_INFORMATION_STREAM,
  WORD_DOCUMENT_STREAM,
} from "./detect";
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
import { buildStshForStyles } from "./style/stsh";
import {
  flattenSectionBlocks,
  type WriteParagraph,
  type WriteWarning,
} from "./table/write";
import { buildTextClx } from "./text/piece-table-write";
import { PARAGRAPH_MARK, SECTION_MARK } from "./text/special";

// The top-level write: a wordprocessing ContentDocument to real [MS-DOC] bytes, wrapped in a real [MS-CFB] compound file. Every step below inverts one of read.ts's own -- the text stream is laid out and the paragraph/character formatting encoded into grpprls first (write.ts, prop/chp-write.ts, prop/pap-write.ts, table/write.ts), then packed into the piece table, the two property bin tables and their formatted disk pages, an empty-but-conformant style sheet, and (when a run names one) a font table (text/piece-table-write.ts, prop/fkp-write.ts, style/stsh.ts, style/fonts.ts) -- the identical structures readDocContent (read.ts) consumes, so a document this writer produces is verified by reading it back through this package's own reader rather than by inspecting its bytes in isolation. A ContentTable block is expanded by table/write.ts's flattenSectionBlocks into the same flat paragraph sequence every other block already is, each with its own terminator (a cell/row mark's own cell-mark character rather than the ordinary paragraph mark) and extra grpprl bytes (sprmPFInTable, and on a row's own mark, sprmPFTtp plus its whole TAP) -- so table paragraphs flow through the identical Chpx/Papx paging logic below as every other paragraph, not a separate table-only path.
//
// What this writer does NOT do is stated in full in the README's own scope section, not only here: no footnotes/headers/endnotes, no embedded-object blocks, no construct-boundary markers, and no hyperlinks or fields. Each is a genuine layer of the format this writer does not implement; none is silently approximated. A pageBreak block IS written -- as the manual-page-break spelling of the end-of-section character (table/write.ts's appendPageBreak, the inverse of read.ts's markManualPageBreaks). Tables are written, but only at depth 1 (see table/write.ts) and without cell shading/borders or any other TAP layer document-schema.js's own ContentTable/ContentTableCell has no field for. Every paragraph's own styleId/headingLevel mints a real STSH entry (ExaDev/documents.js#1059) -- but with no formatting of its own: every property this writer emits is already, unconditionally, a direct exception, so a style's own identity round-trips while its formatting stays entirely direct-exception-based. Every section writes its own real page size and margins (multiple sections included, ExaDev/documents.js#971), and an inline picture writes its own real PNG/JPEG bytes into a genuine Data stream (ExaDev/documents.js#971) -- see [Writing](#writing) in the README for both.

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
  if (document.sections.length === 0) {
    throw new DocFormatError(
      "a wordprocessing document must carry at least one section",
    );
  }

  const dataStream = new DataStreamBuilder();
  const sectionParagraphLists = document.sections.map((section, index) => {
    const paragraphs = flattenSectionBlocks(
      section.blocks,
      dataStream,
      options.onWarning,
    );
    // Every section but the last ends on the end-of-section character (0x000C, [MS-DOC] 2.4.4's own worked example); the Main Document's own final character, closing the last section, MUST instead be an ordinary paragraph mark ([MS-DOC]'s own "Main Document" glossary entry: "The last character in the main document MUST be a paragraph mark (Unicode 0x000D)"). Neither boundary may land on a table's own cell/TTP mark (0x0007), even though a row-ending mark is itself a perfectly legal paragraph-boundary terminator everywhere else ([MS-DOC] 2.4.2's "Determining Paragraph Boundaries": "The character at the end character position of a paragraph MUST be a paragraph mark, an end-of-section character, a cell mark, or a TTP mark"). An otherwise-empty section and a section whose very last block is a table both leave the flattened sequence's own last terminator short of that stronger requirement, so both get one trailing empty ordinary paragraph appended first -- confirmed against a real producer (LibreOffice 26.2.5.2) for the single-section, table-last case: a table it writes as a document's own last content is always followed by a genuine 0x000D, and a written .doc lacking one is not merely missing a property but is not recognised as carrying a table at all by LibreOffice's own .doc import filter (see the README's Tables section for the full finding, ExaDev/documents.js#892).
    closeSection(
      paragraphs,
      index === document.sections.length - 1 ? PARAGRAPH_MARK : SECTION_MARK,
    );
    return paragraphs;
  });
  const sectionStartIndices: number[] = [];
  {
    let runningIndex = 0;
    for (const paragraphs of sectionParagraphLists) {
      sectionStartIndices.push(runningIndex);
      runningIndex += paragraphs.length;
    }
  }
  const writeParagraphs: WriteParagraph[] = sectionParagraphLists.flat();

  // 1a. Mint a real istd for every distinct paragraph style: a headingLevel of 1-9 maps directly to that istd (headingLevelFromIstd's own read-side rule, so a re-read derives the identical headingLevel back regardless of what styleId names it), and every other named styleId gets its own istd starting at 10. This mints style IDENTITY only -- name, kind, istd -- with no formatting of its own: every property this writer emits is already, unconditionally, a direct exception (see buildStshForStyles's own comment and the README's scope note, ExaDev/documents.js#1059). A paragraph with neither styleId nor an in-range headingLevel gets istd 0, left an empty hole rather than a real "Normal" entry -- minting one there unconditionally would round-trip an absent styleId into a real "Normal" string on the next read, which is not what the source document stated. A paragraph whose own styleId literally IS "Normal" is treated like any other named style and mints its own real entry (not necessarily at istd 0), so that distinction survives. A headingLevel outside 1-9 (the schema's own field is unbounded, "ODF alone permits ten levels") has no istd slot to round-trip through at all -- a genuine format-boundary limit, so such a paragraph falls back to its styleId (or istd 0) exactly as if it carried no headingLevel.
  const FIRST_NON_HEADING_ISTD = 10;
  const MAX_HEADING_ISTD = 9;
  const styleNames = new Map<number, string>();
  const istdByStyleId = new Map<string, number>();
  let nextNonHeadingIstd = FIRST_NON_HEADING_ISTD;
  const istdOf = (properties: {
    readonly styleId?: string;
    readonly headingLevel?: number;
  }): number => {
    const heading = properties.headingLevel;
    if (heading !== undefined && heading >= 1 && heading <= MAX_HEADING_ISTD) {
      if (!styleNames.has(heading)) {
        styleNames.set(
          heading,
          properties.styleId ?? `Heading ${String(heading)}`,
        );
      }
      return heading;
    }
    const styleId = properties.styleId;
    if (styleId === undefined) return 0;
    const existing = istdByStyleId.get(styleId);
    if (existing !== undefined) return existing;
    const istd = nextNonHeadingIstd;
    nextNonHeadingIstd += 1;
    istdByStyleId.set(styleId, istd);
    styleNames.set(istd, styleId);
    return istd;
  };
  const istds = writeParagraphs.map((entry) => istdOf(entry.properties));

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

  // 2. Encode every run's and paragraph's own direct formatting up front: a run's byte-identical grpprl is what decides whether it merges with its neighbour into one Chpx exception below, so the encoding has to exist before the text stream is laid out. A table paragraph's own extraGrpprl (sprmPFInTable, and on a row's own mark, sprmPFTtp plus its TAP) is appended after its ordinary direct formatting -- table/write.ts already ordered the two so a later table sprm never has to fight an earlier paragraph one for the same property. A run's own extraGrpprl (table/write.ts's WriteRun) is the run-level analogue: today only imageParagraph's own sprmCPicLocation, which encodeCharacterGrpprl could never derive from a bare ContentRun since it names no picture field of its own.
  const formatted: FormattedParagraph[] = writeParagraphs.map((entry) => ({
    runs: entry.runs.map((writeRun) => ({
      text: writeRun.run.text,
      grpprl: [
        ...encodeCharacterGrpprl(writeRun.run, fontIndexOf),
        ...writeRun.extraGrpprl,
      ],
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
      const istd = istds[index];
      if (istd === undefined) {
        throw new DocFormatError(
          "internal defect: writeDocContent lost a paragraph's own minted istd",
        );
      }
      return { fc: characterFc(start), istd, grpprl: paragraph.grpprl };
    },
  );
  const papxPages = buildPapxPages(papxParagraphSpecs, textFcLim);

  // Every section's own Sepx, [MS-DOC] 2.9.279 -- not an FKP-paged structure like the Chpx/Papx pages above, so each needs no page alignment and is simply appended after the last, in section order.
  const sepxPageStart = (papxPageStart + papxPages.length) * FKP_PAGE_SIZE;
  const sepxList = document.sections.map((section) =>
    buildSepx(encodeSectionGrpprl(section)),
  );
  const fcSepxList: number[] = [];
  {
    let sepxCursor = sepxPageStart;
    for (const sepx of sepxList) {
      fcSepxList.push(sepxCursor);
      sepxCursor += sepx.length;
    }
  }
  const lastFcSepx = fcSepxList[fcSepxList.length - 1];
  const lastSepx = sepxList[sepxList.length - 1];
  if (lastFcSepx === undefined || lastSepx === undefined) {
    throw new DocFormatError(
      "internal defect: writeDocContent built an empty section list despite the earlier at-least-one-section guard",
    );
  }
  const wordDocument = new Uint8Array(lastFcSepx + lastSepx.length);
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
  sepxList.forEach((sepx, index) => {
    const fcSepx = fcSepxList[index];
    if (fcSepx === undefined) {
      throw new DocFormatError(
        `internal defect: writeDocContent lost section ${String(index)}'s own Sepx placement`,
      );
    }
    wordDocument.set(sepx, fcSepx);
  });

  // Each section's own start CP -- PlcfSed.aCp[i] -- is exactly where its first paragraph's own text begins, which paragraphStarts already recorded for every paragraph in the flattened, whole-document sequence (step 3 above).
  const sectionStartCps = sectionStartIndices.map((paragraphIndex, index) => {
    const startCp = paragraphStarts[paragraphIndex];
    if (startCp === undefined) {
      throw new DocFormatError(
        `internal defect: writeDocContent lost section ${String(index)}'s own start CP`,
      );
    }
    return startCp;
  });

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
  const stsh = buildStshForStyles(styleNames);
  const fontTable =
    fontNames.length > 0 ? buildFontTable(fontNames) : undefined;
  const plcfSed = buildPlcfSed(sectionStartCps, text.length, fcSepxList);

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
  // Only when the document actually carries at least one inline picture -- matching what pictures.ts's own reader treats as "a valid Word Binary File with no pictures need not have a Data stream at all", not malformed input.
  const dataStreamBytes = dataStream.build();
  if (dataStreamBytes.length > 0) {
    streams.push({ path: DATA_STREAM, bytes: dataStreamBytes });
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

// Ensures `paragraphs` ends in a genuine ordinary-paragraph-mark-terminated entry -- appending an empty one when the last entry's own terminator is anything else (a table's own cell/row mark) -- then, when `terminator` differs from PARAGRAPH_MARK, replaces that entry's terminator with it. The one shared guarantee writeDocContent's own per-section loop and its final Main-Document-ending call both need: neither an end-of-section character nor the Main Document's own final character may land on a table's row-ending mark instead of a real paragraph mark (see this function's own call site for the [MS-DOC] citations).
function closeSection(paragraphs: WriteParagraph[], terminator: number): void {
  const last = paragraphs[paragraphs.length - 1];
  if (last?.terminator !== PARAGRAPH_MARK) {
    paragraphs.push({
      runs: [],
      properties: {},
      extraGrpprl: [],
      terminator: PARAGRAPH_MARK,
    });
  }
  if (terminator === PARAGRAPH_MARK) return;
  const index = paragraphs.length - 1;
  const target = paragraphs[index];
  if (target === undefined) {
    throw new DocFormatError(
      "internal defect: closeSection lost its own just-ensured trailing paragraph",
    );
  }
  paragraphs[index] = { ...target, terminator };
}
