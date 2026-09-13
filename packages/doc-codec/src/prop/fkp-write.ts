import { DocFormatError } from "../errors";
import { FKP_PAGE_SIZE } from "./fkp";

// The inverse of fkp.ts's parseChpxFkp/parsePapxFkp: packs a document's character- and paragraph-formatting exceptions into formatted disk pages, splitting across as many 512-byte pages as the content needs rather than assuming it always fits one. [MS-DOC] 2.9.23/2.9.175 bound a single page at MAX_CRUN (0x65) runs or 0x1D paragraphs, and every page is a fixed 512 bytes regardless of how much grpprl content its records hold -- a document with enough distinct formatting exceptions overflows either limit before the file itself is large, so page-splitting is exercised in this module's own tests rather than left as a theoretical concern a small document would never hit. The paragraph bound is not checked directly: it is already exactly where BxPap's own front array (17 bytes per paragraph, 13 for its own BxPap plus 4 for its rgfc entry) alone exceeds the page's 512 bytes regardless of any record content, so the record-region overflow check below already refuses anything past it on its own -- unlike a run, every paragraph's own GrpPrlAndIstd is written unconditionally (istd alone is never omitted the way a run's whole Chpx can be), so that check is never skipped the way it can be for an all-default-formatting run. The run bound has no such equivalent and is still checked explicitly below, for exactly that reason: a run whose own grpprl is undefined skips the record-region write entirely (rgb 0, "no exception"), so a batch of enough such runs would never touch the very check that would otherwise catch it.
//
// Layout mirrors fkp.ts's own read-side comments exactly, because it is inverting the identical structure: the element count in the page's LAST byte, rgfc/rgb (or rgfc/bxPap) arrays growing forward from the front, and property records packed backward from the end with their own offsets stored halved. Deliberately not shared with test-support/fkp.ts's builders, which exist to construct arbitrary and deliberately-invalid fixtures for the reader's own tests: this module is production code with its own overflow detection (a batch that would not fit returns undefined rather than silently overwriting the front arrays with the record region), which the test-support builders have no reason to carry.

const MAX_CRUN = 0x65;
/** A BxPap is a 1-byte bOffset followed by a 12-byte PHE this package never populates (see fkp.ts: "the specification says SHOULD be zero and SHOULD be ignored"). */
const BX_PAP_SIZE = 13;
/** A Chpx's own cb is one byte, capping its own grpprl at 255 bytes before the format can no longer express its length at all -- checked explicitly below, since 255 comfortably fits within a page's own available record region regardless of how many runs share it, so nothing else would catch an oversized one. A PapxInFkp's one-byte cb/cb' has the identical 510-byte (2 x 255) limit for its own GrpPrlAndIstd, but needs no equivalent check: BX_PAP_SIZE's own 13-byte-per-paragraph front cost already rules out anything that large on capacity grounds first (see buildPapxPage's own comment). */
const MAX_CHPX_RECORD_GRPPRL = 0xff;

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
  // Only the upper bound is checked here, not crun < 1: this function's only callers (below) always pass at least one run, so an empty batch never reaches this point.
  if (crun > MAX_CRUN) return undefined;
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
  // .entries() rather than an indexed runs[index] read: it types run as ChpxRunToWrite directly, not ChpxRunToWrite | undefined, since every index it yields is genuinely in bounds -- unlike a manual index read, which noUncheckedIndexedAccess can never narrow past "possibly absent" even though runs[index] can never actually be absent for index < runs.length.
  for (const [index, run] of runs.entries()) {
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
  // No cpara bounds check at all, unlike buildChpxPage's own crun > MAX_CRUN: this function's only callers (below) always pass at least one paragraph, and -- unlike a run, whose grpprl can be entirely absent -- every paragraph's own GrpPrlAndIstd is written unconditionally, so cpara paragraphs alone always claim (cpara + 1) * 4 + cpara * BX_PAP_SIZE bytes of the page's front before a single one of them reaches the loop's own writeAt < frontUsed check; past 0x1D that already exceeds 512, so that check alone already refuses anything past it.
  const cpara = paragraphs.length;
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
  // .entries(), for the identical reason buildChpxPage's own loop uses it: types paragraph as PapxParagraphToWrite directly rather than PapxParagraphToWrite | undefined.
  for (const [index, paragraph] of paragraphs.entries()) {
    const bxPapAt = bxPapStart + index * BX_PAP_SIZE;
    const grpPrlAndIstd = [
      paragraph.istd & 0xff,
      (paragraph.istd >> 8) & 0xff,
      ...paragraph.grpprl,
    ];
    // No separate grpPrlAndIstd.length > MAX_GRP_PRL_AND_ISTD check: BX_PAP_SIZE (13 bytes per paragraph) already reserves so much of the page's own front that even the smallest possible frontUsed (a single paragraph, 21 bytes) leaves far less room for a record than MAX_GRP_PRL_AND_ISTD (510) permits -- the writeAt < frontUsed check just below always rejects a GrpPrlAndIstd anywhere near that size on capacity grounds alone, well before the format's own cb/cb' encoding limit could ever be the deciding factor. Which of PapxInFkp's two length spellings applies is decided by parity alone -- see fkp.ts's own comment on parsePapxFkp for why an odd GrpPrlAndIstd always takes the one-byte cb form and an even one the two-byte cb' form.
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

// Greedily fills each page to capacity before starting the next, using a placeholder fcLim of 0 while testing fit: a page's byte usage never depends on the VALUE in its final rgfc slot, only on the slot's fixed presence, so the fit-or-not answer this produces is identical to what the real fcLim would give. Throws when a single item cannot fit in an otherwise-empty page -- a defect in the caller's own grpprl encoding, not a shape this format can express by splitting further. One throw covers both ways that can happen (the very first item is already too big, or a later item is too big once it starts a fresh batch of its own): whichever one it is, batch is down to just that one item by the time the check below runs, and the observable result -- this exact thrown message, nothing else -- is identical either way, so a second copy of the same throw guarding the first case specifically would only ever restate it.
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
    // No batch.length > 0 guard on this push: batch can only be empty here on the very first item, and a batch of just that one item is about to be checked below regardless -- when it too fails to fit, the function throws before this empty entry could ever be observed in the returned batches.
    batches.push(batch);
    batch = [item];
    if (!fits(batch)) {
      throw new DocFormatError(
        `a single ${what} does not fit in one 512-byte formatted disk page`,
      );
    }
  }
  // No batch.length > 0 guard here either: both callers below already reject an empty items list before ever calling this function, so the loop above runs at least once and leaves batch non-empty however it exits (extended on the fits branch, reset to a fresh [item] on the other) -- there is no way to reach here with batch still [].
  batches.push(batch);
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

/** Whether a paragraph carrying exactly this grpprl -- alone, on an otherwise-empty page -- fits within a single 512-byte PapxFkp page. This is precisely the fits-in-isolation check splitIntoBatches performs immediately before it throws "a single paragraph-formatting record does not fit in one 512-byte formatted disk page": production code that can predict an oversized grpprl before committing to it (table/write.ts's own lost-boundary fallback, ExaDev/documents.js#1013) calls this ahead of time, rather than re-deriving fkp-write.ts's own page-packing arithmetic -- the front-reserved rgfc/BxPap bytes, the record-length-prefix parity -- as a second, driftable copy of it. A paragraph that fits alone can always be given its own page by the batching above, so "fits alone" is the exact condition that keeps a paragraph this large from ever reaching that throw, regardless of what else shares its page. `istd` defaults to 0, matching every paragraph this package's own writer ever produces (see write.ts's own PapxParagraphToWrite construction). */
export function fitsAloneOnPapxPage(
  grpprl: readonly number[],
  istd = 0,
): boolean {
  return buildPapxPage([{ fc: 0, istd, grpprl }], 0) !== undefined;
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
