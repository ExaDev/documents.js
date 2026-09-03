// Assembles a whole synthetic .doc -- a real [MS-CFB] compound file holding a WordDocument stream and a 1Table stream, wired together exactly as [MS-DOC] specifies -- from a description of its paragraphs and runs. It exists so the reader can be tested end to end against a file whose every byte was placed from the specification's own field tables, without needing a licensable real-world corpus.
//
// The builder deliberately computes every offset the way a producer would (the piece table's fc from where it actually wrote the text, the bin tables' page numbers from where it actually wrote the FKP pages) rather than restating constants the parser also holds, so the two agree only if both independently match the specification.
//
// Test-support only: excluded from the published dist (tsdown.config.ts drops src/test-support/**), never imported by src/index.ts.

import { FKP_PAGE_SIZE } from "../prop/fkp";
import { PARAGRAPH_MARK } from "../text/special";
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
}

export interface DocSpec {
  readonly paragraphs: readonly DocParagraphSpec[];
  /** Writes the text as one byte per character rather than as 16-bit code units, exercising the piece table's compressed spelling and its halved offset. */
  readonly compressed?: boolean;
  /** Splits the text across this many pieces rather than one, exercising a logical stream assembled from discontiguous byte ranges. */
  readonly pieces?: number;
  readonly styles?: readonly DocStyleSpec[];
}

/** Where the text is written in the WordDocument stream: past the FIB, on a page boundary, and even, which the 16-bit spelling requires. */
const TEXT_FC = 0x400;

export function buildDoc(spec: DocSpec): Uint8Array<ArrayBuffer> {
  const compressed = spec.compressed === true;
  const bytesPerCharacter = compressed ? 1 : 2;

  // 1. The logical text: every run's characters in order, each paragraph closed by its own mark.
  let text = "";
  const paragraphRanges: { start: number; end: number }[] = [];
  const runRanges: {
    start: number;
    end: number;
    grpprl?: readonly number[];
  }[] = [];
  for (const paragraph of spec.paragraphs) {
    const paragraphStart = text.length;
    for (const run of paragraph.runs) {
      const runStart = text.length;
      text += run.text;
      if (text.length > runStart) {
        runRanges.push({
          start: runStart,
          end: text.length,
          ...(run.grpprl === undefined ? {} : { grpprl: run.grpprl }),
        });
      }
    }
    text += String.fromCharCode(paragraph.mark ?? PARAGRAPH_MARK);
    // The mark shares the last run's formatting, which is what a producer writes: extending that run rather than adding an unformatted one keeps the ChpxFkp's ranges contiguous.
    const lastRun = runRanges[runRanges.length - 1];
    if (lastRun?.end === text.length - 1) {
      lastRun.end = text.length;
    } else {
      runRanges.push({ start: text.length - 1, end: text.length });
    }
    paragraphRanges.push({ start: paragraphStart, end: text.length });
  }

  const characterFc = (cp: number): number => TEXT_FC + cp * bytesPerCharacter;
  const textByteLength = text.length * bytesPerCharacter;

  // 2. The WordDocument stream: the FIB at offset zero, the text at TEXT_FC, and the two FKP pages on the next free page boundaries after it.
  const firstFreePage = Math.ceil((TEXT_FC + textByteLength) / FKP_PAGE_SIZE);

  const papxPage = firstFreePage + 1;
  const wordDocument = new Uint8Array((papxPage + 1) * FKP_PAGE_SIZE);
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
      runRanges.map((run) => ({
        fc: characterFc(run.start),
        ...(run.grpprl === undefined ? {} : { grpprl: run.grpprl }),
      })),
      characterFc(text.length),
    ),
    firstFreePage * FKP_PAGE_SIZE,
  );
  wordDocument.set(
    buildPapxFkp(
      spec.paragraphs.map((paragraph, index) => {
        const range = paragraphRanges[index];
        if (range === undefined) throw new Error("paragraph range missing");
        return {
          fc: characterFc(range.start),
          istd: paragraph.istd ?? 0,
          ...(paragraph.grpprl === undefined
            ? {}
            : { grpprl: paragraph.grpprl }),
        };
      }),
      characterFc(text.length),
    ),
    papxPage * FKP_PAGE_SIZE,
  );

  // 3. The Table stream: the Clx, the two bin tables, and the style sheet, each at an offset the FIB then names.
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

  const tableParts = [clx, plcBteChpx, plcBtePapx, stsh];
  const tableOffsets: number[] = [];
  let tableLength = 0;
  for (const part of tableParts) {
    tableOffsets.push(tableLength);
    tableLength += part.length;
  }
  const table = new Uint8Array(tableLength);
  tableParts.forEach((part, index) => {
    const offset = tableOffsets[index];
    if (offset === undefined) throw new Error("table part offset missing");
    table.set(part, offset);
  });
  const offsetOf = (index: number): number => {
    const offset = tableOffsets[index];
    if (offset === undefined) throw new Error("table part offset missing");
    return offset;
  };

  const fib = buildFib({
    ccpText: text.length,
    cbMac: wordDocument.length,
    fWhichTblStm: 1,
    fcClx: offsetOf(0),
    lcbClx: clx.length,
    fcPlcfBteChpx: offsetOf(1),
    lcbPlcfBteChpx: plcBteChpx.length,
    fcPlcfBtePapx: offsetOf(2),
    lcbPlcfBtePapx: plcBtePapx.length,
    fcStshf: offsetOf(3),
    lcbStshf: stsh.length,
  });
  wordDocument.set(fib, 0);

  return compoundFile([
    { path: "WordDocument", bytes: wordDocument },
    { path: "1Table", bytes: table },
  ]);
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
  styles.forEach((style, istd) => {
    const std: number[] = [];
    const word0 = (style.sti ?? istd) & 0x0fff;
    const word1 = ((style.stk ?? 1) & 0x000f) | (0x0fff << 4);
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
    out.push(std.length & 0xff, (std.length >> 8) & 0xff, ...std);
    // "LPStd structures are stored on even-byte boundaries, but this length MUST NOT include this padding."
    if (std.length % 2 === 1) out.push(0);
  });
  return new Uint8Array(out);
}
