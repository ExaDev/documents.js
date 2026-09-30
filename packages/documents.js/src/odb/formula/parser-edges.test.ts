import { describe, expect, it } from "vitest";
import { parseRptFormula } from "./parser";

// The scanner and refusal edges: which characters a name admits (underscore and digits stay in a function name, so the refusal names the whole spelling), whitespace tolerance at both ends of a formula, number scanning through a sign and a fraction, and every refusal message naming what it expected and what it found, including the end of the formula as a finding.

describe("parseRptFormula: names and whitespace", () => {
  it("underscore and digits stay inside a name, so the refusal names the whole spelling", () => {
    expect(() => parseRptFormula("rpt:SU2M([V])")).toThrow("SU2M");
  });

  it("whitespace around a whole formula is tolerated, at both ends", () => {
    expect(parseRptFormula("  field:[V]  ")).toEqual({
      kind: "field",
      reference: { name: "V", spelling: "bracket" },
      text: "  field:[V]  ",
    });
    expect(parseRptFormula("  rpt:SUM([V]) ").kind).toBe("aggregate");
  });
});

describe("parseRptFormula: number scanning", () => {
  it("a negative and a fractional count are scanned as numbers, then refused as counts", () => {
    expect(() => parseRptFormula("rpt:LEFT([A];-2)")).toThrow(
      "non-negative whole number of characters, but was -2",
    );
    expect(() => parseRptFormula("rpt:LEFT([A];1.5)")).toThrow(
      "non-negative whole number of characters, but was 1.5",
    );
  });

  it("a bare sign or dot is not a number", () => {
    expect(() => parseRptFormula("rpt:LEFT([A];-)")).toThrow(
      "expected a number",
    );
    expect(() => parseRptFormula("rpt:LEFT([A];.)")).toThrow(
      "expected a number",
    );
  });
});

describe("parseRptFormula: refusals name what they expected and found", () => {
  it("a missing function name", () => {
    expect(() => parseRptFormula("rpt:([V])")).toThrow(
      "expected an rpt: function name",
    );
  });

  it("the opening parenthesis", () => {
    expect(() => parseRptFormula("rpt:SUM[A])")).toThrow(
      "the opening parenthesis of a function",
    );
  });

  it("the end of the formula when that is what was found instead", () => {
    expect(() => parseRptFormula("rpt:LEFT([A];2")).toThrow(
      "found the end of the formula",
    );
  });

  it("the offending character when one is present", () => {
    expect(() => parseRptFormula("rpt:LEFT([A];2x")).toThrow('found "x"');
  });

  it("an unterminated bracket reference", () => {
    expect(() => parseRptFormula("field:[V")).toThrow('no closing "]"');
  });

  it("an unterminated quoted reference", () => {
    expect(() => parseRptFormula('rpt:SUM("ABC')).toThrow(
      "no closing double quote",
    );
  });

  it("trailing text after either shape", () => {
    expect(() => parseRptFormula("field:[V] x")).toThrow(
      "unexpected trailing text after a field: reference",
    );
    expect(() => parseRptFormula("rpt:SUM([V]) y")).toThrow(
      "unexpected trailing text after a function call",
    );
  });

  it("a formula beginning with neither prefix", () => {
    expect(() => parseRptFormula("SUM([V])")).toThrow(
      'expected a formula beginning "field:" or "rpt:"',
    );
  });

  it("a second argument that is not a number of characters", () => {
    expect(() => parseRptFormula("rpt:LEFT([A];[B])")).toThrow(
      "must be a number of characters",
    );
  });

  it("a missing argument after a separator names what it expected", () => {
    expect(() => parseRptFormula("rpt:LEFT([A];2;)")).toThrow(
      "expected a number",
    );
  });
});
