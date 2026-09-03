import { describe, expect, it } from "vitest";

import { BUILTIN_NUMBER_FORMATS, classifyNumberFormat } from "./number-format";

describe("classifyNumberFormat", () => {
  it.each([
    ["General", "number"],
    ["0", "number"],
    ["#,##0.00", "number"],
    ["0.00E+00", "number"],
    ["0%", "percentage"],
    ["0.00%", "percentage"],
    ["mm-dd-yy", "date"],
    ["d-mmm-yy", "date"],
    ["yyyy-mm-dd", "date"],
    ["h:mm:ss", "time"],
    ["h:mm AM/PM", "time"],
    ["m/d/yy h:mm", "dateTime"],
    ["[h]:mm:ss", "elapsedTime"],
    ["@", "text"],
  ])("classifies %s as %s", (code, kind) => {
    expect(classifyNumberFormat(code).kind).toBe(kind);
  });

  it("resolves the two identical m runs of a combined format oppositely", () => {
    // 'mm' between 'yyyy' and 'dd' is a month; 'mm' after 'hh' is minutes. Getting this wrong turns a dateTime into a date or drops the date half entirely.
    expect(classifyNumberFormat("yyyy-mm-dd hh:mm:ss").kind).toBe("dateTime");
  });

  it("reads a bare unbracketed currency symbol as currency", () => {
    expect(classifyNumberFormat("$#,##0_);($#,##0)")).toEqual({
      kind: "currency",
    });
  });

  it("reads a quoted currency symbol as currency", () => {
    expect(classifyNumberFormat('_("$"* #,##0_);_("$"* \\(#,##0\\)').kind).toBe(
      "currency",
    );
  });

  it("extracts an ISO 4217 code from a currency bracket", () => {
    expect(classifyNumberFormat("[$GBP-809]#,##0.00")).toEqual({
      kind: "currency",
      code: "GBP",
    });
  });

  it("reads a currency bracket carrying a symbol as currency with no code", () => {
    // There is no faithful symbol-to-code mapping, so the kind is kept and the code left absent rather than invented.
    expect(classifyNumberFormat("[$£-809]#,##0.00")).toEqual({
      kind: "currency",
    });
  });

  it("does not read a bare locale tag as currency", () => {
    // '[$-809]' is '$' immediately followed by '-': a locale tag with no currency meaning at all. Real producers put it on date, time, and percentage formats, so reading it as currency would misclassify most of a styled workbook.
    expect(classifyNumberFormat("[$-809]0.00%").kind).toBe("percentage");
    expect(classifyNumberFormat("[$-809]yyyy-mm-dd").kind).toBe("date");
  });

  it("does not read a date code inside a quoted literal", () => {
    // The 'd' of "dollars" is text, not a day code.
    expect(classifyNumberFormat('#,##0" dollars"').kind).toBe("number");
  });

  it("does not read an escaped character as a code", () => {
    expect(classifyNumberFormat("0\\%").kind).toBe("number");
  });

  it("ignores a colour bracket", () => {
    expect(classifyNumberFormat("[Red]#,##0").kind).toBe("number");
  });

  it("classifies on the first section only", () => {
    // Sections two onward are the negative/zero/text renderings of the same value; a negative cell must not classify differently from an identical positive one.
    expect(classifyNumberFormat("0.00%;[Red]-0.00%").kind).toBe("percentage");
  });

  it("does not split on a semicolon inside a quoted literal", () => {
    expect(classifyNumberFormat('"a;b"0%').kind).toBe("percentage");
  });

  it("prefers a percentage over a currency marker", () => {
    expect(classifyNumberFormat("[$GBP-809]0.00%").kind).toBe("percentage");
  });

  it("treats a text placeholder alongside numeric placeholders as a number", () => {
    expect(classifyNumberFormat("#,##0;@").kind).toBe("number");
  });

  it("does not read the e of General as scientific notation", () => {
    expect(classifyNumberFormat("General").kind).toBe("number");
  });
});

describe("BUILTIN_NUMBER_FORMATS", () => {
  it("leaves the reserved identifiers absent rather than inventing codes", () => {
    // ECMA-376 Part 1 SS18.8.30 leaves 23-36 reserved. An XF pointing at one must resolve to no format code at all, not to a fabricated one.
    for (let id = 23; id <= 36; id += 1) {
      expect(BUILTIN_NUMBER_FORMATS.has(id)).toBe(false);
    }
  });

  it("classifies every built-in date and time identifier temporally", () => {
    // The identifiers a producer relies on being known without writing a Format record. Feeding them through the same classifier as a custom code is what keeps the two feeds from drifting.
    const temporal = [14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47];
    for (const id of temporal) {
      const code = BUILTIN_NUMBER_FORMATS.get(id);
      expect(code).toBeDefined();
      expect(["date", "time", "dateTime", "elapsedTime"]).toContain(
        classifyNumberFormat(code ?? "").kind,
      );
    }
  });

  it("classifies the built-in percentage identifiers as percentages", () => {
    for (const id of [9, 10]) {
      expect(
        classifyNumberFormat(BUILTIN_NUMBER_FORMATS.get(id) ?? "").kind,
      ).toBe("percentage");
    }
  });

  it("classifies the built-in currency and accounting identifiers as currency", () => {
    for (const id of [5, 6, 7, 8, 42, 44]) {
      expect(
        classifyNumberFormat(BUILTIN_NUMBER_FORMATS.get(id) ?? "").kind,
      ).toBe("currency");
    }
  });
});
