// Hand-built ChpxFkp and PapxFkp pages for the reader's tests, laid out directly from [MS-DOC] 2.9.23 and 2.9.175: a fixed 512-byte page whose element count lives in its LAST byte, an rgfc array of (count + 1) 4-byte stream offsets at the front, a parallel array of byte offsets in the middle, and the property records themselves packed after that -- at offsets stated as HALVES, so every one must land on an even byte.
//
// Test-support only: excluded from the published dist (tsdown.config.ts drops src/test-support/**), never imported by src/index.ts.

import { FKP_PAGE_SIZE } from "../prop/fkp";

/** One run of characters sharing a Chpx, keyed on the WordDocument byte offset where the run starts. */
export interface ChpxRunSpec {
  readonly fc: number;
  /** The Chpx's grpprl bytes, or undefined for a run [MS-DOC] permits to carry no Chpx at all (rgb entry zero). */
  readonly grpprl?: readonly number[];
}

/** One paragraph, keyed on the WordDocument byte offset where its text starts. */
export interface PapxParagraphSpec {
  readonly fc: number;
  readonly istd: number;
  readonly grpprl?: readonly number[];
  /** Omits the PapxInFkp entirely (bOffset zero), the "this paragraph has the default properties" case. */
  readonly omitPapx?: boolean;
}

/** Builds a ChpxFkp page. `fcLim` is the exclusive end of the last run, which becomes the final rgfc entry. */
export function buildChpxFkp(
  runs: readonly ChpxRunSpec[],
  fcLim: number,
): Uint8Array<ArrayBuffer> {
  const page = new Uint8Array(FKP_PAGE_SIZE);
  const view = new DataView(page.buffer);
  const crun = runs.length;
  runs.forEach((run, index) => {
    view.setUint32(index * 4, run.fc, true);
  });
  view.setUint32(crun * 4, fcLim, true);
  page[FKP_PAGE_SIZE - 1] = crun;

  // Chpx records are packed backwards from the end of the page, which is where a real producer puts them: the rgfc and rgb arrays grow forwards from the front, so the two meet in the middle with the padding between them.
  let writeAt = FKP_PAGE_SIZE - 1;
  runs.forEach((run, index) => {
    const rgbAt = (crun + 1) * 4 + index;
    if (run.grpprl === undefined) {
      page[rgbAt] = 0;
      return;
    }
    const record = [run.grpprl.length, ...run.grpprl];
    writeAt -= record.length;
    writeAt -= writeAt % 2; // rgb stores the offset halved, so a record must start on an even byte.
    page.set(record, writeAt);
    page[rgbAt] = writeAt / 2;
  });
  return page;
}

/** Builds a PapxFkp page. `fcLim` is the exclusive end of the last paragraph, which becomes the final rgfc entry. */
export function buildPapxFkp(
  paragraphs: readonly PapxParagraphSpec[],
  fcLim: number,
): Uint8Array<ArrayBuffer> {
  const page = new Uint8Array(FKP_PAGE_SIZE);
  const view = new DataView(page.buffer);
  const cpara = paragraphs.length;
  paragraphs.forEach((paragraph, index) => {
    view.setUint32(index * 4, paragraph.fc, true);
  });
  view.setUint32(cpara * 4, fcLim, true);
  page[FKP_PAGE_SIZE - 1] = cpara;

  let writeAt = FKP_PAGE_SIZE - 1;
  paragraphs.forEach((paragraph, index) => {
    // Each BxPap is 13 bytes: a bOffset byte then a 12-byte PHE the specification says SHOULD be zero and SHOULD be ignored.
    const bxPapAt = (cpara + 1) * 4 + index * 13;
    if (paragraph.omitPapx === true) {
      page[bxPapAt] = 0;
      return;
    }
    // GrpPrlAndIstd is the 2-byte istd followed by the grpprl.
    const grpprl = paragraph.grpprl ?? [];
    const grpPrlAndIstd = [
      paragraph.istd & 0xff,
      (paragraph.istd >> 8) & 0xff,
      ...grpprl,
    ];
    // Which of PapxInFkp's two length spellings applies is decided entirely by parity, not by preference: the one-byte form gives a GrpPrlAndIstd of 2xcb-1 bytes, always ODD, and the two-byte form gives 2xcb' bytes, always EVEN. Since GrpPrlAndIstd is the 2-byte istd plus the grpprl, an odd-length grpprl takes the one-byte form and an even-length one (including the empty grpprl) takes the two-byte form -- exactly as [MS-DOC] 2.9.176's own worked example shows, where a record of istd plus two 3-byte Prls uses cb 0 with cb' 4, and a record of istd alone uses cb 0 with cb' 1.
    const record: number[] =
      grpPrlAndIstd.length % 2 === 1
        ? [(grpPrlAndIstd.length + 1) / 2, ...grpPrlAndIstd]
        : [0x00, grpPrlAndIstd.length / 2, ...grpPrlAndIstd];
    writeAt -= record.length;
    writeAt -= writeAt % 2;
    page.set(record, writeAt);
    page[bxPapAt] = writeAt / 2;
  });
  return page;
}

/** Builds a PlcBteChpx or PlcBtePapx: FCs ascending, then one 4-byte page number per range. */
export function buildBinTable(
  fcs: readonly number[],
  pageNumbers: readonly number[],
): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(fcs.length * 4 + pageNumbers.length * 4);
  const view = new DataView(bytes.buffer);
  fcs.forEach((fc, index) => {
    view.setUint32(index * 4, fc, true);
  });
  pageNumbers.forEach((pn, index) => {
    view.setUint32(fcs.length * 4 + index * 4, pn, true);
  });
  return bytes;
}
