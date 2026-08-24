import { describe, expect, it } from "vitest";
import { el, txt } from "../../xml/fragment";
import { OdsCell } from "./cell";
import { createOds } from "./editor";

describe("OdsCell.value", () => {
  it('number: writes office:value-type="float" (not "number") and office:value, and round-trips', () => {
    const sheet = createOds().sheets()[0]!;
    const cell = sheet.cell(0, 0);
    cell.value = { kind: "number", value: 42.5 };
    expect(cell.value).toEqual({ kind: "number", value: 42.5 });
  });

  it("percentage: round-trips and defaults displayText to a percentage-formatted string", () => {
    const sheet = createOds().sheets()[0]!;
    const cell = sheet.cell(0, 0);
    cell.value = { kind: "percentage", value: 0.5 };
    expect(cell.value).toEqual({ kind: "percentage", value: 0.5 });
    expect(cell.displayText).toBe("50%");
  });

  it("currency: with a currency code, round-trips and writes office:currency", () => {
    const sheet = createOds().sheets()[0]!;
    const cell = sheet.cell(0, 0);
    cell.value = { kind: "currency", value: 19.99, currency: "GBP" };
    expect(cell.value).toEqual({
      kind: "currency",
      value: 19.99,
      currency: "GBP",
    });
  });

  it("currency: without a currency code, round-trips and writes no office:currency attribute", () => {
    const sheet = createOds().sheets()[0]!;
    const cell = sheet.cell(0, 0);
    cell.value = { kind: "currency", value: 19.99 };
    expect(cell.value).toEqual({ kind: "currency", value: 19.99 });
  });

  it('boolean: true writes office:boolean-value="true" and round-trips; false likewise', () => {
    const sheet = createOds().sheets()[0]!;
    const trueCell = sheet.cell(0, 0);
    trueCell.value = { kind: "boolean", value: true };
    expect(trueCell.value).toEqual({ kind: "boolean", value: true });
    expect(trueCell.displayText).toBe("TRUE");

    const falseCell = sheet.cell(0, 1);
    falseCell.value = { kind: "boolean", value: false };
    expect(falseCell.value).toEqual({ kind: "boolean", value: false });
    expect(falseCell.displayText).toBe("FALSE");
  });

  it("date: round-trips the ISO string verbatim", () => {
    const sheet = createOds().sheets()[0]!;
    const cell = sheet.cell(0, 0);
    cell.value = { kind: "date", value: "2026-07-30" };
    expect(cell.value).toEqual({ kind: "date", value: "2026-07-30" });
  });

  it("time: round-trips the string verbatim, without validation or reformatting", () => {
    const sheet = createOds().sheets()[0]!;
    const cell = sheet.cell(0, 0);
    cell.value = { kind: "time", value: "13:30:00" };
    expect(cell.value).toEqual({ kind: "time", value: "13:30:00" });
  });

  it("string: round-trips, and writes an explicit office:string-value (not relying on the text:p fallback)", () => {
    const sheet = createOds().sheets()[0]!;
    const cell = sheet.cell(0, 0);
    cell.value = { kind: "string", value: "hello world" };
    expect(cell.value).toEqual({ kind: "string", value: "hello world" });
    // Independent of displayText: overriding the rendered text afterward must not change the underlying value.
    cell.displayText = "something else entirely";
    expect(cell.value).toEqual({ kind: "string", value: "hello world" });
  });

  it("empty: writes no office:value-type at all, and clears any PREVIOUSLY set value attributes when a cell switches kinds", () => {
    const sheet = createOds().sheets()[0]!;
    const cell = sheet.cell(0, 0);
    cell.value = { kind: "number", value: 7 };
    cell.value = { kind: "empty" };
    expect(cell.value).toEqual({ kind: "empty" });
    expect(cell.displayText).toBe("");
  });

  it("switching a cell from number to string leaves no stale office:value behind", () => {
    const sheet = createOds().sheets()[0]!;
    const cell = sheet.cell(0, 0);
    cell.value = { kind: "number", value: 7 };
    cell.value = { kind: "string", value: "seven" };
    expect(cell.value).toEqual({ kind: "string", value: "seven" });
  });

  it('error: has no ODF wire representation, so it deliberately round-trips to a string carrying the SAME text, not back to kind "error"', () => {
    const sheet = createOds().sheets()[0]!;
    const cell = sheet.cell(0, 0);
    cell.value = { kind: "error", value: "#DIV/0!" };
    expect(cell.value).toEqual({ kind: "string", value: "#DIV/0!" });
    expect(cell.displayText).toBe("#DIV/0!");
  });
});

describe("OdsCell.formula", () => {
  it("get/set/remove a verbatim OpenFormula string, independent of value", () => {
    const sheet = createOds().sheets()[0]!;
    const cell = sheet.cell(0, 0);
    expect(cell.formula).toBeUndefined();
    cell.formula = "of:=SUM([.A1:.A3])";
    expect(cell.formula).toBe("of:=SUM([.A1:.A3])");
    cell.value = { kind: "number", value: 6 };
    expect(cell.formula).toBe("of:=SUM([.A1:.A3])");
    expect(cell.value).toEqual({ kind: "number", value: 6 });
    cell.formula = undefined;
    expect(cell.formula).toBeUndefined();
  });
});

describe("OdsCell.displayText", () => {
  it("set/get round-trips a plain string, embedding a newline as a same-paragraph text:line-break", () => {
    const sheet = createOds().sheets()[0]!;
    const cell = sheet.cell(0, 0);
    cell.displayText = "line one\nline two";
    expect(cell.displayText).toBe("line one\nline two");
  });

  it("get() also correctly decodes a cell with MULTIPLE text:p children (a real Calc Alt+Enter line break) joined with \\n -- the shape a real producer, not this editor's own writer, would use", () => {
    const pkg = createOds().toPackage();
    const node = el("table:table-cell", { "office:value-type": "string" }, [
      el("text:p", {}, [txt("line one")]),
      el("text:p", {}, [txt("line two")]),
    ]);
    const cell = new OdsCell(node, pkg);
    expect(cell.displayText).toBe("line one\nline two");
  });

  it("overrides the default display text value() derives, when set afterward", () => {
    const sheet = createOds().sheets()[0]!;
    const cell = sheet.cell(0, 0);
    cell.value = { kind: "number", value: 3.14159 };
    cell.displayText = "3.14";
    expect(cell.displayText).toBe("3.14");
    // value's own machine value is untouched by a later displayText override.
    expect(cell.value).toEqual({ kind: "number", value: 3.14159 });
  });
});

describe("OdsCell.setStyledRuns", () => {
  it("writes bold/italic runs via the reused odt text-run machinery, and displayText concatenates them", () => {
    const editor = createOds();
    const sheet = editor.sheets()[0]!;
    const cell = sheet.cell(0, 0);
    cell.setStyledRuns([
      { text: "Bold ", bold: true },
      { text: "Italic", italic: true },
    ]);
    expect(cell.displayText).toBe("Bold Italic");
  });

  it("interns a text-family automatic style for the styled run, appended (not replacing anything) to office:automatic-styles", () => {
    const editor = createOds();
    const sheet = editor.sheets()[0]!;
    sheet.cell(0, 0).setStyledRuns([{ text: "Bold", bold: true }]);
    const contentPart = editor.toPackage().parts["content.xml"];
    const root =
      contentPart?.kind === "xml"
        ? contentPart.nodes.find((n) => n.type === "element")
        : undefined;
    const automaticStyles =
      root?.type === "element"
        ? root.children.find(
            (c) => c.type === "element" && c.tag === "office:automatic-styles",
          )
        : undefined;
    const textStyles =
      automaticStyles?.type === "element"
        ? automaticStyles.children.filter(
            (c) =>
              c.type === "element" &&
              c.tag === "style:style" &&
              c.attributes.some(
                (a) => a.name === "style:family" && a.value === "text",
              ),
          )
        : [];
    expect(textStyles.length).toBeGreaterThan(0);
  });

  it("replaces any prior plain displayText/value content outright, not additively", () => {
    const sheet = createOds().sheets()[0]!;
    const cell = sheet.cell(0, 0);
    cell.value = { kind: "string", value: "old text" };
    cell.setStyledRuns([{ text: "new text" }]);
    expect(cell.displayText).toBe("new text");
  });
});
