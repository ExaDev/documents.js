import { DocFormatError } from "../errors";
import { FKP_PAGE_SIZE } from "./fkp";

// The inverse of fkp.ts's parseChpxFkp/parsePapxFkp: packs a document's character- and paragraph-formatting exceptions into formatted disk pages, splitting across as many 512-byte pages as the content needs rather than assuming it always fits one. [MS-DOC] 2.9.23/2.9.175 bound a single page at MAX_CRUN (0x65) runs or MAX_CPARA (0x1D) paragraphs, and every page is a fixed 512 bytes regardless of how much grpprl content its records hold -- a document with enough distinct formatting exceptions overflows either limit before the file itself is large, so page-splitting is exercised in this module's own tests rather than left as a theoretical concern a small document would never hit.
//
// Layout mirrors fkp.ts's own read-side comments exactly, because it is inverting the identical structure: the element count in the page's LAST byte, rgfc/rgb (or rgfc/bxPap) arrays growing forward from the front, and property records packed backward from the end with their own offsets stored halved. Deliberately not shared with test-support/fkp.ts's builders, which exist to construct arbitrary and deliberately-invalid fixtures for the reader's own tests: this module is production code with its own overflow detection (a batch that would not fit returns undefined rather than silently overwriting the front arrays with the record region), which the test-support builders have no reason to carry.

const MAX_CRUN = 0x65;
const MAX_CPARA = 0x1d;
/** A BxPap is a 1-byte bOffset followed by a 12-byte PHE this package never populates (see fkp.ts: "the specification says SHOULD be zero and SHOULD be ignored"). */
const BX_PAP_SIZE = 13;
/** A Chpx's own cb is one byte, and a PapxInFkp's one-byte cb/cb' halves the GrpPrlAndIstd length -- both single-byte fields, so 255 bounds a Chpx record's cb and 510 bounds a PapxInFkp's GrpPrlAndIstd (2 x 255) before either can no longer be expressed. */
const MAX_CHPX_RECORD_GRPPRL = 0xff;
const MAX_GRP_PRL_AND_ISTD = 0x1fe;

export interface ChpxRunToWrite {
  readonly fc: number;
  /** undefined writes rgb 0 -- "no exception, default properties" -- exactly what parseChpxFkp reads back as undefined. */
  readonly grpprl: readonly number[] | undefined;
}

export interface PapxParagraphToWrite {
  readonly fc: number;
  readonly istd: number;
  readonly grpprl: readonly number[];
}

function buildChpxPage(
  runs: readonly ChpxRunToWrite[],
  fcLim: number,
): Uint8Array | undefined {
  const crun = runs.length;
  if (crun < 1 || crun > MAX_CRUN) return undefined;
  const page = new Uint8Array(FKP_PAGE_SIZE);
  const view = new DataView(page.buffer);
  runs.forEach((run, index) => {
    view.setUint32(index * 4, run.fc, true);
  });
  view.setUint32(crun * 4, fcLim, true);
  page[FKP_PAGE_SIZE - 1] = crun;

  const rgbStart = (crun + 1) * 4;
  const frontUsed = rgbStart + crun;
  let writeAt = FKP_PAGE_SIZE - 1;
  for (let index = 0; index < crun; index += 1) {
    const run = runs[index];
    if (run === undefined) {
      throw new DocFormatError("run missing from a batch already sized");
    }
    const rgbAt = rgbStart + index;
    if (run.grpprl === undefined) {
      page[rgbAt] = 0;
      continue;
    }
    if (run.grpprl.length > MAX_CHPX_RECORD_GRPPRL) return undefined;
    const record = [run.grpprl.length, ...run.grpprl];
    writeAt -= record.length;
    writeAt -= writeAt % 2;
    if (writeAt < frontUsed) return undefined;
    page.set(record, writeAt);
    page[rgbAt] = writeAt / 2;
  }
  return page;
}

function buildPapxPage(
  paragraphs: readonly PapxParagraphToWrite[],
  fcLim: number,
): Uint8Array | undefined {
  const cpara = paragraphs.length;
  if (cpara < 1 || cpara > MAX_CPARA) return undefined;
  const page = new Uint8Array(FKP_PAGE_SIZE);
  const view = new DataView(page.buffer);
  paragraphs.forEach((paragraph, index) => {
    view.setUint32(index * 4, paragraph.fc, true);
  });
  view.setUint32(cpara * 4, fcLim, true);
  page[FKP_PAGE_SIZE - 1] = cpara;

  const bxPapStart = (cpara + 1) * 4;
  const frontUsed = bxPapStart + cpara * BX_PAP_SIZE;
  let writeAt = FKP_PAGE_SIZE - 1;
  for (let index = 0; index < cpara; index += 1) {
    const paragraph = paragraphs[index];
    if (paragraph === undefined) {
      throw new DocFormatError("paragraph missing from a batch already sized");
    }
    const bxPapAt = bxPapStart + index * BX_PAP_SIZE;
    const grpPrlAndIstd = [
      paragraph.istd & 0xff,
      (paragraph.istd >> 8) & 0xff,
      ...paragraph.grpprl,
    ];
    if (grpPrlAndIstd.length > MAX_GRP_PRL_AND_ISTD) return undefined;
    // Which of PapxInFkp's two length spellings applies is decided by parity alone -- see fkp.ts's own comment on parsePapxFkp for why an odd GrpPrlAndIstd always takes the one-byte cb form and an even one the two-byte cb' form.
    const record: number[] =
      grpPrlAndIstd.length % 2 === 1
        ? [(grpPrlAndIstd.length + 1) / 2, ...grpPrlAndIstd]
        : [0x00, grpPrlAndIstd.length / 2, ...grpPrlAndIstd];
    writeAt -= record.length;
    writeAt -= writeAt % 2;
    if (writeAt < frontUsed) return undefined;
    page.set(record, writeAt);
    page[bxPapAt] = writeAt / 2;
  }
  return page;
}

// Greedily fills each page to capacity before starting the next, using a placeholder fcLim of 0 while testing fit: a page's byte usage never depends on the VALUE in its final rgfc slot, only on the slot's fixed presence, so the fit-or-not answer this produces is identical to what the real fcLim would give. Throws when a single item cannot fit in an otherwise-empty page -- a defect in the caller's own grpprl encoding, not a shape this format can express by splitting further.
function splitIntoBatches<T>(
  items: readonly T[],
  fits: (batch: readonly T[]) => boolean,
  what: string,
): T[][] {
  const batches: T[][] = [];
  let batch: T[] = [];
  for (const item of items) {
    const candidate = [...batch, item];
    if (fits(candidate)) {
      batch = candidate;
      continue;
    }
    if (batch.length === 0) {
      throw new DocFormatError(
        `a single ${what} does not fit in one 512-byte formatted disk page`,
      );
    }
    batches.push(batch);
    batch = [item];
    if (!fits(batch)) {
      throw new DocFormatError(
        `a single ${what} does not fit in one 512-byte formatted disk page`,
      );
    }
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}

/** Splits `runs` across as many ChpxFkp pages as needed. `fcLim` is the exclusive end of the whole run sequence (the byte offset one past the document's own text). */
export function buildChpxPages(
  runs: readonly ChpxRunToWrite[],
  fcLim: number,
): Uint8Array[] {
  if (runs.length === 0) {
    throw new DocFormatError("buildChpxPages requires at least one run");
  }
  const batches = splitIntoBatches(
    runs,
    (batch) => buildChpxPage(batch, 0) !== undefined,
    "character-formatting run",
  );
  return batches.map((batch, index) => {
    const next = batches[index + 1];
    const pageFcLim = next === undefined ? fcLim : (next[0]?.fc ?? fcLim);
    const page = buildChpxPage(batch, pageFcLim);
    if (page === undefined) {
      throw new DocFormatError(
        "a ChpxFkp batch that fit during splitting no longer fits when finalised; this is an internal defect",
      );
    }
    return page;
  });
}

/** Splits `paragraphs` across as many PapxFkp pages as needed. `fcLim` is the exclusive end of the whole paragraph sequence. */
export function buildPapxPages(
  paragraphs: readonly PapxParagraphToWrite[],
  fcLim: number,
): Uint8Array[] {
  if (paragraphs.length === 0) {
    throw new DocFormatError("buildPapxPages requires at least one paragraph");
  }
  const batches = splitIntoBatches(
    paragraphs,
    (batch) => buildPapxPage(batch, 0) !== undefined,
    "paragraph-formatting record",
  );
  return batches.map((batch, index) => {
    const next = batches[index + 1];
    const pageFcLim = next === undefined ? fcLim : (next[0]?.fc ?? fcLim);
    const page = buildPapxPage(batch, pageFcLim);
    if (page === undefined) {
      throw new DocFormatError(
        "a PapxFkp batch that fit during splitting no longer fits when finalised; this is an internal defect",
      );
    }
    return page;
  });
}

/** A built page's own first rgfc entry -- the byte offset of the first run or paragraph it covers. Reading it back out of the page's own bytes, rather than threading it through as separate metadata, keeps the bin table's keys and the page's own content provably in agreement: there is exactly one place either could disagree with itself. */
export function firstFcOfPage(page: Uint8Array): number {
  return new DataView(page.buffer, page.byteOffset, 4).getUint32(0, true);
}

/** Builds a PlcBteChpx or PlcBtePapx: the bin table mapping each page's own starting byte offset (plus a final terminating fcLim) to its page number. `firstFcs` must carry exactly one more entry than `pageNumbers` -- see plc.ts's own PLC shape. */
export function buildPropertyBinTable(
  firstFcs: readonly number[],
  pageNumbers: readonly number[],
): Uint8Array {
  if (firstFcs.length !== pageNumbers.length + 1) {
    throw new DocFormatError(
      `buildPropertyBinTable was given ${firstFcs.length} keys for ${pageNumbers.length} page numbers; a PLC needs exactly one more key than element`,
    );
  }
  const bytes = new Uint8Array(firstFcs.length * 4 + pageNumbers.length * 4);
  const view = new DataView(bytes.buffer);
  firstFcs.forEach((fc, index) => {
    view.setUint32(index * 4, fc, true);
  });
  pageNumbers.forEach((pageNumber, index) => {
    view.setUint32(firstFcs.length * 4 + index * 4, pageNumber, true);
  });
  return bytes;
}
