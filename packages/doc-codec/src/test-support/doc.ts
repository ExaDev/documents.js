// Assembles a whole synthetic .doc -- a real [MS-CFB] compound file holding a WordDocument stream and a 1Table stream, wired together exactly as [MS-DOC] specifies -- from a description of its paragraphs and runs. It exists so the reader can be tested end to end against a file whose every byte was placed from the specification's own field tables, without needing a licensable real-world corpus.
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
}

export interface DocStyleSpec {
  readonly name: string;
  readonly sti?: number;
  readonly stk?: number;
  /** The istd this style inherits from -- StdfBase.istdBase -- or absent for "does not inherit from any other style" (0x0FFF). */
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
  /** The one section's own Sepx grpprl -- absent produces no PlcfSed at all, exercising the reader's own fallback to its page-geometry defaults exactly as a real file with no section properties would. Ignored when `sections` is given. */
  readonly sectionGrpprl?: readonly number[];
  /** Multiple sections' own Sepx grpprls, one per section in document order -- overrides `sectionGrpprl`. Section boundaries are derived from where `paragraphs` themselves place a SECTION_MARK terminator (`mark: SECTION_MARK`): this array must carry exactly one more entry than the number of SECTION_MARK-terminated paragraphs, matching [MS-DOC] 2.8.26's own "an end-of-section character MUST be the final character in the text range of all but the last section". */
  readonly sections?: readonly (readonly number[])[];
  /** The footnote document's own stories, one per footnote reference in document order -- an empty story (`[]`) is a genuinely empty one, per [MS-DOC]'s own "the beginning CP has the same value as the next CP"; a non-empty one gets its own trailing guard paragraph mark appended automatically ("not considered part of the story contents", the Headers page's own words, restated for PlcffndTxt by that structure's own page). Absent produces no footnote document at all (ccpFtn 0, no PlcffndTxt). */
  readonly footnotes?: readonly (readonly DocParagraphSpec[])[];
  /** The endnote document's own stories -- the identical shape and guard-mark handling as `footnotes`, for PlcfendTxt. */
  readonly endnotes?: readonly (readonly DocParagraphSpec[])[];
  /** The comment (annotation) document's own stories -- the identical shape and guard-mark handling as `footnotes`, for PlcfandTxt. */
  readonly comments?: readonly (readonly DocParagraphSpec[])[];
  /** The header document's own stories, FLAT and in Plcfhdd's own fixed order: six footnote/endnote-separator stories first (ordinarily `[]`, since no test here needs to assert on separator content), then six per section -- evenHeader, oddHeader, evenFooter, oddFooter, firstHeader, firstFooter -- repeated once per entry in `sections`/`sectionGrpprl`. Absent produces no header document at all (ccpHdd 0, no Plcfhdd). */
  readonly headerFooterStories?: readonly (readonly DocParagraphSpec[])[];
}

// Two grpprls are the same exception when both are absent or their bytes match, which is what decides whether adjacent stretches merge into one ChpxFkp run.
function sameGrpprl(
  a: readonly number[] | undefined,
  b: readonly number[] | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

/** Where the text is written in the WordDocument stream: past the FIB, on a page boundary, and even, which the 16-bit spelling requires. */
const TEXT_FC = 0x400;

interface ParagraphAccumulator {
  text: string;
  readonly paragraphs: { spec: DocParagraphSpec; start: number; end: number }[];
  readonly runRanges: {
    start: number;
    end: number;
    grpprl?: readonly number[];
  }[];
}

// Appends `paragraphs`' own text/marks onto a shared accumulator -- the logical-text-building step every document-stream range this builder writes shares (the main document, and each footnote/endnote/comment/header-footer story appendSubdocument below writes in turn), so a subdocument's own paragraphs flow into the identical ChpxFkp/PapxFkp/Clx-building machinery the main document already uses rather than a second, parallel implementation.
function appendParagraphs(
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
          ...(run.grpprl === undefined ? {} : { grpprl: run.grpprl }),
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

// Appends one document-stream range's own stories onto the accumulator -- shared by footnotes/endnotes/comments (each story a plain paragraph list) and headerFooterStories (already flat, one entry per fixed Plcfhdd slot) -- and returns that range's own boundary plex keys (PlcffndTxt/PlcfandTxt/PlcfendTxt/Plcfhdd's own aCP), local to the range's own start rather than the whole document, matching what each of those structures states as its own CPs. A non-empty story gets its own trailing guard paragraph mark, [MS-DOC]'s own "not considered part of the story contents" -- an empty one (`[]`) gets neither content nor a guard, matching "the beginning CP has the same value as the next CP".
function appendSubdocument(
  acc: ParagraphAccumulator,
  stories: readonly (readonly DocParagraphSpec[])[],
): number[] {
  const subdocStart = acc.text.length;
  const keys: number[] = [0];
  for (const story of stories) {
    if (story.length > 0) {
      appendParagraphs(acc, story);
      appendParagraphs(acc, [{ runs: [] }]);
    }
    keys.push(acc.text.length - subdocStart);
  }
  // The trailing "ignored" sentinel every one of these boundary plexes carries -- any value works, since this package's own reader (text/paragraphs.ts's splitEntriesByBoundaries via subdocument.ts's readSubdocumentStories) never consults the group it would define.
  keys.push(acc.text.length - subdocStart);
  return keys;
}

export function buildDoc(spec: DocSpec): Uint8Array<ArrayBuffer> {
  const compressed = spec.compressed === true;
  const bytesPerCharacter = compressed ? 1 : 2;

  // 1. The logical text: the main document's own paragraphs, then -- in [MS-DOC] 2.4.1's own subdocument order -- the footnote, header, comment, and endnote documents, each only when the spec actually wants one.
  const acc: ParagraphAccumulator = { text: "", paragraphs: [], runRanges: [] };
  appendParagraphs(acc, spec.paragraphs);
  const ccpText = acc.text.length;

  const footnoteKeys =
    spec.footnotes === undefined
      ? undefined
      : appendSubdocument(acc, spec.footnotes);
  const ccpFtn = acc.text.length - ccpText;

  const headerFooterKeys =
    spec.headerFooterStories === undefined
      ? undefined
      : appendSubdocument(acc, spec.headerFooterStories);
  const ccpHdd = acc.text.length - ccpText - ccpFtn;

  const commentKeys =
    spec.comments === undefined
      ? undefined
      : appendSubdocument(acc, spec.comments);
  const ccpAtn = acc.text.length - ccpText - ccpFtn - ccpHdd;

  const endnoteKeys =
    spec.endnotes === undefined
      ? undefined
      : appendSubdocument(acc, spec.endnotes);
  const ccpEdn = acc.text.length - ccpText - ccpFtn - ccpHdd - ccpAtn;

  const { text, paragraphs, runRanges } = acc;

  // Adjacent stretches with identical formatting become ONE ChpxFkp run, which is what a real producer writes: the format stores formatting as exceptions over runs of unchanging properties, not one entry per authored span. It matters for what the reader is exercised against, because the resulting run routinely spans paragraph boundaries -- two consecutive bold paragraphs are one Chpx covering both, including the paragraph mark between them -- so the reader has to split runs by paragraph itself rather than inheriting the split from the formatting table.
  const mergedRuns: typeof runRanges = [];
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

  const characterFc = (cp: number): number => TEXT_FC + cp * bytesPerCharacter;
  const textByteLength = text.length * bytesPerCharacter;

  // 2. The WordDocument stream: the FIB at offset zero, the text at TEXT_FC, and the two FKP pages on the next free page boundaries after it.
  const firstFreePage = Math.ceil((TEXT_FC + textByteLength) / FKP_PAGE_SIZE);

  const papxPage = firstFreePage + 1;
  // The Sepx array, when the spec wants one, sits right after the Papx page -- not itself an FKP-paged structure, so it needs no page alignment of its own; each section's own Sepx follows the previous one directly.
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
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (compressed) {
      wordDocument[characterFc(index)] = code & 0xff;
    } else {
      wordView.setUint16(characterFc(index), code, true);
    }
  }

  wordDocument.set(
    buildChpxFkp(
      mergedRuns.map((run) => ({
        fc: characterFc(run.start),
        ...(run.grpprl === undefined ? {} : { grpprl: run.grpprl }),
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
        ...(paragraph.grpprl === undefined ? {} : { grpprl: paragraph.grpprl }),
      })),
      characterFc(text.length),
    ),
    papxPage * FKP_PAGE_SIZE,
  );
  if (sepxList !== undefined) {
    sepxList.forEach((bytes, index) => {
      const offset = sepxOffsets[index];
      if (offset === undefined) throw new Error("Sepx offset missing");
      wordDocument.set(bytes, offset);
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
  // A section's own start CP is derived from the paragraph stream itself, not stated separately: every SECTION_MARK-terminated paragraph the spec places closes one section and opens the next, mirroring how a real .doc's own end-of-section character marks the boundary PlcfSed.aCp then restates as a CP. Scanned only over the main document's own range: SECTION_MARK is a main-document-only construct, and a subdocument's own text could otherwise coincidentally contain the identical byte value with no section meaning at all.
  const sectionStartCps = [0];
  for (let index = 0; index < ccpText; index += 1) {
    if (text.charCodeAt(index) === SECTION_MARK) {
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
    const offset = tableOffsets.get(name);
    if (offset === undefined)
      throw new Error(`table part offset missing for ${name}`);
    table.set(bytes, offset);
  }
  const offsetOf = (name: string): number => {
    const offset = tableOffsets.get(name);
    if (offset === undefined)
      throw new Error(`table part offset missing for ${name}`);
    return offset;
  };

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
  ]);
}

// Sepx, [MS-DOC] 2.9.279: a 2-byte cb (grpprl's own length) followed by the grpprl itself. Built independently of prop/sep-write.ts's own buildSepx, for the same reason the sprm byte sequences at the top of read.test.ts are hand-encoded rather than built through prop/sep-write.ts's encodeSectionGrpprl: a fixture sharing code with the module under test would let a bug in one hide behind the same bug in the other.
function buildSepxBytes(grpprl: readonly number[]): Uint8Array {
  return new Uint8Array([
    grpprl.length & 0xff,
    (grpprl.length >> 8) & 0xff,
    ...grpprl,
  ]);
}

// A PlcfSed for `startCps.length` sections: startCps (each section's own PlcfSed.aCp[i], per [MS-DOC] 2.8.26 "the beginning of a range of text ... that constitutes a section") plus a trailing ccpText -- the "last CP does not begin a new section" terminator -- bracketing one 12-byte Sed ([MS-DOC] 2.9.269) per section, each naming where buildSepxBytes' own bytes for that section were placed in the WordDocument stream.
function buildPlcfSedBytes(
  startCps: readonly number[],
  ccpText: number,
  fcSepxList: readonly number[],
): Uint8Array {
  if (startCps.length !== fcSepxList.length) {
    throw new Error(
      `buildPlcfSedBytes was given ${startCps.length} section start CPs but ${fcSepxList.length} Sepx offsets -- these must be the same length`,
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
    view.setUint16(base, 0, true); // sed.fn -- ignored.
    view.setUint32(base + 2, fcSepx, true); // sed.fcSepx.
    view.setUint16(base + 6, 0, true); // sed.fnMpr -- ignored.
    view.setUint32(base + 8, 0xffffffff, true); // sed.fcMpr -- ignored.
  });
  return bytes;
}

// A CP-only PLC -- PlcffndTxt/PlcfandTxt/PlcfendTxt/Plcfhdd's own shape, [MS-DOC]'s own "a PLC that contains only CPs and no additional data": just the aCP array itself, one 4-byte little-endian value per key, no data section at all (element size 0, so parsePlc's own count = keys.length - 1 falls straight out of the byte length alone).
function buildPlcBytes(keys: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(keys.length * 4);
  const view = new DataView(bytes.buffer);
  keys.forEach((key, index) => {
    view.setUint32(index * 4, key, true);
  });
  return bytes;
}

// A Clx with no Prc array (so its first byte is the Pcdt's own 0x02) and a PlcPcd splitting the text into `pieceCount` pieces of as-equal length as divides.
function buildClx(
  characterCount: number,
  pieceCount: number,
  compressed: boolean,
  characterFc: (cp: number) => number,
): Uint8Array {
  const boundaries: number[] = [0];
  for (let index = 1; index < pieceCount; index += 1) {
    boundaries.push(Math.floor((characterCount * index) / pieceCount));
  }
  boundaries.push(characterCount);
  const cps = [...new Set(boundaries)].sort((a, b) => a - b);

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
    const cp = cps[index];
    if (cp === undefined) throw new Error("piece boundary missing");
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

// An STSH whose STSHI carries the full header a real producer writes -- Stshif, ftcBi, and the latent-style data -- so the reader's use of cbStshi to skip forward is genuinely exercised rather than trivially satisfied by a header that happens to be exactly Stshif.
function buildStsh(styles: readonly DocStyleSpec[]): Uint8Array {
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
  // One LPUpxPapx/LPUpxChpx entry: a 2-byte cbUpx (the payload's own length, excluding padding) followed by the payload, followed by one zero pad byte if that length is odd -- [MS-DOC] 2.9.140/2.9.138's own "padded to an even length, but the length in cbUpx MUST NOT include this padding".
  const pushLpUpx = (out: number[], payload: readonly number[]): void => {
    out.push(payload.length & 0xff, (payload.length >> 8) & 0xff, ...payload);
    if (payload.length % 2 === 1) out.push(0);
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
    // grLPUpxSw, [MS-DOC] 2.9.113: StkParaGRLPUPX (lpUpxPapx then lpUpxChpx) for a paragraph style, StkCharGRLPUPX (lpUpxChpx alone) for a character style -- every real producer writes these regardless of whether the style itself carries any exceptions, so the fixture always does too, matching a real .doc's own STSH shape rather than the pre-#1005 fixture's own omission of grLPUpxSw entirely.
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
    // "LPStd structures are stored on even-byte boundaries, but this length MUST NOT include this padding."
    if (std.length % 2 === 1) out.push(0);
  });
  return new Uint8Array(out);
}
