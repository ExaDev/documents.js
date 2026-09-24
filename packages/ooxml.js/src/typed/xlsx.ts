import { z } from "zod";
import type { Package } from "../model/package";
import type { XmlElement } from "../model/node";
import {
  attr,
  childrenWithTag,
  elementsWithTag,
  resolveRelationships,
  rootElement,
  textContent,
} from "./util";
import { workbookPartPath } from "./xlsx/parts";
import { loadSharedStrings } from "./xlsx/shared-strings";

// Lossy ergonomic projection of a SpreadsheetML (xlsx) package into a reading view. This is a one-way read view over the generic Package model: it keeps sheet names, cell references, resolved string and numeric values, cell formulas, merged-cell ranges, and defined names, and discards everything else (formats, styles, charts, and all other markup). It is not a round-trip path — encoding this view back to OOXML is not supported.
//
// A different reading view from readXlsxContent (typed/xlsx/content.ts) and from the tree-form readXlsx (typed/document-tree.ts), not a lesser version of either: this one answers "what are the cell values" and nothing else. It held the name readXlsx until that went to the package-native reader; readXlsxWorkbook names what it returns, exactly as readXlsxContent beside it does.

export const XlsxCellSchema = z.object({
  reference: z.string(),
  value: z.string(),
  formula: z.string().optional(),
});
export type XlsxCell = z.infer<typeof XlsxCellSchema>;

export const XlsxSheetSchema = z.object({
  name: z.string(),
  cells: z.array(XlsxCellSchema),
  mergedRanges: z.array(z.string()),
});
export type XlsxSheet = z.infer<typeof XlsxSheetSchema>;

export const DefinedNameSchema = z.object({
  name: z.string(),
  refersTo: z.string(),
});
export type DefinedName = z.infer<typeof DefinedNameSchema>;

export const XlsxWorkbookSchema = z.object({
  sheets: z.array(XlsxSheetSchema),
  definedNames: z.array(DefinedNameSchema),
});
export type XlsxWorkbook = z.infer<typeof XlsxWorkbookSchema>;

const SHEET_PATH_RE = /^xl\/worksheets\/sheet(\d+)\.xml$/;

// Maps worksheet part name -> display name by correlating the workbook's own <sheet name r:id> entries through the workbook's relationships. Both the workbook part and its relationship targets are resolved rather than assumed, so a package that names its workbook something other than xl/workbook.xml still yields sheet names (ExaDev/documents.js#1314).
function resolveSheetNames(pkg: Package): Map<string, string> {
  const names = new Map<string, string>();
  const workbook = rootElement(pkg.parts[workbookPartPath(pkg)]);
  if (workbook === undefined) {
    return names;
  }
  const rels = resolveRelationships(pkg, workbookPartPath(pkg));
  for (const sheet of elementsWithTag(workbook.children, "sheet")) {
    const name = attr(sheet, "name");
    const rid = attr(sheet, "r:id");
    const rel = rid === undefined ? undefined : rels.get(rid);
    if (name !== undefined && rel !== undefined) {
      names.set(rel.target, name);
    }
  }
  return names;
}

// Workbook-level defined names (named ranges), one per <definedName> child under <definedNames> in the workbook part: the name attribute identifies the range, the element text is its reference.
function readDefinedNames(pkg: Package): DefinedName[] {
  const names: DefinedName[] = [];
  const workbook = rootElement(pkg.parts[workbookPartPath(pkg)]);
  if (workbook === undefined) {
    return names;
  }
  for (const container of elementsWithTag(workbook.children, "definedNames")) {
    for (const definedName of childrenWithTag(container, "definedName")) {
      const name = attr(definedName, "name");
      if (name === undefined) {
        continue;
      }
      names.push({ name, refersTo: textContent(definedName) });
    }
  }
  return names;
}

function sheetNumberOf(path: string): number | undefined {
  const match = SHEET_PATH_RE.exec(path);
  const digits = match === null ? undefined : match[1];
  if (digits === undefined) {
    return undefined;
  }
  return Number.parseInt(digits, 10);
}

// A cell is projected only when it has a reference (r) and a resolvable value: t="s" dereferences <v> through the shared-strings table, otherwise <v> is the literal (numeric) value coerced to string. When the cell carries an <f> child, its text becomes the projected formula, carried alongside the value. Cells without <v> (styling-only, or formula cells with no cached value) and unresolvable shared-string references are dropped — that is the defined scope of this lossy projection.
function readCell(
  cell: XmlElement,
  sharedStrings: readonly string[],
): XlsxCell | undefined {
  const reference = attr(cell, "r");
  if (reference === undefined) {
    return undefined;
  }
  const valueEl = childrenWithTag(cell, "v")[0];
  if (valueEl === undefined) {
    return undefined;
  }
  const raw = textContent(valueEl);
  let value: string | undefined;
  if (attr(cell, "t") === "s") {
    const index = Number.parseInt(raw, 10);
    value = Number.isInteger(index) ? sharedStrings[index] : undefined;
  } else {
    value = raw;
  }
  if (value === undefined) {
    return undefined;
  }
  const projected: XlsxCell = { reference, value };
  const formulaEl = childrenWithTag(cell, "f")[0];
  if (formulaEl !== undefined) {
    projected.formula = textContent(formulaEl);
  }
  return projected;
}

function readCells(
  worksheet: XmlElement,
  sharedStrings: readonly string[],
): XlsxCell[] {
  const cells: XlsxCell[] = [];
  for (const row of elementsWithTag(worksheet.children, "row")) {
    for (const cell of childrenWithTag(row, "c")) {
      const projected = readCell(cell, sharedStrings);
      if (projected !== undefined) {
        cells.push(projected);
      }
    }
  }
  return cells;
}

// Merged-cell ranges of a worksheet: each <mergeCell ref="..."> under <mergeCells> contributes one A1-style range string.
function readMergedRanges(worksheet: XmlElement): string[] {
  const ranges: string[] = [];
  for (const mergeCells of elementsWithTag(worksheet.children, "mergeCells")) {
    for (const mergeCell of childrenWithTag(mergeCells, "mergeCell")) {
      const ref = attr(mergeCell, "ref");
      if (ref !== undefined) {
        ranges.push(ref);
      }
    }
  }
  return ranges;
}

// Entry point of the lossy one-way projection: returns the workbook's sheets (display names, cells with resolved values and any formulas, and merged-cell ranges) plus its defined names. Not a round-trip path.
export function readXlsxWorkbook(pkg: Package): XlsxWorkbook {
  const sharedStrings = loadSharedStrings(pkg);
  const names = resolveSheetNames(pkg);
  const definedNames = readDefinedNames(pkg);
  const worksheets = Object.keys(pkg.parts)
    .map((path) => ({ path, number: sheetNumberOf(path) }))
    .filter(
      (entry): entry is { path: string; number: number } =>
        entry.number !== undefined,
    )
    .sort((a, b) => a.number - b.number);
  const sheets: XlsxSheet[] = [];
  for (const { path, number } of worksheets) {
    const root = rootElement(pkg.parts[path]);
    if (root === undefined) {
      continue;
    }
    const name = names.get(path) ?? `Sheet${number}`;
    sheets.push({
      name,
      cells: readCells(root, sharedStrings),
      mergedRanges: readMergedRanges(root),
    });
  }
  return { sheets, definedNames };
}
