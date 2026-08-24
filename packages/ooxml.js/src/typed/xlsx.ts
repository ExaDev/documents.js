import { z } from "zod";
import type { Package } from "../model/package";
import type { XmlElement } from "../model/node";
import {
  attr,
  childrenWithTag,
  elementsWithTag,
  rootElement,
  textContent,
} from "./util";
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

// Targets in xl/_rels/workbook.xml.rels are relative to the rels part's directory (xl/), so "worksheets/sheet1.xml" resolves to "xl/worksheets/sheet1.xml"; a leading slash is already package-rooted.
function resolveRelTarget(target: string): string {
  if (target.startsWith("/")) {
    return target.slice(1);
  }
  return `xl/${target}`;
}

// Maps relationship Id -> resolved worksheet part name, so a workbook <sheet r:id="..."> can be matched to its xl/worksheets/sheetN.xml path.
function relTargets(pkg: Package): Map<string, string> {
  const map = new Map<string, string>();
  const rels = rootElement(pkg.parts["xl/_rels/workbook.xml.rels"]);
  if (rels === undefined) {
    return map;
  }
  for (const rel of childrenWithTag(rels, "Relationship")) {
    const id = attr(rel, "Id");
    const target = attr(rel, "Target");
    if (id !== undefined && target !== undefined) {
      map.set(id, resolveRelTarget(target));
    }
  }
  return map;
}

// Maps worksheet part name -> display name by correlating xl/workbook.xml <sheet name r:id> entries through the workbook rels.
function resolveSheetNames(pkg: Package): Map<string, string> {
  const names = new Map<string, string>();
  const workbook = rootElement(pkg.parts["xl/workbook.xml"]);
  if (workbook === undefined) {
    return names;
  }
  const targets = relTargets(pkg);
  for (const sheet of elementsWithTag(workbook.children, "sheet")) {
    const name = attr(sheet, "name");
    const rid = attr(sheet, "r:id");
    if (name !== undefined && rid !== undefined) {
      const partName = targets.get(rid);
      if (partName !== undefined) {
        names.set(partName, name);
      }
    }
  }
  return names;
}

// Workbook-level defined names (named ranges), one per <definedName> child under <definedNames> in xl/workbook.xml: the name attribute identifies the range, the element text is its reference.
function readDefinedNames(pkg: Package): DefinedName[] {
  const names: DefinedName[] = [];
  const workbook = rootElement(pkg.parts["xl/workbook.xml"]);
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
  sharedStrings: string[],
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

function readCells(worksheet: XmlElement, sharedStrings: string[]): XlsxCell[] {
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
