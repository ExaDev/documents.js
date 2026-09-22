import { describe, expect, it } from "vitest";
import type { ContentSheetDataValidation } from "document-schema.js";
import { el } from "../../xml/fragment";
import { attr } from "../util";
import {
  buildDataValidationsElement,
  readDataValidations,
} from "./data-validation";

// buildDataValidationElement is not exported — exercised indirectly through buildDataValidationsElement, which wraps it 1:1 for a single-entry array.
function buildOne(validation: ContentSheetDataValidation) {
  const wrapper = buildDataValidationsElement([validation]);
  const child = wrapper?.children[0];
  if (child?.type !== "element") {
    throw new Error("expected a single dataValidation element");
  }
  return child;
}

function worksheetWith(
  ...dataValidation: ReturnType<typeof el>[]
): ReturnType<typeof el> {
  return el("worksheet", {}, [el("dataValidations", {}, dataValidation)]);
}

describe("readDataValidations", () => {
  it("returns no validations and no residue for a worksheet with no <dataValidations> container", () => {
    const result = readDataValidations(el("worksheet", {}, []));
    expect(result).toEqual({ validations: [], residueElements: [] });
  });

  it("returns nothing for an empty <dataValidations> container", () => {
    const result = readDataValidations(
      el("worksheet", {}, [el("dataValidations", {}, [])]),
    );
    expect(result).toEqual({ validations: [], residueElements: [] });
  });

  it("quarantines an element whose type is unrecognised (including the 'none' member) as whole-element residue", () => {
    const dv = el("dataValidation", { type: "none", sqref: "A1" });
    const result = readDataValidations(worksheetWith(dv));
    expect(result.validations).toEqual([]);
    expect(result.residueElements).toEqual([dv]);
  });

  it("quarantines a recognised-type element with no sqref at all", () => {
    const dv = el("dataValidation", { type: "whole" });
    const result = readDataValidations(worksheetWith(dv));
    expect(result.validations).toEqual([]);
    expect(result.residueElements).toEqual([dv]);
  });

  it("quarantines a recognised-type element whose sqref parses to no range", () => {
    const dv = el("dataValidation", { type: "whole", sqref: "not-a-range" });
    const result = readDataValidations(worksheetWith(dv));
    expect(result.validations).toEqual([]);
    expect(result.residueElements).toEqual([dv]);
  });

  it("promotes a minimal valid whole-number rule", () => {
    const dv = el("dataValidation", { type: "whole", sqref: "A1:B2" });
    const result = readDataValidations(worksheetWith(dv));
    expect(result.residueElements).toEqual([]);
    expect(result.validations).toEqual([
      {
        ranges: [{ startRow: 0, startColumn: 0, endRow: 1, endColumn: 1 }],
        type: "whole",
      },
    ]);
  });

  it("reads a between-operator rule's formula1 AND formula2", () => {
    const dv = el(
      "dataValidation",
      { type: "whole", sqref: "A1", operator: "between" },
      [
        el("formula1", {}, [{ type: "text", value: "1" }]),
        el("formula2", {}, [{ type: "text", value: "10" }]),
      ],
    );
    const result = readDataValidations(worksheetWith(dv));
    expect(result.validations[0]).toMatchObject({
      operator: "between",
      formula1: "1",
      formula2: "10",
    });
  });

  it("ignores formula2 for a non-between/notBetween operator, even if the element carries a <formula2>", () => {
    const dv = el(
      "dataValidation",
      { type: "whole", sqref: "A1", operator: "equal" },
      [
        el("formula1", {}, [{ type: "text", value: "1" }]),
        el("formula2", {}, [{ type: "text", value: "10" }]),
      ],
    );
    const result = readDataValidations(worksheetWith(dv));
    const validation = result.validations[0];
    expect(validation?.formula1).toBe("1");
    expect(Object.hasOwn(validation ?? {}, "formula2")).toBe(false);
  });

  it("drops a stray operator attribute for a 'list' type, which has no operator field", () => {
    const dv = el("dataValidation", {
      type: "list",
      sqref: "A1",
      operator: "equal",
    });
    const result = readDataValidations(worksheetWith(dv));
    expect(Object.hasOwn(result.validations[0] ?? {}, "operator")).toBe(false);
  });

  it("drops a stray operator attribute for a 'custom' type as well", () => {
    const dv = el("dataValidation", {
      type: "custom",
      sqref: "A1",
      operator: "greaterThan",
    });
    const result = readDataValidations(worksheetWith(dv));
    expect(Object.hasOwn(result.validations[0] ?? {}, "operator")).toBe(false);
  });

  it("drops an operator value outside the recognised ST_DataValidationOperator vocabulary", () => {
    const dv = el("dataValidation", {
      type: "whole",
      sqref: "A1",
      operator: "bogus",
    });
    const result = readDataValidations(worksheetWith(dv));
    expect(Object.hasOwn(result.validations[0] ?? {}, "operator")).toBe(false);
  });

  it("recognises every ST_DataValidationOperator vocabulary member, not just a couple of them", () => {
    const operators = [
      "between",
      "notBetween",
      "equal",
      "notEqual",
      "greaterThan",
      "greaterThanOrEqual",
      "lessThan",
      "lessThanOrEqual",
    ] as const;
    for (const operator of operators) {
      const dv = el("dataValidation", { type: "whole", sqref: "A1", operator });
      const result = readDataValidations(worksheetWith(dv)).validations[0];
      expect(result?.operator).toBe(operator);
    }
  });

  it("reads formula2 for a notBetween operator too, not just between", () => {
    const dv = el(
      "dataValidation",
      { type: "whole", sqref: "A1", operator: "notBetween" },
      [
        el("formula1", {}, [{ type: "text", value: "1" }]),
        el("formula2", {}, [{ type: "text", value: "10" }]),
      ],
    );
    const result = readDataValidations(worksheetWith(dv)).validations[0];
    expect(result?.formula2).toBe("10");
  });

  it("omits formula1 entirely when the element carries no <formula1> child", () => {
    const dv = el("dataValidation", { type: "whole", sqref: "A1" });
    const result = readDataValidations(worksheetWith(dv)).validations[0];
    expect(Object.hasOwn(result ?? {}, "formula1")).toBe(false);
  });

  it("reads allowBlank/showInputMessage/showErrorMessage only when truthy, omitting the key entirely otherwise", () => {
    const trueDv = el("dataValidation", {
      type: "whole",
      sqref: "A1",
      allowBlank: "1",
      showInputMessage: "true",
      showErrorMessage: "1",
    });
    const trueResult = readDataValidations(worksheetWith(trueDv))
      .validations[0];
    expect(trueResult).toMatchObject({
      allowBlank: true,
      showInputMessage: true,
      showErrorMessage: true,
    });

    const falseDv = el("dataValidation", { type: "whole", sqref: "A1" });
    const falseResult = readDataValidations(worksheetWith(falseDv))
      .validations[0];
    expect(Object.hasOwn(falseResult ?? {}, "allowBlank")).toBe(false);
    expect(Object.hasOwn(falseResult ?? {}, "showInputMessage")).toBe(false);
    expect(Object.hasOwn(falseResult ?? {}, "showErrorMessage")).toBe(false);
  });

  it("decodes promptTitle/prompt/errorTitle/error entities, omitting each when absent", () => {
    const dv = el("dataValidation", {
      type: "whole",
      sqref: "A1",
      promptTitle: "Ben &amp; Jerry",
      prompt: "Pick a &lt;value&gt;",
      errorTitle: "Bad &quot;input&quot;",
      error: "Try &apos;again&apos;",
    });
    const result = readDataValidations(worksheetWith(dv)).validations[0];
    expect(result).toMatchObject({
      promptTitle: "Ben & Jerry",
      prompt: "Pick a <value>",
      errorTitle: 'Bad "input"',
      error: "Try 'again'",
    });

    const bare = el("dataValidation", { type: "whole", sqref: "A1" });
    const bareResult = readDataValidations(worksheetWith(bare)).validations[0];
    for (const key of ["promptTitle", "prompt", "errorTitle", "error"]) {
      expect(Object.hasOwn(bareResult ?? {}, key)).toBe(false);
    }
  });

  it("reads a 'warning'/'information' errorStyle, omitting the field for the default 'stop' or an unrecognised value", () => {
    const warning = readDataValidations(
      worksheetWith(
        el("dataValidation", {
          type: "whole",
          sqref: "A1",
          errorStyle: "warning",
        }),
      ),
    ).validations[0];
    expect(warning?.errorStyle).toBe("warning");

    const information = readDataValidations(
      worksheetWith(
        el("dataValidation", {
          type: "whole",
          sqref: "A1",
          errorStyle: "information",
        }),
      ),
    ).validations[0];
    expect(information?.errorStyle).toBe("information");

    const stop = readDataValidations(
      worksheetWith(
        el("dataValidation", {
          type: "whole",
          sqref: "A1",
          errorStyle: "stop",
        }),
      ),
    ).validations[0];
    expect(Object.hasOwn(stop ?? {}, "errorStyle")).toBe(false);

    const bogus = readDataValidations(
      worksheetWith(
        el("dataValidation", {
          type: "whole",
          sqref: "A1",
          errorStyle: "bogus",
        }),
      ),
    ).validations[0];
    expect(Object.hasOwn(bogus ?? {}, "errorStyle")).toBe(false);
  });

  it("captures an unmanaged attribute as source residue, omitting the field when none is present", () => {
    const withExtra = readDataValidations(
      worksheetWith(
        el("dataValidation", {
          type: "whole",
          sqref: "A1",
          imeMode: "hiragana",
        }),
      ),
    ).validations[0];
    expect(withExtra?.source?.format).toBe("xlsx");
    expect(withExtra?.source?.xml).toContain("imeMode");

    const clean = readDataValidations(
      worksheetWith(el("dataValidation", { type: "whole", sqref: "A1" })),
    ).validations[0];
    expect(Object.hasOwn(clean ?? {}, "source")).toBe(false);
  });
});

describe("buildDataValidationsElement", () => {
  it("returns undefined for an empty array", () => {
    expect(buildDataValidationsElement([])).toBeUndefined();
  });

  it("wraps every validation with a count attribute matching the array length", () => {
    const wrapper = buildDataValidationsElement([
      {
        ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
        type: "whole",
      },
      {
        ranges: [{ startRow: 1, startColumn: 0, endRow: 1, endColumn: 0 }],
        type: "whole",
      },
    ]);
    expect(wrapper?.tag).toBe("dataValidations");
    expect(attr(wrapper!, "count")).toBe("2");
    expect(wrapper?.children).toHaveLength(2);
  });
});

describe("buildDataValidationElement (via buildDataValidationsElement)", () => {
  it("always writes type, sqref, allowBlank, showInputMessage, showErrorMessage, and a default errorStyle of 'stop'", () => {
    const built = buildOne({
      ranges: [{ startRow: 0, startColumn: 0, endRow: 1, endColumn: 1 }],
      type: "whole",
    });
    expect(attr(built, "type")).toBe("whole");
    expect(attr(built, "sqref")).toBe("A1:B2");
    expect(attr(built, "allowBlank")).toBe("false");
    expect(attr(built, "showInputMessage")).toBe("false");
    expect(attr(built, "showErrorMessage")).toBe("false");
    expect(attr(built, "errorStyle")).toBe("stop");
  });

  it("writes true booleans as the literal string 'true'", () => {
    const built = buildOne({
      ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
      type: "whole",
      allowBlank: true,
      showInputMessage: true,
      showErrorMessage: true,
    });
    expect(attr(built, "allowBlank")).toBe("true");
    expect(attr(built, "showInputMessage")).toBe("true");
    expect(attr(built, "showErrorMessage")).toBe("true");
  });

  it("omits the operator attribute entirely when the validation has none", () => {
    const built = buildOne({
      ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
      type: "list",
    });
    expect(attr(built, "operator")).toBeUndefined();
  });

  it("writes the operator attribute when present", () => {
    const built = buildOne({
      ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
      type: "whole",
      operator: "greaterThan",
    });
    expect(attr(built, "operator")).toBe("greaterThan");
  });

  it("writes a non-default errorStyle verbatim", () => {
    const built = buildOne({
      ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
      type: "whole",
      errorStyle: "warning",
    });
    expect(attr(built, "errorStyle")).toBe("warning");
  });

  it("encodes promptTitle/prompt/errorTitle/error, omitting each when absent", () => {
    const built = buildOne({
      ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
      type: "whole",
      promptTitle: "Ben & Jerry",
      prompt: "Pick a <value>",
      errorTitle: 'Bad "input"',
      error: "Try 'again'",
    });
    expect(attr(built, "promptTitle")).toBe("Ben &amp; Jerry");
    expect(attr(built, "prompt")).toBe("Pick a &lt;value&gt;");
    expect(attr(built, "errorTitle")).toContain("&quot;");
    expect(attr(built, "error")).toContain("&apos;");

    const bare = buildOne({
      ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
      type: "whole",
    });
    for (const key of ["promptTitle", "prompt", "errorTitle", "error"]) {
      expect(attr(bare, key)).toBeUndefined();
    }
  });

  it("writes formula1/formula2 children only when present, in that order", () => {
    const both = buildOne({
      ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
      type: "whole",
      operator: "between",
      formula1: "1",
      formula2: "10",
    });
    expect(
      both.children.map((c) => (c.type === "element" ? c.tag : undefined)),
    ).toEqual(["formula1", "formula2"]);

    const neither = buildOne({
      ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
      type: "whole",
    });
    expect(neither.children).toHaveLength(0);
  });

  it("lays managed attributes on top of captured residue, never letting residue override a managed key", () => {
    const dv = el("dataValidation", {
      type: "whole",
      sqref: "A1",
      imeMode: "hiragana",
    });
    const read = readDataValidations(worksheetWith(dv)).validations[0];
    if (read === undefined) {
      throw new Error("expected a promoted validation");
    }
    const rebuilt = buildOne(read);
    expect(attr(rebuilt, "imeMode")).toBe("hiragana");
    expect(attr(rebuilt, "type")).toBe("whole");
  });
});
