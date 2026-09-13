import type {
  ContentDefinedName,
  ContentSheetPrintRange,
  ContentSheetRepeatRange,
} from "document-schema.js";
import type { Package } from "../../model/package";
import { attr, childrenWithTag, rootElement, textContent } from "../util";
import {
  columnIndexToLetters,
  columnLettersToIndex,
  parseRangeReference,
} from "document-schema.js";

// xl/workbook.xml's own print-area and print-titles mechanism: NOT a per-sheet attribute of any kind, but two reserved, sheet-scoped workbook-level defined names -- confirmed against real LibreOffice output (see typed/xlsx/content.test.ts's own kitchen-sink fixture): <definedName localSheetId="0" name="_xlnm.Print_Area">Data!$A$1:$I$20</definedName> and <definedName localSheetId="0" name="_xlnm.Print_Titles">Data!$A:$A,Data!$1:$1</definedName>. ECMA-376 Part 1 SS18.2.6 reserves the "_xlnm." prefix for exactly this purpose (Print_Area, Print_Titles, and others this reader doesn't need); localSheetId is the 0-based index of the sheet the name applies to, in xl/workbook.xml's own <sheets> document order -- the SAME order typed/xlsx/content.ts's own sheet-resolution walk already produces, so a caller need only pass that same 0-based index through.

export interface SheetDefinedNames {
  printArea?: string;
  printTitles?: string;
}

export const XLNM_PRINT_AREA = "_xlnm.Print_Area";
export const XLNM_PRINT_TITLES = "_xlnm.Print_Titles";

// Reads every sheet-scoped _xlnm.Print_Area/_xlnm.Print_Titles defined name in xl/workbook.xml into a Map keyed by localSheetId. A defined name with no localSheetId (workbook-scoped, not sheet-scoped) is out of this reader's scope -- Print_Area/Print_Titles are always written sheet-scoped by every real producer this package targets.
export function readDefinedNamesBySheet(
  pkg: Package,
): Map<number, SheetDefinedNames> {
  const map = new Map<number, SheetDefinedNames>();
  const workbook = rootElement(pkg.parts["xl/workbook.xml"]);
  if (workbook === undefined) {
    return map;
  }
  const container = childrenWithTag(workbook, "definedNames")[0];
  if (container === undefined) {
    return map;
  }
  for (const definedName of childrenWithTag(container, "definedName")) {
    const localSheetIdRaw = attr(definedName, "localSheetId");
    if (localSheetIdRaw === undefined) {
      continue;
    }
    // A definedName with no name at all can never equal either reserved name below, so it is already excluded by that check alone -- no separate `name === undefined` guard is needed first.
    const name = attr(definedName, "name");
    if (name !== XLNM_PRINT_AREA && name !== XLNM_PRINT_TITLES) {
      continue;
    }
    const sheetIndex = Number.parseInt(localSheetIdRaw, 10);
    if (!Number.isInteger(sheetIndex) || sheetIndex < 0) {
      continue;
    }
    const value = textContent(definedName);
    const existing = map.get(sheetIndex) ?? {};
    if (name === XLNM_PRINT_AREA) {
      existing.printArea = value;
    } else {
      existing.printTitles = value;
    }
    map.set(sheetIndex, existing);
  }
  return map;
}

// Every defined name in xl/workbook.xml as the schema's own ContentDefinedName carries it: refersTo VERBATIM (the element's own text, in Excel's own formula language -- the identical "no closed grammar without a general formula engine" reasoning ContentSheetCell.formula already records), and a sheet-scoped name's localSheetId mapped onto scopeSheetIndex, which indexes the SAME <sheets> document order this package reads sheets in. The _xlnm built-ins are included rather than filtered: they are definedName entries like any other, and the two print names the print-settings reader additionally promotes into structured printRange/repeatRows fields still belong to the workbook's own name list. Order is the file's own document order, the only order a same-format writer can hope to reproduce.
export function readWorkbookNames(pkg: Package): ContentDefinedName[] {
  const workbook = rootElement(pkg.parts["xl/workbook.xml"]);
  if (workbook === undefined) {
    return [];
  }
  const container = childrenWithTag(workbook, "definedNames")[0];
  if (container === undefined) {
    return [];
  }
  const names: ContentDefinedName[] = [];
  for (const definedName of childrenWithTag(container, "definedName")) {
    const name = attr(definedName, "name");
    if (name === undefined) {
      continue;
    }
    const localSheetIdRaw = attr(definedName, "localSheetId");
    const localSheetId =
      localSheetIdRaw === undefined
        ? undefined
        : Number.parseInt(localSheetIdRaw, 10);
    names.push({
      name,
      refersTo: textContent(definedName),
      ...(localSheetId !== undefined &&
      Number.isInteger(localSheetId) &&
      localSheetId >= 0
        ? { scopeSheetIndex: localSheetId }
        : {}),
    });
  }
  return names;
}

// Strips a leading "SheetName!" (or "'Sheet Name'!") prefix from one reference segment. Excel sheet names cannot themselves contain "!" (a reserved formula character), so the LAST "!" in the segment unambiguously separates the sheet-name prefix from the cell/range reference that follows, with no need to parse the optional single-quote sheet-name quoting at all. No ternary is needed for the no-"!"-at-all case: lastIndexOf returns -1 then, and slice(-1 + 1) is slice(0), which already returns the whole segment unchanged.
function stripSheetPrefix(segment: string): string {
  const bang = segment.lastIndexOf("!");
  return segment.slice(bang + 1);
}

// _xlnm.Print_Area's value is a comma-separated list of one or more absolute ranges (Excel supports multiple non-contiguous print areas per sheet); ContentSheetPrintSettings.printRange models only ONE, so -- matching document-schema.js's own documented odf.js precedent for the identical ODF table:print-ranges scope boundary -- only the first range is parsed, and it is a documented, narrow scope boundary rather than a silent one.
export function parsePrintAreaValue(
  value: string,
): ContentSheetPrintRange | undefined {
  // Found via indexOf/slice rather than value.split(",")[0], so `first` is always a definite string (never possibly-undefined under noUncheckedIndexedAccess) with no separate emptiness guard needed: an empty (or whitespace-only) first segment already parses to no range at all, since stripSheetPrefix/replace leave it empty and parseRangeReference("") returns undefined on its own.
  const commaIndex = value.indexOf(",");
  const first = (commaIndex === -1 ? value : value.slice(0, commaIndex)).trim();
  return parseRangeReference(stripSheetPrefix(first).replace(/\$/g, ""));
}

interface PrintTitles {
  repeatRows?: ContentSheetRepeatRange;
  repeatColumns?: ContentSheetRepeatRange;
}

// _xlnm.Print_Titles' value is a comma-separated list of up to two segments, each a FULL-COLUMN range ("$A:$C", letters only on both sides -- the repeated-columns band) or a FULL-ROW range ("$1:$3", digits only on both sides -- the repeated-rows band); a segment matching neither shape (a genuine cell-to-cell range would be malformed here) is skipped.
export function parsePrintTitlesValue(value: string): PrintTitles {
  const result: PrintTitles = {};
  for (const rawSegment of value.split(",")) {
    const segment = stripSheetPrefix(rawSegment.trim()).replace(/\$/g, "");
    const separatorIndex = segment.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }
    const startSpec = segment.slice(0, separatorIndex);
    const endSpec = segment.slice(separatorIndex + 1);
    // columnLettersToIndex already rejects anything but a non-empty run of letters (document-schema.js's own a1.ts), so trying it directly on both sides -- rather than gating first on a letters-only regex -- rejects exactly the same inputs: no separate regex test is needed to tell them apart.
    const startColumn = columnLettersToIndex(startSpec);
    const endColumn = columnLettersToIndex(endSpec);
    if (startColumn !== undefined && endColumn !== undefined) {
      result.repeatColumns = {
        start: Math.min(startColumn, endColumn),
        end: Math.max(startColumn, endColumn),
      };
    } else if (/^\d+$/.test(startSpec) && /^\d+$/.test(endSpec)) {
      const start = Number.parseInt(startSpec, 10) - 1;
      const end = Number.parseInt(endSpec, 10) - 1;
      result.repeatRows = {
        start: Math.min(start, end),
        end: Math.max(start, end),
      };
    }
  }
  return result;
}

// Excel quotes a sheet name in a formula/defined-name reference whenever it contains anything other than letters, digits, or underscores (spaces, punctuation, a leading digit, ...) -- a conservative superset of the real ECMA-376 grammar's own reserved-character rule, safe to over-quote but never safe to under-quote. An embedded single quote is escaped by doubling it, Excel's own convention for a quoted sheet name. Exported for typed/xlsx/drawings-write.ts, which quotes a chart series' own sheet-qualified range formula the identical way.
export function quoteSheetNameIfNeeded(sheetName: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(sheetName)) {
    return sheetName;
  }
  return `'${sheetName.replace(/'/g, "''")}'`;
}

// The write-side inverse of parsePrintAreaValue: builds a _xlnm.Print_Area defined-name value for one sheet's own print range. Built directly from the range's own row/column indices rather than dollar-signing rangeReference's own formatted "A1:B2" string with a regex: the same structured values are available already, so there is no formatted string to re-parse in the first place.
export function buildPrintAreaValue(
  sheetName: string,
  range: ContentSheetPrintRange,
): string {
  const start = `$${columnIndexToLetters(range.startColumn)}$${range.startRow + 1}`;
  const end = `$${columnIndexToLetters(range.endColumn)}$${range.endRow + 1}`;
  return `${quoteSheetNameIfNeeded(sheetName)}!${start}:${end}`;
}

// The write-side inverse of parsePrintTitlesValue: builds a _xlnm.Print_Titles defined-name value from whichever of repeatRows/repeatColumns is present (order matches this package's own kitchen-sink fixture: columns segment first, then rows).
export function buildPrintTitlesValue(
  sheetName: string,
  repeatRows: ContentSheetRepeatRange | undefined,
  repeatColumns: ContentSheetRepeatRange | undefined,
): string | undefined {
  const quotedName = quoteSheetNameIfNeeded(sheetName);
  const segments: string[] = [];
  if (repeatColumns !== undefined) {
    segments.push(
      `${quotedName}!$${columnIndexToLetters(repeatColumns.start)}:$${columnIndexToLetters(repeatColumns.end)}`,
    );
  }
  if (repeatRows !== undefined) {
    segments.push(
      `${quotedName}!$${repeatRows.start + 1}:$${repeatRows.end + 1}`,
    );
  }
  return segments.length > 0 ? segments.join(",") : undefined;
}
