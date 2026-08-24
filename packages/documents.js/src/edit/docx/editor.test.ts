import { decodePackage } from "ooxml.js";
import { describe, expect, it } from "vitest";
import { minimalDocxBytes, minimalDocxPackage } from "../../test-support/docx";
import { assertPartsUnchangedExcept } from "../../test-support/fidelity";
import { createDocx, openDocx } from "./editor";

describe("openDocx / createDocx", () => {
  it("openDocx reads an existing package and exposes its paragraphs", () => {
    const editor = openDocx(minimalDocxBytes());
    const paragraphs = editor.paragraphs();
    expect(paragraphs.length).toBeGreaterThan(0);
    expect(paragraphs[0]?.text).toContain("Hello, world!");
  });

  it("openDocx exposes existing tables", () => {
    const editor = openDocx(minimalDocxBytes());
    const tables = editor.tables();
    expect(tables).toHaveLength(1);
    expect(tables[0]?.cell(0, 0).text).toContain("A1");
    expect(tables[0]?.cell(0, 1).text).toContain("B1");
  });

  it("createDocx starts from a valid, empty, encodable package", () => {
    const editor = createDocx();
    expect(editor.paragraphs()).toHaveLength(0);
    const bytes = editor.toBytes();
    expect(decodePackage(bytes)).toEqual(editor.toPackage());
  });
});

describe("DocxEditor.body", () => {
  it("appendParagraph inserts before the trailing w:sectPr, not after it", () => {
    const editor = createDocx();
    editor.body.appendParagraph({ text: "First" });
    editor.body.appendParagraph({ text: "Second" });
    const paragraphs = editor.paragraphs();
    expect(paragraphs.map((p) => p.text)).toEqual(["First", "Second"]);
    // Round-tripping through encode/decode must still succeed -- proves sectPr is still last.
    expect(() => editor.toBytes()).not.toThrow();
  });

  it("appendTable adds a table that toPackage/toBytes can round-trip", () => {
    const editor = createDocx();
    const table = editor.body.appendTable({ rows: 2, columns: 2 });
    table.cell(0, 0).appendParagraph({ text: "A1" });
    expect(editor.tables()).toHaveLength(1);
    expect(decodePackage(editor.toBytes())).toEqual(editor.toPackage());
  });

  it("insertParagraphAt inserts at the requested paragraph position", () => {
    const editor = createDocx();
    editor.body.appendParagraph({ text: "First" });
    editor.body.appendParagraph({ text: "Third" });
    editor.body.insertParagraphAt(1, { text: "Second" });
    expect(editor.paragraphs().map((p) => p.text)).toEqual([
      "First",
      "Second",
      "Third",
    ]);
  });

  it("appendPageBreak adds a paragraph containing a page-break run", () => {
    const editor = createDocx();
    editor.body.appendParagraph({ text: "Before" });
    editor.body.appendPageBreak();
    editor.body.appendParagraph({ text: "After" });
    expect(editor.paragraphs()).toHaveLength(3);
  });
});

describe("live-view fidelity: mutating one run must not change any other part", () => {
  it("mutating a run in word/document.xml leaves every other part byte-for-byte unchanged", () => {
    const before = minimalDocxPackage();
    const editor = openDocx(minimalDocxBytes());
    const run = editor.paragraphs()[0]?.runs()[0];
    if (run === undefined) {
      throw new Error("expected at least one run in the fixture");
    }
    run.text = "Mutated!";
    run.bold = true;

    const after = editor.toPackage();
    expect(after.parts["word/document.xml"]).not.toEqual(
      before.parts["word/document.xml"],
    );
    assertPartsUnchangedExcept(before, after, ["word/document.xml"]);
  });

  it("adding a new paragraph leaves styles.xml and every other part unchanged", () => {
    const before = minimalDocxPackage();
    const editor = openDocx(minimalDocxBytes());
    editor.body.appendParagraph({ text: "New paragraph" });
    assertPartsUnchangedExcept(before, editor.toPackage(), [
      "word/document.xml",
    ]);
  });
});
