import { int16At, uint16At } from "../bytes/view";
import { decodeWordString } from "./characters";

// -- Table formulas, per WPFF Table Formula Functions --
//
// "Table formula codes and their operation are shown below. These codes are used by New Cell Formula (function 0xD0 subfunction 0x81)." The tokenised formula this module decodes is `stream/table.ts`'s own CELL_FORMULA_SUBFUNCTION payload -- already isolated from its own six-byte length framing by readEmbeddedSubfunctions, so what reaches readTableFormula here is exactly the SDK's own "<tokenized formula> x length of formula" region and nothing else.
//
// A WORD ABOUT WHY THIS IS A LINEAR WALK, NOT AN RPN STACK MACHINE: the code table includes "," comma (22), "(" (23), and ")" (24) as formula codes in their own right, which a genuine postfix/RPN encoding would never need -- precedence and grouping are exactly what parenthesised infix notation states explicitly and RPN encodes structurally, through operand order alone. Their presence means WordPerfect's own tokenised formula is a straight linearisation of the formula AS TYPED, one token per operator, operand, paren, or comma, in source order -- so decoding it is a left-to-right substitution (each code's own text, concatenated) rather than a stack evaluation. That is also why this reader never needs an arity table for any operator or function: arity only matters to a stack machine building a tree, and nothing here builds one.
//
// THE HONEST-OR-NOTHING CONTRACT: every code this module does not have a confirmed, unambiguous textual spelling for -- the SDK's own "* (assumed)" hedge on code 45, the "+" shortcut (14) whose direction-flag enumeration the mirrored SDK pages never state, the two temp-function codes (33, 34) whose own shape this reader cannot confirm without a real file carrying one -- aborts the WHOLE formula rather than emitting a partially-decoded or guessed string. A formula this reader cannot state with confidence is exactly as informative reported through the diagnostic sink as read.ts already reports every other unresolved construct; a formula silently wrong in one token is worse than one visibly absent.
//
// https://github.com/OneWingedShark/WordPerfect/blob/master/doc/SDK_Help/FileFormats/WPFF_TableFormulas.htm

// Function Number Values for Code 12 ("group 1 functions"), the SDK's own table transcribed in full -- data, not interpretation, the same status this package's character-set and JUSTIFICATION tables already have.
const GROUP1_FUNCTIONS: ReadonlyMap<number, string> = new Map([
  [1, "MINUS"],
  [2, "ABS"],
  [3, "INT"],
  [4, "SIGN"],
  [5, "NOT"],
  [6, "TRUE"],
  [7, "FALSE"],
  [8, "AND"],
  [9, "OR"],
  [10, "AVE"],
  [11, "COUNT"],
  [12, "MIN"],
  [13, "MAX"],
  [14, "NA"],
  [15, "ISNA"],
  [16, "TIME"],
  [17, "DATE"],
  [18, "FACT"],
  [19, "ROW"],
  [20, "COLUMN"],
]);

// Function Number Values for Code 13 ("group 2 functions"), transcribed in full from the same table.
const GROUP2_FUNCTIONS: ReadonlyMap<number, string> = new Map([
  [1, "POWER"],
  [2, "LN"],
  [3, "LOG"],
  [4, "SQRT"],
  [5, "PI"],
  [6, "EXP"],
  [7, "SIN"],
  [8, "COS"],
  [9, "TAN"],
  [10, "MOD"],
  [11, "ASIN"],
  [12, "ACOS"],
  [13, "ATAN"],
  [14, "TERM"],
  [15, "PV"],
  [16, "PMT"],
  [17, "FV"],
  [18, "NPV"],
  [19, "LOOKUP"],
  [20, "INDEX"],
  [21, "ROUND"],
  [22, "STDEV"],
  [23, "CONCEDE"],
  [24, "MID"],
  [25, "LENGTH"],
  [26, "VALUE"],
  [27, "TEXT"],
  [28, "MDY"],
  [29, "MONTH"],
  [30, "DAY"],
  [31, "YEAR"],
  [32, "DATETEXT"],
  [33, "DATEVALUE"],
  [34, "VAR"],
  [35, "RANDOM"],
  [36, "CURRENCY"],
  [37, "ITERATION"],
  [38, "ISVALUE"],
  [39, "ISTEXT"],
  [40, "REPLACE"],
  [41, "RADIANS"],
  [42, "CELL"],
  [43, "SUBTRACT"],
  [44, "IRR"],
  [45, "FIND"],
  [46, "LEFT"],
  [47, "RIGHT"],
  [48, "UPPER"],
  [49, "LOWER"],
  [50, "PROPER"],
  [51, "CHAR"],
  [52, "CODE"],
  [53, "TRIM"],
  [54, "REPEAT"],
  [55, "BLOCK"],
  [56, "CURSOR"],
  [57, "DDB"],
  [58, "SLN"],
  [59, "SYD"],
  [60, "RATE"],
  [61, "STATUS"],
  [62, "FOREACH"],
  [63, "DEGREES"],
  [64, "HOUR"],
  [65, "MINUTE"],
  [66, "SECOND"],
  [67, "HMS"],
  [68, "TIMETEXT"],
  [69, "TIMEVALUE"],
  [70, "PRODUCT"],
  [71, "QUOTIENT"],
  [72, "VARP"],
  [73, "STDEVP"],
  [74, "ATAN2"],
  [75, "MATCH"],
  [76, "MATCH2"],
  [77, "LOOKUP2"],
  [78, "LINK"],
  [79, "ISERR"],
  [80, "ISERR2"],
  [81, "CHOOSE"],
]);

// Code 21's own function#, the six comparison operators.
const COMPARE_OPERATORS: ReadonlyMap<number, string> = new Map([
  [1, "="],
  [2, "<>"],
  [3, ">"],
  [4, ">="],
  [5, "<"],
  [6, "<="],
]);

// Every fixed-symbol single-byte code: the opcode is the whole token, and its text never depends on anything else in the stream.
const SYMBOL_CODES: ReadonlyMap<number, string> = new Map([
  [1, "+"],
  [2, "-"],
  [3, "*"],
  [4, "/"],
  [5, "-"],
  [6, "%"],
  [7, "SUM"],
  [11, "^"],
  [15, "%"],
  [16, "!"],
  [17, "&"],
  [18, "|"],
  [19, "^^"],
  [20, "IF"],
  [22, ","],
  [23, "("],
  [24, ")"],
  [29, "!="],
  [35, "0"],
  [36, "{"],
  [37, "}"],
  [38, "!"],
  [39, "<"],
  [40, ">"],
]);

// Column letters follow the same base-26 convention every spreadsheet-style cell reference uses (A, B, ..., Z, AA, ...) -- a reasonable, defensible choice for rendering WordPerfect's own (row, column) pair as text, not a value the mirrored SDK pages state outright. Absolute references are marked with a leading "$" on the affected component, the same convention.
function columnLetters(column: number): string {
  let value = column;
  let letters = "";
  do {
    letters = String.fromCharCode(65 + (value % 26)) + letters;
    value = Math.floor(value / 26) - 1;
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

// Code 30's own byte string: identical length convention, one byte per character instead of two.
function readLengthPrefixedByteString(
  cursor: FormulaCursor,
): string | undefined {
  if (cursor.offset + 2 > cursor.bytes.length) {
    return undefined;
  }
  const length = uint16At(cursor.bytes, cursor.offset);
  cursor.offset += 2;
  if (cursor.offset + length > cursor.bytes.length) {
    return undefined;
  }
  const slice = cursor.bytes.subarray(cursor.offset, cursor.offset + length);
  cursor.offset += length;
  // Stryker disable next-line ArrowFunction,StringLiteral: this function's only caller (code 30's floating point constant) discards the decoded string itself and checks only whether it is defined -- the double it read is what the caller reports, this spelling is skipped past. Both mutations here still produce a real, defined string of the same length, never undefined, so the one thing the caller observes is unaffected regardless of what text this actually builds.
  return Array.from(slice, (byte) => String.fromCharCode(byte)).join("");
}

function readCellNumber(
  cursor: FormulaCursor,
): { row: number; column: number } | undefined {
  if (cursor.offset + 4 > cursor.bytes.length) {
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
    case 8: // number constant
    case 9: // string constant
    case 10: // name reference
    case 26: {
      // formula error
      const text = readLengthPrefixedWordString(cursor);
      if (text === undefined) {
        return undefined;
      }
      return code === 9 ? `"${text}"` : text;
    }
    case 12: {
      const functionNumber = cursor.bytes[cursor.offset];
      cursor.offset += 1;
      const name =
        functionNumber === undefined
          ? undefined
          : GROUP1_FUNCTIONS.get(functionNumber);
      return name;
    }
    case 13: {
      const functionNumber = cursor.bytes[cursor.offset];
      cursor.offset += 1;
      const name =
        functionNumber === undefined
          ? undefined
          : GROUP2_FUNCTIONS.get(functionNumber);
      return name;
    }
    case 21: {
      const functionNumber = cursor.bytes[cursor.offset];
      cursor.offset += 1;
      return functionNumber === undefined
        ? undefined
        : COMPARE_OPERATORS.get(functionNumber);
    }
    case 25: {
      // space(s): [space#], a 16-bit count of literal spaces.
      if (cursor.offset + 2 > cursor.bytes.length) {
        return undefined;
      }
      const count = uint16At(cursor.bytes, cursor.offset);
      cursor.offset += 2;
      return " ".repeat(count);
    }
    case 27: {
      // cell reference (documented "not used", supported anyway for completeness): no absolute-reference flags of its own.
      const cell = readCellNumber(cursor);
      return cell === undefined
        ? undefined
        : cellReferenceText(cell.row, cell.column, false, false);
    }
    case 28: {
      // range reference (documented "not used"): two plain cell references joined by ":".
      const start = readCellNumber(cursor);
      const end = start === undefined ? undefined : readCellNumber(cursor);
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
    case 30: {
      // floating point constant: an 8-byte double, then its own byte-string spelling. The double is authoritative; the string is the user's own typed spelling and is skipped past rather than re-decoded, since JavaScript's own number-to-string conversion already gives a faithful textual value.
      if (cursor.offset + 8 > cursor.bytes.length) {
        return undefined;
      }
      const view = new DataView(
        cursor.bytes.buffer,
        cursor.bytes.byteOffset + cursor.offset,
        8,
      );
      const value = view.getFloat64(0, true);
      cursor.offset += 8;
      const spelling = readLengthPrefixedByteString(cursor);
      return spelling === undefined ? undefined : String(value);
    }
    case 31: {
      // user argument reference: [argument number].
      if (cursor.offset + 2 > cursor.bytes.length) {
        return undefined;
      }
      const argumentNumber = uint16At(cursor.bytes, cursor.offset);
      cursor.offset += 2;
      return `ARG${argumentNumber}`;
    }
    case 32: {
      // user function call: the function's own name, verbatim.
      return readLengthPrefixedWordString(cursor);
    }
    case 41:
    case 42: {
      // attribute on/off: a formatting marker inside the formula's own displayed spelling, contributing no text to its computed meaning.
      cursor.offset += 2;
      return "";
    }
    case 43: {
      // total attribute mask.
      cursor.offset += 2;
      return "";
    }
    case 44:
      // conditional attribute: no payload beyond the code itself.
      return "";
    default: {
      if (code >= 48 && code <= 63) {
        // range reference, absolute-flag bits per the SDK's own NOTE: bit0/1 on the bottom-right cell, bit2/3 on the top-left cell.
        const flags = code - 48;
        const start = readCellNumber(cursor);
        const end = start === undefined ? undefined : readCellNumber(cursor);
        if (start === undefined || end === undefined) {
          return undefined;
        }
        const startText = cellReferenceText(
          start.row,
          start.column,
          (flags & 0x04) !== 0,
          (flags & 0x08) !== 0,
        );
        const endText = cellReferenceText(
          end.row,
          end.column,
          (flags & 0x01) !== 0,
          (flags & 0x02) !== 0,
        );
        return startText === undefined || endText === undefined
          ? undefined
          : `${startText}:${endText}`;
      }
      if (code >= 64 && code <= 67) {
        // cell reference, absolute-flag bits per the same NOTE: bit0 column, bit1 row.
        const flags = code - 64;
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

// Decodes a New Cell Formula embedded subfunction's own tokenised formula (stream/table.ts's CELL_FORMULA_SUBFUNCTION payload) into the formula's own linear text, exactly as WordPerfect's own token stream states it -- concatenated left to right, since the stream already carries its own parentheses and commas rather than needing a tree rebuilt from postfix order. Returns undefined the moment any token cannot be stated with confidence, aborting the whole formula rather than returning a partially decoded or guessed string.
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
