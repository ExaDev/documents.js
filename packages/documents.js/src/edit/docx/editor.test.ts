import { decodePackage, type XmlElement } from "ooxml.js";
import { describe, expect, it } from "vitest";
import { minimalDocxBytes, minimalDocxPackage } from "../../test-support/docx";
import { assertPartsUnchangedExcept } from "../../test-support/fidelity";
import type {
  ContentControlLock,
  ContentControlType,
  ProvenanceChange,
} from "document-schema.js";
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
    // Round-tripping through encode/decode must still succeed — proves sectPr is still last.
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

// ExaDev/documents.js#933: an already-open live editor previously exposed no metadata setter at all — a caller had to re-decode the whole document through setDocumentMetadata/patchDocxMetadata (src/metadata/write.ts) to change it, discarding every other pending edit made through the SAME editor instance. `editor.metadata = {...}` patches the live package directly, the same primitive patchDocxMetadata itself now shares (src/metadata/core-patch.ts's own patchOoxmlCorePropertiesOnPackage).
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

describe("DocxBody region scaffolds", () => {
  function bodyElementOf(editor: ReturnType<typeof createDocx>): XmlElement {
    const pkg = editor.toPackage();
    const part = pkg.parts["word/document.xml"];
    if (part?.kind !== "xml") {
      throw new Error("expected document.xml");
    }
    const root = part.nodes.find((n): n is XmlElement => n.type === "element");
    const body = root?.children.find(
      (n): n is XmlElement => n.type === "element" && n.tag === "w:body",
    );
    if (body === undefined) {
      throw new Error("expected w:body");
    }
    return body;
  }

  function lastSdtPrTags(
    editor: ReturnType<typeof createDocx>,
  ): { tag: string; val: string | undefined }[] {
    const body = bodyElementOf(editor);
    const sdt = body.children.findLast(
      (n): n is XmlElement => n.type === "element" && n.tag === "w:sdt",
    );
    const sdtPr = sdt?.children.find(
      (n): n is XmlElement => n.type === "element" && n.tag === "w:sdtPr",
    );
    if (sdtPr === undefined) {
      throw new Error("expected w:sdtPr");
    }
    // One nesting level deep covers the index control, whose gallery element sits inside w:docPartObj rather than directly under w:sdtPr.
    return sdtPr.children
      .filter((n): n is XmlElement => n.type === "element")
      .flatMap((child) => [
        {
          tag: child.tag,
          val: child.attributes.find((a) => a.name === "w:val")?.value,
        },
        ...child.children
          .filter((n): n is XmlElement => n.type === "element")
          .map((grandchild) => ({
            tag: grandchild.tag,
            val: grandchild.attributes.find((a) => a.name === "w:val")?.value,
          })),
      ]);
  }

  it("writes every SDT control type's own type element", () => {
    const cases: readonly [
      ContentControlType,
      { tag: string; val: string | undefined },
    ][] = [
      ["plainText", { tag: "w:text", val: undefined }],
      ["date", { tag: "w:date", val: undefined }],
      ["picture", { tag: "w:picture", val: undefined }],
      ["group", { tag: "w:group", val: undefined }],
      ["repeatingSection", { tag: "w:repeatingSection", val: undefined }],
      ["index", { tag: "w:docPartGallery", val: "Table of Contents" }],
      ["richText", { tag: "w:id", val: "1" }],
    ];
    for (const [controlType, expected] of cases) {
      const editor = createDocx();
      editor.body.openContentControlRegion({
        kind: "contentControl",
        controlType,
      });
      editor.body.closeRegion();
      const tags = lastSdtPrTags(editor);
      expect(
        tags.some((t) => t.tag === expected.tag && t.val === expected.val),
        `${controlType} -> ${expected.tag}`,
      ).toBe(true);
    }
  });

  it("writes a comboBox's options as list items and a dropDown's as a list", () => {
    for (const controlType of ["comboBox", "dropDown"] as const) {
      const editor = createDocx();
      editor.body.openContentControlRegion({
        kind: "contentControl",
        controlType,
        options: ["one", "two"],
      });
      editor.body.closeRegion();
      const expectedTag =
        controlType === "comboBox" ? "w:comboBox" : "w:dropDownList";
      const body = bodyElementOf(editor);
      const sdt = body.children.findLast(
        (n): n is XmlElement => n.type === "element" && n.tag === "w:sdt",
      );
      const list = sdt?.children
        .find(
          (n): n is XmlElement => n.type === "element" && n.tag === "w:sdtPr",
        )
        ?.children.find(
          (n): n is XmlElement => n.type === "element" && n.tag === expectedTag,
        );
      expect(list?.children).toHaveLength(2);
      expect(
        list?.children
          .find(
            (n): n is XmlElement =>
              n.type === "element" && n.tag === "w:listItem",
          )
          ?.attributes.find((a) => a.name === "w:displayText")?.value,
      ).toBe("one");
    }
  });

  it("writes each lock spelling, a date control's value, and a checkbox's state", () => {
    const locks: readonly [ContentControlLock, string][] = [
      ["content", "contentLocked"],
      ["container", "sdtLocked"],
      ["both", "sdtContentLocked"],
    ];
    for (const [lock, expected] of locks) {
      const editor = createDocx();
      editor.body.openContentControlRegion({
        kind: "contentControl",
        controlType: "richText",
        lock,
      });
      editor.body.closeRegion();
      expect(
        lastSdtPrTags(editor).some(
          (t) => t.tag === "w:lock" && t.val === expected,
        ),
        lock,
      ).toBe(true);
    }

    const dated = createDocx();
    dated.body.openContentControlRegion({
      kind: "contentControl",
      controlType: "date",
      value: "2024-05-06T07:08:09Z",
    });
    dated.body.closeRegion();
    const body = bodyElementOf(dated);
    const sdt = body.children.findLast(
      (n): n is XmlElement => n.type === "element" && n.tag === "w:sdt",
    );
    const dateElement = sdt?.children
      .find((n): n is XmlElement => n.type === "element" && n.tag === "w:sdtPr")
      ?.children.find(
        (n): n is XmlElement => n.type === "element" && n.tag === "w:date",
      );
    expect(
      dateElement?.attributes.find((a) => a.name === "w:fullDate")?.value,
    ).toBe("2024-05-06T07:08:09Z");

    const checked = createDocx();
    checked.body.openContentControlRegion({
      kind: "contentControl",
      controlType: "checkbox",
      checked: true,
    });
    checked.body.closeRegion();
    expect(
      lastSdtPrTags(checked).some(
        (t) => t.tag === "w:checked" && t.val === "true",
      ),
    ).toBe(true);
    const unchecked = createDocx();
    unchecked.body.openContentControlRegion({
      kind: "contentControl",
      controlType: "checkbox",
    });
    unchecked.body.closeRegion();
    expect(
      lastSdtPrTags(unchecked).some(
        (t) => t.tag === "w:checked" && t.val === "false",
      ),
    ).toBe(true);
  });

  it("writes alias and tag, and each provenance change kind with author and date", () => {
    const editor = createDocx();
    editor.body.openContentControlRegion({
      kind: "contentControl",
      controlType: "richText",
      alias: "Label",
      tag: "machine",
    });
    editor.body.closeRegion();
    const tags = lastSdtPrTags(editor);
    expect(tags.some((t) => t.tag === "w:alias" && t.val === "Label")).toBe(
      true,
    );
    expect(tags.some((t) => t.tag === "w:tag" && t.val === "machine")).toBe(
      true,
    );

    const changes: readonly [ProvenanceChange, string][] = [
      ["insertion", "w:ins"],
      ["deletion", "w:del"],
      ["moveFrom", "w:moveFrom"],
      ["moveTo", "w:moveTo"],
    ];
    for (const [change, expectedTag] of changes) {
      const prov = createDocx();
      expect(
        prov.body.openProvenanceRegion({
          kind: "provenance",
          change,
          author: "Jane",
          dateIso: "2024-05-06T07:08:09Z",
        }),
        change,
      ).toBe(true);
      prov.body.closeRegion();
      const body = bodyElementOf(prov);
      const region = body.children.findLast(
        (n): n is XmlElement => n.type === "element" && n.tag === expectedTag,
      );
      expect(region?.attributes).toContainEqual({
        name: "w:author",
        value: "Jane",
      });
      expect(region?.attributes).toContainEqual({
        name: "w:date",
        value: "2024-05-06T07:08:09Z",
      });
    }

    const refused = createDocx();
    expect(
      refused.body.openProvenanceRegion({
        kind: "provenance",
        change: "formatChange",
      }),
    ).toBe(false);
  });
});
