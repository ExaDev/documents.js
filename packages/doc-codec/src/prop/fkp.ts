import { readUint16LE, readUint32LE, readUint8, slice } from "../bytes";
import { DocFormatError } from "../errors";
import { findLargestAtMost, parsePlc } from "../plc";

// The formatted disk page (FKP), [MS-DOC] 2.9.23 and 2.9.175 -- how a .doc stores character and paragraph formatting as sparse exceptions rather than per-character state. Text is divided into runs of identical formatting; each run's properties live in one 512-byte page, and a bin table maps a byte offset in the WordDocument stream to the page holding the properties for the text there.
//
// Three details in the page layout are easy to get wrong and produce plausible-looking wrong formatting rather than an error:
//
// 1. The element count is the page's LAST byte, at offset 511, not its first. Everything else is sized from it, so reading it from the wrong end mis-sizes both arrays at once.
// 2. The offsets to the property records are stored HALVED -- "rgb[i] x 2 MUST either specify an offset, in bytes, between the beginning of the ChpxFkp and crun, or be equal to zero" -- so a record always begins on an even byte and a raw rgb value is never an offset.
// 3. A zero in that array is not offset zero: it means the run or paragraph carries no exception at all and takes the document defaults.
//
// The paragraph side adds a fourth: PapxInFkp's length byte is doubled and decremented ("If this value is not 0, the grpprlInPapx is 2xcb-1 bytes long"), with a second spelling when it is zero. And what that length measures is the GrpPrlAndIstd -- the 2-byte style index AND the grpprl together -- not the grpprl alone, so a reader that treats it as the grpprl's own length reads two bytes of style index as the first sprm of every paragraph.

/** Every FKP is exactly one 512-byte page, whatever the compound file's own sector size. */
export const FKP_PAGE_SIZE = 512;
/** ChpxFkp.crun "MUST be at least 0x01, and MUST NOT exceed 0x65". */
const MAX_CRUN = 0x65;
/** PapxFkp.cpara "MUST be at least 0x01, and MUST NOT exceed 0x1D". */
const MAX_CPARA = 0x1d;
/** BxPap is a 1-byte bOffset followed by a 12-byte PHE the specification says SHOULD be zero and SHOULD be ignored. */
const BX_PAP_SIZE = 13;
/** PnFkpChpx/PnFkpPapx: "pn (22 bits)" then 10 unused, and "the ChpxFkp structure begins at an offset of pn x 512". */
const PN_MASK = 0x003fffff;

export interface ChpxFkp {
  readonly rgfc: readonly number[];
  /** The Chpx's grpprl for run `index`, or undefined when the run's rgb entry is zero and it carries no exception. */
  grpprl(index: number): Uint8Array | undefined;
}

export interface PapxRecord {
  readonly istd: number;
  readonly grpprl: Uint8Array;
}

export interface PapxFkp {
  readonly rgfc: readonly number[];
  /** The PapxInFkp for paragraph `index`, or undefined when its BxPap.bOffset is zero and the paragraph takes the defaults. */
  papx(index: number): PapxRecord | undefined;
}

function checkPage(page: Uint8Array, what: string): void {
  if (page.length !== FKP_PAGE_SIZE) {
    throw new DocFormatError(
      `${what} is ${page.length} bytes rather than the fixed ${FKP_PAGE_SIZE} every formatted disk page occupies`,
    );
  }
}

function readRgfc(page: Uint8Array, count: number): number[] {
  const rgfc: number[] = [];
  for (let index = 0; index <= count; index += 1) {
    rgfc.push(readUint32LE(page, index * 4));
  }
  return rgfc;
}

export function parseChpxFkp(page: Uint8Array): ChpxFkp {
  checkPage(page, "ChpxFkp");
  const crun = readUint8(page, FKP_PAGE_SIZE - 1);
  if (crun < 1 || crun > MAX_CRUN) {
    throw new DocFormatError(
      `ChpxFkp declares crun ${crun}, outside the 0x01..0x${MAX_CRUN.toString(16).toUpperCase()} range [MS-DOC] permits`,
    );
  }
  const rgfc = readRgfc(page, crun);
  const rgbStart = (crun + 1) * 4;
  return {
    rgfc,
    grpprl(index: number): Uint8Array | undefined {
      if (!Number.isInteger(index) || index < 0 || index >= crun) {
        throw new DocFormatError(
          `ChpxFkp covers ${crun} runs; run ${index} was requested`,
        );
      }
      const halfOffset = readUint8(page, rgbStart + index);
      if (halfOffset === 0) return undefined;
      const chpxAt = halfOffset * 2;
      const cb = readUint8(page, chpxAt);
      return slice(page, chpxAt + 1, cb, `Chpx for ChpxFkp run ${index}`);
    },
  };
}

export function parsePapxFkp(page: Uint8Array): PapxFkp {
  checkPage(page, "PapxFkp");
  const cpara = readUint8(page, FKP_PAGE_SIZE - 1);
  if (cpara < 1 || cpara > MAX_CPARA) {
    throw new DocFormatError(
      `PapxFkp declares cpara ${cpara}, outside the 0x01..0x${MAX_CPARA.toString(16).toUpperCase()} range [MS-DOC] permits`,
    );
  }
  const rgfc = readRgfc(page, cpara);
  const rgbxStart = (cpara + 1) * 4;
  return {
    rgfc,
    papx(index: number): PapxRecord | undefined {
      if (!Number.isInteger(index) || index < 0 || index >= cpara) {
        throw new DocFormatError(
          `PapxFkp covers ${cpara} paragraphs; paragraph ${index} was requested`,
        );
      }
      const bOffset = readUint8(page, rgbxStart + index * BX_PAP_SIZE);
      // "If bOffset is 0 then there is no PapxInFkp for this paragraph and this paragraph has the default properties."
      if (bOffset === 0) return undefined;
      const papxAt = bOffset * 2;

      // The two length spellings, [MS-DOC] 2.9.176. Both measure the GrpPrlAndIstd, which begins with the 2-byte istd.
      const cb = readUint8(page, papxAt);
      let grpPrlAndIstdAt: number;
      let grpPrlAndIstdSize: number;
      if (cb !== 0) {
        grpPrlAndIstdAt = papxAt + 1;
        grpPrlAndIstdSize = 2 * cb - 1;
      } else {
        const cbPrime = readUint8(page, papxAt + 1);
        if (cbPrime < 1) {
          throw new DocFormatError(
            `PapxInFkp for paragraph ${index} has cb 0 and cb' 0, but [MS-DOC] requires cb' to be at least 1`,
          );
        }
        grpPrlAndIstdAt = papxAt + 2;
        grpPrlAndIstdSize = 2 * cbPrime;
      }
      if (grpPrlAndIstdSize < 2) {
        throw new DocFormatError(
          `PapxInFkp for paragraph ${index} declares a ${grpPrlAndIstdSize}-byte GrpPrlAndIstd, too short for the 2-byte istd it must begin with`,
        );
      }
      return {
        istd: readUint16LE(page, grpPrlAndIstdAt),
        grpprl: slice(
          page,
          grpPrlAndIstdAt + 2,
          grpPrlAndIstdSize - 2,
          `grpprl of PapxInFkp for paragraph ${index}`,
        ),
      };
    },
  };
}

export interface PapxLookup extends PapxRecord {
  /** The byte offset one past the end of the paragraph this record covers -- PapxFkp.rgfc[k + 1], the paragraph boundary [MS-DOC] 2.4.2 derives its own from. */
  readonly fcLim: number;
}

// A bin table (PlcBteChpx or PlcBtePapx) together with the WordDocument stream its page numbers address, resolving a byte offset to the properties covering it in the two steps [MS-DOC] 2.4.6.1 and 2.4.6.2 both prescribe: find the containing entry in the bin table, read the FKP page it names, then find the containing run or paragraph within that page.
//
// Parsed pages are memoised because a document's text resolves through the same handful of pages thousands of times, and a page is re-parsed identically every time.
export class PropertyBinTable {
  readonly #wordDocument: Uint8Array;
  readonly #keys: readonly number[];
  readonly #pageNumbers: readonly number[];
  readonly #chpxPages = new Map<number, ChpxFkp>();
  readonly #papxPages = new Map<number, PapxFkp>();

  constructor(wordDocument: Uint8Array, plc: Uint8Array, what: string) {
    this.#wordDocument = wordDocument;
    const parsed = parsePlc(plc, 4, what);
    this.#keys = parsed.keys;
    const pageNumbers: number[] = [];
    for (let index = 0; index < parsed.count; index += 1) {
      pageNumbers.push(readUint32LE(parsed.element(index), 0) & PN_MASK);
    }
    this.#pageNumbers = pageNumbers;
  }

  #pageBytes(fc: number): Uint8Array | undefined {
    const index = findLargestAtMost(this.#keys, fc);
    if (index === undefined) return undefined;
    const pageNumber = this.#pageNumbers[index];
    if (pageNumber === undefined) {
      throw new DocFormatError(
        `bin table entry ${index} names no formatted-disk-page number`,
      );
    }
    return slice(
      this.#wordDocument,
      pageNumber * FKP_PAGE_SIZE,
      FKP_PAGE_SIZE,
      `formatted disk page ${pageNumber}`,
    );
  }

  #pageNumberFor(fc: number): number | undefined {
    const index = findLargestAtMost(this.#keys, fc);
    return index === undefined ? undefined : this.#pageNumbers[index];
  }

  /** The direct character-formatting grpprl covering `fc`, or undefined when the offset is outside the table or its run carries no exception. */
  chpxGrpprl(fc: number): Uint8Array | undefined {
    const pageNumber = this.#pageNumberFor(fc);
    if (pageNumber === undefined) return undefined;
    let fkp = this.#chpxPages.get(pageNumber);
    if (fkp === undefined) {
      const bytes = this.#pageBytes(fc);
      if (bytes === undefined) return undefined;
      fkp = parseChpxFkp(bytes);
      this.#chpxPages.set(pageNumber, fkp);
    }
    const run = findLargestAtMost(fkp.rgfc, fc);
    return run === undefined ? undefined : fkp.grpprl(run);
  }

  /** The direct paragraph-formatting record covering `fc`, or undefined when the offset is outside the table or its paragraph carries no exception. */
  papx(fc: number): PapxLookup | undefined {
    const pageNumber = this.#pageNumberFor(fc);
    if (pageNumber === undefined) return undefined;
    let fkp = this.#papxPages.get(pageNumber);
    if (fkp === undefined) {
      const bytes = this.#pageBytes(fc);
      if (bytes === undefined) return undefined;
      fkp = parsePapxFkp(bytes);
      this.#papxPages.set(pageNumber, fkp);
    }
    const index = findLargestAtMost(fkp.rgfc, fc);
    if (index === undefined) return undefined;
    const record = fkp.papx(index);
    if (record === undefined) return undefined;
    const fcLim = fkp.rgfc[index + 1];
    if (fcLim === undefined) {
      throw new DocFormatError(
        `PapxFkp paragraph ${index} has no bracketing end offset, so its extent is undefined`,
      );
    }
    return { ...record, fcLim };
  }
}
