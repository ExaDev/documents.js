import { recordByteLength, type RecordGroup } from "../biff/substreams";
import {
  RECORD_ARRAY,
  RECORD_FORMULA,
  RECORD_SHRFMLA,
} from "../biff/record-types";
import { BlockCursor } from "../biff/cursor";
import { recoverFromFormatError } from "../biff/records";
import { readCellHeader } from "./sheet";
import type {
  ArrayFormulaGroup,
  FormulaGroup,
  SharedFormulaGroup,
} from "./sheet";

// The shared- and array-formula grouping split from sheet.ts: the collectors that pair SHR/ARRAY records into the groups readSheetRecords resolves each formula cell against.

export function groupKey(row: number, column: number): string {
  return `${row},${column}`;
}

/**
 * Walks every record once, looking for a Formula record immediately followed by a ShrFmla or Array record ([MS-XLS] 2.1.7.20.6's own FORMULA production, and 984826cc/c6ee7512's own "this record is preceded by a single Formula record"), and returns the shared/array expression each one carries, keyed by that Formula record's own cell — the same (row, column) a PtgExp token names when it points back to this group (see readPtgExpBase, and readFormula below which performs the actual lookup).
 *
 * Built as a single upfront pass over the whole sheet rather than interleaved into readSheetRecords' own per-record loop: every Formula record that uses a shared/array formula (including the group's own base cell, which points at itself) needs this map already complete when it is reached, and although [MS-XLS] guarantees the base pair precedes every other use, resolving the whole map first removes that ordering as a correctness dependency rather than merely relying on it.
 */
export function collectFormulaGroups(
  records: readonly RecordGroup[],
): ReadonlyMap<string, FormulaGroup> {
  const groups = new Map<string, FormulaGroup>();
  // records.entries() rather than an indexed for-loop: it types `record` as a genuine RecordGroup with no undefined case to guard for the loop's own sake (noUncheckedIndexedAccess only has an opinion about arr[i], not about-of iteration), leaving `next = records[index + 1]` — genuinely capable of running past the array's own end — as the one undefined check this loop actually needs.
  for (const [index, record] of records.entries()) {
    const next = records[index + 1];
    if (next === undefined) {
      continue;
    }
    if (record.type !== RECORD_FORMULA) {
      continue;
    }
    if (next.type === RECORD_SHRFMLA) {
      collectFormulaGroup(groups, record, next, readShrFmlaGroup);
    } else if (next.type === RECORD_ARRAY) {
      collectFormulaGroup(groups, record, next, readArrayGroup);
    }
  }
  return groups;
}

/**
 * Reads one shared/array formula group and keys it by its base Formula record's own cell, degrading a malformed ShrFmla/Array record to "no group recovered for this base cell" rather than letting a BiffFormatError propagate out of collectFormulaGroups and abort the whole sheet read (and every other cell in it, formula or not). readCellHeader and readGroup (readShrFmlaGroup or readArrayGroup) between them make several cursor reads capable of raising that error, not only the final `cursor.take(cce)` that copies out rgce itself: an undersized record already runs out of bytes during readCellHeader's own Cell fields, or during readShrFmlaGroup/readArrayGroup's leading `cursor.skip` past their fixed header, or during the `cursor.u16()` that reads cce — every one of those, like the `take`, is a plain read past this record's own declared bytes, and every one is caught here the same way. This is the same per-record boundary readSupBookSafely already draws for a malformed SupBook (workbook/globals.ts): before this reader ever walked a ShrFmla/Array record's own length fields, a malformed one had nothing here to trip over, so this is entirely new territory the read-every-record-once contract now needs to hold against. A cell whose Formula record points at this base through a PtgExp then resolves to no formula text at all — exactly the same outcome "leaves formula absent for a PtgExp whose base cell has no matching ShrFmla/Array group" already documents for a dangling reference, since from resolveFormulaText's own vantage point the two cases are indistinguishable.
 */
export function collectFormulaGroup(
  groups: Map<string, FormulaGroup>,
  record: RecordGroup,
  next: RecordGroup,
  readGroup: (record: RecordGroup) => FormulaGroup,
): void {
  try {
    const header = readCellHeader(new BlockCursor(record.blocks));
    groups.set(groupKey(header.row, header.column), readGroup(next));
  } catch (error) {
    recoverFromFormatError(error, undefined);
  }
}

/** ShrFmla ([MS-XLS] 984826cc): a RefU range (6 bytes, not needed here — the group is looked up by its base cell's own coordinates, not by re-deriving them from this range), a reserved byte, a cUse byte, then a SharedParsedFormula (458bbec0): a two-byte cce and that many bytes of rgce. Its own rgce is forbidden from containing PtgArray ([MS-XLS] 458bbec0's own "MUST NOT contain... PtgArray"), so no rgcb is read here. */
const SHRFMLA_HEADER_BYTES = 8;

export function readShrFmlaGroup(record: RecordGroup): SharedFormulaGroup {
  const cursor = new BlockCursor(record.blocks);
  cursor.skip(SHRFMLA_HEADER_BYTES);
  const cce = cursor.u16();
  return { kind: "shared", rgce: cursor.take(cce) };
}

/** Array ([MS-XLS] c6ee7512): a Ref range (6 bytes), a flags word (fAlwaysCalc plus reserved bits), four unused bytes, then an ArrayParsedFormula (242bcf20): a two-byte cce, that many bytes of rgce, and — unlike ShrFmla's own SharedParsedFormula — a real rgcb trailer, since an array formula's rgce CAN contain a PtgArray for an array-constant literal used within it (e.g. `{=A1:A3+{1;2;3}}`). rgcb's own length is never stated directly: it is whatever bytes remain in the record once the header and rgce are accounted for. */
const ARRAY_HEADER_BYTES = 12;

export function readArrayGroup(record: RecordGroup): ArrayFormulaGroup {
  const cursor = new BlockCursor(record.blocks);
  cursor.skip(ARRAY_HEADER_BYTES);
  const cce = cursor.u16();
  const rgce = cursor.take(cce);
  // Never negative: cursor.take(cce) just above already proved that many bytes genuinely present, so recordByteLength(record) is provably >= ARRAY_HEADER_BYTES + 2 + cce already. Always taking it (rather than special-casing a non-positive length as undefined) still hands parseFormulaText the exact same "no PtgArray trailer" fact when it is genuinely zero: an empty-but-defined rgcb makes ptg.ts's own rgcbCursor real rather than undefined, but a real cursor with zero bytes left fails on its own very first read exactly as an absent one already does, so a formula needing one resolves to undefined either way, and one that needs none never consults rgcb at all. Reading a length larger than what the record actually holds (a genuine overrun) still throws BiffFormatError, caught below for the same reason as before: a malformed trailer should degrade only this one array formula's group, not abort any other cell's read.
  const rgcbLength = recordByteLength(record) - (ARRAY_HEADER_BYTES + 2 + cce);
  try {
    return { kind: "array", rgce, rgcb: cursor.take(rgcbLength) };
  } catch (error) {
    return recoverFromFormatError(error, {
      kind: "array" as const,
      rgce,
      rgcb: undefined,
    });
  }
}

/** Reads one worksheet substream's records. */
