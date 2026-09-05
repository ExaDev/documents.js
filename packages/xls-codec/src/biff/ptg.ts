import { columnIndexToLetters } from "document-schema.js";

import { BlockCursor } from "./cursor";
import { errorTextOf } from "./errors";
import { FTAB_FIXED_ARITY, FTAB_NAMES } from "./ptg-functions";
import { readShortXLUnicodeString, readXLUnicodeString } from "./strings";

// A BIFF8 compiled formula (Ptg token stream, [MS-XLS] 2.5.198.25 -- https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/94229a89-a5b6-4f2b-834f-bd28cdc57c6b) walked left to right and rebuilt into the infix text a spreadsheet application would show.
//
// The tokens are postfix (reverse Polish): an operand token pushes a value, an operator or function token pops however many operands it needs and pushes the combined result. This module carries that same shape one level up -- an OPERAND STACK of already-formatted text, each entry tagged with the precedence of whatever built it -- so a binary operator or function call is always "pop N, join, push" and the only real complexity is deciding when a child needs literal parentheses around it before it can sit inside its parent's text. That decision is precedence comparison, not a special case: wrap the left child when its own precedence is lower than the operator being applied, wrap the right child when its precedence is lower than OR EQUAL to it. The equal case on the right is what reproduces `a-(b-c)` correctly (and, for a commutative operator, only ever fires when the postfix stream itself demanded that grouping -- which happens only when the formula's own author wrote explicit parentheses, since a bare `a+b+c` always compiles left-nested) -- so this one rule is correct for every operator here regardless of its true associativity, and this module never needs to know what that associativity actually is.
//
// A shared formula's PtgExp and an array constant's PtgArray are now resolved rather than aborting the parse -- see readPtgExpBase (joined against a ShrFmla/Array record by workbook/sheet.ts's collectFormulaGroups), the ParseFormulaOptions.relativeTo-driven PtgRefN/PtgAreaN expansion, and the ParseFormulaOptions.rgcb-driven PtgArray/PtgExtraArray handling below. What remains unrecognised -- a data table's PtgTbl, a defined name's PtgName/PtgNameX, a natural-language "Elf" reference, a genuinely external workbook's 3D reference -- still aborts the whole parse rather than guessing: parseFormulaText returns undefined, and the caller leaves ContentSheetCell.formula absent for that cell exactly as it already does for a cell this reader cannot map at all. A BiffFormatError from a cursor read past the end of rgce is not caught here: cce already bounds a well-formed token stream exactly, so a cursor genuinely running past it means this module misjudged a token's own byte width, which is a bug worth failing loudly on rather than silently discarding.

/** A 3D reference's sheet scope, resolved from its ixti through EXTERNSHEET and a self-referencing SupBook ([MS-XLS] 2.4.271, 2.4.106, 2.5.344): the first and last sheet of the reference, both direct BoundSheet8 indices into FormulaSheetContext.sheets. A single-sheet 3D reference has `firstSheetIndex === lastSheetIndex`. Defined here rather than alongside the globals reader that produces it, since resolving it into reference text is what this module exists to do. */
export interface SheetRange {
  readonly firstSheetIndex: number;
  readonly lastSheetIndex: number;
}

/** What a 3D reference's own ixti resolves against: the workbook's sheets in BoundSheet8 order (only the name is needed here), and each ixti's own resolved sheet range (undefined where this reader does not resolve it -- see WorkbookGlobals.sheetRanges, which this type's own sheetRanges field matches field-for-field). */
export interface FormulaSheetContext {
  readonly sheets: readonly { readonly name: string }[];
  readonly sheetRanges: readonly (SheetRange | undefined)[];
}

/** One already-formatted operand on the stack, carrying the precedence of the operator that produced it (or PRECEDENCE_ATOMIC for a literal, a reference, or a function call) so its parent can decide whether it needs wrapping in literal parentheses. */
interface FormulaOperand {
  readonly text: string;
  readonly precedence: number;
}

// Excel's own documented operator precedence (https://support.microsoft.com/en-us/office/calculation-operators-and-precedence-in-excel), narrowed to the operators this module builds text for -- reference operators (: (space) ,) are not in this vocabulary (see the module comment), so PRECEDENCE_ATOMIC is the ceiling every leaf and function call carries.
const PRECEDENCE_COMPARISON = 1;
const PRECEDENCE_CONCAT = 2;
const PRECEDENCE_ADD_SUB = 3;
const PRECEDENCE_MUL_DIV = 4;
const PRECEDENCE_POWER = 5;
const PRECEDENCE_PERCENT = 6;
const PRECEDENCE_UNARY = 7;
const PRECEDENCE_ATOMIC = 8;

function pushAtomic(stack: FormulaOperand[], text: string): void {
  stack.push({ text, precedence: PRECEDENCE_ATOMIC });
}

function wrapBelow(operand: FormulaOperand, minimum: number): string {
  return operand.precedence < minimum ? `(${operand.text})` : operand.text;
}

function wrapAtOrBelow(operand: FormulaOperand, minimum: number): string {
  return operand.precedence <= minimum ? `(${operand.text})` : operand.text;
}

/** Pops two operands and pushes their combination -- the left wrapped only if its own precedence is strictly lower than this operator's, the right wrapped if its precedence is lower than or equal to it (see the module comment for why the same rule is correct for every operator here). Returns false, changing nothing, when fewer than two operands are on the stack -- a malformed token stream this reader declines to guess at rather than reading past. */
function applyBinary(
  stack: FormulaOperand[],
  symbol: string,
  precedence: number,
): boolean {
  const right = stack.pop();
  const left = stack.pop();
  if (left === undefined || right === undefined) {
    return false;
  }
  stack.push({
    text: `${wrapBelow(left, precedence)}${symbol}${wrapAtOrBelow(right, precedence)}`,
    precedence,
  });
  return true;
}

function applyPrefix(stack: FormulaOperand[], symbol: string): boolean {
  const operand = stack.pop();
  if (operand === undefined) {
    return false;
  }
  stack.push({
    text: `${symbol}${wrapBelow(operand, PRECEDENCE_UNARY)}`,
    precedence: PRECEDENCE_UNARY,
  });
  return true;
}

function applyPercent(stack: FormulaOperand[]): boolean {
  const operand = stack.pop();
  if (operand === undefined) {
    return false;
  }
  stack.push({
    text: `${wrapBelow(operand, PRECEDENCE_PERCENT)}%`,
    precedence: PRECEDENCE_PERCENT,
  });
  return true;
}

/** PtgParen ([MS-XLS] 2.5.198.80): a pure display token restating parentheses the formula's own author typed, regardless of whether the grouping they express is otherwise necessary. Wrapped unconditionally rather than through precedence comparison, since the point is to reproduce exactly what was there, not to decide afresh whether it was needed. */
function applyParen(stack: FormulaOperand[]): boolean {
  const operand = stack.pop();
  if (operand === undefined) {
    return false;
  }
  stack.push({ text: `(${operand.text})`, precedence: PRECEDENCE_ATOMIC });
  return true;
}

/** Pops exactly `arity` operands (in argument order) and pushes `name(arg1,arg2,...)`. A function call's own arguments never need wrapping regardless of what built them -- the parentheses already bound them unambiguously -- so every argument is taken as its bare text. */
function applyFunctionCall(
  stack: FormulaOperand[],
  name: string,
  arity: number,
): boolean {
  if (stack.length < arity) {
    return false;
  }
  const args = stack.splice(stack.length - arity, arity);
  stack.push({
    text: `${name}(${args.map((operand) => operand.text).join(",")})`,
    precedence: PRECEDENCE_ATOMIC,
  });
  return true;
}

/** PtgAttrSum ([MS-XLS] 2.5.198.41): the optimisation a real producer emits in place of a PtgFuncVar call to SUM with a single reference-class argument, wrapping whatever is already on top of the stack. */
function applySum(stack: FormulaOperand[]): boolean {
  return applyFunctionCall(stack, "SUM", 1);
}

function quoteStringLiteral(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

// ColRelU ([MS-XLS] 2.5.51): a 16-bit column field packing the zero-based column index into its low 14 bits, with bit 14 (0x4000) saying the column is a RELATIVE reference and bit 15 (0x8000) saying the row coordinate carried alongside it is too. Absolute is the "not relative" case in both, which is why the formatter below negates each bit.
const COLUMN_INDEX_MASK = 0x3fff;
const COLUMN_RELATIVE_BIT = 0x4000;
const ROW_RELATIVE_BIT = 0x8000;

/** One corner of a cell reference: its 0-based row/column, and whether each is an absolute ($) coordinate. */
interface CellPoint {
  readonly row: number;
  readonly column: number;
  readonly columnAbsolute: boolean;
  readonly rowAbsolute: boolean;
}

function pointFrom(row: number, columnField: number): CellPoint {
  return {
    row,
    column: columnField & COLUMN_INDEX_MASK,
    columnAbsolute: (columnField & COLUMN_RELATIVE_BIT) === 0,
    rowAbsolute: (columnField & ROW_RELATIVE_BIT) === 0,
  };
}

function formatPoint(point: CellPoint): string {
  const column = `${point.columnAbsolute ? "$" : ""}${columnIndexToLetters(point.column)}`;
  const row = `${point.rowAbsolute ? "$" : ""}${point.row + 1}`;
  return `${column}${row}`;
}

/** RgceLoc ([MS-XLS] 2.5.198.109): a single cell reference, as PtgRef/PtgRef3d carry it -- a plain row then a ColRelU column field. */
function readLoc(cursor: BlockCursor): CellPoint {
  const row = cursor.u16();
  const columnField = cursor.u16();
  return pointFrom(row, columnField);
}

/** RgceArea ([MS-XLS] 2.5.198.105): a rectangular range, as PtgArea/PtgArea3d carry it -- both row bounds, then both corners' own ColRelU column fields. */
function readArea(cursor: BlockCursor): readonly [CellPoint, CellPoint] {
  const rowFirst = cursor.u16();
  const rowLast = cursor.u16();
  const columnFirstField = cursor.u16();
  const columnLastField = cursor.u16();
  return [
    pointFrom(rowFirst, columnFirstField),
    pointFrom(rowLast, columnLastField),
  ];
}

/** A cell position a relative Ptg token's offset is resolved against -- the referencing cell currently being expanded, never the shared formula's own base cell. Exported only because it appears in ParseFormulaOptions.relativeTo and readPtgExpBase's own return type, both public. */
export interface FormulaOrigin {
  readonly row: number;
  readonly column: number;
}

/** Sign-extends the low `bits` bits of `raw` by shifting them out to the top of a 32-bit word and back with an arithmetic shift -- the same trick BlockCursor.i16 uses for a full 16-bit field, generalised here to the 14-bit column delta a relative column field packs ([MS-XLS] 174e856e ColRelNegU: "col (14 bits): A signed integer... MUST be greater than or equal to -255 [and] less than or equal to 255"). */
function signExtend(raw: number, bits: number): number {
  const shift = 32 - bits;
  return (raw << shift) >> shift;
}

/** RgceLocRel's row field, once known to be relative ([MS-XLS] 2db37ba7 RgceLocRel): a signed 16-bit delta from `currentRow`, wrapped back into 0..65535 exactly as the spec states ("adjusted by 0x00010000") rather than left negative or overflowing -- Excel itself lets a filled-down/across shared formula's relative reference wrap around the sheet edge this way. */
function resolveRelativeRow(rawRow: number, currentRow: number): number {
  const row = currentRow + signExtend(rawRow, 16);
  if (row < 0) return row + 0x10000;
  if (row > 0xffff) return row - 0x10000;
  return row;
}

/** RgceLocRel's column field, once known to be relative: a signed 14-bit delta from `currentColumn` (the two flag bits above it already stripped by the caller), wrapped back into 0..255 ([MS-XLS] "adjusted by 0x0100"). */
function resolveRelativeColumn(
  rawColumn: number,
  currentColumn: number,
): number {
  const column = currentColumn + signExtend(rawColumn, 14);
  if (column < 0) return column + 0x100;
  if (column > 0xff) return column - 0x100;
  return column;
}

/** One corner of a relative reference ([MS-XLS] 2db37ba7 RgceLocRel, or one half of 75afd109 RgceAreaRel): the same ColRelU-shaped flag bits pointFrom already decodes for an absolute reference, but a set relative bit now means the paired field holds a signed delta from `current` rather than an absolute coordinate. */
function resolveRelativeCorner(
  rowField: number,
  columnField: number,
  current: FormulaOrigin,
): CellPoint {
  const columnAbsolute = (columnField & COLUMN_RELATIVE_BIT) === 0;
  const rowAbsolute = (columnField & ROW_RELATIVE_BIT) === 0;
  const rawColumn = columnField & COLUMN_INDEX_MASK;
  return {
    row: rowAbsolute ? rowField : resolveRelativeRow(rowField, current.row),
    column: columnAbsolute
      ? rawColumn
      : resolveRelativeColumn(rawColumn, current.column),
    columnAbsolute,
    rowAbsolute,
  };
}

/** RgceLocRel ([MS-XLS] 2.5.198.111): PtgRefN's own cell shape -- a row field then a ColRelNegU column field, structurally identical to RgceLoc/ColRelU (see readLoc/pointFrom above) but reinterpreting a relative field as an offset from `current` -- the cell this formula is being expanded for -- rather than an absolute coordinate. Meaningful only when expanding a shared formula's own tokens for one specific referencing cell (see workbook/sheet.ts's collectFormulaGroups); every other caller has no `current` cell to offer, which is exactly when this reader has no business meeting one of these tokens at all -- SharedParsedFormula's own grammar is the only place they are legal. */
function readRelativeLoc(
  cursor: BlockCursor,
  current: FormulaOrigin,
): CellPoint {
  const rowField = cursor.u16();
  const columnField = cursor.u16();
  return resolveRelativeCorner(rowField, columnField, current);
}

/** RgceAreaRel ([MS-XLS] 75afd109): PtgAreaN's own two-corner shape -- the same field order readArea already uses for an absolute range (both rows, then both corners' own column fields), each corner resolved through the identical relative/absolute rule readRelativeLoc applies to a single cell. */
function readRelativeArea(
  cursor: BlockCursor,
  current: FormulaOrigin,
): readonly [CellPoint, CellPoint] {
  const rowFirst = cursor.u16();
  const rowLast = cursor.u16();
  const columnFirstField = cursor.u16();
  const columnLastField = cursor.u16();
  return [
    resolveRelativeCorner(rowFirst, columnFirstField, current),
    resolveRelativeCorner(rowLast, columnLastField, current),
  ];
}

/**
 * PtgExtraArray's own SerAr elements ([MS-XLS] 69ff31ac): every variant but SerStr is a fixed nine bytes -- a one-byte type tag plus eight bytes of payload/padding -- so only SerStr's own XLUnicodeString needs its length read from the data rather than assumed.
 */
const SERAR_NIL = 0x00;
const SERAR_NUM = 0x01;
const SERAR_STR = 0x02;
const SERAR_BOOL = 0x04;
const SERAR_ERR = 0x10;
/** SerNil/SerBool/SerErr's own trailing padding, after the one type byte this module already reads and (for SerBool/SerErr) the one payload byte after it -- see SERAR_FIXED_PAYLOAD_BYTES for the pre-payload figure these values are derived from. */
const SERAR_FIXED_PAYLOAD_BYTES = 8;

/** One SerAr element ([MS-XLS] 69ff31ac) from a PtgExtraArray's `array` field, as the literal text an array-constant token in that position would show -- undefined for a type tag this reader does not recognise, or an error code [MS-XLS] does not define, in which case the caller aborts the whole PtgArray rather than fabricating a placeholder value. */
function readArrayElementText(cursor: BlockCursor): string | undefined {
  const type = cursor.u8();
  switch (type) {
    case SERAR_NUM:
      return String(cursor.f64());
    case SERAR_STR:
      return quoteStringLiteral(readXLUnicodeString(cursor));
    case SERAR_BOOL: {
      const value = cursor.u8() !== 0;
      cursor.skip(SERAR_FIXED_PAYLOAD_BYTES - 1);
      return value ? "TRUE" : "FALSE";
    }
    case SERAR_ERR: {
      const text = errorTextOf(cursor.u8());
      cursor.skip(SERAR_FIXED_PAYLOAD_BYTES - 1);
      return text;
    }
    case SERAR_NIL:
      cursor.skip(SERAR_FIXED_PAYLOAD_BYTES);
      return "";
    default:
      return undefined;
  }
}

/**
 * PtgExtraArray ([MS-XLS] edd64b46): the literal value grid a PtgArray token's own RgbExtra trailer carries -- one less than the column and row counts, then that many SerAr elements in row-major order. Rendered as Excel's own array-constant syntax (comma between columns, semicolon between rows, e.g. `{1,2;3,4}`), which is the same textual spelling this token has whether it sits inside an ordinary formula's array-constant literal (`=SUM({1,2,3})`) or inside an array formula's own expression -- the array-FORMULA-level `{...}` a CSE entry adds is a separate, outer wrapping applied by the caller, never this one.
 */
function readArrayLiteralText(cursor: BlockCursor): string | undefined {
  const columns = cursor.u8() + 1;
  const rows = cursor.u16() + 1;
  const rowTexts: string[] = [];
  for (let row = 0; row < rows; row += 1) {
    const values: string[] = [];
    for (let column = 0; column < columns; column += 1) {
      const value = readArrayElementText(cursor);
      if (value === undefined) {
        return undefined;
      }
      values.push(value);
    }
    rowTexts.push(values.join(","));
  }
  return `{${rowTexts.join(";")}}`;
}

// A sheet name needs single-quote wrapping (with any embedded quote doubled) whenever it is not a bare identifier -- this covers the common real-world cases (a space, a leading digit, punctuation) without attempting Excel's full, more permissive grammar; a name this pattern quotes unnecessarily is still valid Excel syntax, so the only real risk is the pattern being too PERMISSIVE, and every character it allows unquoted (letters, digits, underscore, period) is one Excel itself never requires quoting for.
const SIMPLE_SHEET_NAME_RE = /^[A-Za-z_][A-Za-z0-9_.]*$/;

function quoteSheetLabel(label: string): string {
  return SIMPLE_SHEET_NAME_RE.test(label)
    ? label
    : `'${label.replaceAll("'", "''")}'`;
}

/** The `'Sheet'!` or `'First:Last'!` prefix a 3D reference's own ixti resolves to, or undefined when this reader does not resolve it (see WorkbookGlobals.sheetRanges) -- an unresolved ixti aborts the whole formula's parse, the same as any other unsupported token. */
function resolveSheetLabel(
  ixti: number,
  context: FormulaSheetContext,
): string | undefined {
  const range = context.sheetRanges[ixti];
  if (range === undefined) {
    return undefined;
  }
  const first = context.sheets[range.firstSheetIndex]?.name;
  const last = context.sheets[range.lastSheetIndex]?.name;
  if (first === undefined || last === undefined) {
    return undefined;
  }
  const label =
    range.firstSheetIndex === range.lastSheetIndex ? first : `${first}:${last}`;
  return `${quoteSheetLabel(label)}!`;
}

// The Ptg opcode enumeration ([MS-XLS] 2.5.198.25's own first-byte/second-byte table -- https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/94229a89-a5b6-4f2b-834f-bd28cdc57c6b), restricted to the tokens this module actually acts on. A reference/value/array-class family (PtgRef, PtgArea, PtgFunc, PtgFuncVar, PtgRef3d, PtgArea3d) shares one on-disk field layout across its three opcodes -- only the ARITY of a leaf-vs-operand distinction the parse tree carries differs, which this module, building text rather than validating a parse tree, has no need to tell apart -- so all three are dispatched to the identical handler below.

const PTG_ADD = 0x03;
const PTG_SUB = 0x04;
const PTG_MUL = 0x05;
const PTG_DIV = 0x06;
const PTG_POWER = 0x07;
const PTG_CONCAT = 0x08;
const PTG_LT = 0x09;
const PTG_LE = 0x0a;
const PTG_EQ = 0x0b;
const PTG_GE = 0x0c;
const PTG_GT = 0x0d;
const PTG_NE = 0x0e;
const PTG_UPLUS = 0x12;
const PTG_UMINUS = 0x13;
const PTG_PERCENT = 0x14;
const PTG_PAREN = 0x15;
const PTG_MISSARG = 0x16;
const PTG_STR = 0x17;
const PTG_ERR = 0x1c;
const PTG_BOOL = 0x1d;
const PTG_INT = 0x1e;
const PTG_NUM = 0x1f;
const PTG_FUNC_REF = 0x21;
const PTG_FUNC_VALUE = 0x41;
const PTG_FUNC_ARRAY = 0x61;
const PTG_FUNCVAR_REF = 0x22;
const PTG_FUNCVAR_VALUE = 0x42;
const PTG_FUNCVAR_ARRAY = 0x62;
const PTG_REF_REF = 0x24;
const PTG_REF_VALUE = 0x44;
const PTG_REF_ARRAY = 0x64;
const PTG_AREA_REF = 0x25;
const PTG_AREA_VALUE = 0x45;
const PTG_AREA_ARRAY = 0x65;
const PTG_REF3D_REF = 0x3a;
const PTG_REF3D_VALUE = 0x5a;
const PTG_REF3D_ARRAY = 0x7a;
const PTG_AREA3D_REF = 0x3b;
const PTG_AREA3D_VALUE = 0x5b;
const PTG_AREA3D_ARRAY = 0x7b;
/** PtgRefN's family ([MS-XLS] 2.5.198.25): a relative-only single-cell reference, legal only inside a shared formula's own SharedParsedFormula -- see readRelativeLoc. */
const PTG_REFN_REF = 0x2c;
const PTG_REFN_VALUE = 0x4c;
const PTG_REFN_ARRAY = 0x6c;
/** PtgAreaN's family: PtgRefN's area counterpart -- see readRelativeArea. */
const PTG_AREAN_REF = 0x2d;
const PTG_AREAN_VALUE = 0x4d;
const PTG_AREAN_ARRAY = 0x6d;
/** PtgArray's family ([MS-XLS] 61167ac8): an array-constant literal, whose values live in a PtgExtraArray this token's own bytes never carry -- see ParseFormulaOptions.rgcb and readArrayLiteralText. Each token is a fixed eight bytes: the opcode itself (already consumed by the caller) plus seven bytes this reader never inspects (unused1/2/3), since the real data is the RgbExtra trailer's own PtgExtraArray in the same position-in-sequence as this token. */
const PTG_ARRAY_REF = 0x20;
const PTG_ARRAY_VALUE = 0x40;
const PTG_ARRAY_ARRAY = 0x60;
/** The seven bytes of a PtgArray token besides its own opcode byte (already consumed as `opcode` by the caller) -- unused1 (1 byte) + unused2 (2 bytes) + unused3 (4 bytes), [MS-XLS] 61167ac8. */
const PTG_ARRAY_TRAILING_BYTES = 7;

// PtgAttr's own family ([MS-XLS] 2.5.198.25's 0x19 second-byte group): every one of these is a fixed four bytes (the shared 0x19 opcode, a one-byte subtype flag, then two more bytes -- an offset for Semi/If/Goto, unused for Sum/Baxcel/Space/SpaceSemi) EXCEPT PtgAttrChoose, whose trailing rgOffset array is variable-length and therefore unsupported here (see PTG_ATTR_CHOOSE below). None of the fixed four carries any text-relevant information for this module's purposes: PtgAttrIf/PtgAttrGoto/PtgAttrSemi/PtgAttrSpace/PtgAttrSpaceSemi/PtgAttrBaxcel are calculation-engine control/display framing this module discards as pure no-ops (their own "offset" fields describe evaluator jump distances, irrelevant to reconstructing text), and PtgAttrSum alone has a text effect, wrapping whatever operand already sits on top of the stack.
const PTG_ATTR_OPCODE = 0x19;
const PTG_ATTR_SEMI = 0x01;
const PTG_ATTR_IF = 0x02;
const PTG_ATTR_CHOOSE = 0x04;
const PTG_ATTR_GOTO = 0x08;
const PTG_ATTR_SUM = 0x10;
const PTG_ATTR_BAXCEL_A = 0x20;
const PTG_ATTR_BAXCEL_B = 0x21;
const PTG_ATTR_SPACE = 0x40;
const PTG_ATTR_SPACE_SEMI = 0x41;
/** The four bytes every PtgAttr subtype but PtgAttrChoose occupies: the shared opcode, the subtype flag byte (already consumed by the caller), and two more this module never inspects. */
const PTG_ATTR_TRAILING_BYTES = 2;

/**
 * Parses a Formula record's compiled expression into the text a spreadsheet application would show, or returns undefined for a token this reader does not resolve -- a defined name, a natural-language reference, a data table, or a 3D reference into a genuinely external workbook (see the module comment for the full list). The caller leaves ContentSheetCell.formula absent in that case, exactly as for any other unsupported construct.
 *
 * `rgce` is the formula's own token bytes, already sliced to their declared length (CellParsedFormula.cce/SharedParsedFormula.cce/ArrayParsedFormula.cce) by the caller -- this function reads exactly that many bytes and nothing past them.
 */
export interface ParseFormulaOptions {
  /** The cell this formula is being evaluated for -- present only when `rgce` is a ShrFmla's own SharedParsedFormula being expanded for one specific referencing cell (see workbook/sheet.ts's collectFormulaGroups), which is the only place PtgRefN/PtgAreaN are legal. Absent for every other caller, in which case meeting one of those tokens aborts the parse exactly as it always has. */
  readonly relativeTo?: FormulaOrigin;
  /** The RgbExtra trailer following `rgce` in the same CellParsedFormula/ArrayParsedFormula ([MS-XLS] 7dd67f0a/242bcf20) -- consulted only when `rgce` contains a PtgArray, one PtgExtraArray pulled off the front for each in the order both arrays share ([MS-XLS] 70f743b2: "The order of the structures MUST be the same as the order of the Ptgs"). Absent (or exhausted before a PtgArray needs it) aborts the parse rather than guessing at the array's values. */
  readonly rgcb?: Uint8Array<ArrayBuffer>;
}

export function parseFormulaText(
  rgce: Uint8Array<ArrayBuffer>,
  context: FormulaSheetContext,
  options: ParseFormulaOptions = {},
): string | undefined {
  const cursor = new BlockCursor([rgce]);
  const stack: FormulaOperand[] = [];
  // Lazily-nonexistent rather than lazily-created: a formula with no PtgArray at all (the overwhelming majority) never touches this, and a genuine RgbExtra trailer is read strictly left-to-right across however many PtgArray tokens rgce turns out to hold, in the same single pass as rgce itself.
  const rgcbCursor =
    options.rgcb === undefined ? undefined : new BlockCursor([options.rgcb]);

  while (cursor.remainingInBlock() > 0) {
    const opcode = cursor.u8();
    switch (opcode) {
      case PTG_ADD:
        if (!applyBinary(stack, "+", PRECEDENCE_ADD_SUB)) return undefined;
        break;
      case PTG_SUB:
        if (!applyBinary(stack, "-", PRECEDENCE_ADD_SUB)) return undefined;
        break;
      case PTG_MUL:
        if (!applyBinary(stack, "*", PRECEDENCE_MUL_DIV)) return undefined;
        break;
      case PTG_DIV:
        if (!applyBinary(stack, "/", PRECEDENCE_MUL_DIV)) return undefined;
        break;
      case PTG_POWER:
        if (!applyBinary(stack, "^", PRECEDENCE_POWER)) return undefined;
        break;
      case PTG_CONCAT:
        if (!applyBinary(stack, "&", PRECEDENCE_CONCAT)) return undefined;
        break;
      case PTG_LT:
        if (!applyBinary(stack, "<", PRECEDENCE_COMPARISON)) return undefined;
        break;
      case PTG_LE:
        if (!applyBinary(stack, "<=", PRECEDENCE_COMPARISON)) return undefined;
        break;
      case PTG_EQ:
        if (!applyBinary(stack, "=", PRECEDENCE_COMPARISON)) return undefined;
        break;
      case PTG_GE:
        if (!applyBinary(stack, ">=", PRECEDENCE_COMPARISON)) return undefined;
        break;
      case PTG_GT:
        if (!applyBinary(stack, ">", PRECEDENCE_COMPARISON)) return undefined;
        break;
      case PTG_NE:
        if (!applyBinary(stack, "<>", PRECEDENCE_COMPARISON)) return undefined;
        break;
      case PTG_UPLUS:
        if (!applyPrefix(stack, "+")) return undefined;
        break;
      case PTG_UMINUS:
        if (!applyPrefix(stack, "-")) return undefined;
        break;
      case PTG_PERCENT:
        if (!applyPercent(stack)) return undefined;
        break;
      case PTG_PAREN:
        if (!applyParen(stack)) return undefined;
        break;
      case PTG_MISSARG:
        // An omitted optional argument (e.g. the third argument of IF(A1>0,1)) -- present in the token stream as a real, empty operand so the enclosing PtgFuncVar's own cparams still counts it.
        pushAtomic(stack, "");
        break;
      case PTG_STR:
        pushAtomic(stack, quoteStringLiteral(readShortXLUnicodeString(cursor)));
        break;
      case PTG_ERR: {
        const text = errorTextOf(cursor.u8());
        if (text === undefined) return undefined;
        pushAtomic(stack, text);
        break;
      }
      case PTG_BOOL:
        pushAtomic(stack, cursor.u8() !== 0 ? "TRUE" : "FALSE");
        break;
      case PTG_INT:
        pushAtomic(stack, String(cursor.u16()));
        break;
      case PTG_NUM:
        pushAtomic(stack, String(cursor.f64()));
        break;
      case PTG_REF_REF:
      case PTG_REF_VALUE:
      case PTG_REF_ARRAY:
        pushAtomic(stack, formatPoint(readLoc(cursor)));
        break;
      case PTG_AREA_REF:
      case PTG_AREA_VALUE:
      case PTG_AREA_ARRAY: {
        const [start, end] = readArea(cursor);
        pushAtomic(stack, `${formatPoint(start)}:${formatPoint(end)}`);
        break;
      }
      case PTG_REF3D_REF:
      case PTG_REF3D_VALUE:
      case PTG_REF3D_ARRAY: {
        const ixti = cursor.u16();
        const point = readLoc(cursor);
        const label = resolveSheetLabel(ixti, context);
        if (label === undefined) return undefined;
        pushAtomic(stack, `${label}${formatPoint(point)}`);
        break;
      }
      case PTG_AREA3D_REF:
      case PTG_AREA3D_VALUE:
      case PTG_AREA3D_ARRAY: {
        const ixti = cursor.u16();
        const [start, end] = readArea(cursor);
        const label = resolveSheetLabel(ixti, context);
        if (label === undefined) return undefined;
        pushAtomic(stack, `${label}${formatPoint(start)}:${formatPoint(end)}`);
        break;
      }
      case PTG_REFN_REF:
      case PTG_REFN_VALUE:
      case PTG_REFN_ARRAY: {
        if (options.relativeTo === undefined) return undefined;
        pushAtomic(
          stack,
          formatPoint(readRelativeLoc(cursor, options.relativeTo)),
        );
        break;
      }
      case PTG_AREAN_REF:
      case PTG_AREAN_VALUE:
      case PTG_AREAN_ARRAY: {
        if (options.relativeTo === undefined) return undefined;
        const [start, end] = readRelativeArea(cursor, options.relativeTo);
        pushAtomic(stack, `${formatPoint(start)}:${formatPoint(end)}`);
        break;
      }
      case PTG_ARRAY_REF:
      case PTG_ARRAY_VALUE:
      case PTG_ARRAY_ARRAY: {
        cursor.skip(PTG_ARRAY_TRAILING_BYTES);
        if (rgcbCursor === undefined) return undefined;
        const text = readArrayLiteralText(rgcbCursor);
        if (text === undefined) return undefined;
        pushAtomic(stack, text);
        break;
      }
      case PTG_FUNC_REF:
      case PTG_FUNC_VALUE:
      case PTG_FUNC_ARRAY: {
        const iftab = cursor.u16();
        const name = FTAB_NAMES.get(iftab);
        const arity = FTAB_FIXED_ARITY.get(iftab);
        if (name === undefined || arity === undefined) return undefined;
        if (!applyFunctionCall(stack, name, arity)) return undefined;
        break;
      }
      case PTG_FUNCVAR_REF:
      case PTG_FUNCVAR_VALUE:
      case PTG_FUNCVAR_ARRAY: {
        const cparams = cursor.u8();
        const iftab = cursor.u16();
        const name = FTAB_NAMES.get(iftab);
        if (name === undefined) return undefined;
        if (!applyFunctionCall(stack, name, cparams)) return undefined;
        break;
      }
      case PTG_ATTR_OPCODE: {
        const subtype = cursor.u8();
        if (subtype === PTG_ATTR_CHOOSE) {
          // Variable-length (a cOffset count then that many 2-byte jump offsets), and CHOOSE is not in this reader's supported vocabulary -- see the module comment.
          return undefined;
        }
        cursor.skip(PTG_ATTR_TRAILING_BYTES);
        if (subtype === PTG_ATTR_SUM) {
          if (!applySum(stack)) return undefined;
        } else if (
          subtype !== PTG_ATTR_SEMI &&
          subtype !== PTG_ATTR_IF &&
          subtype !== PTG_ATTR_GOTO &&
          subtype !== PTG_ATTR_BAXCEL_A &&
          subtype !== PTG_ATTR_BAXCEL_B &&
          subtype !== PTG_ATTR_SPACE &&
          subtype !== PTG_ATTR_SPACE_SEMI
        ) {
          return undefined;
        }
        break;
      }
      default:
        // Every token this module still does not recognise -- PtgExp (resolved one level up, by the caller joining it against a ShrFmla/Array record before ever calling this function -- see readPtgExpBase), PtgTbl, PtgName/PtgNameX, PtgMemArea/MemErr/MemNoMem/MemFunc, PtgSxName, the Elf/Radical natural-language family, and PtgIsect/PtgUnion/PtgRange (the space/comma/colon reference operators, not in this reader's supported vocabulary) -- aborts the parse.
        return undefined;
    }
  }

  return stack.length === 1 ? stack[0]?.text : undefined;
}

/** PtgExp's own opcode ([MS-XLS] f9aa266f): 0x01, a reserved bit, then the row/col of the Formula record that carries the shared or array formula's real expression -- see readPtgExpBase. */
const PTG_EXP_OPCODE = 0x01;
/** PtgExp's own fixed size: the opcode byte plus a Rw (2 bytes) and a Col (2 bytes), [MS-XLS] f9aa266f. */
const PTG_EXP_SIZE = 5;

/**
 * If `rgce` is EXACTLY one PtgExp token -- which is the only shape a Formula record belonging to a shared or array formula group ever has, including the group's own base cell, which points at itself -- returns the (row, column) of the Formula record that carries the real expression (a ShrFmla or Array record immediately follows it). Returns undefined for every other rgce, so a caller can try this first and fall back to parseFormulaText for a formula that merely happens to open with byte 0x01 for some other reason (it cannot: no other single-byte-opcode Ptg in this reader's vocabulary is 0x01, but a malformed or foreign rgce is not assumed well-formed here either) or is simply longer than five bytes.
 *
 * Exported for workbook/sheet.ts's collectFormulaGroups, which joins the returned cell against whichever ShrFmla/Array record follows the Formula record found there.
 */
export function readPtgExpBase(
  rgce: Uint8Array<ArrayBuffer>,
): FormulaOrigin | undefined {
  if (rgce.length !== PTG_EXP_SIZE || rgce[0] !== PTG_EXP_OPCODE) {
    return undefined;
  }
  const cursor = new BlockCursor([rgce]);
  cursor.skip(1);
  const row = cursor.u16();
  const column = cursor.u16();
  return { row, column };
}
