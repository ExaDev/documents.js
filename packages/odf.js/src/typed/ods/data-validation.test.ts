import { describe, expect, it } from "vitest";
import { el, txt } from "../../xml/fragment";
import {
  parseContentValidationCondition,
  readContentValidationDefinitions,
  resolveSheetDataValidations,
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
