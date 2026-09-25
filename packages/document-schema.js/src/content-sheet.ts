import { z } from "zod";
import { ColorSchema } from "./color";
import type { Color } from "./color";
import {
  CONTENT_ANNOTATION_FIELDS,
  ContentBorderSchema,
  ContentImageBlockSchema,
  ContentFontSchema,
  ContentRunSchema,
  ContentEmbeddedObjectSchema,
} from "./content-vocabulary";
import { SourceResidueSchema } from "./source";
import { AlignmentSchema } from "./style";
import { LayoutFrameSchema, MarginsSchema, PageSizeSchema } from "./geometry";

// The spreadsheet content model, split from content.ts: per-side cell borders, fills and pattern types, the decimal-string and cell-value vocabularies, sheet cells/columns/rows, print settings, data validation, conditional formats, sheet images and ContentSheetSchema itself. Block-model vocabularies come from content-vocabulary.ts; nothing is imported from content.ts at module-evaluation time.
// Per-side borders for a rectangular cell (table or sheet) — each side independently optional, since a real cell frequently has some sides bordered and others not. diagonalUp/diagonalDown name the two corner-to-corner rules a cell can carry independently of its four sides (OOXML's own xlsx cell-border vocabulary already names them this way; RTF's \cldglu/\cldgll state the identical pair for a table cell) — "up" runs bottom-left to top-right, "down" runs top-left to bottom-right.
export const ContentCellBordersSchema = z.object({
  left: ContentBorderSchema.optional(),
  right: ContentBorderSchema.optional(),
  top: ContentBorderSchema.optional(),
  bottom: ContentBorderSchema.optional(),
  diagonalUp: ContentBorderSchema.optional(),
  diagonalDown: ContentBorderSchema.optional(),
});
export type ContentCellBorders = z.infer<typeof ContentCellBordersSchema>;

// The closed set of genuine two-colour pattern fills a table/sheet cell's background can carry, spanning the two independent vocabularies this family's format codecs actually read: WordprocessingML's own ST_Shd (ECMA-376 Part 1 17.18.78) — which [MS-DOC]'s Ipat enumeration (2.9.121) maps its own supported values onto directly, so doc-codec's binary reader and ooxml.js's docx reader share this half verbatim — and SpreadsheetML's own ST_PatternType, which [MS-XLS]'s FillPattern enumeration is the binary predecessor of, so xls-codec's BIFF8 reader and ooxml.js's xlsx reader share this other half. The two never overlap in membership (a table cell never carries an xlsx-style named grey density, a sheet cell never carries a Word-style percentage), so one flat enum serves both without ambiguity, the same way ContentCellValueSchema's ten variants serve every spreadsheet format's own value-kind vocabulary in one union. percentN is ST_Shd's own pctN family (5 through 95, the 23 members [MS-DOC] maps onto a real ST_Shd token — its own further ipatPctNew* fine percentages have no ST_Shd equivalent at all and [MS-DOC] itself says they "SHOULD NOT be used", so they are deliberately excluded here rather than invented a name for); the twelve directional stripe/cross members and their 'thin' density variants are ST_Shd's own remaining tokens. mediumGray/darkGray/lightGray through gray0625 are ST_PatternType's own seventeen non-solid, non-none members verbatim, including the two fixed micro-densities (12.5%/6.25%) Excel's own UI exposes as "Gray125"/"Gray0625" rather than as another percentage step.
export const ContentCellPatternTypeSchema = z.enum([
  "percent5",
  "percent10",
  "percent12",
  "percent15",
  "percent20",
  "percent25",
  "percent30",
  "percent35",
  "percent37",
  "percent40",
  "percent45",
  "percent50",
  "percent55",
  "percent60",
  "percent62",
  "percent65",
  "percent70",
  "percent75",
  "percent80",
  "percent85",
  "percent87",
  "percent90",
  "percent95",
  "horizontalStripe",
  "verticalStripe",
  "diagonalStripe",
  "reverseDiagonalStripe",
  "horizontalCross",
  "diagonalCross",
  "thinHorizontalStripe",
  "thinVerticalStripe",
  "thinDiagonalStripe",
  "thinReverseDiagonalStripe",
  "thinHorizontalCross",
  "thinDiagonalCross",
  "mediumGray",
  "darkGray",
  "lightGray",
  "darkHorizontal",
  "darkVertical",
  "darkDown",
  "darkUp",
  "darkGrid",
  "darkTrellis",
  "lightHorizontal",
  "lightVertical",
  "lightDown",
  "lightUp",
  "lightGrid",
  "lightTrellis",
  "gray125",
  "gray0625",
]);
export type ContentCellPatternType = z.infer<
  typeof ContentCellPatternTypeSchema
>;

// A table/sheet cell's own background, replacing a bare Color with a discriminated shape wide enough to state what the source format actually carries (ExaDev/documents.js#951): 'solid' is the overwhelmingly common case, one flat colour; 'pattern' is a genuine two-colour fill (a percentage grey, a stripe, a crosshatch) that a single Color cannot express at all, foregroundColor/backgroundColor each independently optional because a real producer's own pattern fill may state only one half explicitly and leave the other at the application's automatic default — the identical "a colour can defer instead of asserting" convention w:shd/@w:fill and xlsx's own theme/indexed/auto colours already follow elsewhere in this family. There is no third 'none' variant: the field's own optionality already states "no fill" by being absent, exactly as it always has.
export const ContentCellFillSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("solid"), color: ColorSchema }),
  z.object({
    kind: z.literal("pattern"),
    patternType: ContentCellPatternTypeSchema,
    foregroundColor: ColorSchema.optional(),
    backgroundColor: ColorSchema.optional(),
  }),
]);
export type ContentCellFill = z.infer<typeof ContentCellFillSchema>;

// A single representative colour for a ContentCellFill, for a consumer that only ever renders or approximates with one colour (a rasterising layout engine, a preview pane, a format whose own decoration vocabulary has no pattern-fill concept of its own to write one into) and has no use for the full pattern shape: a solid fill's own colour, or a pattern's foreground colour — the one a mid-to-high-density pattern shows the most of — falling back to its background colour when the producer left the foreground unset, and undefined only when a pattern states neither. Never a substitute for branching on `fill.kind` in a writer that can actually state a pattern: this exists solely for the many simpler consumers that cannot.
export function resolveCellFillColor(fill: ContentCellFill): Color | undefined {
  return fill.kind === "solid"
    ? fill.color
    : (fill.foregroundColor ?? fill.backgroundColor);
}

// Reads `.kind` off a ContentCellFill that a caller's own exhaustive switch has already switched over both real members ('solid'/'pattern') — TypeScript types such a value 'never' at that point, so this takes it through a deliberately widened parameter type rather than an `as` cast. A value that reaches this call anyway (a malformed object bypassing schema validation, or a stale caller shape) still carries a real, inspectable kind at runtime even though the type system says none is left to name. Every codec writer that switches exhaustively on ContentCellFill's kind and needs to name an unreachable default's actual value shares this one implementation (doc-codec, xls-codec, ooxml.js) rather than each keeping its own byte-identical copy.
export function unrecognizedFillKind(fill: { kind?: unknown }): string {
  return String(fill.kind);
}

// Spreadsheet content model. Mirrors ODF's own office:value-type vocabulary for cell values (ContentCellValueSchema) plus the sparse cell/column/row addressing and print-settings shape every spreadsheet format (xlsx, ods) shares. No reader or writer in any package consumes this yet — it exists so odf.js can target a stable, correctly-typed shape for its own .ods reader.

// A decimal-string pattern schema for an exact, arbitrary-precision numeric representation — optional sign, no leading zeros (other than a bare '0'), an optional fractional part. Deliberately a string, not z.bigint(): bigint is not JSON-serializable and z.toJSONSchema() cannot represent it at all, even with unrepresentable: 'any' (it would silently emit an empty schema).
export const DecimalStringSchema = z.string().regex(/^-?(0|[1-9]\d*)(\.\d+)?$/);
export type DecimalString = z.infer<typeof DecimalStringSchema>;

// A cell's own computed/typed value, one variant per ODF office:value-type, plus a 'dateTime' variant ODF has no separate type for (see below). formula and displayText live on ContentSheetCellSchema itself, not per-variant here, since a formula can produce any of these value kinds and displayText is a per-cell rendering concern, not part of the value's own type. exactValue is an additive-optional sidecar on the number/percentage/currency variants only (the ones a real spreadsheet stores as an arbitrary-precision decimal underneath): value always remains the nearest IEEE-754 double approximation, present and populated exactly as before; exactValue, when present, is the authoritative exact decimal representation, and a producer should only set it when `String(Number(exactValue))` would not round-trip back to `exactValue` exactly — so it is absent for the overwhelming majority of real cells (anything a double already represents exactly) and adds zero bytes to ordinary documents.
//
// — Canonical date/time wire spelling — The three temporal variants below each carry their value as a string, and that string has exactly one permitted spelling, stated here once and binding on every producer (odf.js, ooxml.js, and documents.js's own hsqldb/firebird decoders alike): 'date' is an ISO 8601 calendar date, `YYYY-MM-DD`; 'time' is a plain ISO 8601 wall-clock time of day, `HH:MM:SS` (24-hour, zero-padded, seconds always present, no date part, no timezone designator, and NOT ODF's own `PTnHnMnS` duration spelling, which a producer reading `office:time-value` must convert from); 'dateTime' is an ISO 8601 combined date and time, `YYYY-MM-DDTHH:MM:SS`, with a `.sss` fractional-seconds part and/or a `Z`/`+HH:MM` offset appended only when the source genuinely carried one. Anything else — a locale-formatted rendering, a serial number, a bare `HH:MM` — belongs in the cell's own displayText, never in `value`. This is a wire-format contract, not a validated one: the schemas below are plain z.string(), since a regex here would reject a real value a producer has not yet been updated to normalise, turning a fidelity bug into a hard parse failure. Producers converge on this spelling in their own later releases; this comment is the definition they converge on.
export const ContentCellValueSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("number"),
    value: z.number(),
    exactValue: DecimalStringSchema.optional(),
  }),
  z.object({
    kind: z.literal("percentage"),
    value: z.number(),
    exactValue: DecimalStringSchema.optional(),
  }), // the underlying numeric value, e.g. 0.5 for a cell displaying "50%"
  z.object({
    kind: z.literal("currency"),
    value: z.number(),
    currency: z.string().optional(),
    exactValue: DecimalStringSchema.optional(),
  }), // currency is the ISO 4217 code (e.g. 'USD'), mirroring ODF's office:currency
  z.object({ kind: z.literal("boolean"), value: z.boolean() }),
  z.object({ kind: z.literal("date"), value: z.string() }), // ISO 8601 calendar date, YYYY-MM-DD, e.g. '2026-07-30' — a date with no time-of-day component; use 'dateTime' when the source carries both
  z.object({ kind: z.literal("time"), value: z.string() }), // ISO 8601 wall-clock time of day, HH:MM:SS, e.g. '13:30:00' — never ODF's PTnHnMnS duration spelling
  z.object({ kind: z.literal("dateTime"), value: z.string() }), // ISO 8601 combined date and time, YYYY-MM-DDTHH:MM:SS, e.g. '2026-07-30T13:30:00' — a genuine single date+time value (an HSQLDB/Firebird TIMESTAMP column, or xlsx's one t="d" cell type, which covers date and date+time alike), distinct from 'date' rather than collapsed onto it
  z.object({ kind: z.literal("string"), value: z.string() }),
  z.object({ kind: z.literal("error"), value: z.string() }), // the producer's own error text, e.g. '#DIV/0!'
  z.object({ kind: z.literal("empty") }), // a cell that is present (formatted, merged, etc.) but carries no value
]);
export type ContentCellValue = z.infer<typeof ContentCellValueSchema>;

// A cell-anchored annotation, one shape deliberately covering both mechanisms a real spreadsheet uses for comments — xlsx's legacy single notes and its newer threaded comments alike: a legacy note is a comment whose replies stay absent, a threaded comment is one whose replies array is populated, so no separate union or kind discriminant is needed. Replies are flat — a reply never carries replies of its own — matching how threaded comments nest in the source formats. createdAt is an ISO 8601 date-time in the source format's own spelling and precision (e.g. '2026-08-17T09:30:00Z'), present only when the source recorded one; a wire contract stated here rather than a validated one, for the same reason as ContentCellValueSchema's own temporal strings above — a regex would turn a producer not yet normalised to ISO 8601 into a hard parse failure.
export const ContentSheetCellCommentSchema = z.object({
  text: z.string(),
  author: z.string().optional(),
  createdAt: z.string().optional(),
  replies: z
    .array(z.object({ text: z.string(), author: z.string().optional() }))
    .optional(),
});
export type ContentSheetCellComment = z.infer<
  typeof ContentSheetCellCommentSchema
>;

// row/column are the cell's own position, not implied by array index — ContentSheetSchema.cells is sparse, since real sheets are sparse. displayText is the producer's own rendered string for `value` (its number-format/locale/currency-symbol applied already) and is required on every cell that exists in this array, since a cell with nothing to display simply isn't included; it is what makes spreadsheet-to-PDF rendering tractable without this package reimplementing a number-format/locale engine. formula, if present, is carried verbatim in whatever syntax the source format used. colSpan/rowSpan are set on the anchor cell only, matching how ContentTableCell already handles merged cells. alignment is an override of the existing value-kind default (numeric right, boolean/error centre, string left); absent means that default still applies. verticalAlignment has no value-kind default to fall back to, so its own absence means 'bottom' outright, matching a real spreadsheet's own typical default. comment, when present, is the cell's annotation (ContentSheetCellCommentSchema above) and never affects rendering — it is carried for fidelity, so inspecting or round-tripping a document does not silently drop what the author pinned to that cell.
export const ContentSheetCellSchema = z.object({
  row: z.number().int().nonnegative(),
  column: z.number().int().nonnegative(),
  value: ContentCellValueSchema,
  formula: z.string().optional(),
  displayText: z.string(),
  // The producer's own raw number-format code (xlsx numFmtId's own format string, e.g. "0.00%", "$#,##0.00", "yyyy-mm-dd") — the literal pattern `value.kind`'s percentage/currency/date/time/dateTime classification was derived FROM, kept alongside that classification rather than replacing it: two cells both classified 'percentage' can carry different display precision ("0%" vs "0.00%"), a fact the classification alone discards and a lossless-capture consumer may still want. Absent for a cell with no producer-declared format at all (xlsx's own General, ODF's own unstyled default), not a fabricated empty string.
  numberFormatCode: z.string().optional(),
  font: ContentFontSchema.optional(), // the cell's own font, for the common case of uniformly formatted cell text — a real sheet states exactly one font per cell ([MS-XLS] XF's font index, xlsx's cell xf, ODF's resolved cell style), so uniform is the rule and mixed the exception. runs stays the channel for genuinely mixed inline formatting; when both are present a run's own property wins over the cell font for that run, the identical innermost-wins overlay discipline style resolution applies (the cell font sits one level below its runs' own properties, where a resolved style's run half already sits). Absent means the cell carries no font of its own — the format's default — never an implicit empty font
  runs: z.array(ContentRunSchema).optional(), // the rare case of genuinely mixed inline formatting within one cell's text; absent when the cell's formatting is uniform
  colSpan: z.number().int().positive().optional(),
  rowSpan: z.number().int().positive().optional(),
  background: ContentCellFillSchema.optional(),
  borders: ContentCellBordersSchema.optional(),
  alignment: AlignmentSchema.optional(), // override; absent means the existing value-kind default
  verticalAlignment: z.enum(["top", "middle", "bottom"]).optional(), // absent means 'bottom'
  comment: ContentSheetCellCommentSchema.optional(), // a cell-anchored annotation — a legacy note or a threaded comment; see ContentSheetCellCommentSchema above
  sourcePath: z.string().optional(), // deterministic, document-order-derived path assigned by the format reader
  source: SourceResidueSchema.optional(), // quarantined residue — opaque text this format carries and no other format interprets (src/source.ts)
  frames: z.array(LayoutFrameSchema).optional(), // this cell's own rendered position(s), once a layout pass has fused one in — see FusedNode above
  ...CONTENT_ANNOTATION_FIELDS,
});
export type ContentSheetCell = z.infer<typeof ContentSheetCellSchema>;

// widthPt/heightPt are optional-positive rather than required-nonnegative: an entry exists in these arrays whenever a column/row carries ANY per-axis property (a width, or merely `hidden`), and a real spreadsheet frequently has one without a declared size at all. Making the size required forced such an entry to state an explicit 0, which a consumer then had to treat as authoritative — rendering a zero-width column instead of the application's own default width, and so producing a zero-size grid from a file that renders perfectly well elsewhere. Absent now means exactly "no declared size, use the application default"; 0 is no longer expressible, which is correct, since a genuinely zero-sized column is `hidden: true`, not a zero width.
export const ContentSheetColumnSchema = z.object({
  index: z.number().int().nonnegative(),
  widthPt: z.number().positive().optional(),
  hidden: z.boolean().optional(),
});
export type ContentSheetColumn = z.infer<typeof ContentSheetColumnSchema>;

export const ContentSheetRowSchema = z.object({
  index: z.number().int().nonnegative(),
  heightPt: z.number().positive().optional(),
  hidden: z.boolean().optional(),
});
export type ContentSheetRow = z.infer<typeof ContentSheetRowSchema>;

export const ContentSheetPrintRangeSchema = z.object({
  startRow: z.number().int().nonnegative(),
  startColumn: z.number().int().nonnegative(),
  endRow: z.number().int().nonnegative(),
  endColumn: z.number().int().nonnegative(),
});
export type ContentSheetPrintRange = z.infer<
  typeof ContentSheetPrintRangeSchema
>;

export const ContentSheetRepeatRangeSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
});
export type ContentSheetRepeatRange = z.infer<
  typeof ContentSheetRepeatRangeSchema
>;

export const ContentSheetPrintSettingsSchema = z.object({
  pageSize: PageSizeSchema,
  margins: MarginsSchema,
  printRange: ContentSheetPrintRangeSchema.optional(), // absent means "print the whole used range"
  scalePercent: z.number().positive().optional(), // print scale as a percentage: 100 means actual size, 50 means half size. Named for its unit rather than the bare `scale` it replaced, which left percentage-vs-fraction to the source format's own convention and so made 1 ambiguous between "1% of actual size" and "actual size".
  fitToPages: z
    .object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    })
    .optional(),
  repeatRows: ContentSheetRepeatRangeSchema.optional(), // rows repeated as a header band on every printed page
  repeatColumns: ContentSheetRepeatRangeSchema.optional(), // columns repeated as a header band on every printed page
  gridlines: z.boolean(),
  headers: z.boolean(), // row/column header display (the "A, B, C" / "1, 2, 3" chrome, not a repeated print header band)
  pageOrder: z.enum(["downThenOver", "overThenDown"]),
  manualBreaks: z
    .object({
      rows: z.array(z.number().int().nonnegative()),
      columns: z.array(z.number().int().nonnegative()),
    })
    .optional(),
});
export type ContentSheetPrintSettings = z.infer<
  typeof ContentSheetPrintSettingsSchema
>;

// A rectangular cell range on one sheet — the target of a dataValidation or conditionalFormatting rule, which (unlike a merge, anchored on its one top-left cell) can span, and a single rule can even name several of, disjoint ranges (confirmed against a real LibreOffice-produced xlsx, ExaDev/documents.js#758: a rule's own sqref attribute carries a space-separated list of ranges, not always one). Structurally identical to ContentSheetPrintRangeSchema but kept as its own name: a print range and a rule's target range are unrelated facts that happen to share a shape.
export const ContentSheetRangeSchema = z.object({
  startRow: z.number().int().nonnegative(),
  startColumn: z.number().int().nonnegative(),
  endRow: z.number().int().nonnegative(),
  endColumn: z.number().int().nonnegative(),
});
export type ContentSheetRange = z.infer<typeof ContentSheetRangeSchema>;

// The 8-value ECMA-376 comparison-operator vocabulary (ST_DataValidationOperator), shared verbatim by a dataValidation rule's own numeric/date/time/textLength types and a conditionalFormatting cellIs rule below — the one piece of real, closed vocabulary both rule families already share in the spec itself.
export const SheetRuleOperatorSchema = z.enum([
  "between",
  "notBetween",
  "equal",
  "notEqual",
  "greaterThan",
  "greaterThanOrEqual",
  "lessThan",
  "lessThanOrEqual",
]);
export type SheetRuleOperator = z.infer<typeof SheetRuleOperatorSchema>;

// A cell's input-constraint rule (xlsx dataValidation, ODF table:content-validation) — promoted from the anchor-cell residue landing ooxml.js's own construct inventory deferred pending a real producer file (ExaDev/documents.js#758, verified against a real LibreOffice-produced xlsx). formula1/formula2 stay raw formula text, in whatever spelling the producer used (a literal quoted list for 'list', a cell-range reference, or a numeric/date literal): Excel's own formula language has no closed grammar this package could parse without a general formula engine, the same reason ContentSheetCell.formula is carried verbatim rather than structurally modelled.
export const ContentSheetDataValidationTypeSchema = z.enum([
  "whole",
  "decimal",
  "list",
  "date",
  "time",
  "textLength",
  "custom",
]);
export type ContentSheetDataValidationType = z.infer<
  typeof ContentSheetDataValidationTypeSchema
>;

export const ContentSheetDataValidationSchema = z.object({
  ranges: z.array(ContentSheetRangeSchema),
  type: ContentSheetDataValidationTypeSchema,
  operator: SheetRuleOperatorSchema.optional(), // absent for 'list' and 'custom', which have no comparison operator
  formula1: z.string().optional(), // raw formula text — absent only for a shape ECMA-376 itself allows with none
  formula2: z.string().optional(), // the second bound, present only for 'between'/'notBetween'
  allowBlank: z.boolean().optional(),
  showInputMessage: z.boolean().optional(),
  promptTitle: z.string().optional(),
  prompt: z.string().optional(),
  showErrorMessage: z.boolean().optional(),
  errorStyle: z.enum(["stop", "warning", "information"]).optional(), // absent means 'stop', ECMA-376's own default
  errorTitle: z.string().optional(),
  error: z.string().optional(),
  source: SourceResidueSchema.optional(), // the rule's own raw XML, quarantined for round-trip safety against a producer attribute this schema does not name
});
export type ContentSheetDataValidation = z.infer<
  typeof ContentSheetDataValidationSchema
>;

// A conditional-format rule's resulting style, limited to the two properties actually observed on a real LibreOffice-produced dxf (font colour, fill background) — everything else a dxf element may carry (borders, alignment overrides, font weight) rides `source` verbatim rather than being guessed at from spec alone pending its own real-producer verification.
export const ContentSheetConditionalFormatStyleSchema = z.object({
  textColor: ColorSchema.optional(),
  background: ColorSchema.optional(),
  source: SourceResidueSchema.optional(),
});
export type ContentSheetConditionalFormatStyle = z.infer<
  typeof ContentSheetConditionalFormatStyleSchema
>;

// A conditional-format value object (ECMA-376's own cfvo): a threshold's own kind (an absolute number, a percent, a percentile, this range's own min/max, or a formula result) and, for every kind but min/max, the value itself as raw formula/literal text — the same "structure yes, formula content no" boundary the rule schemas below draw throughout.
const cfvoTypeSchema = z.enum([
  "num",
  "percent",
  "max",
  "min",
  "formula",
  "percentile",
]);
export const ContentSheetConditionalFormatValueSchema = z.object({
  type: cfvoTypeSchema,
  value: z.string().optional(), // absent for 'min'/'max', which name a bound rather than carrying one
});
export type ContentSheetConditionalFormatValue = z.infer<
  typeof ContentSheetConditionalFormatValueSchema
>;

const MIN_COLOR_SCALE_STOPS = 2;
const MAX_COLOR_SCALE_STOPS = 3;

const conditionalFormatCommonFields = {
  ranges: z.array(ContentSheetRangeSchema),
  priority: z.number().int().optional(),
  stopIfTrue: z.boolean().optional(),
  source: SourceResidueSchema.optional(),
};

// A range's conditional display rule (xlsx conditionalFormatting/cfRule, ODF's own calcext:conditional-formats vendor extension) — promoted from the anchor-cell residue landing for every CLOSED-form rule type ECMA-376 defines (ExaDev/documents.js#758, verified against a real LibreOffice-produced xlsx carrying cellIs and colorScale rules). The one member deliberately absent is 'expression': an arbitrary boolean formula has no closed-form structure to model without a general formula engine — the same boundary dataValidation's own 'custom'/other formula fields already draw by staying raw text, except here there is no other field to carry it in at all, so an expression-type cfRule is not promoted by this union and continues to land through the pre-existing anchor-cell residue mechanism, unchanged.
export const ContentSheetConditionalFormatSchema = z.discriminatedUnion(
  "type",
  [
    z.object({
      type: z.literal("cellIs"),
      ...conditionalFormatCommonFields,
      operator: SheetRuleOperatorSchema,
      formula1: z.string(),
      formula2: z.string().optional(), // present only for 'between'/'notBetween'
      style: ContentSheetConditionalFormatStyleSchema.optional(),
    }),
    z.object({
      type: z.enum([
        "containsText",
        "notContainsText",
        "beginsWith",
        "endsWith",
      ]),
      ...conditionalFormatCommonFields,
      text: z.string(),
      style: ContentSheetConditionalFormatStyleSchema.optional(),
    }),
    z.object({
      type: z.enum([
        "containsBlanks",
        "notContainsBlanks",
        "containsErrors",
        "notContainsErrors",
        "uniqueValues",
        "duplicateValues",
      ]),
      ...conditionalFormatCommonFields,
      style: ContentSheetConditionalFormatStyleSchema.optional(),
    }),
    z.object({
      type: z.literal("top10"),
      ...conditionalFormatCommonFields,
      rank: z.number().positive(),
      percent: z.boolean().optional(),
      bottom: z.boolean().optional(),
      style: ContentSheetConditionalFormatStyleSchema.optional(),
    }),
    z.object({
      type: z.literal("aboveAverage"),
      ...conditionalFormatCommonFields,
      aboveAverage: z.boolean().optional(), // absent means true, ECMA-376's own default
      equalAverage: z.boolean().optional(),
      stdDev: z.number().int().positive().optional(),
      style: ContentSheetConditionalFormatStyleSchema.optional(),
    }),
    z.object({
      type: z.literal("timePeriod"),
      ...conditionalFormatCommonFields,
      timePeriod: z.enum([
        "yesterday",
        "today",
        "tomorrow",
        "last7Days",
        "thisMonth",
        "lastMonth",
        "nextMonth",
        "thisWeek",
        "lastWeek",
        "nextWeek",
        // Reachable only from odf.js's own calcext:date-is reading (ExaDev/documents.js#1075) — ECMA-376's own ST_TimePeriod enum has no year-scoped member, so xlsx never produces these, but LibreOffice's calcext extension genuinely does (verified against sc/source/filter/xml/xmlcondformat.cxx's own calcext:date-is/@date reading: "this-year"/"last-year"/"next-year" are real, recognised values, not a guess).
        "thisYear",
        "lastYear",
        "nextYear",
      ]),
      style: ContentSheetConditionalFormatStyleSchema.optional(),
    }),
    z.object({
      type: z.literal("colorScale"),
      ...conditionalFormatCommonFields,
      // Excel's own colorScale conditional format supports a two-colour or a three-colour scale; there is no four-colour variant.
      stops: z
        .array(
          z.object({
            value: ContentSheetConditionalFormatValueSchema,
            color: ColorSchema,
          }),
        )
        .min(MIN_COLOR_SCALE_STOPS)
        .max(MAX_COLOR_SCALE_STOPS),
    }),
    z.object({
      type: z.literal("dataBar"),
      ...conditionalFormatCommonFields,
      min: ContentSheetConditionalFormatValueSchema,
      max: ContentSheetConditionalFormatValueSchema,
      color: ColorSchema,
      showValue: z.boolean().optional(),
    }),
    z.object({
      type: z.literal("iconSet"),
      ...conditionalFormatCommonFields,
      iconSetType: z.string(), // ECMA-376's own iconSet identifier, e.g. '3TrafficLights1' — an open, producer-extensible vocabulary (custom icon sets), so a closed enum here would reject a real file rather than describe one
      thresholds: z.array(ContentSheetConditionalFormatValueSchema),
      reverse: z.boolean().optional(),
      showValue: z.boolean().optional(),
    }),
  ],
);
export type ContentSheetConditionalFormat = z.infer<
  typeof ContentSheetConditionalFormatSchema
>;

// A spreadsheet-anchored image: cell-relative placement (an xlsx/ods "anchor cell + pixel offset" style position) on top of ContentImageBlockSchema's own existing fields, rather than a second, independent image shape.
export const ContentSheetImageSchema = ContentImageBlockSchema.extend({
  anchorRow: z.number().int().nonnegative(),
  anchorColumn: z.number().int().nonnegative(),
  offsetXPt: z.number(), // offset from the anchor cell's own top-left corner
  offsetYPt: z.number(),
});
export type ContentSheetImage = z.infer<typeof ContentSheetImageSchema>;

// embeddedObjects is its own explicit array here, unlike the wordprocessing/presentation/drawing cases above, since a spreadsheet has no block-flow concept for an embedded object to anchor into the way ContentBlock's 'embeddedObject' variant does for the other three kinds.
export const ContentSheetSchema = z.object({
  name: z.string(),
  cells: z.array(ContentSheetCellSchema),
  columns: z.array(ContentSheetColumnSchema),
  rows: z.array(ContentSheetRowSchema),
  images: z.array(ContentSheetImageSchema),
  printSettings: ContentSheetPrintSettingsSchema,
  embeddedObjects: z.array(ContentEmbeddedObjectSchema).optional(),
  dataValidations: z.array(ContentSheetDataValidationSchema).optional(),
  conditionalFormats: z.array(ContentSheetConditionalFormatSchema).optional(),
  source: SourceResidueSchema.optional(), // quarantined residue — opaque text this format carries and no other format interprets (src/source.ts); rides the tree's sheet descriptor automatically (omit+extend, src/package-node.ts)
  ...CONTENT_ANNOTATION_FIELDS,
});
export type ContentSheet = z.infer<typeof ContentSheetSchema>;
