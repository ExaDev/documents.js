import type { ContentDocument, ContentTableCell } from "document-schema.js";
import { describe, expect, it } from "vitest";
import {
  cellText,
  paragraphAlignment,
  readWithDiagnostics,
  sectionOf,
  wordprocessingOf,
} from "./structure-fixtures";

// Direct coverage for the read-result helpers in src/test-support/structure-fixtures.ts themselves: every document read-structure.test.ts and its split siblings build is a well-formed "wordprocessing" document with at least one section, and every cell they inspect holds a single paragraph, so none of them exercises these helpers' own guard branches or their own discrimination between block/run shapes.

describe("readWithDiagnostics", () => {
  it("carries an empty diagnostics array, not just a non-empty one, when nothing is reported", () => {
    const { diagnostics } = readWithDiagnostics([]);
    expect(diagnostics).toEqual([]);
  });
});

describe("wordprocessingOf", () => {
  it("throws naming the document as expected to be wordprocessing when it is not", () => {
    const document = {
      kind: "spreadsheet",
      metadata: {},
      sheets: [],
    } as unknown as ContentDocument;
    expect(() => wordprocessingOf(document)).toThrow(
      "expected a wordprocessing document",
    );
  });
});

describe("sectionOf", () => {
  it("throws naming a section as expected when the document carries none", () => {
    const document: ContentDocument = {
      kind: "wordprocessing",
      metadata: {},
      sections: [],
    };
    expect(() => sectionOf(document)).toThrow("expected a section");
  });
});

describe("cellText", () => {
  it("drops a non-paragraph block rather than reading through it", () => {
    const cell: ContentTableCell = {
      blocks: [
        { kind: "pageBreak" },
        { kind: "paragraph", runs: [{ text: "kept" }] },
      ],
    };
    expect(cellText(cell)).toBe("kept");
  });

  it("joins several runs' text directly with no separator between them", () => {
    const cell: ContentTableCell = {
      blocks: [{ kind: "paragraph", runs: [{ text: "a" }, { text: "b" }] }],
    };
    expect(cellText(cell)).toBe("ab");
  });
});

describe("paragraphAlignment", () => {
  it("answers undefined for a cell with no blocks at all", () => {
    const cell: ContentTableCell = { blocks: [] };
    expect(paragraphAlignment(cell)).toBeUndefined();
  });

  it("answers undefined when the first block is not a paragraph", () => {
    const cell: ContentTableCell = { blocks: [{ kind: "pageBreak" }] };
    expect(paragraphAlignment(cell)).toBeUndefined();
  });

  it("reads the first paragraph block's own alignment", () => {
    const cell: ContentTableCell = {
      blocks: [
        { kind: "paragraph", runs: [{ text: "x" }], alignment: "center" },
      ],
    };
    expect(paragraphAlignment(cell)).toBe("center");
  });
});
