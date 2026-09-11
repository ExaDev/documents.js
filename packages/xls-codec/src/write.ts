import {
  hasSummaryInformationFields,
  writeCompoundFile,
  writeSummaryInformationStream,
} from "archive-codec";
import type {
  Alignment,
  Color,
  ContentBorder,
  ContentCellFill,
  ContentDocument,
  ContentSheet,
  ContentSheetCell,
  DocumentTree,
} from "document-schema.js";
import {
  colorToRgbHex,
  flattenTree,
  unrecognizedFillKind,
} from "document-schema.js";

import {
  BUILTIN_NUMBER_FORMATS,
  isIsoCurrencyCodeShape,
} from "excel-number-format";

import { BiffWriteError } from "./biff/write-errors";
import {
  NORMAL_FONT_FIELDS,
  xfFontFieldsOf,
  type XfFontFields,
} from "./biff/font";
import {
  BORDER_STYLE_NONE,
  borderStyleTokenFor,
  DEFAULT_PALETTE_HEX_TO_ICV,
  FILL_PATTERN_NONE,
  FILL_PATTERN_SOLID,
  ICV_AUTOMATIC_BACKGROUND,
  ICV_AUTOMATIC_FOREGROUND,
  PALETTE_BASE_ICV,
  PALETTE_ENTRY_COUNT,
  PATTERN_TYPE_TO_FILL_PATTERN,
  type XfBorderEdge,
  type XfDecorationFields,
} from "./biff/xf-colors";
import type { XlsContentDocument } from "./content";
import { SUMMARY_INFORMATION_STREAM } from "./container";
import { layoutMetadataToSummaryInformation } from "./metadata";
import {
  buildWorkbookGlobals,
  GENERAL_CELL_XF_INDEX,
  type CellXfPlanEntry,
  type WorkbookGlobalsPlan,
} from "./workbook/globals-writer";
import { definedNameEntriesFor } from "./workbook/defined-names";
import {
  printNameEntriesFor,
  type PrintNamePlanEntry,
} from "./workbook/print-names";
import {
  buildWorksheetSubstream,
  type SheetWriteContext,
} from "./workbook/sheet-writer";
import { buildDrawingWritePlan } from "./workbook/drawing-writer";
import { cellCarriesFormatting, writesCellRecord } from "./written-cells";

// The BIFF8 write path: a ContentDocument (or DocumentTree) of kind 'spreadsheet' back to real .xls bytes -- a genuine [MS-XLS] Workbook stream wrapped in a genuine [MS-CFB] compound file via archive-codec's writeCompoundFile. The counterpart of content.ts's readXlsContent/readXls, and of ooxml.js's own writeXlsx.
//
// Three things are workbook-wide rather than per-sheet, so they are resolved in one pass over every sheet before any record is written: the number-format table (a cell's own numberFormatCode, or a representative default for its value kind when absent, maps onto a shared BIFF8 format identifier the same code reuses everywhere it appears), the colour table (every distinct background, border, and font colour a cell uses, resolved to an icv against the fixed default palette or, when a colour genuinely isn't in it, a real Palette record this pass mints), and the shared string table (every distinct string value, in first-encountered order, referenced by index from a LabelSst cell in any sheet). Two further passes intern the cell-format axes: buildFontPlan gives each distinct cell font its own font-table entry, then buildCellXfPlan interns the (number format, font, alignment, decoration) tuple every cell resolves to into its own cell XF index -- two cells sharing all four share one XF record, mirroring how ooxml.js's own CellFormatTable dedupes an xlsx <xf> on the identical (format, decoration) pair, widened here by two more axes. Building each of these once and threading the result into every sheet's own writer is what keeps two cells in different sheets sharing the identical string, format, font, alignment, or decoration from minting redundant table entries.
//
// See this package's README for the writer's own scope: what it covers (every cell value kind, merged ranges, row/column geometry, number formats, a cell's own font, fill, borders, and alignment, same-sheet formulas, comments, data validation, conditional formats, print settings, metadata) and what it deliberately does not (the formula constructs outside the same-sheet vocabulary, images and embedded objects, and a long tail of BIFF8 records that carry UI/interoperability state rather than document content).

const WORKBOOK_STREAM_NAME = "Workbook";

/** [MS-XLS] 2.4.126: a Format record's own ifmt is constrained to the ranges 5-8, 23-26, 41-44, 63-66, and 164-382 for a custom (non-built-in) code; 164 is the first identifier every real producer actually uses for a custom code, and this writer follows suit, incrementing sequentially and refusing to exceed the range's own ceiling. */
const FIRST_CUSTOM_FORMAT_ID = 164;
const LAST_CUSTOM_FORMAT_ID = 382;

const BUILTIN_FORMAT_PERCENTAGE = 9; // "0%"
const BUILTIN_FORMAT_CURRENCY = 44; // '_("$"* #,##0.00_);_("$"* \(#,##0.00\);_("$"* "-"??_);_(@_)'
const BUILTIN_FORMAT_DATE = 14; // "mm-dd-yy"
const BUILTIN_FORMAT_TIME = 21; // "h:mm:ss"
const BUILTIN_FORMAT_DATE_TIME = 22; // "m/d/yy h:mm"
const GENERAL_FORMAT_ID = 0;

function builtinCode(id: number): string {
  const code = BUILTIN_NUMBER_FORMATS.get(id);
  if (code === undefined) {
    throw new BiffWriteError(
      `internal error: BUILTIN_NUMBER_FORMATS has no entry for id ${id}`,
    );
  }
  return code;
}

/** The default format identifier a value kind resolves to when its own cell carries no numberFormatCode -- chosen so excel-number-format's classifyNumberFormat, run against the resulting code on the way back in, reclassifies to the identical kind. A plain number/string/boolean/error needs no distinguishing code at all: General classifies as 'number', which is exactly the fallback content.ts's own resolveValue already takes for a numeric cell with no format. */
function defaultFormatIdForKind(
  kind: ContentSheetCell["value"]["kind"],
): number {
  switch (kind) {
    case "percentage":
      return BUILTIN_FORMAT_PERCENTAGE;
    case "currency":
      return BUILTIN_FORMAT_CURRENCY;
    case "date":
      return BUILTIN_FORMAT_DATE;
    case "time":
      return BUILTIN_FORMAT_TIME;
    case "dateTime":
      return BUILTIN_FORMAT_DATE_TIME;
    case "number":
    case "string":
    case "boolean":
    case "error":
    case "empty":
      return GENERAL_FORMAT_ID;
  }
}

/**
 * The number-format code a cell resolves through -- its own explicit numberFormatCode, a `[$USD]#,##0.00`-shaped code for a currency cell that names an ISO 4217 code of its own (see below), or the built-in code for its value kind's own default identifier. This is called identically during the workbook-wide format scan and later per cell, so the two can never resolve a cell to different codes.
 *
 * The ISO-code bracket is the one carrier a currency code survives the round trip through: the format string IS where BIFF8 states a cell's currency, and the classifier this package's own reader reads it back through recovers the code from exactly that bracket -- writing the symbol instead would render identically and lose the code permanently, since no faithful symbol-to-code mapping exists on the way back ('$' alone is USD, CAD, AUD and a dozen others). That is the identical encoding ooxml.js's own typed/xlsx/number-format.ts currencyNumberFormat already states for the same schema field, so an amount round-trips through either legacy format under the same spelling. A currency string that is not an ISO-code shape (a display symbol like "£") cannot go inside that bracket without producing a malformed format code, so it falls back to the plain built-in currency format -- the value kind preserved, the code honestly lost, since inventing a code for a symbol would state a currency the cell never named.
 */
function formatCodeForCell(cell: ContentSheetCell): string {
  if (cell.numberFormatCode === undefined && cell.value.kind === "currency") {
    const currency = cell.value.currency;
    if (currency !== undefined && isIsoCurrencyCodeShape(currency)) {
      return `[$${currency.toUpperCase()}]#,##0.00`;
    }
  }
  return (
    cell.numberFormatCode ??
    builtinCode(defaultFormatIdForKind(cell.value.kind))
  );
}

interface FormatPlan {
  readonly customFormats: readonly {
    readonly id: number;
    readonly code: string;
  }[];
  readonly formatIdOf: (code: string) => number;
}

/** Scans every sheet's cells once, assigning each distinct number-format code a formatId: reusing a built-in id for a code matching one of excel-number-format's own BUILTIN_NUMBER_FORMATS strings exactly, minting a new custom id from FIRST_CUSTOM_FORMAT_ID otherwise. Cell XF index assignment is a separate, later pass (buildCellXfPlan below) -- a formatId alone no longer determines a cell's XF index once decoration exists, since two cells sharing a format but differing in background/borders need two distinct XFs. */
function buildFormatPlan(sheets: readonly ContentSheet[]): FormatPlan {
  const codeToFormatId = new Map<string, number>();
  const builtinIdByCode = new Map<string, number>(
    Array.from(BUILTIN_NUMBER_FORMATS, ([id, code]) => [code, id]),
  );
  const customFormats: { id: number; code: string }[] = [];
  let nextCustomId = FIRST_CUSTOM_FORMAT_ID;

  const resolve = (code: string): number => {
    const existing = codeToFormatId.get(code);
    if (existing !== undefined) {
      return existing;
    }
    const builtinId = builtinIdByCode.get(code);
    let formatId: number;
    if (builtinId !== undefined) {
      formatId = builtinId;
    } else {
      if (nextCustomId > LAST_CUSTOM_FORMAT_ID) {
        throw new BiffWriteError(
          `workbook needs more than ${LAST_CUSTOM_FORMAT_ID - FIRST_CUSTOM_FORMAT_ID + 1} distinct custom number formats, more than [MS-XLS] 2.4.126's own ${FIRST_CUSTOM_FORMAT_ID}-${LAST_CUSTOM_FORMAT_ID} custom-identifier range allows`,
        );
      }
      formatId = nextCustomId;
      nextCustomId += 1;
      customFormats.push({ id: formatId, code });
    }
    codeToFormatId.set(code, formatId);
    return formatId;
  };

  for (const sheet of sheets) {
    for (const cell of sheet.cells) {
      if (!writesCellRecord(cell)) {
        continue;
      }
      resolve(formatCodeForCell(cell));
    }
  }

  return {
    customFormats,
    formatIdOf: (code: string): number => {
      const id = codeToFormatId.get(code);
      if (id === undefined) {
        throw new BiffWriteError(
          `internal error: number-format code ${JSON.stringify(code)} was not registered during the workbook-wide format scan`,
        );
      }
      return id;
    },
  };
}

// --- Cell decoration: the workbook-wide colour table, and the (format, decoration) -> XF-index interning that carries it ---

interface PalettePlan {
  /** The workbook's own custom colour table (56 entries, icv 8 first), or undefined when every distinct decoration colour the workbook's cells use already matches the fixed default table -- in which case no Palette record is needed at all, and icvOf resolves every colour straight through that default table. */
  readonly paletteColors: readonly Color[] | undefined;
  /** The icv (7-bit colour-table index) a decoration colour resolves to -- into `paletteColors` when defined, into the fixed default table otherwise. Every colour this is called with must already have been registered during the workbook-wide colour scan below. */
  readonly icvOf: (color: Color) => number;
}

/** Scans every sheet's cells once for the distinct fill/border colours the workbook actually uses (background, and each present border side's own colour), then decides whether they all already have a home in the fixed default table (no Palette record needed) or whether at least one genuinely custom colour forces a real one -- in which case every distinct colour, not just the non-default ones, is allocated its own dedicated slot, so the whole 56-entry table is self-consistent and every reference resolves through it rather than a mix of "the file's own table" and "the implicit default". */
function buildPalettePlan(sheets: readonly ContentSheet[]): PalettePlan {
  const colorByHex = new Map<string, Color>();
  const record = (color: Color | undefined): void => {
    if (color === undefined) {
      return;
    }
    const hex = colorToRgbHex(color);
    if (!colorByHex.has(hex)) {
      colorByHex.set(hex, color);
    }
  };
  const recordFill = (fill: ContentCellFill | undefined): void => {
    if (fill === undefined) {
      return;
    }
    if (fill.kind === "solid") {
      record(fill.color);
      return;
    }
    record(fill.foregroundColor);
    record(fill.backgroundColor);
  };

  for (const sheet of sheets) {
    for (const cell of sheet.cells) {
      // Only cells that actually become records, so the scan can never allocate a palette slot to a colour the XF pass below then never writes -- see written-cells.ts on why every pass shares one predicate.
      if (!writesCellRecord(cell)) {
        continue;
      }
      recordFill(cell.background);
      record(cell.font?.color);
      record(cell.borders?.left?.color);
      record(cell.borders?.right?.color);
      record(cell.borders?.top?.color);
      record(cell.borders?.bottom?.color);
    }
    // A conditional-format rule's own style colours are palette references too (the DXFN the base-CF and CF12 writers emit for every rule variant that carries a style field), so the same workbook-wide scan registers them. The visual-scale variants (colour scale, data bar, icon set) carry no style and state their colours as CFColor RGB triples instead, which need no palette slot.
    for (const rule of sheet.conditionalFormats ?? []) {
      if (!("style" in rule)) {
        continue;
      }
      record(rule.style?.textColor);
      record(rule.style?.background);
    }
  }

  const missing = (hex: string): never => {
    throw new BiffWriteError(
      `internal error: colour ${hex} was not registered during the workbook-wide palette scan`,
    );
  };

  if (colorByHex.size === 0) {
    return {
      paletteColors: undefined,
      icvOf: (color) => missing(colorToRgbHex(color)),
    };
  }

  // Fast path: does every distinct colour already match the fixed default table exactly? If so, no Palette record is needed at all.
  const defaultIcvByHex = new Map<string, number>();
  let needsCustomPalette = false;
  for (const hex of colorByHex.keys()) {
    const icv = DEFAULT_PALETTE_HEX_TO_ICV.get(hex);
    if (icv === undefined) {
      needsCustomPalette = true;
      break;
    }
    defaultIcvByHex.set(hex, icv);
  }
  if (!needsCustomPalette) {
    return {
      paletteColors: undefined,
      icvOf: (color) =>
        defaultIcvByHex.get(colorToRgbHex(color)) ??
        missing(colorToRgbHex(color)),
    };
  }

  // Slow path: at least one colour needs a genuinely custom entry. Allocate every distinct colour -- not just the non-default ones -- into fresh slots in first-use order, so the record this writes is fully self-consistent.
  if (colorByHex.size > PALETTE_ENTRY_COUNT) {
    throw new BiffWriteError(
      `workbook needs ${colorByHex.size} distinct decoration colours, more than the ${PALETTE_ENTRY_COUNT} entries [MS-XLS] 2.4.188's own Palette record can hold`,
    );
  }
  const icvByHex = new Map<string, number>();
  const paletteColors: Color[] = [];
  let nextIcv = PALETTE_BASE_ICV;
  for (const [hex, color] of colorByHex) {
    icvByHex.set(hex, nextIcv);
    paletteColors.push(color);
    nextIcv += 1;
  }
  // Unused trailing slots are never referenced by any XF this writer emits -- their exact content is immaterial, and black is as good a filler as any -- but the record still declares the full, spec-required 56 entries rather than a short one.
  while (paletteColors.length < PALETTE_ENTRY_COUNT) {
    paletteColors.push({ r: 0, g: 0, b: 0 });
  }

  return {
    paletteColors,
    icvOf: (color) =>
      icvByHex.get(colorToRgbHex(color)) ?? missing(colorToRgbHex(color)),
  };
}

const UNDECORATED_EDGE: XfBorderEdge = { style: BORDER_STYLE_NONE, icv: 0 };

function resolveWriteEdge(
  border: ContentBorder | undefined,
  icvOf: (color: Color) => number,
): XfBorderEdge {
  if (border === undefined) {
    return UNDECORATED_EDGE;
  }
  return { style: borderStyleTokenFor(border), icv: icvOf(border.color) };
}

/** A ContentCellFill's own fillPattern/fillForegroundIcv/fillBackgroundIcv triple, resolved for whichever of 'solid'/'pattern' the cell states -- undefined input resolves to FLSNULL with both colours Automatic, matching the pre-#951 undecorated case exactly. A 'pattern' fill leaving one of its own colours unstated writes that colour Automatic too, the inverse of xf-colors.ts's own resolveFillBackground treating an unresolvable icv the same way on read. */
function resolveFillFields(
  fill: ContentCellFill | undefined,
  icvOf: (color: Color) => number,
): Pick<
  XfDecorationFields,
  "fillPattern" | "fillForegroundIcv" | "fillBackgroundIcv"
> {
  if (fill === undefined) {
    return {
      fillPattern: FILL_PATTERN_NONE,
      fillForegroundIcv: ICV_AUTOMATIC_FOREGROUND,
      fillBackgroundIcv: ICV_AUTOMATIC_BACKGROUND,
    };
  }
  switch (fill.kind) {
    case "solid":
      return {
        fillPattern: FILL_PATTERN_SOLID,
        fillForegroundIcv: icvOf(fill.color),
        fillBackgroundIcv: ICV_AUTOMATIC_BACKGROUND,
      };
    case "pattern": {
      const fillPattern = PATTERN_TYPE_TO_FILL_PATTERN.get(fill.patternType);
      if (fillPattern === undefined) {
        throw new BiffWriteError(
          `xls-codec cannot write a '${fill.patternType}' cell fill: [MS-XLS]'s own FillPattern enumeration has no member for it, that pattern name belonging only to WordprocessingML's ST_Shd half of ContentCellPatternType's shared vocabulary`,
        );
      }
      return {
        fillPattern,
        fillForegroundIcv:
          fill.foregroundColor === undefined
            ? ICV_AUTOMATIC_FOREGROUND
            : icvOf(fill.foregroundColor),
        fillBackgroundIcv:
          fill.backgroundColor === undefined
            ? ICV_AUTOMATIC_BACKGROUND
            : icvOf(fill.backgroundColor),
      };
    }
    default:
      // Reporting the actual kind beats the if/else this replaced, whose implicit "anything that isn't 'solid' must be 'pattern'" fell through to PATTERN_TYPE_TO_FILL_PATTERN.get(undefined) and threw a BiffWriteError blaming a nonexistent pattern name instead of the real cause: an undefined kind.
      throw new BiffWriteError(
        `xls-codec cannot write a cell fill with kind '${unrecognizedFillKind(fill)}': ContentCellFillSchema's discriminated union only defines 'solid' and 'pattern'`,
      );
  }
}

/** A cell's own decoration, resolved into the raw XfDecorationFields the CellXF payload packs -- undefined for a cell with neither a background nor any border, so it shares the workbook's plain undecorated XF exactly as it did before decoration existed. The "has decoration at all" question is written-cells.ts's, since the writer's own record-emission predicate turns on the identical answer. */
function resolveDecorationForCell(
  cell: ContentSheetCell,
  icvOf: (color: Color) => number,
): XfDecorationFields | undefined {
  if (!cellCarriesFormatting(cell)) {
    return undefined;
  }
  return {
    ...resolveFillFields(cell.background, icvOf),
    left: resolveWriteEdge(cell.borders?.left, icvOf),
    right: resolveWriteEdge(cell.borders?.right, icvOf),
    top: resolveWriteEdge(cell.borders?.top, icvOf),
    bottom: resolveWriteEdge(cell.borders?.bottom, icvOf),
  };
}

/** A deterministic signature for one cell XF's own (formatId, fontIndex, alignment, verticalAlignment, decoration) tuple, so two cells sharing all five share one XF record -- the interning key buildCellXfPlan below dedupes on, mirroring how CellFormatTable in ooxml.js's typed/xlsx/styles.ts dedupes an <xf> on (number format, decoration) together rather than on format alone, widened here by the cell's own font and alignment. */
function signatureOfCellXf(
  formatId: number,
  fontIndex: number,
  alignment: Alignment | undefined,
  verticalAlignment: "top" | "middle" | "bottom" | undefined,
  decoration: XfDecorationFields | undefined,
): string {
  let signature = `f${formatId}|n${fontIndex}|a${alignment ?? ""}|v${verticalAlignment ?? ""}`;
  if (decoration === undefined) {
    return signature;
  }
  signature +=
    `|p${decoration.fillPattern}:${decoration.fillForegroundIcv}:${decoration.fillBackgroundIcv}` +
    `|l${decoration.left.style}:${decoration.left.icv}` +
    `|r${decoration.right.style}:${decoration.right.icv}` +
    `|t${decoration.top.style}:${decoration.top.icv}` +
    `|b${decoration.bottom.style}:${decoration.bottom.icv}`;
  return signature;
}

interface FontPlan {
  /** The workbook's font table in write order: entry 0 is the Normal font, every later entry one distinct cell font, exactly as globals-writer.ts writes the records. */
  readonly fontEntries: readonly XfFontFields[];
  /** The font-table index a cell's own font resolves to -- 0 (the Normal font) for a cell stating none, so the index this returns and the font-entry interning above can never disagree about what "no font" means. */
  readonly fontIndexForCell: (cell: ContentSheetCell) => number;
}

/** A deterministic signature for one font-table entry, the interning key below dedupes on -- name, height, the four flags, and the colour index, since those are the whole record as far as this package's reader is concerned. */
function signatureOfFont(fields: XfFontFields): string {
  return (
    `${fields.name}|${fields.heightTwips}|` +
    `${fields.bold ? 1 : 0}${fields.italic ? 1 : 0}${fields.strikeout ? 1 : 0}${fields.underline ? 1 : 0}` +
    `|${fields.colorIcv}`
  );
}

/**
 * Scans every sheet's cells once, interning each distinct cell font into its own font-table entry: the Normal font is always entry 0 (every style XF and the implicit General cell XF reference it, whether or not any cell states a font of its own), and each distinct ContentFont the workbook's cells resolve to mints one further entry the first time it is seen. A ContentFont that normalises back to the Normal font's own fields -- absent, empty, or restating only default values -- resolves to entry 0 and mints nothing, the write-side mirror of the reader's own diff against entry 0.
 */
function buildFontPlan(
  sheets: readonly ContentSheet[],
  palettePlan: PalettePlan,
): FontPlan {
  const fontEntries: XfFontFields[] = [NORMAL_FONT_FIELDS];
  const indexBySignature = new Map<string, number>([
    [signatureOfFont(NORMAL_FONT_FIELDS), 0],
  ]);
  const fieldsOf = (cell: ContentSheetCell): XfFontFields =>
    xfFontFieldsOf(cell.font, palettePlan.icvOf);

  for (const sheet of sheets) {
    for (const cell of sheet.cells) {
      // The same predicate every other workbook-wide pass applies, so a font is never interned for a cell that then writes no record naming it.
      if (!writesCellRecord(cell)) {
        continue;
      }
      const fields = fieldsOf(cell);
      const signature = signatureOfFont(fields);
      if (indexBySignature.has(signature)) {
        continue;
      }
      indexBySignature.set(signature, fontEntries.length);
      fontEntries.push(fields);
    }
  }

  return {
    fontEntries,
    fontIndexForCell: (cell: ContentSheetCell): number => {
      const index = indexBySignature.get(signatureOfFont(fieldsOf(cell)));
      if (index === undefined) {
        throw new BiffWriteError(
          `internal error: the cell at row ${cell.row}, column ${cell.column} resolves to a font the workbook-wide font scan never saw -- the writer's own "does this cell get a record" predicate and its font-interning pass disagree about this cell`,
        );
      }
      return index;
    },
  };
}

interface CellXfPlan {
  readonly cellXfEntries: readonly CellXfPlanEntry[];
  readonly xfIndexForCell: (cell: ContentSheetCell) => number;
}

/**
 * Scans every sheet's cells once, interning each distinct (number format, font, alignment, decoration) combination into its own cell XF index -- a cell with General formatting, the Normal font, and no decoration resolves to the workbook's own implicit GENERAL_CELL_XF_INDEX with no new XF record at all, exactly as before; every other combination mints one XF record the first time it is seen and is reused by every later cell sharing it.
 *
 * The returned xfIndexForCell only ever LOOKS UP -- it cannot mint an entry, and refuses a signature this scan never saw. buildWorkbookGlobals is handed cellXfEntries before any sheet's records are built, so an entry minted later than this scan would be one no XF record was written for, and the cell record naming its index would point past the end of the workbook's XF table. Nothing about the resulting bytes says so: a reader resolves that index to whatever XF happens to sit there, or to none, and the cell's format is silently wrong either way. Refusing the lookup is the only place that divergence can still be caught.
 */
function buildCellXfPlan(
  sheets: readonly ContentSheet[],
  formatPlan: FormatPlan,
  palettePlan: PalettePlan,
  fontPlan: FontPlan,
): CellXfPlan {
  const cellXfEntries: CellXfPlanEntry[] = [];
  const xfIndexBySignature = new Map<string, number>([
    [
      signatureOfCellXf(GENERAL_FORMAT_ID, 0, undefined, undefined, undefined),
      GENERAL_CELL_XF_INDEX,
    ],
  ]);
  let nextXfIndex = GENERAL_CELL_XF_INDEX + 1;

  const signatureOf = (cell: ContentSheetCell): string =>
    signatureOfCellXf(
      formatPlan.formatIdOf(formatCodeForCell(cell)),
      fontPlan.fontIndexForCell(cell),
      cell.alignment,
      cell.verticalAlignment,
      resolveDecorationForCell(cell, palettePlan.icvOf),
    );

  for (const sheet of sheets) {
    for (const cell of sheet.cells) {
      if (!writesCellRecord(cell)) {
        continue;
      }
      const formatId = formatPlan.formatIdOf(formatCodeForCell(cell));
      const fontIndex = fontPlan.fontIndexForCell(cell);
      const decoration = resolveDecorationForCell(cell, palettePlan.icvOf);
      const signature = signatureOfCellXf(
        formatId,
        fontIndex,
        cell.alignment,
        cell.verticalAlignment,
        decoration,
      );
      if (xfIndexBySignature.has(signature)) {
        continue;
      }
      xfIndexBySignature.set(signature, nextXfIndex);
      nextXfIndex += 1;
      cellXfEntries.push({
        formatId,
        fontIndex,
        alignment: cell.alignment,
        verticalAlignment: cell.verticalAlignment,
        decoration,
      });
    }
  }

  return {
    cellXfEntries,
    xfIndexForCell: (cell: ContentSheetCell): number => {
      const signature = signatureOf(cell);
      const index = xfIndexBySignature.get(signature);
      if (index === undefined) {
        throw new BiffWriteError(
          `internal error: the cell at row ${cell.row}, column ${cell.column} resolves to cell-XF signature ${JSON.stringify(signature)}, which the workbook-wide cell-format scan never saw -- the writer's own "does this cell get a record" predicate and its XF-interning pass disagree about this cell`,
        );
      }
      return index;
    },
  };
}

interface SstPlan {
  readonly strings: readonly string[];
  readonly totalCount: number;
  readonly indexOf: (text: string) => number;
}

/** Scans every sheet's string-kind cells once, in sheet then cell order, assigning each distinct value the shared string table index every LabelSst cell referencing it uses. */
function buildSstPlan(sheets: readonly ContentSheet[]): SstPlan {
  const indexOf = new Map<string, number>();
  const strings: string[] = [];
  let totalCount = 0;
  for (const sheet of sheets) {
    for (const cell of sheet.cells) {
      if (cell.value.kind !== "string") {
        continue;
      }
      totalCount += 1;
      if (!indexOf.has(cell.value.value)) {
        indexOf.set(cell.value.value, strings.length);
        strings.push(cell.value.value);
      }
    }
  }
  return {
    strings,
    totalCount,
    indexOf: (text: string): number => {
      const index = indexOf.get(text);
      if (index === undefined) {
        throw new BiffWriteError(
          `internal error: string ${JSON.stringify(text)} was not registered during the workbook-wide shared-string scan`,
        );
      }
      return index;
    },
  };
}

/**
 * The built-in Print_Area/Print_Titles defined names every sheet's own print settings need, across the whole workbook.
 *
 * Workbook-wide rather than per-sheet because that is where BIFF8 puts them: an Lbl lives in the globals substream and names its sheet through its own itab, so a sheet's print RANGE is written nowhere near the sheet's own records. The ixti each name's PtgArea3d refers to is the sheet's own index, matching the one-XTI-per-sheet ExternSheet record globals-writer.ts writes alongside them.
 */
function buildPrintNamePlan(
  sheets: readonly ContentSheet[],
): PrintNamePlanEntry[] {
  return sheets.flatMap((sheet, sheetIndex) =>
    printNameEntriesFor(sheetIndex, sheetIndex, sheet.printSettings),
  );
}

/** Patches a BoundSheet8's own lbPlyPos field in place: a 4-byte little-endian integer at a byte offset globals-writer.ts already reported, once the real value -- where that sheet's own substream landed in the finished workbook stream -- is known. */
function patchBoundSheetOffsets(
  globalsBytes: Uint8Array<ArrayBuffer>,
  offsets: readonly number[],
  values: readonly number[],
): void {
  const view = new DataView(
    globalsBytes.buffer,
    globalsBytes.byteOffset,
    globalsBytes.byteLength,
  );
  offsets.forEach((offset, index) => {
    view.setUint32(offset, values[index] ?? 0, true);
  });
}

function concatBytes(
  parts: readonly Uint8Array<ArrayBuffer>[],
): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

interface WorkbookStreamBuild {
  readonly bytes: Uint8Array<ArrayBuffer>;
  /** The Embedding Storage streams (drawing-writer.ts's own MBD-named Package streams, [MS-XLS] 2.1.7) an embedded OLE object needs beside the Workbook stream in the outer compound file -- empty when the workbook carries none. */
  readonly embeddingStreams: readonly {
    readonly path: string;
    readonly bytes: Uint8Array<ArrayBuffer>;
  }[];
}

/** Builds the [MS-XLS] Workbook stream: the globals substream followed by one worksheet substream per sheet, with every BoundSheet8's own lbPlyPos patched to the real byte offset its sheet's substream landed at. */
function buildWorkbookStream(content: XlsContentDocument): WorkbookStreamBuild {
  if (content.sheets.length === 0) {
    throw new BiffWriteError(
      "a .xls workbook must contain at least one sheet ([MS-XLS] 2.1.7.20.3's own BUNDLESHEET production requires 1*BoundSheet8), but the document being written has none",
    );
  }

  const formatPlan = buildFormatPlan(content.sheets);
  const sstPlan = buildSstPlan(content.sheets);
  const palettePlan = buildPalettePlan(content.sheets);
  const fontPlan = buildFontPlan(content.sheets, palettePlan);
  const cellXfPlan = buildCellXfPlan(
    content.sheets,
    formatPlan,
    palettePlan,
    fontPlan,
  );
  const drawingPlan = buildDrawingWritePlan(content.sheets);

  const globalsPlan: WorkbookGlobalsPlan = {
    sheetNames: content.sheets.map((sheet) => sheet.name),
    fonts: fontPlan.fontEntries,
    customFormats: formatPlan.customFormats,
    cellXfEntries: cellXfPlan.cellXfEntries,
    sharedStrings: sstPlan.strings,
    sharedStringTotalCount: sstPlan.totalCount,
    paletteColors: palettePlan.paletteColors,
    printNames: buildPrintNamePlan(content.sheets),
    definedNames: definedNameEntriesFor(content.names ?? [], content.sheets),
    drawingGroupBytes: drawingPlan.drawingGroupBytes,
  };
  const globals = buildWorkbookGlobals(globalsPlan);

  const sheetContext: SheetWriteContext = {
    xfIndexForCell: cellXfPlan.xfIndexForCell,
    sstIndexFor: (text) => sstPlan.indexOf(text),
    icvOf: palettePlan.icvOf,
  };

  const sheetStreams = content.sheets.map((sheet, index) => {
    const drawing = drawingPlan.sheetDrawings[index];
    if (drawing === undefined) {
      throw new BiffWriteError(
        `internal error: sheet ${index} has no drawing plan entry -- buildDrawingWritePlan produced fewer entries than there are sheets`,
      );
    }
    return buildWorksheetSubstream(sheet, sheetContext, drawing);
  });

  const sheetOffsets: number[] = [];
  let offset = globals.bytes.length;
  for (const stream of sheetStreams) {
    sheetOffsets.push(offset);
    offset += stream.length;
  }

  const globalsBytes = globals.bytes.slice();
  patchBoundSheetOffsets(globalsBytes, globals.lbPlyPosOffsets, sheetOffsets);

  return {
    bytes: concatBytes([globalsBytes, ...sheetStreams]),
    embeddingStreams: drawingPlan.embeddingStreams,
  };
}

/**
 * Writes a spreadsheet ContentDocument to real .xls bytes: a BIFF8 Workbook stream wrapped in an [MS-CFB] compound file.
 *
 * The counterpart of content.ts's readXlsContent. See this package's README for the writer's full scope.
 */
export function writeXlsContent(
  content: XlsContentDocument,
): Uint8Array<ArrayBuffer> {
  const workbook = buildWorkbookStream(content);
  const streams = [
    { path: WORKBOOK_STREAM_NAME, bytes: workbook.bytes },
    ...workbook.embeddingStreams,
  ];
  // Only when there is something SummaryInformation can actually hold: an input whose metadata carries nothing beyond creator/producer/language (or nothing at all) should read back exactly as it would with no stream present, not force an empty-but-present one into existence.
  if (hasSummaryInformationFields(content.metadata)) {
    streams.push({
      path: SUMMARY_INFORMATION_STREAM,
      bytes: writeSummaryInformationStream(
        layoutMetadataToSummaryInformation(content.metadata),
      ),
    });
  }
  return writeCompoundFile(streams);
}

/** Writes a DocumentTree of kind 'spreadsheet' to real .xls bytes, flattening it to a ContentDocument first -- the counterpart of content.ts's readXls. */
export function writeXls(tree: DocumentTree): Uint8Array<ArrayBuffer> {
  const content: ContentDocument = flattenTree(tree);
  if (content.kind !== "spreadsheet") {
    throw new BiffWriteError(
      `writeXls was given a DocumentTree of kind '${content.kind}', but a .xls workbook can only be written from a 'spreadsheet' document`,
    );
  }
  return writeXlsContent(content);
}
