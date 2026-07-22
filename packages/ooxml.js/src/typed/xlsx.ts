import { z } from 'zod';
import type { Package } from '../model/package';
import type { XmlElement } from '../model/node';
import { attr, childrenWithTag, elementsWithTag, rootElement, textContent } from './util';

// Lossy ergonomic projection of a SpreadsheetML (xlsx) package's cell values. This is a one-way read view over the generic Package model: it keeps only meaningful spreadsheet content (sheet names, cell references, resolved string and numeric values) and discards everything else (formats, styles, formulas, merged cells, charts). It is not a round-trip path — encoding this view back to OOXML is not supported.

export const XlsxCellSchema = z.object({
  reference: z.string(),
  value: z.string(),
});
export type XlsxCell = z.infer<typeof XlsxCellSchema>;

export const XlsxSheetSchema = z.object({
  name: z.string(),
  cells: z.array(XlsxCellSchema),
});
export type XlsxSheet = z.infer<typeof XlsxSheetSchema>;

export const XlsxWorkbookSchema = z.object({
  sheets: z.array(XlsxSheetSchema),
});
export type XlsxWorkbook = z.infer<typeof XlsxWorkbookSchema>;

const SHEET_PATH_RE = /^xl\/worksheets\/sheet(\d+)\.xml$/;

// Shared strings: each <si> holds one or more <t> runs (plain text, or rich-text runs nested in <r>); their text concatenates into the indexed string value.
function loadSharedStrings(pkg: Package): string[] {
  const root = rootElement(pkg.parts['xl/sharedStrings.xml']);
  if (root === undefined) {
    return [];
  }
  const strings: string[] = [];
  for (const si of childrenWithTag(root, 'si')) {
    let value = '';
    for (const t of elementsWithTag(si.children, 't')) {
      value += textContent(t);
    }
    strings.push(value);
  }
  return strings;
}

// Targets in xl/_rels/workbook.xml.rels are relative to the rels part's directory (xl/), so "worksheets/sheet1.xml" resolves to "xl/worksheets/sheet1.xml"; a leading slash is already package-rooted.
function resolveRelTarget(target: string): string {
  if (target.startsWith('/')) {
    return target.slice(1);
  }
  return `xl/${target}`;
}

// Maps relationship Id -> resolved worksheet part name, so a workbook <sheet r:id="..."> can be matched to its xl/worksheets/sheetN.xml path.
function relTargets(pkg: Package): Map<string, string> {
  const map = new Map<string, string>();
  const rels = rootElement(pkg.parts['xl/_rels/workbook.xml.rels']);
  if (rels === undefined) {
    return map;
  }
  for (const rel of childrenWithTag(rels, 'Relationship')) {
    const id = attr(rel, 'Id');
    const target = attr(rel, 'Target');
    if (id !== undefined && target !== undefined) {
      map.set(id, resolveRelTarget(target));
    }
  }
  return map;
}

// Maps worksheet part name -> display name by correlating xl/workbook.xml <sheet name r:id> entries through the workbook rels.
function resolveSheetNames(pkg: Package): Map<string, string> {
  const names = new Map<string, string>();
  const workbook = rootElement(pkg.parts['xl/workbook.xml']);
  if (workbook === undefined) {
    return names;
  }
  const targets = relTargets(pkg);
  for (const sheet of elementsWithTag(workbook.children, 'sheet')) {
    const name = attr(sheet, 'name');
    const rid = attr(sheet, 'r:id');
    if (name !== undefined && rid !== undefined) {
      const partName = targets.get(rid);
      if (partName !== undefined) {
        names.set(partName, name);
      }
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

// A cell models only when it has a reference (r) and a resolvable value: t="s" dereferences <v> through the shared-strings table, otherwise <v> is the literal (numeric) value coerced to string. Cells without <v> (styling-only, or formula cells with no cached value) and unresolvable shared-string references are dropped — that is the defined scope of this lossy projection.
function readCell(cell: XmlElement, sharedStrings: string[]): XlsxCell | undefined {
  const reference = attr(cell, 'r');
  if (reference === undefined) {
    return undefined;
  }
  const valueEl = childrenWithTag(cell, 'v')[0];
  if (valueEl === undefined) {
    return undefined;
  }
  const raw = textContent(valueEl);
  let value: string | undefined;
  if (attr(cell, 't') === 's') {
    const index = Number.parseInt(raw, 10);
    value = Number.isInteger(index) ? sharedStrings[index] : undefined;
  } else {
    value = raw;
  }
  if (value === undefined) {
    return undefined;
  }
  return { reference, value };
}

function readCells(worksheet: XmlElement, sharedStrings: string[]): XlsxCell[] {
  const cells: XlsxCell[] = [];
  for (const row of elementsWithTag(worksheet.children, 'row')) {
    for (const cell of childrenWithTag(row, 'c')) {
      const projected = readCell(cell, sharedStrings);
      if (projected !== undefined) {
        cells.push(projected);
      }
    }
  }
  return cells;
}

export function readXlsx(pkg: Package): XlsxWorkbook {
  const sharedStrings = loadSharedStrings(pkg);
  const names = resolveSheetNames(pkg);
  const worksheets = Object.keys(pkg.parts)
    .map((path) => ({ path, number: sheetNumberOf(path) }))
    .filter((entry): entry is { path: string; number: number } => entry.number !== undefined)
    .sort((a, b) => a.number - b.number);
  const sheets: XlsxSheet[] = [];
  for (const { path, number } of worksheets) {
    const root = rootElement(pkg.parts[path]);
    if (root === undefined) {
      continue;
    }
    const name = names.get(path) ?? `Sheet${number}`;
    sheets.push({ name, cells: readCells(root, sharedStrings) });
  }
  return { sheets };
}
