import type { PageSize } from "document-schema.js";
import { PAGE_SIZE_A4, PAGE_SIZE_LETTER } from "document-schema.js";
import { POINTS_PER_INCH } from "../shared/units";

// Small SpreadsheetML-specific helpers shared by typed/xlsx/content.ts (read) and typed/xlsx/build.ts (write) that don't fit a1.ts (cell references) or units.ts (column-width/row-height geometry): xsd:boolean attribute values, ST_PositiveUniversalMeasure length strings, and the ST_PaperSize enumeration.

// ECMA-376 attributes typed xsd:boolean accept both "0"/"1" and "false"/"true" -- real producers use both forms (LibreOffice writes "true"/"false"; Excel itself more often writes "1", or omits the attribute entirely for false). An absent attribute is false, matching xsd:boolean's own default-false convention for every boolean this package reads.
export function readXmlBool(value: string | undefined): boolean {
  return value === "1" || value === "true";
}

// This package's own writer always emits the "true"/"false" spelling (not "1"/"0") -- an arbitrary but consistent choice between the two spec-legal forms, matching what LibreOffice itself writes (see this package's own kitchen-sink fixture) rather than what Excel writes, so a produced file's own boolean attributes are maximally readable by a human inspecting the XML.
export function writeXmlBool(value: boolean): string {
  return value ? "true" : "false";
}

const UNIVERSAL_MEASURE_RE = /^(-?\d+(?:\.\d+)?)(mm|cm|in|pt|pc|pi)$/;

// ST_PositiveUniversalMeasure (ECMA-376 Part 1 SS22.9.2.15 and its non-negative-only sibling): a decimal number immediately followed by a unit suffix, used by <pageSetup>'s own paperWidth/paperHeight attributes for a paper size ECMA-376's own ST_PaperSize enumeration has no code for. Only the units real producers actually emit for this attribute are supported (mm/cm/in/pt/pica); "pc" and "pi" are both accepted spellings for a pica (1/6 inch = 12pt) per the same schema clause.
export function parseUniversalMeasureToPt(value: string): number | undefined {
  const match = UNIVERSAL_MEASURE_RE.exec(value.trim());
  if (match === null) {
    return undefined;
  }
  const amountRaw = match[1];
  const unit = match[2];
  if (amountRaw === undefined || unit === undefined) {
    return undefined;
  }
  const amount = Number(amountRaw);
  switch (unit) {
    case "mm":
      return (amount / 25.4) * POINTS_PER_INCH;
    case "cm":
      return (amount / 2.54) * POINTS_PER_INCH;
    case "in":
      return amount * POINTS_PER_INCH;
    case "pt":
      return amount;
    case "pc":
    case "pi":
      return amount * 12;
    default:
      return undefined;
  }
}

// The write-side counterpart of parseUniversalMeasureToPt: formats a point value as a centimetre-suffixed ST_PositiveUniversalMeasure string (matching the unit real producers use most often for this attribute), rounded to two decimal places.
export function ptToUniversalMeasure(pt: number): string {
  const cm = (pt / POINTS_PER_INCH) * 2.54;
  return `${cm.toFixed(2)}cm`;
}

// ECMA-376 Part 1 SS18.17.2.34 (ST_PaperSize): only the two paper sizes this package's own content model already names as constants (PAGE_SIZE_LETTER, PAGE_SIZE_A4) are mapped -- 1 = Letter (8.5in x 11in), 9 = A4 (210mm x 297mm). Confirmed against both the ClosedXML wiki's own "Paper Size Lookup Table" and PhpSpreadsheet's PageSetup documentation, which enumerate the full ST_PaperSize code list identically. Any other code (Legal, A3, Tabloid, ...) is a genuine, documented scope narrowing -- this reader falls back to explicit paperWidth/paperHeight (see parseUniversalMeasureToPt above) or, failing that, PAGE_SIZE_LETTER, rather than growing a full paper-size table this package's own model has no constants for.
const PAPER_SIZE_BY_CODE: Readonly<Record<string, PageSize>> = {
  "1": PAGE_SIZE_LETTER,
  "9": PAGE_SIZE_A4,
};

export function paperSizeCodeToPageSize(code: string): PageSize | undefined {
  return PAPER_SIZE_BY_CODE[code];
}

// The write-side inverse: a page size within half a point of a known constant writes that constant's own paper code (so a round-tripped Letter/A4 page size doesn't drift into an explicit paperWidth/paperHeight pair); anything else returns undefined, telling the caller to write explicit paperWidth/paperHeight instead.
const PAPER_SIZE_TOLERANCE_PT = 0.5;

function approximatelyEquals(a: number, b: number): boolean {
  return Math.abs(a - b) <= PAPER_SIZE_TOLERANCE_PT;
}

export function pageSizeToPaperSizeCode(
  pageSize: PageSize,
): string | undefined {
  if (
    approximatelyEquals(pageSize.widthPt, PAGE_SIZE_LETTER.widthPt) &&
    approximatelyEquals(pageSize.heightPt, PAGE_SIZE_LETTER.heightPt)
  ) {
    return "1";
  }
  if (
    approximatelyEquals(pageSize.widthPt, PAGE_SIZE_A4.widthPt) &&
    approximatelyEquals(pageSize.heightPt, PAGE_SIZE_A4.heightPt)
  ) {
    return "9";
  }
  return undefined;
}
