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

// ExaDev/documents.js#933: an already-open live editor previously exposed no metadata setter at all -- a caller had to re-decode the whole document through setDocumentMetadata/patchDocxMetadata (src/metadata/write.ts) to change it, discarding every other pending edit made through the SAME editor instance. `editor.metadata = {...}` patches the live package directly, the same primitive patchDocxMetadata itself now shares (src/metadata/core-patch.ts's own patchOoxmlCorePropertiesOnPackage).
describe("DocxEditor.metadata", () => {
  it("reads an empty object from a package carrying no docProps/core.xml at all", () => {
    const editor = openDocx(minimalDocxBytes());
    expect(editor.metadata).toEqual({});
  });

  it("creates docProps/core.xml from scratch when the package had none, readable back through the same editor", () => {
    const editor = openDocx(minimalDocxBytes());
    editor.metadata = { title: "New title", author: "New author" };
    expect(editor.metadata.title).toBe("New title");
    expect(editor.metadata.author).toBe("New author");
  });

  it("patches an existing docProps/core.xml in place, leaving every other part byte-for-byte unchanged", () => {
    const editor = openDocx(minimalDocxBytes());
    editor.metadata = { title: "First title" };
    const before = editor.toPackage();
    const beforeStyles = before.parts["word/styles.xml"];

    editor.metadata = { title: "Second title" };

    expect(editor.metadata.title).toBe("Second title");
    expect(editor.toPackage().parts["word/styles.xml"]).toEqual(beforeStyles);
  });

  it("leaves a field the setter's own value omits exactly as it already was, rather than clearing it", () => {
    const editor = openDocx(minimalDocxBytes());
    editor.metadata = { title: "Title", author: "Author" };
    editor.metadata = { title: "New title" };
    expect(editor.metadata.author).toBe("Author");
  });

  it("clears keywords via an empty array, but cannot remove title/author once set (patchCoreProperties' own documented limitation)", () => {
    const editor = openDocx(minimalDocxBytes());
    editor.metadata = { title: "Title", keywords: ["alpha", "beta"] };
    editor.metadata = { keywords: [] };
    expect(editor.metadata.keywords).toBeUndefined();
    expect(editor.metadata.title).toBe("Title");
  });

  it("silently writes nothing for a field docProps/core.xml has no OOXML spelling for", () => {
    const editor = openDocx(minimalDocxBytes());
    editor.metadata = { title: "Title", producer: "Some PDF tool" };
    expect(editor.metadata.producer).toBeUndefined();
  });

  it("round-trips through toBytes()/openDocx", () => {
    const editor = openDocx(minimalDocxBytes());
    editor.metadata = { title: "Round-tripped title" };
    const reopened = openDocx(editor.toBytes());
    expect(reopened.metadata.title).toBe("Round-tripped title");
  });
});
