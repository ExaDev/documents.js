import { describe, expect, it } from "vitest";
import type { CellNumberFormat } from "./number-format";
import {
  AMOUNT_NUMBER_FORMAT,
  BOOLEAN_NUMBER_FORMAT,
  BUILTIN_NUMBER_FORMATS,
  classifyNumberFormat,
  currencyNumberFormat,
  DATE_NUMBER_FORMAT,
  DATE_TIME_NUMBER_FORMAT,
  MAX_NUMBER_FORMAT_SECTIONS,
  PERCENTAGE_NUMBER_FORMAT,
  splitNumberFormatSections,
  TIME_NUMBER_FORMAT,
  tokenizeNumberFormat,
} from "./number-format";

// Every format code exercised below is either one ECMA-376 Part 1 SS18.8.30's own built-in table defines, or one taken verbatim from real LibreOffice output (this package's own src/typed/xlsx/fixtures/kitchen-sink.xlsx declares numFmtId 164-169 exactly as quoted here) -- not an invented approximation of what such a code might look like.

describe("tokenizeNumberFormat: the constructs a regex cannot tell apart", () => {
  it("treats a quoted run as literal TEXT, so its characters never read as date/time codes", () => {
    expect(tokenizeNumberFormat('"dm"0')).toEqual([
      { kind: "literal", text: "dm" },
      { kind: "code", char: "0" },
    ]);
  });

  it("runs an unterminated quote to the end of the format code rather than throwing", () => {
    expect(tokenizeNumberFormat('0"abc')).toEqual([
      { kind: "code", char: "0" },
      { kind: "literal", text: "abc" },
    ]);
  });

  it("consumes the payload character of a \\x escape and of an _x/*x placeholder as a literal", () => {
    expect(tokenizeNumberFormat("\\-_(* ")).toEqual([
      { kind: "literal", text: "-" },
      { kind: "literal", text: "(" },
      { kind: "literal", text: " " },
    ]);
  });

  it('keeps a bracket whole, including one holding a ";" that must not split a section', () => {
    expect(tokenizeNumberFormat("[$-809]")).toEqual([
      { kind: "bracket", body: "$-809" },
    ]);
    expect(
      splitNumberFormatSections(tokenizeNumberFormat("[a;b]0")),
    ).toHaveLength(1);
  });

  it('does not split on a ";" inside a quoted literal', () => {
    expect(
      splitNumberFormatSections(tokenizeNumberFormat('"a;b"0')),
    ).toHaveLength(1);
  });
});

describe("splitNumberFormatSections", () => {
  it("splits the four positive/negative/zero/text sections real producers write", () => {
    const sections = splitNumberFormatSections(
      tokenizeNumberFormat('0.00;[Red]-0.00;"-";@'),
    );
    expect(sections).toHaveLength(4);
    expect(sections[0]).toEqual([
      { kind: "code", char: "0" },
      { kind: "code", char: "." },
      { kind: "code", char: "0" },
      { kind: "code", char: "0" },
    ]);
  });

  it("returns exactly one (empty) section for an empty format code", () => {
    expect(splitNumberFormatSections(tokenizeNumberFormat(""))).toEqual([[]]);
  });

  it("drops a malformed fifth section rather than treating it as meaningful", () => {
    expect(
      splitNumberFormatSections(tokenizeNumberFormat("0;0;0;0;0")).length,
    ).toBe(MAX_NUMBER_FORMAT_SECTIONS);
  });
});

describe("classifyNumberFormat: real LibreOffice codes from this package's own kitchen-sink fixture", () => {
  it("reads [$-809] as a LOCALE tag, not currency -- the $ is immediately followed by the dash", () => {
    expect(classifyNumberFormat("[$-809]yyyy\\-mm\\-dd")).toEqual({
      kind: "date",
    });
    expect(classifyNumberFormat("[$-809]hh:mm:ss")).toEqual({ kind: "time" });
    expect(classifyNumberFormat("[$-809]0.00%")).toEqual({
      kind: "percentage",
    });
  });

  it("reads [$GBP-809] as currency carrying a real ISO 4217 code", () => {
    expect(classifyNumberFormat("[$GBP-809]#,##0.00")).toEqual({
      kind: "currency",
      code: "GBP",
    });
  });

  it('reads a redefined "General" and a quoted-literal-only boolean format as plain numbers', () => {
    expect(classifyNumberFormat("General")).toEqual({ kind: "number" });
    expect(classifyNumberFormat('"TRUE";"TRUE";"FALSE"')).toEqual({
      kind: "number",
    });
  });
});

describe("classifyNumberFormat: currency by symbol carries no invented code", () => {
  it("classifies a bracketed symbol as currency with no code -- there is no faithful symbol-to-ISO-code mapping", () => {
    expect(classifyNumberFormat("[$£-809]#,##0.00")).toEqual({
      kind: "currency",
    });
    expect(classifyNumberFormat("[$R$-416]#,##0.00")).toEqual({
      kind: "currency",
    });
  });

  it("classifies a bare unbracketed symbol and a quoted one alike (ECMA-376 built-ins 5 and 42 respectively)", () => {
    expect(classifyNumberFormat("$#,##0_);($#,##0)")).toEqual({
      kind: "currency",
    });
    expect(
      classifyNumberFormat(
        '_("$"* #,##0_);_("$"* \\(#,##0\\);_("$"* "-"_);_(@_)',
      ),
    ).toEqual({ kind: "currency" });
  });

  it("recognises a non-dollar currency symbol through the Unicode Sc category rather than a hand-listed set", () => {
    expect(classifyNumberFormat("#,##0.00 €")).toEqual({ kind: "currency" });
    expect(classifyNumberFormat("₹#,##0")).toEqual({ kind: "currency" });
  });
});

describe("classifyNumberFormat: minutes versus months, the language's other genuine ambiguity", () => {
  it('resolves the two identical "mm" runs of a combined date-and-time format oppositely', () => {
    expect(classifyNumberFormat("yyyy-mm-dd hh:mm:ss")).toEqual({
      kind: "dateTime",
    });
  });

  it('reads "mm" as minutes when the nearest preceding code is an hour', () => {
    expect(classifyNumberFormat("h:mm")).toEqual({ kind: "time" });
  });

  it('reads "mm" as minutes when the nearest following code is a second, with no hour anywhere', () => {
    expect(classifyNumberFormat("mm:ss")).toEqual({ kind: "time" });
    expect(classifyNumberFormat("mmss.0")).toEqual({ kind: "time" });
  });

  it('reads "mm" as a month between a year and a day', () => {
    expect(classifyNumberFormat("mm-dd-yy")).toEqual({ kind: "date" });
    expect(classifyNumberFormat("dd/mm/yyyy")).toEqual({ kind: "date" });
  });

  it("always reads a run of three or more m as a month name, never as minutes, even next to an hour", () => {
    expect(classifyNumberFormat("h mmm")).toEqual({ kind: "dateTime" });
    expect(classifyNumberFormat("mmm-yy")).toEqual({ kind: "date" });
  });
});

describe("classifyNumberFormat: precedence when a code carries several signals", () => {
  it("an elapsed-time bracket beats the date and time codes beside it", () => {
    expect(classifyNumberFormat("[h]:mm:ss")).toEqual({ kind: "elapsedTime" });
    expect(classifyNumberFormat("[mm]:ss")).toEqual({ kind: "elapsedTime" });
  });

  it("a date code beats a time code -- a format carrying both is a genuine combined dateTime", () => {
    expect(classifyNumberFormat("m/d/yy h:mm")).toEqual({ kind: "dateTime" });
  });

  it("a percent sign beats a currency marker", () => {
    expect(classifyNumberFormat("[$GBP-809]0.00%")).toEqual({
      kind: "percentage",
    });
  });

  it("a currency marker beats the numeric placeholders it decorates", () => {
    expect(classifyNumberFormat("$#,##0.00")).toEqual({ kind: "currency" });
  });

  it("the text placeholder wins only when there is no numeric placeholder to be a number with", () => {
    expect(classifyNumberFormat("@")).toEqual({ kind: "text" });
    expect(classifyNumberFormat('0.00" "@')).toEqual({ kind: "number" });
  });

  it("classifies from the FIRST section only, so a negative-value section cannot change the kind", () => {
    expect(classifyNumberFormat("0.00;[Red]$-0.00")).toEqual({
      kind: "number",
    });
  });
});

describe("BUILTIN_NUMBER_FORMATS: the same classifier, fed the spec's own implied table", () => {
  const classOf = (id: number) => {
    const code = BUILTIN_NUMBER_FORMATS.get(id);
    if (code === undefined) {
      throw new Error(
        `expected a built-in format code for numFmtId ${String(id)}`,
      );
    }
    return classifyNumberFormat(code);
  };

  it("classifies every plain-numeric built-in as a number", () => {
    for (const id of [0, 1, 2, 3, 4, 11, 12, 13, 37, 38, 39, 40, 41, 43, 48]) {
      expect({ id, class: classOf(id) }).toEqual({
        id,
        class: { kind: "number" },
      });
    }
  });

  it("classifies the currency and accounting built-ins as currency with no code (the spec's table names a symbol, never an ISO code)", () => {
    for (const id of [5, 6, 7, 8, 42, 44]) {
      expect({ id, class: classOf(id) }).toEqual({
        id,
        class: { kind: "currency" },
      });
    }
  });

  it("classifies the two percentage built-ins", () => {
    expect(classOf(9)).toEqual({ kind: "percentage" });
    expect(classOf(10)).toEqual({ kind: "percentage" });
  });

  it("classifies the date, time, combined, elapsed, and text built-ins", () => {
    for (const id of [14, 15, 16, 17]) {
      expect({ id, class: classOf(id) }).toEqual({
        id,
        class: { kind: "date" },
      });
    }
    for (const id of [18, 19, 20, 21, 45, 47]) {
      expect({ id, class: classOf(id) }).toEqual({
        id,
        class: { kind: "time" },
      });
    }
    expect(classOf(22)).toEqual({ kind: "dateTime" });
    expect(classOf(46)).toEqual({ kind: "elapsedTime" });
    expect(classOf(49)).toEqual({ kind: "text" });
  });

  it("leaves ids 23-36 undefined -- ECMA-376's own table reserves them, and inventing codes would fabricate a mapping", () => {
    for (let id = 23; id <= 36; id++) {
      expect(BUILTIN_NUMBER_FORMATS.get(id)).toBeUndefined();
    }
  });
});

// The write side, checked against the classifier immediately above it: every format this package's own writer emits is fed back through classifyNumberFormat here, so the vocabulary typed/xlsx/build.ts writes and the classification typed/xlsx/content.ts reads can never drift apart unnoticed.
describe("the formats typed/xlsx/build.ts writes classify back to the kind they were chosen for", () => {
  function codeOf(format: CellNumberFormat): string {
    if (format.kind === "custom") {
      return format.code;
    }
    const builtin = BUILTIN_NUMBER_FORMATS.get(format.id);
    if (builtin === undefined) {
      throw new Error(
        `numFmtId ${format.id} is not a built-in this package can write by id alone`,
      );
    }
    return builtin;
  }

  it("writes a percentage and a time of day as built-in ids, not as custom codes", () => {
    expect(PERCENTAGE_NUMBER_FORMAT).toEqual({ kind: "builtin", id: 10 });
    expect(TIME_NUMBER_FORMAT).toEqual({ kind: "builtin", id: 21 });
    expect(classifyNumberFormat(codeOf(PERCENTAGE_NUMBER_FORMAT))).toEqual({
      kind: "percentage",
    });
    expect(classifyNumberFormat(codeOf(TIME_NUMBER_FORMAT))).toEqual({
      kind: "time",
    });
  });

  it("writes ISO-ordered date and dateTime codes that classify as date and dateTime, not as each other", () => {
    expect(codeOf(DATE_NUMBER_FORMAT)).toBe("yyyy\\-mm\\-dd");
    expect(codeOf(DATE_TIME_NUMBER_FORMAT)).toBe("yyyy\\-mm\\-dd hh:mm:ss");
    expect(classifyNumberFormat(codeOf(DATE_NUMBER_FORMAT))).toEqual({
      kind: "date",
    });
    expect(classifyNumberFormat(codeOf(DATE_TIME_NUMBER_FORMAT))).toEqual({
      kind: "dateTime",
    });
  });

  it("carries a currency's ISO code through the format itself, recovering the exact code on the way back", () => {
    expect(currencyNumberFormat("GBP")).toEqual({
      kind: "custom",
      code: "[$GBP]#,##0.00",
    });
    expect(classifyNumberFormat(codeOf(currencyNumberFormat("GBP")))).toEqual({
      kind: "currency",
      code: "GBP",
    });
    expect(classifyNumberFormat(codeOf(currencyNumberFormat("usd")))).toEqual({
      kind: "currency",
      code: "USD",
    });
  });

  it("falls back to the plain amount format for a currency naming no ISO code, or naming something that is not one", () => {
    expect(currencyNumberFormat(undefined)).toEqual(AMOUNT_NUMBER_FORMAT);
    // Not an ISO-code shape: interpolating either into a [$...] bracket would produce a malformed format code.
    expect(currencyNumberFormat("£")).toEqual(AMOUNT_NUMBER_FORMAT);
    expect(currencyNumberFormat("Pounds]")).toEqual(AMOUNT_NUMBER_FORMAT);
    // The documented, deliberate loss: nothing in the plain amount format says money.
    expect(classifyNumberFormat(codeOf(AMOUNT_NUMBER_FORMAT))).toEqual({
      kind: "number",
    });
  });

  it("writes the boolean display format as real, quoted three-section markup, matching LibreOffice's own numFmtId 165 verbatim", () => {
    expect(codeOf(BOOLEAN_NUMBER_FORMAT)).toBe('"TRUE";"TRUE";"FALSE"');
    // Its own classification is irrelevant to reading a boolean back (t="b" decides that outright, before any format is consulted) -- it exists so real Excel and Calc DISPLAY the stored 1/0 as TRUE/FALSE.
    expect(classifyNumberFormat(codeOf(BOOLEAN_NUMBER_FORMAT))).toEqual({
      kind: "number",
    });
  });
});
