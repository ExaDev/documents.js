import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import { el, txt } from "../../xml/fragment";
import { parsePackage } from "../../package-io/read";
import {
  assertPackageRoundTrip,
  spreadsheetPackage,
} from "../../test-support/document-tree";
import { readOds, readOdsContent } from "./read";

// This suite reads real, unmodified LibreOffice 26.2-generated .ods fixtures (src/typed/ods/fixtures/*.ods, built via a headless UNO Basic macro driving the SAME UNO calls the Calc UI itself uses — Format > Columns > Width, Format > Rows > Height, Format > Print Areas, Format > Page Style's Sheet tab — never hand-edited afterwards) rather than programmatically reconstructing the expected XML shapes, mirroring readOdtContent's own established convention: this reader's own design brief is explicit that print-settings attribute names and the repeat-row/repeat-column mechanism must each be proven against genuine producer output, not just this package's own idea of what that output looks like. A handful of narrow scope-boundary/hazard-proof tests at the end use small, synthetic, hand-built packages instead (via el/txt), since a genuinely million-row repeat isn't something worth shipping as a binary fixture when the exact real repeat count is already established (typed/shared/a1.test.ts, citing a real LibreOffice-shipped .ots template).

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function loadFixture(name: string): Package {
  const bytes = new Uint8Array(readFileSync(join(FIXTURES_DIR, name)));
  return parsePackage(bytes);
}

describe("readOds: the package-native reader over the same real fixtures", () => {
  it("assembles kitchen-sink.ods into a spreadsheet package whose tree flattens back to readOdsContent output exactly", () => {
    const pkg = loadFixture("kitchen-sink.ods");
    const content = readOdsContent(pkg);
    const documentPackage = readOds(pkg);

    expect(documentPackage.kind).toBe("spreadsheet");
    expect(documentPackage.metadata).toEqual(content.metadata);
    expect(documentPackage.children).toHaveLength(content.sheets.length);
    // The round trip compares against the flat projection (metadata + sheets): the definitions and package-tier residue tables are tree-only, so flattenTree drops them off readOds's own root — the fixture's own residue rows are pinned in the residue describe below.
    assertPackageRoundTrip(documentPackage, {
      kind: "spreadsheet",
      metadata: content.metadata,
      sheets: content.sheets,
    });
  });

  it("keeps a sheet's grid and print settings on its group node, since a sheet holds addressable data rather than block flow", () => {
    const pkg = loadFixture("kitchen-sink.ods");
    const content = readOdsContent(pkg);
    const documentPackage = spreadsheetPackage(readOds(pkg));
    const firstSheet = documentPackage.children[0];
    const firstContentSheet = content.sheets[0];
    if (firstSheet === undefined || firstContentSheet === undefined) {
      throw new Error("expected at least one sheet");
    }
    expect(firstSheet.node.kind).toBe("sheet");
    expect(firstSheet.node.name).toBe(firstContentSheet.name);
    expect(firstSheet.node.cells).toEqual(firstContentSheet.cells);
    expect(firstSheet.node.printSettings).toEqual(
      firstContentSheet.printSettings,
    );
    // A sheet group's extent holds no paragraphs at all, so the minting pass has nothing to factor and never stamps a ref on one.
    expect(firstSheet.style).toBeUndefined();
  });

  it("carries a sheet's anchored images and embedded sub-documents as its group's children", () => {
    const pkg = loadFixture("sheet-anchors.ods");
    const content = readOdsContent(pkg);
    const documentPackage = spreadsheetPackage(readOds(pkg));
    const sheet = documentPackage.children[0];
    const contentSheet = content.sheets[0];
    if (sheet === undefined || contentSheet === undefined) {
      throw new Error("expected at least one sheet");
    }
    const images = contentSheet.images;
    const embedded = contentSheet.embeddedObjects ?? [];
    expect(images.length + embedded.length).toBeGreaterThan(0);
    // Images first, then embedded objects — the fixed order flatten's own partition reverses.
    expect(sheet.children).toEqual([...images, ...embedded]);
    assertPackageRoundTrip(documentPackage, {
      kind: "spreadsheet",
      metadata: content.metadata,
      sheets: content.sheets,
    });
  });

  it("round-trips sheet-formula.ods, whose embedded Math object stays one intact leaf carrying its own formula document", () => {
    const pkg = loadFixture("sheet-formula.ods");
    const content = readOdsContent(pkg);
    assertPackageRoundTrip(readOds(pkg), {
      kind: "spreadsheet",
      metadata: content.metadata,
      sheets: content.sheets,
    });
  });

  it("assembles minimal.ods into a package that round-trips identically", () => {
    const pkg = loadFixture("minimal.ods");
    const content = readOdsContent(pkg);
    assertPackageRoundTrip(readOds(pkg), {
      kind: "spreadsheet",
      metadata: content.metadata,
      sheets: content.sheets,
    });
  });
});

describe("readOdsContent: cell comments (ExaDev/documents.js#949, synthetic packages)", () => {
  function annotationPackage(table: XmlElement): Package {
    return {
      parts: {
        "content.xml": {
          kind: "xml",
          nodes: [
            el("office:document-content", {}, [
              el("office:body", {}, [el("office:spreadsheet", {}, [table])]),
            ]),
          ],
        },
      },
    };
  }

  function cellWithAnnotation(
    annotationChildren: readonly XmlElement[],
    valueAttrs: Readonly<Record<string, string>> = {
      "office:value-type": "string",
    },
  ): XmlElement {
    return el("table:table-cell", valueAttrs, [
      el("office:annotation", {}, annotationChildren),
      el("text:p", {}, [txt("42")]),
    ]);
  }

  it("reads a comment's text, author, and timestamp off office:annotation's own dc:creator/dc:date and text:p", () => {
    const table = el("table:table", { "table:name": "Sheet1" }, [
      el("table:table-row", {}, [
        cellWithAnnotation([
          el("dc:creator", {}, [txt("Alice")]),
          el("dc:date", {}, [txt("2026-01-02T03:04:05")]),
          el("text:p", {}, [txt("A real note")]),
        ]),
      ]),
    ]);
    const { sheets } = readOdsContent(annotationPackage(table));
    expect(sheets[0]?.cells[0]?.comment).toEqual({
      text: "A real note",
      author: "Alice",
      createdAt: "2026-01-02T03:04:05",
    });
  });

  it("reads a comment with no author and no date as text alone, never fabricating either", () => {
    const table = el("table:table", { "table:name": "Sheet1" }, [
      el("table:table-row", {}, [
        cellWithAnnotation([el("text:p", {}, [txt("No metadata")])]),
      ]),
    ]);
    const { sheets } = readOdsContent(annotationPackage(table));
    expect(sheets[0]?.cells[0]?.comment).toEqual({ text: "No metadata" });
  });

  it("joins multiple text:p children with a bare newline, the identical convention readCellText already uses for a cell's own multi-paragraph text", () => {
    const table = el("table:table", { "table:name": "Sheet1" }, [
      el("table:table-row", {}, [
        cellWithAnnotation([
          el("text:p", {}, [txt("First paragraph")]),
          el("text:p", {}, [txt("Second paragraph")]),
        ]),
      ]),
    ]);
    const { sheets } = readOdsContent(annotationPackage(table));
    expect(sheets[0]?.cells[0]?.comment?.text).toBe(
      "First paragraph\nSecond paragraph",
    );
  });

  it("resolves a text:line-break WITHIN one annotation paragraph to the same '\\n' a paragraph boundary produces", () => {
    const table = el("table:table", { "table:name": "Sheet1" }, [
      el("table:table-row", {}, [
        cellWithAnnotation([
          el("text:p", {}, [
            txt("Line one"),
            el("text:line-break"),
            txt("Line two"),
          ]),
        ]),
      ]),
    ]);
    const { sheets } = readOdsContent(annotationPackage(table));
    expect(sheets[0]?.cells[0]?.comment?.text).toBe("Line one\nLine two");
  });

  it("materialises an empty cell for a comment anchored to a position with no office:value-type and no rendered text at all", () => {
    const table = el("table:table", { "table:name": "Sheet1" }, [
      el("table:table-row", {}, [
        el("table:table-cell", {}, [
          el("office:annotation", {}, [
            el("text:p", {}, [txt("Floating note")]),
          ]),
        ]),
      ]),
    ]);
    const { sheets } = readOdsContent(annotationPackage(table));
    expect(sheets[0]?.cells).toEqual([
      {
        row: 0,
        column: 0,
        value: { kind: "empty" },
        displayText: "",
        comment: { text: "Floating note" },
      },
    ]);
  });

  it("leaves comment undefined for an ordinary cell carrying no office:annotation at all", () => {
    const table = el("table:table", { "table:name": "Sheet1" }, [
      el("table:table-row", {}, [
        el("table:table-cell", { "office:value-type": "string" }, [
          el("text:p", {}, [txt("Plain cell")]),
        ]),
      ]),
    ]);
    const { sheets } = readOdsContent(annotationPackage(table));
    expect(sheets[0]?.cells[0]?.comment).toBeUndefined();
  });
});

describe("readOdsContent: data validation (ExaDev/documents.js#925, synthetic packages)", () => {
  function odsValidationPackage(...children: readonly XmlElement[]): Package {
    return {
      parts: {
        "content.xml": {
          kind: "xml",
          nodes: [
            el("office:document-content", {}, [
              el("office:body", {}, [
                el("office:spreadsheet", {}, [...children]),
              ]),
            ]),
          ],
        },
      },
    };
  }

  function contentValidations(
    ...validations: readonly XmlElement[]
  ): XmlElement {
    return el("table:content-validations", {}, [...validations]);
  }

  it("attaches a validation rule to every cell that references its own table:content-validation-name", () => {
    const table = el("table:table", { "table:name": "Sheet1" }, [
      el("table:table-row", {}, [
        el(
          "table:table-cell",
          {
            "office:value-type": "float",
            "office:value": "5",
            "table:content-validation-name": "val1",
          },
          [el("text:p", {}, [txt("5")])],
        ),
      ]),
    ]);
    const pkg = odsValidationPackage(
      contentValidations(
        el("table:content-validation", {
          "table:name": "val1",
          "table:condition":
            "of:cell-content-is-whole-number() and cell-content()>=1",
        }),
      ),
      table,
    );
    const { sheets } = readOdsContent(pkg);
    expect(sheets[0]?.dataValidations).toEqual([
      {
        type: "whole",
        operator: "greaterThanOrEqual",
        formula1: "1",
        allowBlank: true,
        ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
      },
    ]);
  });

  it("collects every referencing cell's own position into that rule's ranges, one 1x1 range per cell", () => {
    const table = el("table:table", { "table:name": "Sheet1" }, [
      el("table:table-row", {}, [
        el("table:table-cell", {
          "office:value-type": "float",
          "office:value": "1",
          "table:content-validation-name": "val1",
        }),
        el("table:table-cell", {
          "office:value-type": "float",
          "office:value": "2",
          "table:content-validation-name": "val1",
        }),
      ]),
    ]);
    const pkg = odsValidationPackage(
      contentValidations(
        el("table:content-validation", {
          "table:name": "val1",
          "table:condition": "of:cell-content-is-whole-number()",
        }),
      ),
      table,
    );
    const { sheets } = readOdsContent(pkg);
    expect(sheets[0]?.dataValidations?.[0]?.ranges).toEqual([
      { startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 },
      { startRow: 0, startColumn: 1, endRow: 0, endColumn: 1 },
    ]);
  });

  it("materialises an empty cell for a validation reference on a cell with no value, formula, or text of its own", () => {
    const table = el("table:table", { "table:name": "Sheet1" }, [
      el("table:table-row", {}, [
        el("table:table-cell", {
          "table:content-validation-name": "val1",
        }),
      ]),
    ]);
    const pkg = odsValidationPackage(
      contentValidations(
        el("table:content-validation", {
          "table:name": "val1",
          "table:condition": "of:cell-content-is-whole-number()",
        }),
      ),
      table,
    );
    const { sheets } = readOdsContent(pkg);
    expect(sheets[0]?.cells).toEqual([
      { row: 0, column: 0, value: { kind: "empty" }, displayText: "" },
    ]);
    expect(sheets[0]?.dataValidations?.[0]?.ranges).toEqual([
      { startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 },
    ]);
  });

  it("sets no dataValidations field at all on a sheet whose cells reference none", () => {
    const table = el("table:table", { "table:name": "Sheet1" }, [
      el("table:table-row", {}, [
        el(
          "table:table-cell",
          { "office:value-type": "float", "office:value": "1" },
          [el("text:p", {}, [txt("1")])],
        ),
      ]),
    ]);
    const { sheets } = readOdsContent(odsValidationPackage(table));
    expect(sheets[0]?.dataValidations).toBeUndefined();
  });

  it("a validation-name reference with no matching definition contributes nothing to dataValidations, rather than throwing", () => {
    const table = el("table:table", { "table:name": "Sheet1" }, [
      el("table:table-row", {}, [
        el(
          "table:table-cell",
          {
            "office:value-type": "float",
            "office:value": "1",
            "table:content-validation-name": "does-not-exist",
          },
          [el("text:p", {}, [txt("1")])],
        ),
      ]),
    ]);
    const { sheets } = readOdsContent(odsValidationPackage(table));
    expect(sheets[0]?.dataValidations).toBeUndefined();
  });
});

describe("readOdsContent: conditional formatting wiring (ExaDev/documents.js#1075, synthetic packages) — conditional-format.test.ts covers the reading logic itself in full; this block proves readOdsContent actually calls it and routes the two outcomes correctly, not just that the reader function works in isolation", () => {
  function conditionalFormatsPackage(table: XmlElement): Package {
    return {
      parts: {
        "content.xml": {
          kind: "xml",
          nodes: [
            el("office:document-content", {}, [
              el("office:body", {}, [el("office:spreadsheet", {}, [table])]),
            ]),
          ],
        },
      },
    };
  }

  it("sets sheet.conditionalFormats from a table's own calcext:conditional-formats", () => {
    const table = el("table:table", { "table:name": "Sheet1" }, [
      el("calcext:conditional-formats", {}, [
        el(
          "calcext:conditional-format",
          { "calcext:target-range-address": "Sheet1.A1:Sheet1.A1" },
          [el("calcext:condition", { "calcext:value": "unique" })],
        ),
      ]),
    ]);
    const { sheets } = readOdsContent(conditionalFormatsPackage(table));
    expect(sheets[0]?.conditionalFormats).toEqual([
      {
        type: "uniqueValues",
        ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
      },
    ]);
  });

  it("sets no conditionalFormats field at all on a sheet with no calcext:conditional-formats element", () => {
    const table = el("table:table", { "table:name": "Sheet1" }, [
      el("table:table-row", {}),
    ]);
    const { sheets } = readOdsContent(conditionalFormatsPackage(table));
    expect(sheets[0]?.conditionalFormats).toBeUndefined();
  });

  it("quarantines an unpromotable rule as whole-element residue instead of double-counting it via the generic vendor-extension sweep", () => {
    const table = el("table:table", { "table:name": "Sheet1" }, [
      el("calcext:conditional-formats", {}, [
        el(
          "calcext:conditional-format",
          { "calcext:target-range-address": "Sheet1.A1:Sheet1.A1" },
          [
            el("calcext:condition", {
              "calcext:value": "formula-is(A1>B1)",
            }),
          ],
        ),
      ]),
    ]);
    const { sheets, source } = readOdsContent(conditionalFormatsPackage(table));
    expect(sheets[0]?.conditionalFormats).toBeUndefined();
    expect(source?.["calcext:conditional-formats"]).toBeDefined();
    expect(source?.["calcext:conditional-formats"]?.xml).toContain(
      "formula-is(A1>B1)",
    );
  });
});

describe("readOdsContent: conditional-format.ods (real LibreOffice output)", () => {
  const { sheets } = readOdsContent(loadFixture("conditional-format.ods"));

  it("promotes the fixture's own >3 cellIs rule, with no style field at all — its apply-style-name references the built-in 'Default' table-cell style, which is genuinely empty (no fo:color/fo:background-color of its own, and the table-cell family default-style carries only text-properties), so there is nothing observable to report", () => {
    expect(sheets[0]?.conditionalFormats).toEqual([
      {
        type: "cellIs",
        ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 1 }],
        operator: "greaterThan",
        formula1: "3",
      },
    ]);
  });
});
