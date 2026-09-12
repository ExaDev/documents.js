import { describe, expect, it } from "vitest";

import { compileFormulaText } from "./ptg-writer";

// PTG opcode values mirrored from ptg-writer.ts's own private constants ([MS-XLS] 2.5.198's own token enumeration) -- the module exports only compileFormulaText itself, so this is the reference the byte-level assertions below check the writer's actual output against.
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
const PTG_REF_VALUE = 0x44;
const PTG_AREA_VALUE = 0x45;
const PTG_FUNC_VALUE = 0x41;
const PTG_FUNCVAR_VALUE = 0x42;

const COLUMN_RELATIVE_BIT = 0x4000;
const ROW_RELATIVE_BIT = 0x8000;

const PTG_INT_MAX = 0xffff;
const MAX_RGCE_LENGTH = 0xffff;

function u16le(value: number): readonly number[] {
  const bits = value & 0xffff;
  return [bits & 0xff, (bits >>> 8) & 0xff];
}

function f64le(value: number): readonly number[] {
  const buffer = new ArrayBuffer(8);
  new DataView(buffer).setFloat64(0, value, true);
  return Array.from(new Uint8Array(buffer));
}

function compiled(text: string): number[] {
  return Array.from(compileFormulaText(text));
}

describe("compileFormulaText", () => {
  describe("whitespace", () => {
    it("skips a leading space", () => {
      expect(compiled(" 1")).toStrictEqual(compiled("1"));
    });

    it("skips a leading tab", () => {
      expect(compiled("\t1")).toStrictEqual(compiled("1"));
    });

    it("skips a leading newline", () => {
      expect(compiled("\n1")).toStrictEqual(compiled("1"));
    });

    it("skips a leading carriage return", () => {
      expect(compiled("\r1")).toStrictEqual(compiled("1"));
    });

    it("skips whitespace of every kind between tokens", () => {
      expect(compiled(" 1 \t+\n2\r ")).toStrictEqual(compiled("1+2"));
    });
  });

  describe("integer literals", () => {
    it("compiles a plain integer as PtgInt", () => {
      expect(compiled("42")).toStrictEqual([PTG_INT, ...u16le(42)]);
    });

    it("compiles zero as PtgInt", () => {
      expect(compiled("0")).toStrictEqual([PTG_INT, ...u16le(0)]);
    });

    it("compiles PTG_INT_MAX itself as PtgInt", () => {
      expect(compiled(String(PTG_INT_MAX))).toStrictEqual([
        PTG_INT,
        ...u16le(PTG_INT_MAX),
      ]);
    });

    it("compiles one above PTG_INT_MAX as PtgNum, not PtgInt", () => {
      const value = PTG_INT_MAX + 1;
      expect(compiled(String(value))).toStrictEqual([PTG_NUM, ...f64le(value)]);
    });

    it("compiles a decimal literal as PtgNum even when its value is a whole number", () => {
      expect(compiled("4.0")).toStrictEqual([PTG_NUM, ...f64le(4)]);
    });

    it("compiles a fractional literal as PtgNum", () => {
      expect(compiled("3.14159")).toStrictEqual([PTG_NUM, ...f64le(3.14159)]);
    });

    it("compiles an exponent literal as PtgNum", () => {
      expect(compiled("1e3")).toStrictEqual([PTG_NUM, ...f64le(1000)]);
    });

    it("writes PtgNum's own float64 in little-endian byte order", () => {
      // 3.14159's IEEE 754 double is not byte-palindromic, so a big-endian writer would produce a different byte sequence than f64le's own little-endian reference encoding.
      expect(compiled("3.14159").slice(1)).toStrictEqual(f64le(3.14159));
    });
  });

  describe("string literals", () => {
    it("compiles a plain string as PtgStr", () => {
      expect(compiled('"hi"')).toStrictEqual([
        PTG_STR,
        2,
        0x00,
        "h".charCodeAt(0),
        "i".charCodeAt(0),
      ]);
    });

    it("compiles the empty string", () => {
      expect(compiled('""')).toStrictEqual([PTG_STR, 0, 0x00]);
    });

    it("un-escapes a doubled quote inside a string literal", () => {
      expect(compiled('"it""s"')).toStrictEqual([
        PTG_STR,
        4,
        0x00,
        ...'it"s'.split("").map((c) => c.charCodeAt(0)),
      ]);
    });

    it("refuses an unterminated string literal", () => {
      expect(() => compileFormulaText('"abc')).toThrow(
        /carries an unterminated string literal starting at offset 0/,
      );
    });

    it("refuses a string literal whose closing quote is doubled off the end", () => {
      expect(() => compileFormulaText('"abc""')).toThrow(
        /carries an unterminated string literal/,
      );
    });
  });

  describe("boolean literals", () => {
    it("compiles TRUE as PtgBool true", () => {
      expect(compiled("TRUE")).toStrictEqual([PTG_BOOL, 1]);
    });

    it("compiles FALSE as PtgBool false", () => {
      expect(compiled("FALSE")).toStrictEqual([PTG_BOOL, 0]);
    });
  });

  describe("error literals", () => {
    it("compiles a recognised error literal as PtgErr", () => {
      // #REF! is BIFF8's own 0x17 error code ([MS-XLS] 2.5.10).
      expect(compiled("#REF!")).toStrictEqual([PTG_ERR, 0x17]);
    });

    it("compiles every one of BIFF8's eight error literals to its own documented code", () => {
      const expected: readonly (readonly [string, number])[] = [
        ["#NULL!", 0x00],
        ["#DIV/0!", 0x07],
        ["#VALUE!", 0x0f],
        ["#REF!", 0x17],
        ["#NAME?", 0x1d],
        ["#NUM!", 0x24],
        ["#N/A", 0x2a],
        ["#GETTING_DATA", 0x2b],
      ];
      for (const [text, code] of expected) {
        expect(compiled(text)).toStrictEqual([PTG_ERR, code]);
      }
    });

    it("refuses an error literal outside the eight BIFF8 defines", () => {
      expect(() => compileFormulaText("#FOO!")).toThrow(
        /carries error literal #FOO!, which is not one of the eight error values/,
      );
    });

    it("refuses a # not followed by a recognised error-literal character", () => {
      expect(() => compileFormulaText("#")).toThrow(
        /carries an unrecognised error literal starting at offset 0/,
      );
    });
  });

  describe("unrecognised input", () => {
    it("refuses a character outside the formula grammar", () => {
      expect(() => compileFormulaText("1@2")).toThrow(
        /carries an unrecognised character "@" at offset 1/,
      );
    });

    it("refuses an empty formula, citing the eof token's own empty text", () => {
      expect(() => compileFormulaText("")).toThrow(
        'formula text "" carries an unexpected token ""',
      );
    });

    it("refuses a formula starting with an operator with no left operand", () => {
      expect(() => compileFormulaText("*3")).toThrow(
        /carries an unexpected token "\*"/,
      );
    });
  });

  describe("leftover tokens after a complete expression", () => {
    it("reports a leftover dollar sign", () => {
      expect(() => compileFormulaText("1$")).toThrow(
        /expected a eof but found "\$"/,
      );
    });

    it("reports a leftover colon", () => {
      expect(() => compileFormulaText("1:")).toThrow(
        /expected a eof but found ":"/,
      );
    });

    it("reports a leftover comma", () => {
      expect(() => compileFormulaText("1,")).toThrow(
        /expected a eof but found ","/,
      );
    });

    it("reports a leftover open parenthesis", () => {
      expect(() => compileFormulaText("1(")).toThrow(
        /expected a eof but found "\("/,
      );
    });

    it("reports a leftover close parenthesis", () => {
      expect(() => compileFormulaText("1)")).toThrow(
        /expected a eof but found "\)"/,
      );
    });
  });

  describe("cell references", () => {
    it("compiles a fully relative reference", () => {
      expect(compiled("A1")).toStrictEqual([
        PTG_REF_VALUE,
        ...u16le(0),
        ...u16le(0 | COLUMN_RELATIVE_BIT | ROW_RELATIVE_BIT),
      ]);
    });

    it("compiles a fully absolute reference", () => {
      expect(compiled("$A$1")).toStrictEqual([
        PTG_REF_VALUE,
        ...u16le(0),
        ...u16le(0),
      ]);
    });

    it("compiles a column-absolute, row-relative reference", () => {
      expect(compiled("$A1")).toStrictEqual([
        PTG_REF_VALUE,
        ...u16le(0),
        ...u16le(0 | ROW_RELATIVE_BIT),
      ]);
    });

    it("compiles a column-relative, row-absolute reference", () => {
      expect(compiled("A$1")).toStrictEqual([
        PTG_REF_VALUE,
        ...u16le(0),
        ...u16le(0 | COLUMN_RELATIVE_BIT),
      ]);
    });

    it("resolves a multi-letter column and multi-digit row", () => {
      // BC77: column "BC" is 0-indexed 54 ((1*26)+2), row 77 is 0-indexed 76.
      expect(compiled("BC77")).toStrictEqual([
        PTG_REF_VALUE,
        ...u16le(76),
        ...u16le(54 | COLUMN_RELATIVE_BIT | ROW_RELATIVE_BIT),
      ]);
    });

    it("compiles a relative area (range)", () => {
      expect(compiled("A1:B2")).toStrictEqual([
        PTG_AREA_VALUE,
        ...u16le(0),
        ...u16le(1),
        ...u16le(0 | COLUMN_RELATIVE_BIT | ROW_RELATIVE_BIT),
        ...u16le(1 | COLUMN_RELATIVE_BIT | ROW_RELATIVE_BIT),
      ]);
    });

    it("compiles an area whose two corners carry independent absolute/relative flags", () => {
      expect(compiled("$A$1:B2")).toStrictEqual([
        PTG_AREA_VALUE,
        ...u16le(0),
        ...u16le(1),
        ...u16le(0),
        ...u16le(1 | COLUMN_RELATIVE_BIT | ROW_RELATIVE_BIT),
      ]);
    });

    it("accepts column IV (0-indexed 255), BIFF8's own last column", () => {
      expect(() => compileFormulaText("IV1")).not.toThrow();
    });

    it("refuses column IW (0-indexed 256), one past BIFF8's own grid", () => {
      expect(() => compileFormulaText("IW1")).toThrow(
        /outside BIFF8's own grid/,
      );
    });

    it("accepts row 65536 (0-indexed 65535), BIFF8's own last row", () => {
      expect(() => compileFormulaText("A65536")).not.toThrow();
    });

    it("refuses row 65537 (0-indexed 65536), one past BIFF8's own grid", () => {
      expect(() => compileFormulaText("A65537")).toThrow(
        /outside BIFF8's own grid/,
      );
    });

    it("refuses row 0 (0-indexed -1), one below BIFF8's own grid", () => {
      expect(() => compileFormulaText("A0")).toThrow(
        /outside BIFF8's own grid/,
      );
    });

    it("states the grid's own row ceiling as MAX_ROW_INDEX + 1 in its error message", () => {
      expect(() => compileFormulaText("A65537")).toThrow(
        /rows 1-65536, columns A-IV/,
      );
    });

    it("refuses a word with more letters than a valid column can carry", () => {
      expect(() => compileFormulaText("ABCD1")).toThrow(
        /carries "ABCD1", which is not a valid cell reference/,
      );
    });

    it("refuses a decimal row number", () => {
      expect(() => compileFormulaText("A$1.5")).toThrow(
        /carries "A1\.5", which is not a valid cell reference/,
      );
    });

    it("refuses a dollar sign not followed by a word", () => {
      expect(() => compileFormulaText("$1")).toThrow(
        /expected a word but found "1"/,
      );
    });
  });

  describe("operators", () => {
    it.each([
      ["<", PTG_LT],
      ["<=", PTG_LE],
      ["=", PTG_EQ],
      [">=", PTG_GE],
      [">", PTG_GT],
      ["<>", PTG_NE],
    ] as const)("compiles the %s comparison operator", (op, opcode) => {
      expect(compiled(`1${op}2`)).toStrictEqual([
        PTG_INT,
        ...u16le(1),
        PTG_INT,
        ...u16le(2),
        opcode,
      ]);
    });

    it("compiles string concatenation", () => {
      expect(compiled("1&2")).toStrictEqual([
        PTG_INT,
        ...u16le(1),
        PTG_INT,
        ...u16le(2),
        PTG_CONCAT,
      ]);
    });

    it.each([
      ["+", PTG_ADD],
      ["-", PTG_SUB],
    ] as const)("compiles the binary %s operator", (op, opcode) => {
      expect(compiled(`1${op}2`)).toStrictEqual([
        PTG_INT,
        ...u16le(1),
        PTG_INT,
        ...u16le(2),
        opcode,
      ]);
    });

    it.each([
      ["*", PTG_MUL],
      ["/", PTG_DIV],
    ] as const)("compiles the %s operator", (op, opcode) => {
      expect(compiled(`1${op}2`)).toStrictEqual([
        PTG_INT,
        ...u16le(1),
        PTG_INT,
        ...u16le(2),
        opcode,
      ]);
    });

    it("compiles exponentiation", () => {
      expect(compiled("1^2")).toStrictEqual([
        PTG_INT,
        ...u16le(1),
        PTG_INT,
        ...u16le(2),
        PTG_POWER,
      ]);
    });

    it("compiles a trailing percent operator", () => {
      expect(compiled("1%")).toStrictEqual([PTG_INT, ...u16le(1), PTG_PERCENT]);
    });

    it.each([
      ["+", PTG_UPLUS],
      ["-", PTG_UMINUS],
    ] as const)("compiles a unary %s operator", (op, opcode) => {
      expect(compiled(`${op}1`)).toStrictEqual([PTG_INT, ...u16le(1), opcode]);
    });

    it("compiles explicit parentheses", () => {
      expect(compiled("(1+2)")).toStrictEqual([
        PTG_INT,
        ...u16le(1),
        PTG_INT,
        ...u16le(2),
        PTG_ADD,
        PTG_PAREN,
      ]);
    });
  });

  describe("precedence", () => {
    it("binds unary minus tighter than exponentiation", () => {
      expect(compiled("-1^2")).toStrictEqual([
        PTG_INT,
        ...u16le(1),
        PTG_UMINUS,
        PTG_INT,
        ...u16le(2),
        PTG_POWER,
      ]);
    });

    it("binds additive operators tighter than concatenation", () => {
      expect(compiled("1&2+3")).toStrictEqual([
        PTG_INT,
        ...u16le(1),
        PTG_INT,
        ...u16le(2),
        PTG_INT,
        ...u16le(3),
        PTG_ADD,
        PTG_CONCAT,
      ]);
    });

    it("binds multiplicative operators tighter than additive", () => {
      expect(compiled("1+2*3")).toStrictEqual([
        PTG_INT,
        ...u16le(1),
        PTG_INT,
        ...u16le(2),
        PTG_INT,
        ...u16le(3),
        PTG_MUL,
        PTG_ADD,
      ]);
    });

    it("binds exponentiation tighter than multiplication", () => {
      expect(compiled("2*3^2")).toStrictEqual([
        PTG_INT,
        ...u16le(2),
        PTG_INT,
        ...u16le(3),
        PTG_INT,
        ...u16le(2),
        PTG_POWER,
        PTG_MUL,
      ]);
    });

    it("binds percent tighter than exponentiation", () => {
      expect(compiled("2^3%")).toStrictEqual([
        PTG_INT,
        ...u16le(2),
        PTG_INT,
        ...u16le(3),
        PTG_PERCENT,
        PTG_POWER,
      ]);
    });

    it("binds comparison operators looser than every arithmetic operator", () => {
      expect(compiled("1+2<3*4")).toStrictEqual([
        PTG_INT,
        ...u16le(1),
        PTG_INT,
        ...u16le(2),
        PTG_ADD,
        PTG_INT,
        ...u16le(3),
        PTG_INT,
        ...u16le(4),
        PTG_MUL,
        PTG_LT,
      ]);
    });
  });

  describe("function calls", () => {
    it("compiles a fixed-arity call as PtgFunc", () => {
      // ABS is [MS-XLS] 2.5.198.17's own Ftab entry 0x0018, fixed arity 1.
      expect(compiled("ABS(1)")).toStrictEqual([
        PTG_INT,
        ...u16le(1),
        PTG_FUNC_VALUE,
        ...u16le(0x0018),
      ]);
    });

    it("compiles a zero-argument fixed-arity call", () => {
      // PI is Ftab entry 0x0013, fixed arity 0.
      expect(compiled("PI()")).toStrictEqual([
        PTG_FUNC_VALUE,
        ...u16le(0x0013),
      ]);
    });

    it("compiles a variable-arity call with no arguments as PtgFuncVar", () => {
      // SUM is Ftab entry 0x0004, variable arity.
      expect(compiled("SUM()")).toStrictEqual([
        PTG_FUNCVAR_VALUE,
        0,
        ...u16le(0x0004),
      ]);
    });

    it("compiles a variable-arity call with several arguments", () => {
      expect(compiled("SUM(1,2,3)")).toStrictEqual([
        PTG_INT,
        ...u16le(1),
        PTG_INT,
        ...u16le(2),
        PTG_INT,
        ...u16le(3),
        PTG_FUNCVAR_VALUE,
        3,
        ...u16le(0x0004),
      ]);
    });

    it("compiles an omitted middle argument as PtgMissArg", () => {
      expect(compiled("IF(1,,3)")).toStrictEqual([
        PTG_INT,
        ...u16le(1),
        PTG_MISSARG,
        PTG_INT,
        ...u16le(3),
        // IF is Ftab entry 0x0001, variable arity.
        PTG_FUNCVAR_VALUE,
        3,
        ...u16le(0x0001),
      ]);
    });

    it("compiles an omitted leading argument as PtgMissArg", () => {
      expect(compiled("IF(,1,2)")).toStrictEqual([
        PTG_MISSARG,
        PTG_INT,
        ...u16le(1),
        PTG_INT,
        ...u16le(2),
        PTG_FUNCVAR_VALUE,
        3,
        ...u16le(0x0001),
      ]);
    });

    it("compiles an omitted trailing argument as PtgMissArg", () => {
      expect(compiled("IF(1,2,)")).toStrictEqual([
        PTG_INT,
        ...u16le(1),
        PTG_INT,
        ...u16le(2),
        PTG_MISSARG,
        PTG_FUNCVAR_VALUE,
        3,
        ...u16le(0x0001),
      ]);
    });

    it("refuses a call to a function outside Ftab's own vocabulary", () => {
      expect(() => compileFormulaText("NOTAREALFUNCTION(1)")).toThrow(
        /calls NOTAREALFUNCTION\(\), which is not one of the built-in functions/,
      );
    });

    it("refuses a fixed-arity call given the wrong number of arguments", () => {
      expect(() => compileFormulaText("ABS(1,2)")).toThrow(
        /calls ABS\(\) with 2 argument\(s\), but \[MS-XLS\]'s own Ftab grammar fixes its arity at 1/,
      );
    });

    it("accepts a variable-arity call with exactly 255 arguments", () => {
      const formula = `SUM(${Array.from({ length: 255 }, () => "1").join(",")})`;
      expect(() => compileFormulaText(formula)).not.toThrow();
    });

    it("refuses a variable-arity call with 256 arguments, one past PtgFuncVar's own single-byte cparams", () => {
      const formula = `SUM(${Array.from({ length: 256 }, () => "1").join(",")})`;
      expect(() => compileFormulaText(formula)).toThrow(
        /a function call with 256 arguments cannot be written.*cannot exceed 255/,
      );
    });
  });

  describe("nested function calls", () => {
    it("compiles a function call nested inside another as an argument", () => {
      expect(compiled('IF(1=1,"yes","no")')).toStrictEqual([
        PTG_INT,
        ...u16le(1),
        PTG_INT,
        ...u16le(1),
        PTG_EQ,
        PTG_STR,
        3,
        0x00,
        ..."yes".split("").map((c) => c.charCodeAt(0)),
        PTG_STR,
        2,
        0x00,
        ..."no".split("").map((c) => c.charCodeAt(0)),
        PTG_FUNCVAR_VALUE,
        3,
        ...u16le(0x0001),
      ]);
    });
  });

  describe("rgce length ceiling", () => {
    // Every additional "+1" term after the first costs 4 bytes (a 3-byte PtgInt operand plus a 1-byte PtgAdd), and the first term alone costs 3 bytes -- so a chain of 16384 terms compiles to exactly 3 + 4*(16384-1) = 65535 bytes, MAX_RGCE_LENGTH itself, and 16385 terms compiles to 65539, four bytes over it.
    const TERMS_AT_CEILING = 16384;

    function chainOf(termCount: number): string {
      return Array.from({ length: termCount }, () => "1").join("+");
    }

    it("accepts a formula compiling to exactly MAX_RGCE_LENGTH bytes", () => {
      const formula = chainOf(TERMS_AT_CEILING);
      let rgce: Uint8Array<ArrayBuffer> | undefined;
      expect(() => {
        rgce = compileFormulaText(formula);
      }).not.toThrow();
      expect(rgce?.length).toBe(MAX_RGCE_LENGTH);
    });

    it("refuses a formula compiling to one term more than the ceiling allows", () => {
      const formula = chainOf(TERMS_AT_CEILING + 1);
      expect(() => compileFormulaText(formula)).toThrow(
        /compiles to 65539 bytes of rgce, above the 65535-byte ceiling/,
      );
    });
  });
});
