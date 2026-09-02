import type { ContentSheetRange } from "document-schema.js";
import {
  cellReference,
  parseRangeReference,
  rangeReference,
} from "document-schema.js";

// CT_DataValidation/@sqref and CT_ConditionalFormatting/@sqref share the identical shape: a whitespace-separated list of one or more A1 ranges, confirmed against a real LibreOffice-produced xlsx to carry several disjoint ranges under one rule rather than always one (ExaDev/documents.js#758's own real-producer-colorscale.xlsx fixture writes `sqref="A1 C1"` for a single dataValidation). Shared by typed/xlsx/data-validation.ts and typed/xlsx/conditional-format.ts rather than duplicated in each.

// Parses a sqref attribute into every range it names. Each token may itself be a single cell ("A1") or a genuine span ("A1:B2") -- parseRangeReference already treats a colon-free token as a zero-width range with identical start/end, so this needs no special-casing for the single-cell case. A token that fails to parse is skipped rather than aborting the whole sqref, so one malformed range among several well-formed ones does not lose the rest; an absent or entirely-unparseable sqref returns an empty array, which the caller reads as "nothing to promote structurally."
export function parseSqref(sqref: string | undefined): ContentSheetRange[] {
  if (sqref === undefined) {
    return [];
  }
  const ranges: ContentSheetRange[] = [];
  for (const token of sqref.split(/\s+/)) {
    if (token === "") {
      continue;
    }
    const range = parseRangeReference(token);
    if (range !== undefined) {
      ranges.push(range);
    }
  }
  return ranges;
}

// The write-side inverse of one range: bare cell form ("A1") for a genuinely zero-width range, "A1:B2" for a real span -- matching a real producer's own sqref spelling (the same real-producer-colorscale.xlsx fixture writes the lone cell of its two-range sqref bare, not as "A1:A1").
export function formatSqrefRange(range: ContentSheetRange): string {
  if (
    range.startRow === range.endRow &&
    range.startColumn === range.endColumn
  ) {
    return cellReference(range.startRow, range.startColumn);
  }
  return rangeReference(range);
}

// Multiple ranges join space-separated, each in its own bare/range form above -- the simpler baseline this package's writers use rather than attempting to re-merge adjacent ranges back into one wider token, which the task this module serves explicitly does not require for round-trip correctness.
export function formatSqref(ranges: readonly ContentSheetRange[]): string {
  return ranges.map(formatSqrefRange).join(" ");
}
