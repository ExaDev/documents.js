import { int16At, sliceAt, uint16At } from "../bytes/view";
import { decodeWordString } from "./characters";

// Column letters are base-26 over 'A'..'Z', with the running value stepped down by one each round because the alphabet has no zero digit.
const ALPHABET_LENGTH = 26;
const UPPERCASE_A_CHAR_CODE = 65;

// A cell number in a formula is two int16s, row then column.
const CELL_NUMBER_BYTES = 4;

// The double in a floating-point constant is 8 bytes.
const DOUBLE_BYTE_LENGTH = 8;

// Codes with payloads, dispatched by the SDK's own numbering.
const CODE_NUMBER_CONSTANT = 8;
const CODE_STRING_CONSTANT = 9;
const CODE_NAME_REFERENCE = 10;
const CODE_GROUP1_FUNCTION = 12;
const CODE_GROUP2_FUNCTION = 13;
const CODE_NEGATION = 21;
const CODE_CELL_REFERENCE = 25;
const CODE_FORMULA_ERROR = 26;
const CODE_BLOCK_REFERENCE = 27;
const CODE_GROUP_REFERENCE = 28;
const CODE_FLOAT_CONSTANT = 30;
const CODE_UNARY_PLUS = 31;
const CODE_UNARY_MINUS = 32;
const CODE_ATTRIBUTE_ON = 41;
const CODE_ATTRIBUTE_OFF = 42;
const CODE_ATTRIBUTE_MASK = 43;
const CODE_CONDITIONAL_ATTRIBUTE = 44;

// Range and absolute-reference codes: 48-63 carry a two-bit absolute flag per corner cell, 64-67 the same idea in a two-bit mask.
const RANGE_REFERENCE_CODE_FIRST = 48;
const RANGE_REFERENCE_CODE_LAST = 63;
const RANGE_REFERENCE_FLAG_MASK = 0x0f;
const RANGE_FLAG_START_ROW_ABSOLUTE = 0x04;
const RANGE_FLAG_START_COLUMN_ABSOLUTE = 0x08;
const RANGE_FLAG_END_ROW_ABSOLUTE = 0x01;
const RANGE_FLAG_END_COLUMN_ABSOLUTE = 0x02;
const ABSOLUTE_REFERENCE_CODE_FIRST = 64;
const ABSOLUTE_REFERENCE_CODE_LAST = 67;
const ABSOLUTE_REFERENCE_FLAG_MASK = 0x03;

// — Table formulas, per WPFF Table Formula Functions --
//
// "Table formula codes and their operation are shown below. These codes are used by New Cell Formula (function 0xD0 subfunction 0x81)." The tokenised formula this module decodes is `stream/table.ts`'s own CELL_FORMULA_SUBFUNCTION payload — already isolated from its own six-byte length framing by readEmbeddedSubfunctions, so what reaches readTableFormula here is exactly the SDK's own "<tokenized formula> x length of formula" region and nothing else.
//
// A WORD ABOUT WHY THIS IS A LINEAR WALK, NOT AN RPN STACK MACHINE: the code table includes "," comma (22), "(" (23), and ")" (24) as formula codes in their own right, which a genuine postfix/RPN encoding would never need — precedence and grouping are exactly what parenthesised infix notation states explicitly and RPN encodes structurally, through operand order alone. Their presence means WordPerfect's own tokenised formula is a straight linearisation of the formula AS TYPED, one token per operator, operand, paren, or comma, in source order — so decoding it is a left-to-right substitution (each code's own text, concatenated) rather than a stack evaluation. That is also why this reader never needs an arity table for any operator or function: arity only matters to a stack machine building a tree, and nothing here builds one.
//
// THE HONEST-OR-NOTHING CONTRACT: every code this module does not have a confirmed, unambiguous textual spelling for — the SDK's own "* (assumed)" hedge on code 45, the "+" shortcut (14) whose direction-flag enumeration the mirrored SDK pages never state, the two temp-function codes (33, 34) whose own shape this reader cannot confirm without a real file carrying one — aborts the WHOLE formula rather than emitting a partially-decoded or guessed string. A formula this reader cannot state with confidence is exactly as informative reported through the diagnostic sink as read.ts already reports every other unresolved construct; a formula silently wrong in one token is worse than one visibly absent.
//
// https://github.com/OneWingedShark/WordPerfect/blob/master/doc/SDK_Help/FileFormats/WPFF_TableFormulas.htm

// Function Number Values for Code 12 ("group 1 functions"), the SDK's own table transcribed in full — data, not interpretation, the same status this package's character-set and JUSTIFICATION tables already have.
// The SDK's own group-1 function names in function-number order; the number each carries is its position in this list.
const GROUP1_FUNCTION_NAMES = [
  "MINUS",
  "ABS",
  "INT",
  "SIGN",
  "NOT",
  "TRUE",
  "FALSE",
  "AND",
  "OR",
  "AVE",
  "COUNT",
  "MIN",
  "MAX",
  "NA",
  "ISNA",
  "TIME",
  "DATE",
  "FACT",
  "ROW",
  "COLUMN",
] as const;
const GROUP1_FUNCTIONS: ReadonlyMap<number, string> = new Map(
  GROUP1_FUNCTION_NAMES.map((name, index) => [index + 1, name] as const),
);

// Function Number Values for Code 13 ("group 2 functions"), transcribed in full from the same table.
// The SDK's own group-2 function names in function-number order.
const GROUP2_FUNCTION_NAMES = [
  "POWER",
  "LN",
  "LOG",
  "SQRT",
  "PI",
  "EXP",
  "SIN",
  "COS",
  "TAN",
  "MOD",
  "ASIN",
  "ACOS",
  "ATAN",
  "TERM",
  "PV",
  "PMT",
  "FV",
  "NPV",
  "LOOKUP",
  "INDEX",
  "ROUND",
  "STDEV",
  "CONCEDE",
  "MID",
  "LENGTH",
  "VALUE",
  "TEXT",
  "MDY",
  "MONTH",
  "DAY",
  "YEAR",
  "DATETEXT",
  "DATEVALUE",
  "VAR",
  "RANDOM",
  "CURRENCY",
  "ITERATION",
  "ISVALUE",
  "ISTEXT",
  "REPLACE",
  "RADIANS",
  "CELL",
  "SUBTRACT",
  "IRR",
  "FIND",
  "LEFT",
  "RIGHT",
  "UPPER",
  "LOWER",
  "PROPER",
  "CHAR",
  "CODE",
  "TRIM",
  "REPEAT",
  "BLOCK",
  "CURSOR",
  "DDB",
  "SLN",
  "SYD",
  "RATE",
  "STATUS",
  "FOREACH",
  "DEGREES",
  "HOUR",
  "MINUTE",
  "SECOND",
  "HMS",
  "TIMETEXT",
  "TIMEVALUE",
  "PRODUCT",
  "QUOTIENT",
  "VARP",
  "STDEVP",
  "ATAN2",
  "MATCH",
  "MATCH2",
  "LOOKUP2",
  "LINK",
  "ISERR",
  "ISERR2",
  "CHOOSE",
] as const;
const GROUP2_FUNCTIONS: ReadonlyMap<number, string> = new Map(
  GROUP2_FUNCTION_NAMES.map((name, index) => [index + 1, name] as const),
);

// Code 21's own function#, the six comparison operators.
// The comparison operators in the code table's own numbering.
const COMPARE_OPERATOR_SYMBOLS = ["=", "<>", ">", ">=", "<", "<="] as const;
const COMPARE_OPERATORS: ReadonlyMap<number, string> = new Map(
  COMPARE_OPERATOR_SYMBOLS.map((symbol, index) => [index + 1, symbol] as const),
);

// Every fixed-symbol single-byte code: the opcode is the whole token, and its text never depends on anything else in the stream.
// The SDK's own fixed-symbol code numbers. The numbering is not contiguous: codes between these belong to constructs with payloads, dispatched below.
const CODE_PLUS = 1;
const CODE_MINUS = 2;
const CODE_TIMES = 3;
const CODE_SLASH = 4;
const CODE_MINUS_5 = 5;
const CODE_PERCENT = 6;
const CODE_SUM = 7;
const CODE_CARET = 11;
const CODE_PERCENT_15 = 15;
const CODE_NOT = 16;
const CODE_AMPERSAND = 17;
const CODE_BAR = 18;
const CODE_CARET_CARET = 19;
const CODE_IF = 20;
const CODE_COMMA = 22;
const CODE_LPAREN = 23;
const CODE_RPAREN = 24;
const CODE_NOT_EQUAL = 29;
const CODE_ZERO = 35;
const CODE_LBRACE = 36;
const CODE_RBRACE = 37;
const CODE_NOT_38 = 38;
const CODE_LT = 39;
const CODE_GT = 40;

const SYMBOL_CODES: ReadonlyMap<number, string> = new Map([
  [CODE_PLUS, "+"],
  [CODE_MINUS_5, "-"],
  [CODE_TIMES, "*"],
  [CODE_SLASH, "/"],
  [CODE_MINUS, "-"],
  [CODE_PERCENT_15, "%"],
  [CODE_SUM, "SUM"],
  [CODE_CARET, "^"],
  [CODE_PERCENT, "%"],
  [CODE_NOT_38, "!"],
  [CODE_AMPERSAND, "&"],
  [CODE_BAR, "|"],
  [CODE_CARET_CARET, "^^"],
  [CODE_IF, "IF"],
  [CODE_COMMA, ","],
  [CODE_LPAREN, "("],
  [CODE_RPAREN, ")"],
  [CODE_NOT_EQUAL, "!="],
  [CODE_ZERO, "0"],
  [CODE_LBRACE, "{"],
  [CODE_RBRACE, "}"],
  [CODE_NOT, "!"],
  [CODE_LT, "<"],
  [CODE_GT, ">"],
]);

// Column letters follow the same base-26 convention every spreadsheet-style cell reference uses (A, B, ..., Z, AA, ...) — a reasonable, defensible choice for rendering WordPerfect's own (row, column) pair as text, not a value the mirrored SDK pages state outright. Absolute references are marked with a leading "$" on the affected component, the same convention.
function columnLetters(column: number): string {
  let value = column;
  let letters = "";
  do {
    letters =
      String.fromCharCode(UPPERCASE_A_CHAR_CODE + (value % ALPHABET_LENGTH)) +
      letters;
    value = Math.floor(value / ALPHABET_LENGTH) - 1;
  } while (value >= 0);
  return letters;
}

function cellReferenceText(
  row: number,
  column: number,
  absoluteColumn: boolean,
  absoluteRow: boolean,
): string | undefined {
  if (row < 0 || column < 0) {
    return undefined;
  }
  const columnText = `${absoluteColumn ? "$" : ""}${columnLetters(column)}`;
  const rowText = `${absoluteRow ? "$" : ""}${row + 1}`;
  return `${columnText}${rowText}`;
}

interface FormulaCursor {
  readonly bytes: Uint8Array;
  offset: number;
}

// Reads a length-prefixed WP word string: a 16-bit character count, then that many WP-decoded characters. "All string lengths are 16-bit values. All strings are WP word strings, except code 30, which is a byte string."
function readLengthPrefixedWordString(
  cursor: FormulaCursor,
): string | undefined {
  if (cursor.offset + 2 > cursor.bytes.length) {
    return undefined;
  }
  const length = uint16At(cursor.bytes, cursor.offset);
  cursor.offset += 2;
  const { text, wordsRead } = decodeWordString(
    cursor.bytes,
    cursor.offset,
    length,
  );
  if (wordsRead < length) {
    return undefined;
  }
  cursor.offset += length * 2;
  return text;
}

// Code 30's own byte string: identical length convention, one byte per character instead of two. Its only caller (the floating point constant below) discards the decoded text and checks only whether this consumed the spelling successfully — the double it already read is the value it reports — so this validates and advances the cursor without building a string nothing reads. Throws (via sliceAt) rather than returning a sentinel when the length prefix or the spelling itself does not fit; the caller wraps the whole token in a try/catch.
function skipLengthPrefixedByteString(cursor: FormulaCursor): void {
  const length = uint16At(sliceAt(cursor.bytes, cursor.offset, 2), 0);
  cursor.offset += 2;
  sliceAt(cursor.bytes, cursor.offset, length);
  cursor.offset += length;
}

function readCellNumber(
  cursor: FormulaCursor,
): { row: number; column: number } | undefined {
  if (cursor.offset + CELL_NUMBER_BYTES > cursor.bytes.length) {
    return undefined;
  }
  const row = int16At(cursor.bytes, cursor.offset);
  const column = int16At(cursor.bytes, cursor.offset + 2);
  cursor.offset += 4;
  return { row, column };
}

function readToken(cursor: FormulaCursor): string | undefined {
  const code = cursor.bytes[cursor.offset];
  if (code === undefined) {
    return undefined;
  }
  cursor.offset += 1;

  const symbol = SYMBOL_CODES.get(code);
  if (symbol !== undefined) {
    return symbol;
  }

  switch (code) {
    case CODE_NUMBER_CONSTANT: // number constant
    case CODE_STRING_CONSTANT: // string constant
    case CODE_NAME_REFERENCE: // name reference
    case CODE_FORMULA_ERROR: {
      // formula error
      const text = readLengthPrefixedWordString(cursor);
      if (text === undefined) {
        return undefined;
      }
      return code === CODE_STRING_CONSTANT ? `"${text}"` : text;
    }
    case CODE_GROUP1_FUNCTION: {
      const functionNumber = cursor.bytes[cursor.offset];
      cursor.offset += 1;
      const name =
        functionNumber === undefined
          ? undefined
          : GROUP1_FUNCTIONS.get(functionNumber);
      return name;
    }
    case CODE_GROUP2_FUNCTION: {
      const functionNumber = cursor.bytes[cursor.offset];
      cursor.offset += 1;
      const name =
        functionNumber === undefined
          ? undefined
          : GROUP2_FUNCTIONS.get(functionNumber);
      return name;
    }
    case CODE_NEGATION: {
      const functionNumber = cursor.bytes[cursor.offset];
      cursor.offset += 1;
      return functionNumber === undefined
        ? undefined
        : COMPARE_OPERATORS.get(functionNumber);
    }
    case CODE_CELL_REFERENCE: {
      // space(s): [space#], a 16-bit count of literal spaces.
      if (cursor.offset + 2 > cursor.bytes.length) {
        return undefined;
      }
      const count = uint16At(cursor.bytes, cursor.offset);
      cursor.offset += 2;
      return " ".repeat(count);
    }
    case CODE_BLOCK_REFERENCE: {
      // cell reference (documented "not used", supported anyway for completeness): no absolute-reference flags of its own.
      const cell = readCellNumber(cursor);
      return cell === undefined
        ? undefined
        : cellReferenceText(cell.row, cell.column, false, false);
    }
    case CODE_GROUP_REFERENCE: {
      // range reference (documented "not used"): two plain cell references joined by ":". readCellNumber's own insufficient-bytes check returns before advancing cursor.offset, so always attempting the second read even when the first failed is safe — it reads from the identical position and fails identically.
      const start = readCellNumber(cursor);
      const end = readCellNumber(cursor);
      if (start === undefined || end === undefined) {
        return undefined;
      }
      const startText = cellReferenceText(
        start.row,
        start.column,
        false,
        false,
      );
      const endText = cellReferenceText(end.row, end.column, false, false);
      return startText === undefined || endText === undefined
        ? undefined
        : `${startText}:${endText}`;
    }
    case CODE_FLOAT_CONSTANT: {
      // floating point constant: an 8-byte double, then its own byte-string spelling. The double is authoritative; the string is the user's own typed spelling and is skipped past rather than re-decoded, since JavaScript's own number-to-string conversion already gives a faithful textual value.
      try {
        const doubleBytes = sliceAt(
          cursor.bytes,
          cursor.offset,
          DOUBLE_BYTE_LENGTH,
        );
        const view = new DataView(
          doubleBytes.buffer,
          doubleBytes.byteOffset,
          DOUBLE_BYTE_LENGTH,
        );
        const value = view.getFloat64(0, true);
        cursor.offset += DOUBLE_BYTE_LENGTH;
        skipLengthPrefixedByteString(cursor);
        return String(value);
      } catch {
        return undefined;
      }
    }
    case CODE_UNARY_PLUS: {
      // user argument reference: [argument number].
      if (cursor.offset + 2 > cursor.bytes.length) {
        return undefined;
      }
      const argumentNumber = uint16At(cursor.bytes, cursor.offset);
      cursor.offset += 2;
      return `ARG${argumentNumber}`;
    }
    case CODE_UNARY_MINUS: {
      // user function call: the function's own name, verbatim.
      return readLengthPrefixedWordString(cursor);
    }
    case CODE_ATTRIBUTE_ON:
    case CODE_ATTRIBUTE_OFF:
    case CODE_ATTRIBUTE_MASK: {
      // attribute on/off and the total attribute mask: formatting markers inside the formula's own displayed spelling, contributing no text to its computed meaning.
      cursor.offset += 2;
      return "";
    }
    case CODE_CONDITIONAL_ATTRIBUTE:
      // conditional attribute: no payload beyond the code itself.
      return "";
    default: {
      if (
        code >= RANGE_REFERENCE_CODE_FIRST &&
        code <= RANGE_REFERENCE_CODE_LAST
      ) {
        // range reference, absolute-flag bits per the SDK's own NOTE: bit0/1 on the bottom-right cell, bit2/3 on the top-left cell. Codes in this range share a fixed high nibble, so their own low 4 bits (code & 0x0f) are exactly code - 48 — a mask on the bits this flags value is ever actually read through, not an offsetting subtraction.
        const flags = code & RANGE_REFERENCE_FLAG_MASK;
        // readCellNumber's own insufficient-bytes check returns before advancing cursor.offset, so always attempting the second read even when the first failed is safe — it reads from the identical position and fails identically.
        const start = readCellNumber(cursor);
        const end = readCellNumber(cursor);
        if (start === undefined || end === undefined) {
          return undefined;
        }
        const startText = cellReferenceText(
          start.row,
          start.column,
          (flags & RANGE_FLAG_START_ROW_ABSOLUTE) !== 0,
          (flags & RANGE_FLAG_START_COLUMN_ABSOLUTE) !== 0,
        );
        const endText = cellReferenceText(
          end.row,
          end.column,
          (flags & RANGE_FLAG_END_ROW_ABSOLUTE) !== 0,
          (flags & RANGE_FLAG_END_COLUMN_ABSOLUTE) !== 0,
        );
        return startText === undefined || endText === undefined
          ? undefined
          : `${startText}:${endText}`;
      }
      if (
        code >= ABSOLUTE_REFERENCE_CODE_FIRST &&
        code <= ABSOLUTE_REFERENCE_CODE_LAST
      ) {
        // cell reference, absolute-flag bits per the same NOTE: bit0 column, bit1 row. Codes in this range share a fixed high bit pattern, so their own low 2 bits (code & 0x03) are exactly code - 64 — a mask on the bits this flags value is ever actually read through, not an offsetting subtraction.
        const flags = code & ABSOLUTE_REFERENCE_FLAG_MASK;
        const cell = readCellNumber(cursor);
        return cell === undefined
          ? undefined
          : cellReferenceText(
              cell.row,
              cell.column,
              (flags & 0x01) !== 0,
              (flags & 0x02) !== 0,
            );
      }
      // Every other code: the "+" shortcut (14, whose direction-flag enumeration the mirrored SDK pages never state), the two temp-function codes (33, 34, whose real shape this reader cannot confirm without a real file), code 45 (the SDK's own "* (assumed)" hedge), and anything the table above simply does not name. None of these get a guessed spelling.
      return undefined;
    }
  }
}

// Decodes a New Cell Formula embedded subfunction's own tokenised formula (stream/table.ts's CELL_FORMULA_SUBFUNCTION payload) into the formula's own linear text, exactly as WordPerfect's own token stream states it — concatenated left to right, since the stream already carries its own parentheses and commas rather than needing a tree rebuilt from postfix order. Returns undefined the moment any token cannot be stated with confidence, aborting the whole formula rather than returning a partially decoded or guessed string.
export function readTableFormula(bytes: Uint8Array): string | undefined {
  const cursor: FormulaCursor = { bytes, offset: 0 };
  let text = "";
  while (cursor.offset < bytes.length) {
    const token = readToken(cursor);
    if (token === undefined) {
      return undefined;
    }
    text += token;
  }
  return text;
}
