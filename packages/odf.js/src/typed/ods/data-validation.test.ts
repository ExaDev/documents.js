import { describe, expect, it } from "vitest";
import { el, txt } from "../../xml/fragment";
import {
  parseContentValidationCondition,
  readContentValidationDefinitions,
  resolveSheetDataValidations,
  synthesiseContentValidationCondition,
} from "./data-validation";

// table:condition's own grammar is transcribed from LibreOffice's real reader (sc/source/filter/xml/xmlcvali.cxx, XMLConverter.cxx) -- see data-validation.ts's own top-of-file note. Every example here is either lifted verbatim from a real LibreOffice-produced .fods fixture (sc/qa/unit/data/functions/logical/fods/if.fods) or hand-built to the identical grammar that source establishes.

describe("parseContentValidationCondition", () => {
  it("parses cell-content-is-in-list with a nested-parens/quoted-string operand (verbatim from a real LibreOffice .fods fixture)", () => {
    expect(
      parseContentValidationCondition(
        'of:cell-content-is-in-list(ROW(INDIRECT("1:10")))',
      ),
    ).toEqual({
      type: "list",
      operator: "equal",
      formula1: 'ROW(INDIRECT("1:10"))',
    });
  });

  it("parses a whole-number range: 'is-whole-number() and cell-content-is-between(a,b)'", () => {
    expect(
      parseContentValidationCondition(
        "of:cell-content-is-whole-number() and cell-content-is-between(1,10)",
      ),
    ).toEqual({
      type: "whole",
      operator: "between",
      formula1: "1",
      formula2: "10",
    });
  });

  it("parses a decimal comparison: 'is-decimal-number() and cell-content()>=<expr>'", () => {
    expect(
      parseContentValidationCondition(
        "of:cell-content-is-decimal-number() and cell-content()>=0.5",
      ),
    ).toEqual({
      type: "decimal",
      operator: "greaterThanOrEqual",
      formula1: "0.5",
    });
  });

  it("parses every comparison operator spelling", () => {
    const cases: [string, string][] = [
      ["=", "equal"],
      ["!=", "notEqual"],
      ["<", "lessThan"],
      ["<=", "lessThanOrEqual"],
      [">", "greaterThan"],
      [">=", "greaterThanOrEqual"],
    ];
    for (const [op, operator] of cases) {
      expect(
        parseContentValidationCondition(
          `of:cell-content-is-date() and cell-content()${op}TODAY()`,
        ),
      ).toEqual({ type: "date", operator, formula1: "TODAY()" });
    }
  });

  it("parses a text-length not-between condition", () => {
    expect(
      parseContentValidationCondition(
        "of:cell-content-text-length-is-not-between(5,20)",
      ),
    ).toEqual({
      type: "textLength",
      operator: "notBetween",
      formula1: "5",
      formula2: "20",
    });
  });

  it("parses is-true-formula as a custom rule with no operator, the raw formula as formula1", () => {
    expect(
      parseContentValidationCondition("of:is-true-formula(ISNUMBER([.A1]))"),
    ).toEqual({ type: "custom", formula1: "ISNUMBER([.A1])" });
  });

  it("parses cell-content-is-whole-number() with no secondary clause as an unconstrained whole-number type", () => {
    expect(
      parseContentValidationCondition("of:cell-content-is-whole-number()"),
    ).toEqual({ type: "whole" });
  });

  it("returns undefined for an unrecognised leading identifier rather than guessing", () => {
    expect(
      parseContentValidationCondition("of:some-future-producer-extension()"),
    ).toBeUndefined();
  });

  it("returns undefined for an empty string", () => {
    expect(parseContentValidationCondition("")).toBeUndefined();
  });

  it("returns undefined for a bare comparison identifier with no preceding type token (cell-content has no validation of its own)", () => {
    expect(
      parseContentValidationCondition("of:cell-content()>=1"),
    ).toBeUndefined();
  });

  it("returns undefined for a function0 identifier with no trailing parentheses at all", () => {
    expect(
      parseContentValidationCondition("of:cell-content-is-whole-number"),
    ).toBeUndefined();
  });

  it("returns undefined for a function0 identifier whose trailing characters aren't the literal '()'", () => {
    expect(
      parseContentValidationCondition("of:cell-content-is-whole-number(x)"),
    ).toBeUndefined();
  });

  it("falls back to the bare type, with no operator, when the secondary clause's own comparison identifier has no parentheses -- rather than treating two arbitrary non-'()' characters as the missing pair and mis-parsing whatever operator happens to follow them", () => {
    expect(
      parseContentValidationCondition(
        "of:cell-content-is-whole-number() and cell-contentAB>=5",
      ),
    ).toEqual({ type: "whole" });
  });

  it("falls back to the bare type when the secondary comparison's operator doesn't match any known spelling", () => {
    expect(
      parseContentValidationCondition(
        "of:cell-content-is-whole-number() and cell-content()~1",
      ),
    ).toEqual({ type: "whole" });
  });

  it("falls back to the bare type when the secondary comparison's operand is empty", () => {
    expect(
      parseContentValidationCondition(
        "of:cell-content-is-whole-number() and cell-content()>=",
      ),
    ).toEqual({ type: "whole" });
  });

  it("trims surrounding whitespace from a comparison operand", () => {
    expect(
      parseContentValidationCondition(
        "of:cell-content-is-whole-number() and cell-content()>= 5",
      ),
    ).toEqual({ type: "whole", operator: "greaterThanOrEqual", formula1: "5" });
  });

  it("falls back to the bare type when the token after 'and' is a function1 (an is-true-formula, its own operand carried on formula1) rather than a comparison or function2 -- not just any wrong-kind token, one whose own parsed fields could otherwise leak through", () => {
    expect(
      parseContentValidationCondition(
        "of:cell-content-is-whole-number() and is-true-formula(X)",
      ),
    ).toEqual({ type: "whole" });
  });

  it("returns undefined for is-true-formula with no parentheses at all", () => {
    expect(
      parseContentValidationCondition("of:is-true-formula"),
    ).toBeUndefined();
  });

  it("returns undefined for is-true-formula whose character right after the identifier isn't '(' -- rather than treating whatever follows that character as the parenthesised operand", () => {
    expect(
      parseContentValidationCondition("of:is-true-formulaXFOO)"),
    ).toBeUndefined();
  });

  it("returns undefined for is-true-formula whose parenthesised operand is empty", () => {
    expect(
      parseContentValidationCondition("of:is-true-formula()"),
    ).toBeUndefined();
  });

  it("returns undefined for cell-content-is-between with no opening parenthesis", () => {
    expect(
      parseContentValidationCondition("of:cell-content-is-between1,10)"),
    ).toBeUndefined();
  });

  it("returns undefined for cell-content-is-between whose first operand is empty", () => {
    expect(
      parseContentValidationCondition("of:cell-content-is-between(,10)"),
    ).toBeUndefined();
  });

  it("returns undefined for cell-content-is-between whose second operand is empty", () => {
    expect(
      parseContentValidationCondition("of:cell-content-is-between(1,)"),
    ).toBeUndefined();
  });

  it("falls back to the bare type, as a secondary clause, when cell-content-is-between has no opening parenthesis -- rather than treating the character right after the identifier as consumed and re-parsing whatever comes after it as the two operands", () => {
    expect(
      parseContentValidationCondition(
        "of:cell-content-is-whole-number() and cell-content-is-between1FOO,BAR)",
      ),
    ).toEqual({ type: "whole" });
  });

  it("falls back to the bare type, as a secondary clause, when cell-content-is-between's first operand is empty -- rather than accepting the second operand alone", () => {
    expect(
      parseContentValidationCondition(
        "of:cell-content-is-whole-number() and cell-content-is-between(,10)",
      ),
    ).toEqual({ type: "whole" });
  });

  it("falls back to the bare type, as a secondary clause, when cell-content-is-between's second operand is empty -- rather than accepting the first operand alone", () => {
    expect(
      parseContentValidationCondition(
        "of:cell-content-is-whole-number() and cell-content-is-between(10,)",
      ),
    ).toEqual({ type: "whole" });
  });
});

function contentValidationsElement(...validations: ReturnType<typeof el>[]) {
  return el("office:spreadsheet", {}, [
    el("table:content-validations", {}, validations),
  ]);
}

describe("readContentValidationDefinitions", () => {
  it("reads a validation's name, condition, and allow-empty-cell", () => {
    const definitions = readContentValidationDefinitions(
      contentValidationsElement(
        el("table:content-validation", {
          "table:name": "val1",
          "table:condition":
            "of:cell-content-is-whole-number() and cell-content()>=1",
          "table:allow-empty-cell": "false",
        }),
      ),
    );
    expect(definitions.get("val1")).toEqual({
      type: "whole",
      operator: "greaterThanOrEqual",
      formula1: "1",
      allowBlank: false,
    });
  });

  it("decodes an XML-escaped comparison operator in table:condition (this package parses with processEntities:false, so a producer that escapes '>' as '&gt;' -- confirmed real behaviour, see conditional-format.ts's own sibling fix -- must be undone before the mini-language parser ever sees the string)", () => {
    const definitions = readContentValidationDefinitions(
      contentValidationsElement(
        el("table:content-validation", {
          "table:name": "val1",
          "table:condition":
            "of:cell-content-is-whole-number() and cell-content()&gt;=1",
        }),
      ),
    );
    expect(definitions.get("val1")).toEqual({
      type: "whole",
      operator: "greaterThanOrEqual",
      formula1: "1",
      allowBlank: true,
    });
  });

  it("allow-empty-cell defaults to true when absent, ODF's own default", () => {
    const definitions = readContentValidationDefinitions(
      contentValidationsElement(
        el("table:content-validation", {
          "table:name": "val1",
          "table:condition": "of:cell-content-is-whole-number()",
        }),
      ),
    );
    expect(definitions.get("val1")?.allowBlank).toBe(true);
  });

  it("reads a help message (prompt) and an error message, both with multi-paragraph bodies joined by a bare newline", () => {
    const definitions = readContentValidationDefinitions(
      contentValidationsElement(
        el(
          "table:content-validation",
          {
            "table:name": "val1",
            "table:condition": "of:cell-content-is-whole-number()",
          },
          [
            el(
              "table:help-message",
              {
                "table:title": "Enter a whole number",
                "table:display": "true",
              },
              [
                el("text:p", {}, [txt("Line one")]),
                el("text:p", {}, [txt("Line two")]),
              ],
            ),
            el(
              "table:error-message",
              {
                "table:title": "Invalid",
                "table:message-type": "warning",
                "table:display": "true",
              },
              [el("text:p", {}, [txt("Not a whole number")])],
            ),
          ],
        ),
      ),
    );
    expect(definitions.get("val1")).toMatchObject({
      showInputMessage: true,
      promptTitle: "Enter a whole number",
      prompt: "Line one\nLine two",
      showErrorMessage: true,
      errorTitle: "Invalid",
      errorStyle: "warning",
      error: "Not a whole number",
    });
  });

  it("omits showInputMessage/showErrorMessage when table:display isn't the literal string 'true', and omits promptTitle/errorTitle when table:title is absent", () => {
    const definitions = readContentValidationDefinitions(
      contentValidationsElement(
        el(
          "table:content-validation",
          {
            "table:name": "val1",
            "table:condition": "of:cell-content-is-whole-number()",
          },
          [
            el("table:help-message", { "table:display": "false" }, []),
            el("table:error-message", { "table:display": "false" }, []),
          ],
        ),
      ),
    );
    const rule = definitions.get("val1");
    expect(rule?.showInputMessage).toBeUndefined();
    expect(rule?.showErrorMessage).toBeUndefined();
    // Presence, not just value: readContentValidation only ever assigns promptTitle/errorTitle when table:title is actually present, so an absent title must leave the key itself unset -- not merely holding an explicit `undefined` -- which `?.` equality can't tell apart from a genuinely missing key.
    expect(Object.hasOwn(rule ?? {}, "promptTitle")).toBe(false);
    expect(Object.hasOwn(rule ?? {}, "errorTitle")).toBe(false);
  });

  it("leaves prompt/error unset when the message element has no text:p children at all (an empty body)", () => {
    const definitions = readContentValidationDefinitions(
      contentValidationsElement(
        el(
          "table:content-validation",
          {
            "table:name": "val1",
            "table:condition": "of:cell-content-is-whole-number()",
          },
          [
            el("table:help-message", { "table:display": "true" }, []),
            el("table:error-message", { "table:display": "true" }, []),
          ],
        ),
      ),
    );
    const rule = definitions.get("val1");
    expect(rule?.showInputMessage).toBe(true);
    expect(rule?.prompt).toBeUndefined();
    expect(rule?.showErrorMessage).toBe(true);
    expect(rule?.error).toBeUndefined();
  });

  it("leaves errorStyle unset when table:message-type is absent or isn't one of the three recognised values", () => {
    const noType = readContentValidationDefinitions(
      contentValidationsElement(
        el(
          "table:content-validation",
          {
            "table:name": "val1",
            "table:condition": "of:cell-content-is-whole-number()",
          },
          [el("table:error-message", {}, [txt("body")])],
        ),
      ),
    );
    expect(noType.get("val1")?.errorStyle).toBeUndefined();

    const unrecognisedType = readContentValidationDefinitions(
      contentValidationsElement(
        el(
          "table:content-validation",
          {
            "table:name": "val1",
            "table:condition": "of:cell-content-is-whole-number()",
          },
          [
            el("table:error-message", { "table:message-type": "critical" }, [
              txt("body"),
            ]),
          ],
        ),
      ),
    );
    expect(unrecognisedType.get("val1")?.errorStyle).toBeUndefined();
  });

  it("recognises 'stop' and 'information' as valid table:message-type values, alongside 'warning' already covered above", () => {
    const stop = readContentValidationDefinitions(
      contentValidationsElement(
        el(
          "table:content-validation",
          {
            "table:name": "val1",
            "table:condition": "of:cell-content-is-whole-number()",
          },
          [
            el("table:error-message", { "table:message-type": "stop" }, [
              txt("body"),
            ]),
          ],
        ),
      ),
    );
    expect(stop.get("val1")?.errorStyle).toBe("stop");

    const information = readContentValidationDefinitions(
      contentValidationsElement(
        el(
          "table:content-validation",
          {
            "table:name": "val1",
            "table:condition": "of:cell-content-is-whole-number()",
          },
          [
            el("table:error-message", { "table:message-type": "information" }, [
              txt("body"),
            ]),
          ],
        ),
      ),
    );
    expect(information.get("val1")?.errorStyle).toBe("information");
  });

  it("returns an empty map when the document declares no table:content-validations at all", () => {
    const definitions = readContentValidationDefinitions(
      el("office:spreadsheet", {}, []),
    );
    expect(definitions.size).toBe(0);
  });

  it("skips a table:content-validation with no table:name, rather than throwing", () => {
    const definitions = readContentValidationDefinitions(
      contentValidationsElement(
        el("table:content-validation", {
          "table:condition": "of:cell-content-is-whole-number()",
        }),
      ),
    );
    expect(definitions.size).toBe(0);
  });
});

describe("resolveSheetDataValidations", () => {
  it("joins a sheet's own referenced names against the document-wide definitions, carrying each rule's own collected ranges", () => {
    const definitions = new Map([
      [
        "val1",
        {
          type: "whole" as const,
          operator: "greaterThan" as const,
          formula1: "0",
        },
      ],
    ]);
    const refs = new Map([
      [
        "val1",
        [
          { startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 },
          { startRow: 1, startColumn: 0, endRow: 1, endColumn: 0 },
        ],
      ],
    ]);
    expect(resolveSheetDataValidations(refs, definitions)).toEqual([
      {
        type: "whole",
        operator: "greaterThan",
        formula1: "0",
        ranges: [
          { startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 },
          { startRow: 1, startColumn: 0, endRow: 1, endColumn: 0 },
        ],
      },
    ]);
  });

  it("drops a reference whose name has no matching definition, rather than fabricating one", () => {
    const refs = new Map([
      ["missing", [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }]],
    ]);
    expect(resolveSheetDataValidations(refs, new Map())).toEqual([]);
  });
});

describe("synthesiseContentValidationCondition", () => {
  it("writes cell-content-is-in-list for a list rule with a formula", () => {
    expect(
      synthesiseContentValidationCondition({
        type: "list",
        formula1: "$Sheet1.$A$1:$A$10",
      }),
    ).toBe("of:cell-content-is-in-list($Sheet1.$A$1:$A$10)");
  });

  it("emits no table:condition for a list rule with no formula", () => {
    expect(
      synthesiseContentValidationCondition({ type: "list" }),
    ).toBeUndefined();
  });

  it("writes is-true-formula for a custom rule with a formula", () => {
    expect(
      synthesiseContentValidationCondition({
        type: "custom",
        formula1: "ISNUMBER([.A1])",
      }),
    ).toBe("of:is-true-formula(ISNUMBER([.A1]))");
  });

  it("emits no table:condition for a custom rule with no formula", () => {
    expect(
      synthesiseContentValidationCondition({ type: "custom" }),
    ).toBeUndefined();
  });

  it("emits no table:condition for a textLength rule missing an operator", () => {
    expect(
      synthesiseContentValidationCondition({
        type: "textLength",
        formula1: "5",
      }),
    ).toBeUndefined();
  });

  it("emits no table:condition for a textLength rule missing formula1", () => {
    expect(
      synthesiseContentValidationCondition({
        type: "textLength",
        operator: "greaterThan",
      }),
    ).toBeUndefined();
  });

  it("writes cell-content-text-length-is-between for a textLength 'between' rule with both formulas", () => {
    expect(
      synthesiseContentValidationCondition({
        type: "textLength",
        operator: "between",
        formula1: "5",
        formula2: "20",
      }),
    ).toBe("of:cell-content-text-length-is-between(5,20)");
  });

  it("writes cell-content-text-length-is-not-between for a textLength 'notBetween' rule with both formulas", () => {
    expect(
      synthesiseContentValidationCondition({
        type: "textLength",
        operator: "notBetween",
        formula1: "5",
        formula2: "20",
      }),
    ).toBe("of:cell-content-text-length-is-not-between(5,20)");
  });

  it("emits no table:condition for a textLength 'between' rule missing its second formula (neither a between clause nor a plain comparison can be written)", () => {
    expect(
      synthesiseContentValidationCondition({
        type: "textLength",
        operator: "between",
        formula1: "5",
      }),
    ).toBeUndefined();
  });

  it("writes a plain comparison for a textLength rule with a non-between operator", () => {
    expect(
      synthesiseContentValidationCondition({
        type: "textLength",
        operator: "equal",
        formula1: "5",
      }),
    ).toBe("of:cell-content-text-length()=5");
  });

  it("writes each plain comparison operator spelling for a textLength rule", () => {
    const cases: [string, string][] = [
      ["equal", "="],
      ["notEqual", "!="],
      ["lessThan", "<"],
      ["lessThanOrEqual", "<="],
      ["greaterThan", ">"],
      ["greaterThanOrEqual", ">="],
    ];
    for (const [operator, symbol] of cases) {
      expect(
        synthesiseContentValidationCondition({
          type: "textLength",
          operator: operator as never,
          formula1: "5",
        }),
      ).toBe(`of:cell-content-text-length()${symbol}5`);
    }
  });

  it("writes the bare function0 identifier for a whole/decimal/date/time rule with no operator", () => {
    expect(synthesiseContentValidationCondition({ type: "whole" })).toBe(
      "of:cell-content-is-whole-number()",
    );
    expect(synthesiseContentValidationCondition({ type: "decimal" })).toBe(
      "of:cell-content-is-decimal-number()",
    );
    expect(synthesiseContentValidationCondition({ type: "date" })).toBe(
      "of:cell-content-is-date()",
    );
    expect(synthesiseContentValidationCondition({ type: "time" })).toBe(
      "of:cell-content-is-time()",
    );
  });

  it("writes the bare identifier alone when a whole/decimal/date/time rule has an operator but no formula1", () => {
    expect(
      synthesiseContentValidationCondition({
        type: "whole",
        operator: "greaterThan",
      }),
    ).toBe("of:cell-content-is-whole-number()");
  });

  it("appends a secondary comparison clause for a whole/decimal/date/time rule with a non-between operator", () => {
    expect(
      synthesiseContentValidationCondition({
        type: "whole",
        operator: "greaterThanOrEqual",
        formula1: "1",
      }),
    ).toBe("of:cell-content-is-whole-number() and cell-content()>=1");
  });

  it("appends a secondary between clause for a whole/decimal/date/time rule with a between operator and both formulas", () => {
    expect(
      synthesiseContentValidationCondition({
        type: "whole",
        operator: "between",
        formula1: "1",
        formula2: "10",
      }),
    ).toBe(
      "of:cell-content-is-whole-number() and cell-content-is-between(1,10)",
    );
  });

  it("appends a secondary between clause for a whole/decimal/date/time rule with a notBetween operator and both formulas", () => {
    expect(
      synthesiseContentValidationCondition({
        type: "date",
        operator: "notBetween",
        formula1: "1",
        formula2: "10",
      }),
    ).toBe("of:cell-content-is-date() and cell-content-is-not-between(1,10)");
  });

  it("writes just the bare identifier for a whole/decimal/date/time rule with a between operator but no second formula (the secondary clause can't be written either way)", () => {
    expect(
      synthesiseContentValidationCondition({
        type: "whole",
        operator: "between",
        formula1: "1",
      }),
    ).toBe("of:cell-content-is-whole-number()");
  });

  it("emits no table:condition for a type this grammar has no identifier for", () => {
    expect(
      synthesiseContentValidationCondition({
        type: "bogus" as never,
      }),
    ).toBeUndefined();
  });
});
