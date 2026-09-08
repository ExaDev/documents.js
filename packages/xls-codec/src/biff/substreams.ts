import {
  BIFF8_VERSION,
  RECORD_BOF,
  RECORD_CONTINUE,
  RECORD_CONTINUEFRT12,
  RECORD_EOF,
} from "./record-types";
import { BiffFormatError, type BiffRecord } from "./records";

// The two structural passes between the flat record list and the substream readers.
//
// groupRecords joins each record to the Continue records ([MS-XLS] 2.4.58) that follow it, producing one entry per LOGICAL record with its blocks kept separate -- separate because the boundary between them is meaningful to a string reader (see biff/strings.ts), so this is a grouping rather than a concatenation. A "future record type" (FRT) record -- CondFmt12/CF12 among them -- uses its own ContinueFrt12 ([MS-XLS] 2.4.62) instead of plain Continue when its data exceeds one record, and that record restates a 12-byte FrtRefHeader of its own before the genuine continuation bytes begin; this function strips that restated header so a ContinueFrt12's own block, like a plain Continue's, is exactly the bytes it is extending the base record with.

/** FrtRefHeader/FrtRefHeaderU's own fixed size ([MS-XLS] 2.4), restated at the front of every ContinueFrt12 record and stripped before its remaining bytes join the record it continues. */
const FRT_REF_HEADER_SIZE = 12;
//
// splitSubstreams then cuts the grouped sequence at its BOF/EOF delimiters. [MS-XLS] 2.1.3 defines a substream as exactly that: "The beginning of each substream is marked by a BOF record that has a dt field that specifies the type of the substream. The end of each substream is marked by an EOF record." (https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/5e380e95-a9f5-4dfd-b6d9-c6998a9772f8) A workbook stream is one globals substream followed by one substream per sheet, in the order the sheets were written -- which is NOT necessarily the order they appear in the workbook, so the sheet order comes from the globals substream's BoundSheet8 records rather than from this sequence.
//
// A BOF met while a substream is already open genuinely does nest -- an embedded chart's own BOF(dt=chart)...EOF substream sits INSIDE the worksheet substream that anchors it, immediately after the MsoDrawing+Obj pair naming the chart shape ([MS-XLS] "Chart Area": "the chart is treated as a drawing ... contained within a worksheet"), and the worksheet's own records continue again once the chart's EOF closes it. This is tracked with a stack rather than treated as "a producer that omitted an EOF" (this function's own earlier, pre-chart-support behaviour): a bare "BOF ends the open substream and starts a new one, with no way back" would silently drop every worksheet record that happens to follow an embedded chart, which no chart-free file could ever have exercised. Each closed substream -- nested or not -- is pushed to the result the moment its own EOF closes it, so a nested chart substream is always reported before the worksheet substream containing it.

/** One logical record: its type, its data blocks -- the base record's, then one per Continue that followed it -- and the base record's own offset in the stream. */
export interface RecordGroup {
  readonly type: number;
  readonly blocks: readonly Uint8Array<ArrayBuffer>[];
  readonly offset: number;
}

/** The total byte length of a record's data across every block (the base record's and any Continues that followed it) -- what a reader needs whenever a trailing field's own length is implied by "whatever is left" rather than stated by a preceding count (a Mul record's entry count, an SST's own bounds check, a formula's RgbExtra trailer). */
export function recordByteLength(record: RecordGroup): number {
  return record.blocks.reduce((sum, block) => sum + block.length, 0);
}

/** One substream: the document type its BOF declared, the records between that BOF and its EOF, its ordinal position among the stream's substreams, and the stream offset of its own BOF -- which is what a BoundSheet8's lbPlyPos names. */
export interface Substream {
  readonly documentType: number;
  readonly records: readonly RecordGroup[];
  readonly index: number;
  readonly offset: number;
}

/** Joins each record to the Continue records following it, keeping the blocks separate. */
export function groupRecords(
  records: readonly BiffRecord[],
): readonly RecordGroup[] {
  const groups: {
    type: number;
    blocks: Uint8Array<ArrayBuffer>[];
    offset: number;
  }[] = [];
  for (const record of records) {
    if (record.type === RECORD_CONTINUE) {
      const current = groups[groups.length - 1];
      if (current === undefined) {
        throw new BiffFormatError(
          "Continue record with no preceding record to continue",
        );
      }
      current.blocks.push(record.data);
      continue;
    }
    if (record.type === RECORD_CONTINUEFRT12) {
      const current = groups[groups.length - 1];
      if (current === undefined) {
        throw new BiffFormatError(
          "ContinueFrt12 record with no preceding record to continue",
        );
      }
      current.blocks.push(record.data.subarray(FRT_REF_HEADER_SIZE));
      continue;
    }
    groups.push({
      type: record.type,
      blocks: [record.data],
      offset: record.offset,
    });
  }
  return groups;
}

/** The BOF record's own fixed prefix: a two-byte vers followed by a two-byte dt. */
const BOF_PREFIX_SIZE = 4;

/** Splits a grouped record sequence into its substreams, verifying each BOF declares BIFF8. A BOF met while a substream is already open pushes that substream onto a stack and starts a nested one; the nested substream is closed and reported (via its own EOF) before its parent resumes collecting records -- see this module's own top comment for why a stack, not a flat "BOF ends the previous substream", is what a chart embedded in a worksheet needs. */
export function splitSubstreams(
  groups: readonly RecordGroup[],
): readonly Substream[] {
  const substreams: Substream[] = [];
  const stack: {
    documentType: number;
    records: RecordGroup[];
    offset: number;
  }[] = [];
  let current:
    | { documentType: number; records: RecordGroup[]; offset: number }
    | undefined;
  for (const group of groups) {
    if (group.type === RECORD_BOF) {
      if (current !== undefined) {
        stack.push(current);
      }
      current = {
        documentType: readBofDocumentType(group),
        records: [],
        offset: group.offset,
      };
      continue;
    }
    if (group.type === RECORD_EOF) {
      if (current !== undefined) {
        substreams.push({ ...current, index: substreams.length });
        current = stack.pop();
      }
      continue;
    }
    // A record outside any substream has no substream to belong to. Real files do not write one; ignoring it is safer than inventing a substream to hold it.
    current?.records.push(group);
  }
  // A substream still open when the records run out (this one, and every ancestor still on the stack) never met its own EOF -- a truncated or malformed file. Reporting each one anyway, outermost last, keeps this function's contract ("every BOF eventually reported as some substream") rather than silently discarding a truncated tail.
  if (current !== undefined) {
    stack.push(current);
  }
  // Innermost (most recently opened) first, matching the "nested substream reported before its parent" contract every EOF-closed substream above already follows.
  for (const open of stack.reverse()) {
    substreams.push({ ...open, index: substreams.length });
  }
  return substreams;
}

/** Reads a BOF's vers and dt ([MS-XLS] 2.4.21), rejecting anything that is not BIFF8. */
function readBofDocumentType(group: RecordGroup): number {
  const data = group.blocks[0];
  if (data === undefined || data.length < BOF_PREFIX_SIZE) {
    throw new BiffFormatError(
      `BOF record carries ${data?.length ?? 0} bytes, too few for its own version and document type`,
    );
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const version = view.getUint16(0, true);
  if (version !== BIFF8_VERSION) {
    // [MS-XLS] 2.4.21 fixes vers at 0x0600 for BIFF8. An earlier BIFF names its records by the same numbers but lays several of them out differently (a BIFF5 Row, XF, and every string among them), so continuing here would misread fields rather than fail.
    throw new BiffFormatError(
      `BOF declares BIFF version 0x${version.toString(16).padStart(4, "0")}; this reader implements BIFF8 (0x0600) only`,
    );
  }
  return view.getUint16(2, true);
}
