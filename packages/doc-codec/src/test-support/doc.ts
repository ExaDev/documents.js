// Assembles a whole synthetic .doc — a real [MS-CFB] compound file holding a WordDocument stream and a 1Table stream, wired together exactly as [MS-DOC] specifies — from a description of its paragraphs and runs. It exists so the reader can be tested end to end against a file whose every byte was placed from the specification's own field tables, without needing a licensable real-world corpus.
//
// The builder deliberately computes every offset the way a producer would (the piece table's fc from where it actually wrote the text, the bin tables' page numbers from where it actually wrote the FKP pages) rather than restating constants the parser also holds, so the two agree only if both independently match the specification.
//
// Test-support only: excluded from the published dist (tsdown.config.ts drops src/test-support/**), never imported by src/index.ts.

import { FKP_PAGE_SIZE } from "../prop/fkp";
import { PARAGRAPH_MARK, SECTION_MARK } from "../text/special";
import { compoundFile } from "./cfb";
import { buildFib } from "./fib";
import { buildBinTable, buildChpxFkp, buildPapxFkp } from "./fkp";

export interface DocRunSpec {
  readonly text: string;
  /** The Chpx grpprl covering this run, or undefined for a run with no character-formatting exception. */
  readonly grpprl?: readonly number[];
}

export interface DocParagraphSpec {
  readonly runs: readonly DocRunSpec[];
  /** The paragraph style index written into the PapxInFkp's GrpPrlAndIstd. */
  readonly istd?: number;
  /** The Papx grpprl covering this paragraph. */
  readonly grpprl?: readonly number[];
  /** The character that terminates the paragraph; the paragraph mark unless a cell or section mark is wanted. */
  readonly mark?: number;
  /** Marks a `mark: SECTION_MARK` paragraph as a manual page break rather than a section boundary — the identical character, distinguished only by PlcfSed's own CPs, exactly as [MS-DOC]'s PlcfSed.aCP text states ("An end-of-section character (0x0C) which occurs at a CP and which is not the last character in a section specifies a manual page break"): the 0x0C is written into the text but opens no section, so the spec's `sections` array needs no entry for it. Main-document paragraphs only; ignored elsewhere. */
  readonly pageBreak?: boolean;
}

export interface DocStyleSpec {
  readonly name: string;
  readonly sti?: number;
  readonly stk?: number;
  /** The istd this style inherits from — StdfBase.istdBase — or absent for "does not inherit from any other style" (0x0FFF). */
  readonly istdBase?: number;
  /** The style's own UpxPapx.grpprlPapx (StkParaGRLPUPX), written only for stk 1 (paragraph); ignored otherwise. Absent writes an empty grpprlPapx, exactly like a style with no paragraph-formatting exceptions of its own. */
  readonly papxGrpprl?: readonly number[];
  /** The style's own UpxChpx.grpprlChpx (StkParaGRLPUPX/StkCharGRLPUPX), written for stk 1 and 2. Absent writes an empty grpprlChpx. */
  readonly chpxGrpprl?: readonly number[];
}

export interface DocSpec {
  readonly paragraphs: readonly DocParagraphSpec[];
  /** Writes the text as one byte per character rather than as 16-bit code units, exercising the piece table's compressed spelling and its halved offset. */
  readonly compressed?: boolean;
  /** Splits the text across this many pieces rather than one, exercising a logical stream assembled from discontiguous byte ranges. */
  readonly pieces?: number;
  readonly styles?: readonly DocStyleSpec[];
  /** The one section's own Sepx grpprl — absent produces no PlcfSed at all, exercising the reader's own fallback to its page-geometry defaults exactly as a real file with no section properties would. Ignored when `sections` is given. */
  readonly sectionGrpprl?: readonly number[];
  /** Multiple sections' own Sepx grpprls, one per section in document order — overrides `sectionGrpprl`. Section boundaries are derived from where `paragraphs` themselves place a SECTION_MARK terminator (`mark: SECTION_MARK`): this array must carry exactly one more entry than the number of SECTION_MARK-terminated paragraphs NOT marked `pageBreak`, matching [MS-DOC] 2.8.26's own "an end-of-section character MUST be the final character in the text range of all but the last section" — a `pageBreak`-marked 0x000C opens no section, per PlcfSed.aCP's own manual-page-break rule. */
  readonly sections?: readonly (readonly number[])[];
  /** The footnote document's own stories, one per footnote reference in document order — an empty story (`[]`) is a genuinely empty one, per [MS-DOC]'s own "the beginning CP has the same value as the next CP"; a non-empty one gets its own trailing guard paragraph mark appended automatically ("not considered part of the story contents", the Headers page's own words, restated for PlcffndTxt by that structure's own page) unless `bareNoteStories` asks for the no-guard spelling. Absent produces no footnote document at all (ccpFtn 0, no PlcffndTxt). */
  readonly footnotes?: readonly (readonly DocParagraphSpec[])[];
  /** Writes note stories (footnotes/endnotes/comments) WITHOUT the separate trailing guard paragraph — the spelling a real producer writes (confirmed against a LibreOffice-authored .doc: a single-paragraph footnote story ends at its own content paragraph's mark, with the subdocument's one extra trailing mark beyond the last story), where the guard spelling instead ends each story with a second, empty paragraph of its own. Both spellings must read identically, which is exactly what subdocument.ts's endsWithGuardParagraph exists to guarantee. */
  readonly bareNoteStories?: boolean;
  /** The endnote document's own stories — the identical shape and guard-mark handling as `footnotes`, for PlcfendTxt. */
  readonly endnotes?: readonly (readonly DocParagraphSpec[])[];
  /** The comment (annotation) document's own stories — the identical shape and guard-mark handling as `footnotes`, for PlcfandTxt. */
  readonly comments?: readonly (readonly DocParagraphSpec[])[];
  /** The header document's own stories, FLAT and in Plcfhdd's own fixed order: six footnote/endnote-separator stories first (ordinarily `[]`, since no test here needs to assert on separator content), then six per section — evenHeader, oddHeader, evenFooter, oddFooter, firstHeader, firstFooter — repeated once per entry in `sections`/`sectionGrpprl`. Absent produces no header document at all (ccpHdd 0, no Plcfhdd). */
  readonly headerFooterStories?: readonly (readonly DocParagraphSpec[])[];
  /** The container's own "Data" stream bytes, verbatim — absent produces no "Data" stream at all, exercising the reader's own fallback for a document with no pictures. buildInlinePictureBytes builds this stream's own content for an inline-picture test. */
  readonly data?: Uint8Array<ArrayBuffer>;
}

/** Two grpprls are the same exception when both are absent or their bytes match, which is what decides whether adjacent stretches merge into one ChpxFkp run. Exported for this package's own direct tests, since a round trip through readDocContent re-derives its own per-paragraph runs regardless of how many ChpxFkp records the writer actually merged them into — whether two adjacent, identically-formatted stretches became one physical record or two is invisible from the read side alone. */
export function sameGrpprl(
  a: readonly number[] | undefined,
  b: readonly number[] | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

/** Folds a flat run-range sequence into ChpxFkp-ready records, merging any adjacent pair that shares byte-identical formatting (sameGrpprl) into one — the same "one exception over a run of unchanging properties" a real producer writes, per this function's own former inline comment (still true of its behaviour, just no longer attached to a single call site now that it is reused directly by this package's own tests). Exported for those tests: whether two adjacent, identically-formatted stretches became one physical ChpxFkp record or two is invisible to a round trip through readDocContent, which re-derives its own per-paragraph runs regardless. */
export function mergeChpxRuns<
  T extends { start: number; end: number; grpprl?: readonly number[] },
>(runRanges: readonly T[]): T[] {
  const mergedRuns: T[] = [];
  for (const run of runRanges) {
    const previous = mergedRuns[mergedRuns.length - 1];
    if (
      previous?.end === run.start &&
      sameGrpprl(previous.grpprl, run.grpprl)
    ) {
      previous.end = run.end;
      continue;
    }
    mergedRuns.push({ ...run });
  }
  return mergedRuns;
}

/** Which CPs the main document's own paragraphs mark as a manual page break — scoped to `end <= ccpText` so a subdocument's own paragraph (footnote, header/footer, comment, endnote) can never register one, exactly as DocParagraphSpec.pageBreak's own doc comment states ("Main-document paragraphs only; ignored elsewhere"): every subdocument's own paragraphs share this identical accumulator's `paragraphs` array, so nothing else already scopes them out before this function sees them. Exported for this package's own direct tests: a subdocument paragraph that sets `pageBreak` regardless would need a CP coincidence with a real main-document section mark to observe any effect through a full buildDoc round trip. */
export function mainDocumentPageBreakCps(
  paragraphs: readonly { spec: DocParagraphSpec; end: number }[],
  ccpText: number,
): Set<number> {
  const pageBreakCps = new Set<number>();
  for (const { spec: paragraph, end } of paragraphs) {
    if (paragraph.pageBreak === true && end <= ccpText) {
      pageBreakCps.add(end);
    }
  }
  return pageBreakCps;
}

/** `values[index]`, asserted defined — or throws `message`. Exported so each call site's own "this index can never actually be missing" invariant (see each one's own comment) stays directly testable via a genuinely mismatched array/index pair, without needing to fabricate one through buildDoc's own public surface. */
export function requireArrayEntry<T>(
  values: readonly (T | undefined)[],
  index: number,
  message: string,
): T {
  const value = values[index];
  if (value === undefined) throw new Error(message);
  return value;
}

/** The Map equivalent of requireArrayEntry, for buildDoc's own table-offset bookkeeping. */
export function requireMapEntry<T>(
  map: ReadonlyMap<string, T>,
  key: string,
  message: string,
): T {
  const value = map.get(key);
  if (value === undefined) throw new Error(message);
  return value;
}

// Every message below is passed to requireArrayEntry/requireMapEntry at a call site whose own comment explains why that lookup can never actually miss for real input — exported as its own named constant/function, the same discipline table/read.ts's own internal-defect messages follow, so the exact text stays directly testable without needing to fabricate a genuine miss through buildDoc's own public surface.
export const SEPX_OFFSET_MISSING_MESSAGE = "Sepx offset missing";
export const PIECE_BOUNDARY_MISSING_MESSAGE = "piece boundary missing";
export function tablePartOffsetMissingMessage(name: string): string {
  return `table part offset missing for ${name}`;
}

/** Where the text is written in the WordDocument stream: past the FIB, on a page boundary, and even, which the 16-bit spelling requires. Exported for this package's own direct tests. */
export const TEXT_FC = 0x400;

export interface ParagraphAccumulator {
  text: string;
  readonly paragraphs: { spec: DocParagraphSpec; start: number; end: number }[];
  readonly runRanges: {
    start: number;
    end: number;
    grpprl?: readonly number[];
  }[];
}

// Appends `paragraphs`' own text/marks onto a shared accumulator — the logical-text-building step every document-stream range this builder writes shares (the main document, and each footnote/endnote/comment/header-footer story appendSubdocument below writes in turn), so a subdocument's own paragraphs flow into the identical ChpxFkp/PapxFkp/Clx-building machinery the main document already uses rather than a second, parallel implementation. Exported for this package's own direct tests: a paragraph's own trailing-mark-merge logic (below) only ever changes how many ChpxFkp records the writer emits, which a round trip through readDocContent cannot observe (it re-derives its own per-paragraph runs regardless).
export function appendParagraphs(
  acc: ParagraphAccumulator,
  paragraphs: readonly DocParagraphSpec[],
): void {
  for (const paragraph of paragraphs) {
    const paragraphStart = acc.text.length;
    for (const run of paragraph.runs) {
      const runStart = acc.text.length;
      acc.text += run.text;
      if (acc.text.length > runStart) {
        acc.runRanges.push({
          start: runStart,
          end: acc.text.length,
          grpprl: run.grpprl,
        });
      }
    }
    acc.text += String.fromCharCode(paragraph.mark ?? PARAGRAPH_MARK);
    // The mark shares the last run's formatting, which is what a producer writes: extending that run rather than adding an unformatted one keeps the ChpxFkp's ranges contiguous.
    const lastRun = acc.runRanges[acc.runRanges.length - 1];
    if (lastRun?.end === acc.text.length - 1) {
      lastRun.end = acc.text.length;
    } else {
      acc.runRanges.push({ start: acc.text.length - 1, end: acc.text.length });
    }
    acc.paragraphs.push({
      spec: paragraph,
      start: paragraphStart,
      end: acc.text.length,
    });
  }
}

// Appends one document-stream range's own stories onto the accumulator — shared by footnotes/endnotes/comments (each story a plain paragraph list) and headerFooterStories (already flat, one entry per fixed Plcfhdd slot) — and returns that range's own boundary plex keys (PlcffndTxt/PlcfandTxt/PlcfendTxt/Plcfhdd's own aCP), local to the range's own start rather than the whole document, matching what each of those structures states as its own CPs. A non-empty story gets its own trailing guard paragraph mark, [MS-DOC]'s own "not considered part of the story contents" — an empty one (`[]`) gets neither content nor a guard, matching "the beginning CP has the same value as the next CP". `bareStories` skips the guard append, spelling each story as ending at its own final content mark the way a real producer writes note stories (DocSpec.bareNoteStories). Exported for this package's own direct tests: whether a guard paragraph was actually appended changes only the returned keys' own spacing, which buildDoc's own footnote/comment/endnote round-trip tests cannot observe on their own (a guard paragraph's own text is empty either way, so `.text` reads identically whether or not one was appended).
export function appendSubdocument(
  acc: ParagraphAccumulator,
  stories: readonly (readonly DocParagraphSpec[])[],
  bareStories: boolean,
): number[] {
  const subdocStart = acc.text.length;
  const keys: number[] = [0];
  for (const story of stories) {
    if (story.length > 0) {
      appendParagraphs(acc, story);
      if (!bareStories) {
        appendParagraphs(acc, [{ runs: [] }]);
      }
    }
    keys.push(acc.text.length - subdocStart);
  }
  // The trailing "ignored" sentinel every one of these boundary plexes carries — any value works, since this package's own reader (text/paragraphs.ts's splitEntriesByBoundaries via subdocument.ts's readSubdocumentStories) never consults the group it would define.
  keys.push(acc.text.length - subdocStart);
  return keys;
}

export function buildDoc(spec: DocSpec): Uint8Array<ArrayBuffer> {
  const compressed = spec.compressed === true;
  const bytesPerCharacter = compressed ? 1 : 2;

  // 1. The logical text: the main document's own paragraphs, then — in [MS-DOC] 2.4.1's own subdocument order — the footnote, header, comment, and endnote documents, each only when the spec actually wants one.
  const acc: ParagraphAccumulator = { text: "", paragraphs: [], runRanges: [] };
  appendParagraphs(acc, spec.paragraphs);
  const ccpText = acc.text.length;

  const footnoteKeys =
    spec.footnotes === undefined
      ? undefined
      : appendSubdocument(acc, spec.footnotes, spec.bareNoteStories === true);
  const ccpFtn = acc.text.length - ccpText;

  const headerFooterKeys =
    spec.headerFooterStories === undefined
      ? undefined
      : appendSubdocument(acc, spec.headerFooterStories, false);
  const ccpHdd = acc.text.length - ccpText - ccpFtn;

  const commentKeys =
    spec.comments === undefined
      ? undefined
      : appendSubdocument(acc, spec.comments, spec.bareNoteStories === true);
  const ccpAtn = acc.text.length - ccpText - ccpFtn - ccpHdd;

  const endnoteKeys =
    spec.endnotes === undefined
      ? undefined
      : appendSubdocument(acc, spec.endnotes, spec.bareNoteStories === true);
  const ccpEdn = acc.text.length - ccpText - ccpFtn - ccpHdd - ccpAtn;

  const { text, paragraphs, runRanges } = acc;
  const mergedRuns = mergeChpxRuns(runRanges);

  const characterFc = (cp: number): number => TEXT_FC + cp * bytesPerCharacter;
  const textByteLength = text.length * bytesPerCharacter;

  // 2. The WordDocument stream: the FIB at offset zero, the text at TEXT_FC, and the two FKP pages on the next free page boundaries after it.
  const firstFreePage = Math.ceil((TEXT_FC + textByteLength) / FKP_PAGE_SIZE);

  const papxPage = firstFreePage + 1;
  // The Sepx array, when the spec wants one, sits right after the Papx page — not itself an FKP-paged structure, so it needs no page alignment of its own; each section's own Sepx follows the previous one directly.
  const sectionGrpprls: readonly (readonly number[])[] | undefined =
    spec.sections ??
    (spec.sectionGrpprl === undefined ? undefined : [spec.sectionGrpprl]);
  const sepxList = sectionGrpprls?.map(buildSepxBytes);
  const fcSepxStart = (papxPage + 1) * FKP_PAGE_SIZE;
  const sepxOffsets: number[] = [];
  let sepxCursor = fcSepxStart;
  if (sepxList !== undefined) {
    for (const bytes of sepxList) {
      sepxOffsets.push(sepxCursor);
      sepxCursor += bytes.length;
    }
  }
  const wordDocument = new Uint8Array(sepxCursor);
  const wordView = new DataView(wordDocument.buffer);
  Array.from({ length: text.length }).forEach((_, index) => {
    const code = text.charCodeAt(index);
    if (compressed) {
      wordDocument[characterFc(index)] = code & 0xff;
    } else {
      wordView.setUint16(characterFc(index), code, true);
    }
  });

  wordDocument.set(
    buildChpxFkp(
      mergedRuns.map((run) => ({
        fc: characterFc(run.start),
        grpprl: run.grpprl,
      })),
      characterFc(text.length),
    ),
    firstFreePage * FKP_PAGE_SIZE,
  );
  wordDocument.set(
    buildPapxFkp(
      paragraphs.map(({ spec: paragraph, start }) => ({
        fc: characterFc(start),
        istd: paragraph.istd ?? 0,
        grpprl: paragraph.grpprl,
      })),
      characterFc(text.length),
    ),
    papxPage * FKP_PAGE_SIZE,
  );
  if (sepxList !== undefined) {
    sepxList.forEach((bytes, index) => {
      wordDocument.set(
        bytes,
        requireArrayEntry(sepxOffsets, index, SEPX_OFFSET_MISSING_MESSAGE),
      );
    });
  }

  // 3. The Table stream: the Clx, the two bin tables, the style sheet, and (when the spec wants sections) the PlcfSed, each at an offset the FIB then names.
  const clx = buildClx(text.length, spec.pieces ?? 1, compressed, characterFc);
  const plcBteChpx = buildBinTable(
    [TEXT_FC, characterFc(text.length)],
    [firstFreePage],
  );
  const plcBtePapx = buildBinTable(
    [TEXT_FC, characterFc(text.length)],
    [papxPage],
  );
  const stsh = buildStsh(spec.styles ?? []);
  // A section's own start CP is derived from the paragraph stream itself, not stated separately: every SECTION_MARK-terminated paragraph the spec places closes one section and opens the next, mirroring how a real .doc's own end-of-section character marks the boundary PlcfSed.aCp then restates as a CP — EXCEPT a paragraph the spec marks `pageBreak`, whose 0x000C is a manual page break instead (no PlcfSed boundary lands after it), the distinction [MS-DOC]'s own PlcfSed.aCP text draws between the two spellings of the identical character. Scanned only over the main document's own range: SECTION_MARK is a main-document-only construct, and a subdocument's own text could otherwise coincidentally contain the identical byte value with no section meaning at all.
  const sectionStartCps = [0];
  const pageBreakCps = mainDocumentPageBreakCps(paragraphs, ccpText);
  for (let index = 0; index < ccpText; index += 1) {
    if (
      text.charCodeAt(index) === SECTION_MARK &&
      !pageBreakCps.has(index + 1)
    ) {
      sectionStartCps.push(index + 1);
    }
  }
  const plcfSed =
    sepxList === undefined
      ? undefined
      : buildPlcfSedBytes(sectionStartCps, ccpText, sepxOffsets);
  const plcffndTxt =
    footnoteKeys === undefined ? undefined : buildPlcBytes(footnoteKeys);
  const plcfHdd =
    headerFooterKeys === undefined
      ? undefined
      : buildPlcBytes(headerFooterKeys);
  const plcfandTxt =
    commentKeys === undefined ? undefined : buildPlcBytes(commentKeys);
  const plcfendTxt =
    endnoteKeys === undefined ? undefined : buildPlcBytes(endnoteKeys);

  // Named rather than positional: several parts are conditionally present (plcfSed/plcffndTxt/plcfHdd/plcfandTxt/plcfendTxt), so a fixed numeric index would silently point at the wrong part the moment one spec includes some of these and not others.
  const namedParts: Record<string, Uint8Array> = {
    clx,
    plcBteChpx,
    plcBtePapx,
    stsh,
    ...(plcfSed === undefined ? {} : { plcfSed }),
    ...(plcffndTxt === undefined ? {} : { plcffndTxt }),
    ...(plcfHdd === undefined ? {} : { plcfHdd }),
    ...(plcfandTxt === undefined ? {} : { plcfandTxt }),
    ...(plcfendTxt === undefined ? {} : { plcfendTxt }),
  };
  const tableOffsets = new Map<string, number>();
  let tableLength = 0;
  for (const [name, bytes] of Object.entries(namedParts)) {
    tableOffsets.set(name, tableLength);
    tableLength += bytes.length;
  }
  const table = new Uint8Array(tableLength);
  for (const [name, bytes] of Object.entries(namedParts)) {
    table.set(
      bytes,
      requireMapEntry(tableOffsets, name, tablePartOffsetMissingMessage(name)),
    );
  }
  const offsetOf = (name: string): number =>
    requireMapEntry(tableOffsets, name, tablePartOffsetMissingMessage(name));

  const fib = buildFib({
    ccpText,
    ccpFtn,
    ccpHdd,
    ccpAtn,
    ccpEdn,
    cbMac: wordDocument.length,
    fWhichTblStm: 1,
    fcClx: offsetOf("clx"),
    lcbClx: clx.length,
    fcPlcfBteChpx: offsetOf("plcBteChpx"),
    lcbPlcfBteChpx: plcBteChpx.length,
    fcPlcfBtePapx: offsetOf("plcBtePapx"),
    lcbPlcfBtePapx: plcBtePapx.length,
    fcStshf: offsetOf("stsh"),
    lcbStshf: stsh.length,
    ...(plcfSed === undefined
      ? {}
      : { fcPlcfSed: offsetOf("plcfSed"), lcbPlcfSed: plcfSed.length }),
    ...(plcffndTxt === undefined
      ? {}
      : {
          fcPlcffndTxt: offsetOf("plcffndTxt"),
          lcbPlcffndTxt: plcffndTxt.length,
        }),
    ...(plcfHdd === undefined
      ? {}
      : { fcPlcfHdd: offsetOf("plcfHdd"), lcbPlcfHdd: plcfHdd.length }),
    ...(plcfandTxt === undefined
      ? {}
      : {
          fcPlcfandTxt: offsetOf("plcfandTxt"),
          lcbPlcfandTxt: plcfandTxt.length,
        }),
    ...(plcfendTxt === undefined
      ? {}
      : {
          fcPlcfendTxt: offsetOf("plcfendTxt"),
          lcbPlcfendTxt: plcfendTxt.length,
        }),
  });
  wordDocument.set(fib, 0);

  return compoundFile([
    { path: "WordDocument", bytes: wordDocument },
    { path: "1Table", bytes: table },
    ...dataStreamParts(spec.data),
  ]);
}

/** The extra "Data" stream part compoundFile should receive — none when `data` is absent, one entry otherwise. Extracted so this exact decision is directly testable: compoundFile's own stream/storage distinction (a node's `stream` property, set from `entry.bytes`) treats a stream entry given `undefined` bytes identically to no entry at all — it stores as an empty storage rather than a stream, so readCompoundFile/readDocStreams find nothing named "Data" either way — meaning a round trip through readDocContent can never distinguish this decision's own two branches when `data` is genuinely absent; only this function's own return value can. */
export function dataStreamParts(
  data: Uint8Array<ArrayBuffer> | undefined,
): readonly {
  readonly path: string;
  readonly bytes: Uint8Array<ArrayBuffer>;
}[] {
  return data === undefined ? [] : [{ path: "Data", bytes: data }];
}

// Sepx, [MS-DOC] 2.9.279: a 2-byte cb (grpprl's own length) followed by the grpprl itself. Built independently of prop/sep-write.ts's own buildSepx, for the same reason the sprm byte sequences at the top of read.test.ts are hand-encoded rather than built through prop/sep-write.ts's encodeSectionGrpprl: a fixture sharing code with the module under test would let a bug in one hide behind the same bug in the other.
function buildSepxBytes(grpprl: readonly number[]): Uint8Array {
  return new Uint8Array([
    grpprl.length & 0xff,
    (grpprl.length >> 8) & 0xff,
    ...grpprl,
  ]);
}

// A PlcfSed for `startCps.length` sections: startCps (each section's own PlcfSed.aCp[i], per [MS-DOC] 2.8.26 "the beginning of a range of text ... that constitutes a section") plus a trailing ccpText — the "last CP does not begin a new section" terminator — bracketing one 12-byte Sed ([MS-DOC] 2.9.269) per section, each naming where buildSepxBytes' own bytes for that section were placed in the WordDocument stream. Exported for this package's own direct tests. sed.fn/fnMpr/fcMpr's own littleEndian argument is omitted, not merely `false`: every one of those three fields writes a byte-order-symmetric constant (0x0000, or 0xffffffff — all bytes identical), so which endianness DataView is told to use can never change the bytes actually produced.
export function buildPlcfSedBytes(
  startCps: readonly number[],
  ccpText: number,
  fcSepxList: readonly number[],
): Uint8Array {
  if (startCps.length !== fcSepxList.length) {
    throw new Error(
      `buildPlcfSedBytes was given ${startCps.length} section start CPs but ${fcSepxList.length} Sepx offsets — these must be the same length`,
    );
  }
  const keys = [...startCps, ccpText];
  const keyBytes = keys.length * 4;
  const bytes = new Uint8Array(keyBytes + fcSepxList.length * 12);
  const view = new DataView(bytes.buffer);
  keys.forEach((cp, index) => {
    view.setUint32(index * 4, cp, true);
  });
  fcSepxList.forEach((fcSepx, index) => {
    const base = keyBytes + index * 12;
    // sed.fn (base + 0) is left as `bytes`' own zero-initialised default — ignored, and writing a literal 0 over it would be a no-op regardless.
    view.setUint32(base + 2, fcSepx, true); // sed.fcSepx.
    view.setUint16(base + 6, 0); // sed.fnMpr — ignored.
    view.setUint32(base + 8, 0xffffffff); // sed.fcMpr — ignored.
  });
  return bytes;
}

/** One inline picture's own PICFAndOfficeArtData bytes, [MS-DOC]'s "Pictures" and [MS-ODRAW] 2.2.15/2.2.28 — a 68-byte PICF (mm=MM_SHAPE, so no cchPicName/stPicName pair; dxaGoal/dyaGoal the picture's own initial size in twips, mx/my 1000 for "no scaling"), an empty OfficeArtSpContainer (an 8-byte record header alone, recLen 0 — this reader never looks inside it), then a single-UID OfficeArtBlipPNG record wrapping `pngBytes` verbatim. Returns the whole byte sequence to place at some offset in a "Data" stream, and the sprmCPicLocation operand bytes (a 4-byte little-endian signed offset) a run's own grpprl states to point at it. */
export function buildInlinePictureBytes(
  picLocation: number,
  pngBytes: Uint8Array,
  dxaGoalTwips: number,
  dyaGoalTwips: number,
): {
  readonly dataStreamBytes: Uint8Array<ArrayBuffer>;
  readonly picLocationGrpprl: number[];
} {
  const picf = new Uint8Array(68);
  const picfView = new DataView(picf.buffer);
  picfView.setUint16(6, 0x0064, true); // mfpf.mm: MM_SHAPE.
  picfView.setInt16(28, dxaGoalTwips, true); // picmid.dxaGoal.
  picfView.setInt16(30, dyaGoalTwips, true); // picmid.dyaGoal.
  picfView.setUint16(32, 1000, true); // picmid.mx: no scaling.
  picfView.setUint16(34, 1000, true); // picmid.my: no scaling.

  const shapeHeader = recordHeaderBytes(0xf004, 0);
  // The blip's own UID: a placeholder, never read back by this package's own reader (findBlipRecord locates the blip by its own record header alone), so it stays the zero bytes `out` already starts with — only its length is ever consulted, to size `out` and the blip header's own recLen below.
  const uidLength = 16;
  const blipHeader = recordHeaderBytes(
    0xf01e,
    0x06e0,
    uidLength + 1 + pngBytes.length,
  );

  // `picLocation` bytes of leading pad precede PICF in the "Data" stream — content this package's own reader never inspects (it locates PICF at exactly `picLocation` and reads forward from there), so `out`'s own zero-initialised bytes already match it with no write of their own needed.
  const out = new Uint8Array(
    picLocation +
      picf.length +
      shapeHeader.length +
      blipHeader.length +
      uidLength +
      1 +
      pngBytes.length,
  );
  let cursor = picLocation;
  out.set(picf, cursor);
  cursor += picf.length;
  out.set(shapeHeader, cursor);
  cursor += shapeHeader.length;
  out.set(blipHeader, cursor);
  cursor += blipHeader.length;
  cursor += uidLength; // The UID's own bytes, left as `out`'s existing zeros — see its own declaration above.
  out[cursor] = 0xff; // tag.
  cursor += 1;
  out.set(pngBytes, cursor);

  const picLocationGrpprl: number[] = [0x03, 0x6a]; // sprmCPicLocation, little-endian.
  const operand = new Int32Array([picLocation]);
  const operandBytes = new Uint8Array(operand.buffer);
  picLocationGrpprl.push(...operandBytes);

  return { dataStreamBytes: out, picLocationGrpprl };
}

// [MS-ODRAW] 2.2.1's OfficeArtRecordHeader — the 8-byte version/instance/type/length header shared by every OfficeArt record, including the ones this fixture doesn't otherwise model (recVer is fixed at 0xF for a container, arbitrary/ignored for an atom, since this package's own reader never checks it). Exported for this package's own direct tests: findBlipRecord's own forward scan for a validated blip is robust enough to find the real blip regardless of what precedes it (see buildInlinePictureBytes' own note), so asserting only on readInlinePicture's own final result can never confirm this header's own bytes were actually written where intended.
export function recordHeaderBytes(
  recType: number,
  recInstance: number,
  recLen = 0,
): Uint8Array {
  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer);
  const recVer = 0x0;
  view.setUint16(0, recVer | (recInstance << 4), true);
  view.setUint16(2, recType, true);
  view.setUint32(4, recLen, true);
  return bytes;
}

// A CP-only PLC — PlcffndTxt/PlcfandTxt/PlcfendTxt/Plcfhdd's own shape, [MS-DOC]'s own "a PLC that contains only CPs and no additional data": just the aCP array itself, one 4-byte little-endian value per key, no data section at all (element size 0, so parsePlc's own count = keys.length - 1 falls straight out of the byte length alone).
export function buildPlcBytes(keys: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(keys.length * 4);
  const view = new DataView(bytes.buffer);
  keys.forEach((key, index) => {
    view.setUint32(index * 4, key, true);
  });
  return bytes;
}

/** A `characterCount`-length text's own boundary CPs when split into `pieceCount` pieces of as-equal length as divides — 0, `characterCount` itself, and every `Math.floor((characterCount*(position+1))/pieceCount)` boundary in between (`pieceCount - 1` of them), deduplicated. Exported for this package's own direct tests: how many pieces a Clx actually splits into is invisible to a round trip through readDocContent, which reassembles them into one string regardless of how many there were (buildDoc's own `pieces` tests only ever assert on that reassembled text). The middle boundaries are generated from an array length rather than a hand-written loop bound deliberately: the position that a hand-written `< pieceCount` bound would exclude and an off-by-one `<= pieceCount` would wrongly include both compute to exactly `characterCount` at `position === pieceCount - 1` — the identical value the trailing `characterCount` already supplies — so the two are absorbed into the same Set entry regardless, and no test built on this function's own return value could ever tell that specific off-by-one apart. Its own boundaries need no explicit sort: `position` only ever increases, and `Math.floor` preserves that monotonicity, so `[0, ...middles, characterCount]` is already non-decreasing before `Set` dedup (which itself preserves insertion order) ever runs. */
export function pieceBoundaries(
  characterCount: number,
  pieceCount: number,
): number[] {
  const middles = Array.from({ length: pieceCount - 1 }, (_, position) =>
    Math.floor((characterCount * (position + 1)) / pieceCount),
  );
  return [...new Set([0, ...middles, characterCount])];
}

// A Clx with no Prc array (so its first byte is the Pcdt's own 0x02) and a PlcPcd splitting the text into `pieceCount` pieces of as-equal length as divides.
function buildClx(
  characterCount: number,
  pieceCount: number,
  compressed: boolean,
  characterFc: (cp: number) => number,
): Uint8Array {
  const cps = pieceBoundaries(characterCount, pieceCount);

  const plc: number[] = [];
  const push32 = (value: number): void => {
    plc.push(
      value & 0xff,
      (value >> 8) & 0xff,
      (value >> 16) & 0xff,
      (value >>> 24) & 0xff,
    );
  };
  for (const cp of cps) push32(cp);
  for (let index = 0; index < cps.length - 1; index += 1) {
    const cp = requireArrayEntry(cps, index, PIECE_BOUNDARY_MISSING_MESSAGE);
    // FcCompressed stores a compressed piece's offset doubled, since the reader halves it: "the text starts at offset fc/2".
    const fc = compressed ? characterFc(cp) * 2 : characterFc(cp);
    plc.push(0, 0); // The Pcd bit field: no fNoParaLast, no fDirty.
    push32((fc >>> 0) | (compressed ? 0x40000000 : 0));
    plc.push(0, 0); // Prm: no additional property modifications.
  }

  return new Uint8Array([
    0x02,
    plc.length & 0xff,
    (plc.length >> 8) & 0xff,
    (plc.length >> 16) & 0xff,
    (plc.length >>> 24) & 0xff,
    ...plc,
  ]);
}

// An STSH whose STSHI carries the full header a real producer writes — Stshif, ftcBi, and the latent-style data — so the reader's use of cbStshi to skip forward is genuinely exercised rather than trivially satisfied by a header that happens to be exactly Stshif. Exported for this package's own direct tests: cbStshi's own exact byte count, and the STSHI's latent-style array specifically, are never independently checked by anything downstream (the reader skips forward by cbStshi wholesale, without validating what it actually skipped past), so a round trip through readDocContent cannot tell a correctly-sized STSHI apart from a wrongly-sized one that still happens to parse.
export function buildStsh(styles: readonly DocStyleSpec[]): Uint8Array {
  const stiMax = styles.length;
  const stshiBytes: number[] = [];
  const push16 = (value: number): void => {
    stshiBytes.push(value & 0xff, (value >> 8) & 0xff);
  };
  push16(styles.length); // cstd
  push16(0x000a); // cbSTDBaseInFile: an Stdf of StdfBase alone.
  push16(0x0001); // fStdStylenamesWritten, which MUST be 1.
  push16(stiMax); // stiMaxWhenSaved
  push16(0x000f); // istdMaxFixedWhenSaved, which MUST be 0x000F.
  push16(0x0000); // nVerBuiltInNamesWhenSaved
  push16(0x0000); // ftcAsci
  push16(0x0000); // ftcFE
  push16(0x0000); // ftcOther
  push16(0x0000); // ftcBi
  push16(0x0004); // StshiLsd.cbLSD, which MUST be 4.
  for (let index = 0; index < stiMax; index += 1) {
    push16(0x0000);
    push16(0x0000);
  }

  const out: number[] = [
    stshiBytes.length & 0xff,
    (stshiBytes.length >> 8) & 0xff,
    ...stshiBytes,
  ];
  // One LPUpxPapx/LPUpxChpx entry: a 2-byte cbUpx (the payload's own length, excluding padding) followed by the payload, followed by one zero pad byte if that length is odd — [MS-DOC] 2.9.140/2.9.138's own "padded to an even length, but the length in cbUpx MUST NOT include this padding".
  const pushLpUpx = (target: number[], payload: readonly number[]): void => {
    target.push(
      payload.length & 0xff,
      (payload.length >> 8) & 0xff,
      ...payload,
    );
    if (payload.length % 2 === 1) target.push(0);
  };

  styles.forEach((style, istd) => {
    const std: number[] = [];
    const stk = style.stk ?? 1;
    const istdBase = style.istdBase ?? 0x0fff;
    const word0 = (style.sti ?? istd) & 0x0fff;
    const word1 = (stk & 0x000f) | ((istdBase & 0x0fff) << 4);
    std.push(word0 & 0xff, (word0 >> 8) & 0xff);
    std.push(word1 & 0xff, (word1 >> 8) & 0xff);
    std.push(0, 0); // cupx and istdNext.
    std.push(0, 0); // bchUpe.
    std.push(0, 0); // grfstd.
    // xstzName: an Xst (a character count then that many 16-bit code units) followed by a 2-byte null terminator.
    std.push(style.name.length & 0xff, (style.name.length >> 8) & 0xff);
    for (const character of style.name) {
      const code = character.charCodeAt(0);
      std.push(code & 0xff, (code >> 8) & 0xff);
    }
    std.push(0, 0);
    // grLPUpxSw, [MS-DOC] 2.9.113: StkParaGRLPUPX (lpUpxPapx then lpUpxChpx) for a paragraph style, StkCharGRLPUPX (lpUpxChpx alone) for a character style — every real producer writes these regardless of whether the style itself carries any exceptions, so the fixture always does too, matching a real .doc's own STSH shape rather than the pre-#1005 fixture's own omission of grLPUpxSw entirely.
    if (stk === 1) {
      // UpxPapx: a 2-byte istd ("MUST be equal to the current style") then grpprlPapx.
      pushLpUpx(std, [
        istd & 0xff,
        (istd >> 8) & 0xff,
        ...(style.papxGrpprl ?? []),
      ]);
      pushLpUpx(std, [...(style.chpxGrpprl ?? [])]);
    } else if (stk === 2) {
      pushLpUpx(std, [...(style.chpxGrpprl ?? [])]);
    }
    out.push(std.length & 0xff, (std.length >> 8) & 0xff, ...std);
    // "LPStd structures are stored on even-byte boundaries, but this length MUST NOT include this padding." No padding byte is ever needed here, though: std's own fixed fields before grLPUpxSw always contribute an even byte count (10 fixed bytes, plus xstzName's own 4 + 2*name.length, itself always even), and pushLpUpx's own cbUpx-plus-payload-plus-conditional-pad is by construction always even too — so std.length is always even, for every style this fixture can produce, regardless of stk or grpprl content.
  });
  return new Uint8Array(out);
}
