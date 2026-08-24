import { describe, expect, it } from "vitest";
import { inferCellValue } from "./cell-typing";

function retyped(text: string): { kind: string; [key: string]: unknown } {
  const result = inferCellValue(text);
  if (result?.outcome !== "retyped") {
    throw new Error(
      `expected ${text} to be re-typed, got ${JSON.stringify(result)}`,
    );
  }
  return result.value;
}

function declineReason(text: string): string {
  const result = inferCellValue(text);
  if (result?.outcome !== "declined") {
    throw new Error(
      `expected ${text} to be declined, got ${JSON.stringify(result)}`,
    );
  }
  return result.reason;
}

describe("inferCellValue: numbers", () => {
  it("re-types plain integers and decimals, signed or not", () => {
    expect(retyped("42")).toEqual({ kind: "number", value: 42 });
    expect(retyped("42.5")).toEqual({ kind: "number", value: 42.5 });
    expect(retyped("-17")).toEqual({ kind: "number", value: -17 });
    expect(retyped("+3.25")).toEqual({ kind: "number", value: 3.25 });
    expect(retyped("0")).toEqual({ kind: "number", value: 0 });
    expect(retyped("0.5")).toEqual({ kind: "number", value: 0.5 });
  });

  it("keeps trailing-zero formatting out of the value, since displayText already carries the printed form", () => {
    expect(retyped("42.50")).toEqual({ kind: "number", value: 42.5 });
  });

  // A grouped number is only accepted where the European decimal-comma reading is structurally impossible: two or more groups, or a group alongside a real decimal point.
  it("re-types a grouped number whose grouping cannot be read as a decimal comma", () => {
    expect(retyped("1,234,567")).toEqual({ kind: "number", value: 1234567 });
    expect(retyped("1,234.50")).toEqual({ kind: "number", value: 1234.5 });
    expect(retyped("-12,345.75")).toEqual({ kind: "number", value: -12345.75 });
  });

  it("declines a lone comma group, which reads as 1234 under one convention and 1.234 under another", () => {
    expect(declineReason("1,234")).toBe("ambiguous-grouping-separator");
  });

  it("declines leading-zero digits, the signature of an identifier rather than a quantity", () => {
    expect(declineReason("007")).toBe("leading-zero-digits");
    expect(declineReason("00123")).toBe("leading-zero-digits");
    expect(declineReason("01.5")).toBe("leading-zero-digits");
  });

  // The precision gate is a real round trip, not a digit-count limit: this integer is 19 digits and Number() silently rounds it, so re-typing would report a value the source never held.
  it("declines a decimal that a JS number cannot hold exactly", () => {
    expect(declineReason("1234567890123456789")).toBe("precision-loss");
    expect(declineReason("0.12345678901234567890123")).toBe("precision-loss");
  });

  it("leaves genuinely non-numeric text alone with no diagnostic at all", () => {
    expect(inferCellValue("Acme Ltd")).toBeUndefined();
    expect(inferCellValue("12A")).toBeUndefined();
    expect(inferCellValue("#DIV/0!")).toBeUndefined();
    expect(inferCellValue("")).toBeUndefined();
  });
});

describe("inferCellValue: percentages and currency", () => {
  // ODF stores a percentage as the fraction (office:value="0.15" renders "15%"), which is the convention src/edit/ods/cell.ts writes back out.
  it("re-types a percentage into the fraction ODF stores, not the printed magnitude", () => {
    expect(retyped("15%")).toEqual({ kind: "percentage", value: 0.15 });
    expect(retyped("-2.5%")).toEqual({ kind: "percentage", value: -0.025 });
  });

  it("names the currency only where the symbol identifies exactly one", () => {
    expect(retyped("£1,234.50")).toEqual({
      kind: "currency",
      value: 1234.5,
      currency: "GBP",
    });
    expect(retyped("€99.99")).toEqual({
      kind: "currency",
      value: 99.99,
      currency: "EUR",
    });
    expect(retyped("$42")).toEqual({
      kind: "currency",
      value: 42,
      currency: undefined,
    }); // '$' is USD, CAD, AUD and more -- the KIND is certain, the code is not
    expect(retyped("¥500")).toEqual({
      kind: "currency",
      value: 500,
      currency: undefined,
    });
  });

  it("reads a negative currency in the sign-before-symbol form both Calc and Excel print", () => {
    expect(retyped("-£5.00")).toEqual({
      kind: "currency",
      value: -5,
      currency: "GBP",
    });
  });

  it("carries the numeric gates through the currency and percentage rules rather than bypassing them", () => {
    expect(declineReason("$1,234")).toBe("ambiguous-grouping-separator");
    expect(declineReason("£007")).toBe("leading-zero-digits");
  });

  // A no-break space (U+00A0, or U+202F narrow) between symbol and amount is ordinary in real rendered output, and is exactly what the whitespace normalisation exists for. Written as an escape rather than a literal, since an invisible character in source is unreviewable.
  it("tolerates no-break spaces around a value, not only ordinary ones", () => {
    expect(retyped("\u00A31234.50")).toEqual({
      kind: "currency",
      value: 1234.5,
      currency: "GBP",
    });
    expect(retyped("\u00A3\u00A01234.50")).toEqual({
      kind: "currency",
      value: 1234.5,
      currency: "GBP",
    });
    expect(retyped("\u00A3\u202F1234.50")).toEqual({
      kind: "currency",
      value: 1234.5,
      currency: "GBP",
    });
    expect(retyped("42.5\u00A0")).toEqual({ kind: "number", value: 42.5 });
  });
});

describe("inferCellValue: dates", () => {
  it("re-types an ISO date, whose component roles the text itself states", () => {
    expect(retyped("2024-01-15")).toEqual({
      kind: "date",
      value: "2024-01-15",
    });
  });

  it("re-types a named-month date in either order, normalising to ISO", () => {
    expect(retyped("15 Jan 2024")).toEqual({
      kind: "date",
      value: "2024-01-15",
    });
    expect(retyped("15 January 2024")).toEqual({
      kind: "date",
      value: "2024-01-15",
    });
    expect(retyped("Jan 15, 2024")).toEqual({
      kind: "date",
      value: "2024-01-15",
    });
    expect(retyped("3-Mar-2019")).toEqual({
      kind: "date",
      value: "2019-03-03",
    });
  });

  it("declines an all-numeric separated date, whose day/month order the text does not state", () => {
    expect(declineReason("01/02/2024")).toBe("ambiguous-date-order");
    // Declined even though 25 cannot be a month: resolving this cell alone would type one column inconsistently against its neighbours.
    expect(declineReason("25/12/2024")).toBe("ambiguous-date-order");
    expect(declineReason("1.2.2024")).toBe("ambiguous-date-order");
  });

  it("rejects a date-shaped string that is not a real calendar date, rather than re-typing it", () => {
    expect(inferCellValue("2024-02-31")).toBeUndefined();
    expect(inferCellValue("31 Feb 2024")).toBeUndefined();
    expect(inferCellValue("2024-13-01")).toBeUndefined();
  });

  it("accepts a real leap day, so the calendar check is a genuine one rather than a fixed month-length table", () => {
    expect(retyped("2024-02-29")).toEqual({
      kind: "date",
      value: "2024-02-29",
    });
    expect(inferCellValue("2023-02-29")).toBeUndefined();
  });
});

describe("inferCellValue: booleans", () => {
  it("re-types exactly the two words a spreadsheet actually prints for a boolean", () => {
    expect(retyped("TRUE")).toEqual({ kind: "boolean", value: true });
    expect(retyped("FALSE")).toEqual({ kind: "boolean", value: false });
    expect(retyped("true")).toEqual({ kind: "boolean", value: true });
  });

  it("declines Yes/No and friends, which no mainstream spreadsheet prints for a boolean by default", () => {
    expect(declineReason("Yes")).toBe("ambiguous-boolean-word");
    expect(declineReason("no")).toBe("ambiguous-boolean-word");
    expect(declineReason("N")).toBe("ambiguous-boolean-word");
    expect(declineReason("Off")).toBe("ambiguous-boolean-word");
  });
});
