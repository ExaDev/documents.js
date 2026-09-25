// The canonical form of everything this writer emits: one canonical* helper per construct family, each stating exactly what reading this writer's own output back produces. Split from write.ts, which keeps the emission side and normaliseOdsContent (the entry point that applies these helpers to both sides of a round-trip equality check).
//
import type {
  Alignment,
  Color,
  ContentCellFill,
  ContentCellValue,
  ContentRun,
  ContentSheet,
  ContentSheetCell,
  ContentSheetColumn,
  ContentSheetConditionalFormat,
  ContentSheetConditionalFormatStyle,
  ContentSheetDataValidation,
  ContentSheetImage,
  ContentSheetPrintSettings,
  ContentSheetRange,
  ContentSheetRow,
} from "document-schema.js";
import {
  colorToRgbHex,
  resolveCellFillColor,
  rgbHexToColor,
} from "document-schema.js";
import { BORDER_EDGE_KEYS } from "../shared/border";
import { segmentOdfParagraphRuns } from "../shared/paragraph-segmentation";
import { DEFAULT_COLUMN_WIDTH_PT, DEFAULT_ROW_HEIGHT_PT } from "./read";
import { canonicalValidationKey } from "./write-validations";
import { assertNeverConditionalFormatType } from "./conditional-format";
// The run-planning and used-range machinery stays in write.ts (the emission side owns it); this module borrows it because the canonical form is defined as exactly what that emission produces once read back. The import cycle between the two modules is safe: every cross-binding use sits inside a hoisted function declaration, never at module top level.
import {
  computeUsedRange,
  formatOdfDuration,
  planCellTextGroups,
} from "./write";

// --- the canonical form: what reading this writer's own output back produces ----------------------------------------

// The office:value attribute's own literal: exactValue (the arbitrary-precision decimal string, when the producer's own value would not survive a bare double round trip) is preferred over String(value) precisely because it is the more precise fact to hand a real spreadsheet application, and reading it back through readCellValue's own `Number(raw)` recovers the identical double either way.
export function formatCellNumberLiteral(
  value: Readonly<{
    value: number;
    exactValue?: string;
  }>,
): string {
  return value.exactValue ?? String(value.value);
}
export function unsupportedCellValueKind(kind: string): Error {
  return new Error(
    `writeOdsContent: a cell carries a "${kind}" value, which this writer does not write — readOdsContent's own reader can never produce this kind for an .ods document (see its own doc comment), so there is no genuine inverse to verify a write against; refusing rather than writing a document that would read back reporting a different value kind than it was given.`,
  );
}
// Reached only if ContentCellValue ever gains a variant a switch over its own kind does not match: every current member is covered wherever this is called, so `value` narrows to `never` at each real call site, and adding an uncovered kind makes that narrowing fail and those calls stop compiling. That is the real safety net. Shared between this module's own writeCellValueAttributes and canonicalCellValue, both of which switch over the identical ContentCellValue['kind'] union, rather than each keeping a byte-identical copy. Exported so write.test.ts can exercise the throw directly with a forced-invalid cast: it is otherwise unreachable, since every real kind is already handled by a case in both.
export function assertNeverContentCellValueKind(value: never): never {
  throw new Error(
    `writeCellValueAttributes: unhandled ContentCellValue kind ${JSON.stringify(value)}`,
  );
}
export function coverageKey(row: number, column: number): string {
  return `${row},${column}`;
}

export function computeCoveredPositions(
  cells: readonly ContentSheetCell[],
): ReadonlySet<string> {
  const covered = new Set<string>();
  for (const cell of cells) {
    const rowSpan = cell.rowSpan ?? 1;
    const colSpan = cell.colSpan ?? 1;
    for (let row = cell.row; row < cell.row + rowSpan; row += 1) {
      for (
        let column = cell.column;
        column < cell.column + colSpan;
        column += 1
      ) {
        if (row !== cell.row || column !== cell.column) {
          covered.add(coverageKey(row, column));
        }
      }
    }
  }
  return covered;
}
// Exported alongside normaliseOdsContent purely for direct unit coverage: normaliseOdsContent applies every canonical* helper below identically to BOTH sides of a round-trip equality check (the actual, real-reader-produced document and the expected, original-document-normalised-the-same-way), so a mutation to one of these helpers alone cannot be observed through that comparison — it changes both sides in lockstep. Each is therefore also pinned directly, against a literal expected return value, in write.test.ts.
export function canonicalColor(color: Readonly<Color>): Color {
  return rgbHexToColor(colorToRgbHex(color));
}

// A cell fill written and read back through this writer: always a 'solid' ContentCellFill, since fo:background-color has no two-colour pattern-fill vocabulary at all (ExaDev/documents.js#951) — sheetCellStyle above resolves a 'pattern' fill to resolveCellFillColor's own single representative colour before it ever reaches ODF, and undefined when that resolves to nothing (a pattern stating neither of its own colours), matching an absent background exactly.
export function canonicalCellFill(
  fill: ContentCellFill,
): ContentCellFill | undefined {
  const color = resolveCellFillColor(fill);
  return color === undefined
    ? undefined
    : { kind: "solid", color: canonicalColor(color) };
}

// A ContentRun carrying only the fields it actually states — the same spelled-only canonical form typed/odt/write.ts's own canonicalRun establishes for wordprocessing runs, restated here rather than imported: the two writers are independent codec modules, and this is a small, self-contained defaulting function rather than a shared abstraction worth coupling them over.
export function canonicalRun(run: ContentRun): ContentRun {
  const canonical: ContentRun = { text: run.text };
  if (run.bold !== undefined) canonical.bold = run.bold;
  if (run.italic !== undefined) canonical.italic = run.italic;
  if (run.underline !== undefined) canonical.underline = run.underline;
  if (run.strike !== undefined) canonical.strike = run.strike;
  if (run.fontFamily !== undefined) canonical.fontFamily = run.fontFamily;
  if (run.sizePt !== undefined) canonical.sizePt = run.sizePt;
  if (run.color !== undefined) canonical.color = canonicalColor(run.color);
  if (run.hyperlink !== undefined) canonical.hyperlink = run.hyperlink;
  return canonical;
}

// The exact runs reading this writer's own cell text back produces: each planCellTextGroups group canonicalised through segmentOdfParagraphRuns (the same fixed point typed/shared/paragraph.ts's own writeOdfParagraph/readOdfParagraph pair already establishes for any ODF text:p), rejoined with a bare {text:'\n'} at every group boundary — exactly the shape readCellText's own synthetic separator produces, regardless of what a same-valued source run originally carried (see isBareNewlineRun's own note on why that asymmetry is unavoidable).
export function canonicalCellRuns(cell: ContentSheetCell): ContentRun[] {
  const groups = planCellTextGroups(cell).map((group) =>
    segmentOdfParagraphRuns(group).map(canonicalRun),
  );
  const combined: ContentRun[] = [];
  groups.forEach((group, index) => {
    if (index > 0) {
      combined.push({ text: "\n" });
    }
    combined.push(...group);
  });
  return combined;
}

// The exact ContentCellValue reading this writer's own written cell back produces. exactValue never survives — readCellValue has no field for it, only ever reading office:value back into the nearest-double `value` — and a 'time' cell reads back as the raw xsd:duration string this writer wrote, per this module's own top-of-file note on that forced, pre-existing asymmetry.
export function canonicalCellValue(value: ContentCellValue): ContentCellValue {
  switch (value.kind) {
    case "number":
      return { kind: "number", value: Number(formatCellNumberLiteral(value)) };
    case "percentage":
      return {
        kind: "percentage",
        value: Number(formatCellNumberLiteral(value)),
      };
    case "currency": {
      const canonical: ContentCellValue = {
        kind: "currency",
        value: Number(formatCellNumberLiteral(value)),
      };
      if (value.currency !== undefined) {
        canonical.currency = value.currency;
      }
      return canonical;
    }
    case "boolean":
      return { kind: "boolean", value: value.value };
    case "date":
      return { kind: "date", value: value.value };
    case "time":
      return { kind: "time", value: formatOdfDuration(value.value) };
    case "string":
      return { kind: "string", value: value.value };
    case "empty":
      return { kind: "empty" };
    case "dateTime":
    case "error":
      throw unsupportedCellValueKind(value.kind);
  }
  return assertNeverContentCellValueKind(value);
}

// One cell's canonical form, or undefined when readOdsContent's own trailing-empty-cell skip drops it entirely: a cell carrying no formula, no office:value-type-bearing value (kind 'empty'), and no rendered text is never materialised by the reader at all, regardless of what colSpan/background/borders it stated — readTable's own skip test (`!hasValueType && formula === undefined && displayText.length === 0`) runs before any of those attributes are even considered. This is a real, forced normalisation, not a writer choice: any of those facts on such a cell is lost on the round trip because ODF's own trailing-empty-cell compression convention has nowhere else to put them.
export function canonicalCell(
  cell: ContentSheetCell,
): ContentSheetCell | undefined {
  const runs = canonicalCellRuns(cell);
  const displayText = runs.map((run) => run.text).join("");
  if (
    cell.value.kind === "empty" &&
    cell.formula === undefined &&
    displayText.length === 0 &&
    cell.comment === undefined
  ) {
    return undefined;
  }

  const canonical: ContentSheetCell = {
    row: cell.row,
    column: cell.column,
    value: canonicalCellValue(cell.value),
    displayText,
  };
  if (cell.formula !== undefined) {
    canonical.formula = cell.formula;
  }
  if (runs.length > 0) {
    canonical.runs = runs;
  }
  if (cell.colSpan !== undefined) {
    canonical.colSpan = cell.colSpan;
  }
  if (cell.rowSpan !== undefined) {
    canonical.rowSpan = cell.rowSpan;
  }
  if (cell.background !== undefined) {
    canonical.background = canonicalCellFill(cell.background);
  }
  if (cell.borders !== undefined) {
    const borders: NonNullable<ContentSheetCell["borders"]> = {};
    for (const edge of BORDER_EDGE_KEYS) {
      const border = cell.borders[edge];
      if (border !== undefined) {
        borders[edge] = {
          color: canonicalColor(border.color),
          widthPt: border.widthPt,
          style: border.style ?? "solid",
        };
      }
    }
    canonical.borders = borders;
  }
  if (cell.alignment !== undefined) {
    canonical.alignment = cell.alignment satisfies Alignment;
  }
  if (cell.verticalAlignment !== undefined) {
    canonical.verticalAlignment = cell.verticalAlignment;
  }
  if (cell.comment !== undefined) {
    canonical.comment = cell.comment;
  }
  return canonical;
}

export function canonicalCells(
  sheet: ContentSheet,
  maxRow: number | undefined,
  maxColumn: number | undefined,
): ContentSheetCell[] {
  if (maxRow === undefined || maxColumn === undefined) {
    return [];
  }
  const cellByPosition = new Map(
    sheet.cells.map((cell) => [coverageKey(cell.row, cell.column), cell]),
  );
  const covered = computeCoveredPositions(sheet.cells);
  const result: ContentSheetCell[] = [];
  for (let row = 0; row <= maxRow; row += 1) {
    for (let column = 0; column <= maxColumn; column += 1) {
      const key = coverageKey(row, column);
      if (covered.has(key)) {
        continue;
      }
      const cell = cellByPosition.get(key);
      if (cell === undefined) {
        continue;
      }
      const canonical = canonicalCell(cell);
      if (canonical !== undefined) {
        result.push(canonical);
      }
    }
  }
  return result;
}

// Dense from 0 to maxColumn/maxRow, an undeclared position stamped with readColumnLayout/readRowLayout's own DEFAULT_COLUMN_WIDTH_PT/DEFAULT_ROW_HEIGHT_PT default — ContentSheetColumn/RowSchema's own "absent widthPt/heightPt means no declared size" cannot be written as a genuinely absent style, since an unstyled table:table-column/-row still resolves to that same reader-side default. A sparse input `columns`/`rows` array is therefore densified on the round trip, one entry per position, exactly as this writer's own dense table:table-column/-row output reads back.
export function canonicalColumns(
  sheet: ContentSheet,
  maxColumn: number | undefined,
): ContentSheetColumn[] {
  if (maxColumn === undefined) {
    return [];
  }
  const byIndex = new Map(
    sheet.columns.map((column) => [column.index, column]),
  );
  const result: ContentSheetColumn[] = [];
  for (let index = 0; index <= maxColumn; index += 1) {
    const declared = byIndex.get(index);
    result.push({
      index,
      widthPt: declared?.widthPt ?? DEFAULT_COLUMN_WIDTH_PT,
      hidden: declared?.hidden === true ? true : undefined,
    });
  }
  return result;
}

export function canonicalRows(
  sheet: ContentSheet,
  maxRow: number | undefined,
): ContentSheetRow[] {
  if (maxRow === undefined) {
    return [];
  }
  const byIndex = new Map(sheet.rows.map((row) => [row.index, row]));
  const result: ContentSheetRow[] = [];
  for (let index = 0; index <= maxRow; index += 1) {
    const declared = byIndex.get(index);
    result.push({
      index,
      heightPt: declared?.heightPt ?? DEFAULT_ROW_HEIGHT_PT,
      hidden: declared?.hidden === true ? true : undefined,
    });
  }
  return result;
}

export function canonicalSheetImage(
  image: ContentSheetImage,
): ContentSheetImage {
  const canonical: ContentSheetImage = {
    kind: "image",
    format: image.format,
    base64: image.base64,
    widthPt: image.widthPt,
    heightPt: image.heightPt,
    anchorRow: image.anchorRow,
    anchorColumn: image.anchorColumn,
    offsetXPt: image.offsetXPt,
    offsetYPt: image.offsetYPt,
  };
  if (image.altText !== undefined) {
    canonical.altText = image.altText;
  }
  return canonical;
}

// Images read back in row-major anchor-position document order (top-to-bottom, then left-to-right), the order readTable's own cell walk discovers them in — never the input array's own order, which this writer's per-position placement does not preserve when several images share no ordering relationship across positions.
export function canonicalImages(sheet: ContentSheet): ContentSheetImage[] {
  return sheet.images
    .map((image, originalIndex) => ({ image, originalIndex }))
    .sort(
      (a, b) =>
        a.image.anchorRow - b.image.anchorRow ||
        a.image.anchorColumn - b.image.anchorColumn ||
        a.originalIndex - b.originalIndex,
    )
    .map(({ image }) => canonicalSheetImage(image));
}

export function canonicalPrintSettings(
  printSettings: ContentSheetPrintSettings,
): ContentSheetPrintSettings {
  const canonical: ContentSheetPrintSettings = {
    pageSize: printSettings.pageSize,
    margins: printSettings.margins,
    gridlines: printSettings.gridlines,
    headers: printSettings.headers,
    pageOrder: printSettings.pageOrder,
  };
  if (printSettings.printRange !== undefined) {
    canonical.printRange = printSettings.printRange;
  }
  if (printSettings.scalePercent !== undefined) {
    canonical.scalePercent = printSettings.scalePercent;
  }
  if (printSettings.fitToPages !== undefined) {
    canonical.fitToPages = printSettings.fitToPages;
  }
  if (printSettings.repeatRows !== undefined) {
    canonical.repeatRows = printSettings.repeatRows;
  }
  if (printSettings.repeatColumns !== undefined) {
    canonical.repeatColumns = printSettings.repeatColumns;
  }
  if (printSettings.manualBreaks !== undefined) {
    canonical.manualBreaks = printSettings.manualBreaks;
  }
  return canonical;
}

// What a sheet's dataValidations read back as, per the read side's own established behaviour rather than chosen here: rules sharing one interned definition merge into one rule carrying the union of their ranges; every range expands to one 1x1 range per stamped cell (readOdsContent's own collect step, one entry per referencing cell, never merged); a position covered by another cell's span carries no reference and so drops out; rules order and range order follow the row-major walk order of first reference; allowBlank is always explicit (the reader's own default); the display flags appear only when true (the reader sets them only on table:display="true"); a list rule always reads an operator of "equal" and a custom rule never reads one (data-validation.ts's own CONDITION_INFOS fixed mappings); a list or custom rule with no formula1 has no condition to write and reads back as a bare custom rule; and a rule whose every position sat under a span is referenced by nothing and vanishes.
// The merge key for canonicalisation is the rule's WRITTEN content — see canonicalValidationKey's own note above.
export function canonicalDataValidations(
  sheet: ContentSheet,
): ContentSheetDataValidation[] | undefined {
  if (sheet.dataValidations === undefined) {
    return undefined;
  }
  const covered = computeCoveredPositions(sheet.cells);
  const byKey = new Map<
    string,
    { rule: ContentSheetDataValidation; ranges: ContentSheetRange[] }
  >();
  for (const rule of sheet.dataValidations) {
    const key = canonicalValidationKey(rule);
    let merged = byKey.get(key);
    if (merged === undefined) {
      merged = { rule, ranges: [] };
      byKey.set(key, merged);
    }
    for (const range of rule.ranges) {
      for (let row = range.startRow; row <= range.endRow; row += 1) {
        for (
          let column = range.startColumn;
          column <= range.endColumn;
          column += 1
        ) {
          if (!covered.has(coverageKey(row, column))) {
            merged.ranges.push({
              startRow: row,
              startColumn: column,
              endRow: row,
              endColumn: column,
            });
          }
        }
      }
    }
  }
  const canonical: ContentSheetDataValidation[] = [];
  for (const { rule, ranges } of byKey.values()) {
    if (ranges.length === 0) {
      continue;
    }
    ranges.sort(
      (a, b) => a.startRow - b.startRow || a.startColumn - b.startColumn,
    );
    if (
      (rule.type === "list" || rule.type === "custom") &&
      rule.formula1 === undefined
    ) {
      // No condition to write at all: the definition carries no table:condition, which readContentValidation itself degrades to a bare custom rule.
      canonical.push({ type: "custom", ranges, allowBlank: true });
      continue;
    }
    const base: ContentSheetDataValidation = {
      ...rule,
      ranges,
      allowBlank: rule.allowBlank ?? true,
    };
    if (base.type === "list") {
      base.operator = "equal";
    } else if (base.type === "custom") {
      delete base.operator;
    }
    canonical.push(base);
  }
  canonical.sort(
    (a, b) =>
      (a.ranges[0]?.startRow ?? 0) - (b.ranges[0]?.startRow ?? 0) ||
      (a.ranges[0]?.startColumn ?? 0) - (b.ranges[0]?.startColumn ?? 0),
  );
  return canonical;
}

// What one conditional-format style reads back as: the two colour properties that actually round-trip through a minted named style, or no style field at all when neither is present (the read side resolves no style from a style element carrying no colour properties — a source-only style is indistinguishable from none).
export function canonicalConditionalFormatStyle(
  style: ContentSheetConditionalFormatStyle | undefined,
):
  | { textColor: Color; background?: never }
  | { background: Color; textColor?: never }
  | undefined {
  if (style?.textColor !== undefined) {
    return { textColor: style.textColor };
  }
  if (style?.background !== undefined) {
    return { background: style.background };
  }
  return undefined;
}

// What a sheet's conditionalFormats read back as: the writer's own emission order preserved (the read side promotes each wrapper's children in document order), each rule's quarantined source dropped, and each style narrowed per canonicalConditionalFormatStyle. The precedence fields never appear here because the writer refuses a rule carrying them before any of this runs.
export function canonicalConditionalFormats(
  sheet: ContentSheet,
): ContentSheetConditionalFormat[] | undefined {
  if (sheet.conditionalFormats === undefined) {
    return undefined;
  }
  return sheet.conditionalFormats.map((format) => {
    const ranges = format.ranges;
    switch (format.type) {
      case "cellIs":
        return {
          type: "cellIs" as const,
          ranges,
          operator: format.operator,
          formula1: format.formula1,
          ...(format.formula2 !== undefined
            ? { formula2: format.formula2 }
            : {}),
          ...(canonicalConditionalFormatStyle(format.style) !== undefined
            ? { style: canonicalConditionalFormatStyle(format.style) }
            : {}),
        };
      case "containsText":
      case "notContainsText":
      case "beginsWith":
      case "endsWith":
        return {
          type: format.type,
          ranges,
          text: format.text,
          ...(canonicalConditionalFormatStyle(format.style) !== undefined
            ? { style: canonicalConditionalFormatStyle(format.style) }
            : {}),
        };
      case "containsBlanks":
      case "notContainsBlanks":
      case "containsErrors":
      case "notContainsErrors":
      case "uniqueValues":
      case "duplicateValues":
        return {
          type: format.type,
          ranges,
          ...(canonicalConditionalFormatStyle(format.style) !== undefined
            ? { style: canonicalConditionalFormatStyle(format.style) }
            : {}),
        };
      case "top10":
        return {
          type: "top10" as const,
          ranges,
          rank: format.rank,
          ...(format.percent !== undefined ? { percent: format.percent } : {}),
          ...(format.bottom !== undefined ? { bottom: format.bottom } : {}),
          ...(canonicalConditionalFormatStyle(format.style) !== undefined
            ? { style: canonicalConditionalFormatStyle(format.style) }
            : {}),
        };
      case "aboveAverage":
        return {
          type: "aboveAverage" as const,
          ranges,
          ...(format.aboveAverage !== undefined
            ? { aboveAverage: format.aboveAverage }
            : {}),
          ...(format.equalAverage !== undefined
            ? { equalAverage: format.equalAverage }
            : {}),
          ...(canonicalConditionalFormatStyle(format.style) !== undefined
            ? { style: canonicalConditionalFormatStyle(format.style) }
            : {}),
        };
      case "timePeriod":
        return {
          type: "timePeriod" as const,
          ranges,
          timePeriod: format.timePeriod,
          ...(canonicalConditionalFormatStyle(format.style) !== undefined
            ? { style: canonicalConditionalFormatStyle(format.style) }
            : {}),
        };
      case "colorScale":
        return { type: "colorScale" as const, ranges, stops: format.stops };
      case "dataBar":
        return {
          type: "dataBar" as const,
          ranges,
          min: format.min,
          max: format.max,
          color: format.color,
          ...(format.showValue !== undefined
            ? { showValue: format.showValue }
            : {}),
        };
      case "iconSet":
        return {
          type: "iconSet" as const,
          ranges,
          iconSetType: format.iconSetType,
          thresholds: format.thresholds,
          ...(format.showValue !== undefined
            ? { showValue: format.showValue }
            : {}),
        };
    }
    return assertNeverConditionalFormatType(format);
  });
}

export function canonicalSheet(sheet: ContentSheet): ContentSheet {
  const { maxRow, maxColumn } = computeUsedRange(sheet);
  const canonical: ContentSheet = {
    name: sheet.name,
    cells: canonicalCells(sheet, maxRow, maxColumn),
    columns: canonicalColumns(sheet, maxColumn),
    rows: canonicalRows(sheet, maxRow),
    images: canonicalImages(sheet),
    printSettings: canonicalPrintSettings(sheet.printSettings),
  };
  const dataValidations = canonicalDataValidations(sheet);
  if (dataValidations !== undefined && dataValidations.length > 0) {
    canonical.dataValidations = dataValidations;
  }
  const conditionalFormats = canonicalConditionalFormats(sheet);
  if (conditionalFormats !== undefined && conditionalFormats.length > 0) {
    canonical.conditionalFormats = conditionalFormats;
  }
  return canonical;
}
