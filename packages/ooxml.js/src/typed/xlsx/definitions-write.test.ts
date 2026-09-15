import type { ContentDefinedName, DefinitionsTable } from "document-schema.js";
import { describe, expect, it } from "vitest";
import {
  buildNameDefinedNameElements,
  buildTablePart,
  collectTableEntries,
} from "./definitions-write";

describe("collectTableEntries", () => {
  it("skips a non-table entry entirely, never validating its own fields, and returns only the table entries", () => {
    const definitions: DefinitionsTable = {
      irrelevant: { kind: "something-else" },
      real: {
        kind: "table",
        name: "MyTable",
        ref: "A1:B2",
        sheet: "Sheet1",
        columns: ["Col1", "Col2"],
      },
    };

    const entries = collectTableEntries(definitions);

    expect(entries).toEqual([
      {
        name: "MyTable",
        ref: "A1:B2",
        sheet: "Sheet1",
        columns: ["Col1", "Col2"],
      },
    ]);
  });

  it("throws naming the field and the entry kind when a required string field is missing", () => {
    const definitions: DefinitionsTable = {
      broken: { kind: "table", ref: "A1:B2", sheet: "Sheet1", columns: [] },
    };
    expect(() => {
      collectTableEntries(definitions);
    }).toThrow(/a "table" definitions entry's "name" field must be a string/);
  });

  it("throws naming the ref field specifically when it is missing, not the name field", () => {
    const definitions: DefinitionsTable = {
      broken: { kind: "table", name: "T", sheet: "Sheet1", columns: [] },
    };
    expect(() => {
      collectTableEntries(definitions);
    }).toThrow(/a "table" definitions entry's "ref" field must be a string/);
  });

  it("throws naming the sheet field specifically when it is missing, not the ref field", () => {
    const definitions: DefinitionsTable = {
      broken: { kind: "table", name: "T", ref: "A1:B2", columns: [] },
    };
    expect(() => {
      collectTableEntries(definitions);
    }).toThrow(/a "table" definitions entry's "sheet" field must be a string/);
  });

  it("throws naming the field and the entry kind when the columns field is not present", () => {
    const definitions: DefinitionsTable = {
      broken: { kind: "table", name: "T", ref: "A1:B2", sheet: "Sheet1" },
    };
    expect(() => {
      collectTableEntries(definitions);
    }).toThrow(
      /a "table" definitions entry's "columns" field must be a string array/,
    );
  });

  it("rejects a columns array carrying even one non-string entry, not just an array of entirely non-strings", () => {
    const definitions: DefinitionsTable = {
      broken: {
        kind: "table",
        name: "T",
        ref: "A1:B2",
        sheet: "Sheet1",
        columns: ["Col1", 42],
      },
    };
    expect(() => {
      collectTableEntries(definitions);
    }).toThrow(/"columns" field must be a string array/);
  });
});

describe("buildNameDefinedNameElements", () => {
  it("records a defined truthy scopeSheetIndex itself in carriedNames, not the empty-string fallback", () => {
    const names: ContentDefinedName[] = [
      { name: "Scoped", refersTo: "Sheet1!A1", scopeSheetIndex: 2 },
    ];
    const carriedNames = new Set<string>();

    buildNameDefinedNameElements(names, carriedNames);

    expect(carriedNames.has("Scoped@2")).toBe(true);
    expect(carriedNames.has("Scoped@")).toBe(false);
  });

  it("falls back to an empty-string scope suffix, not a placeholder, when scopeSheetIndex is absent", () => {
    const names: ContentDefinedName[] = [
      { name: "Global", refersTo: "Sheet1!A1" },
    ];
    const carriedNames = new Set<string>();

    buildNameDefinedNameElements(names, carriedNames);

    expect(carriedNames.has("Global@")).toBe(true);
  });
});

describe("buildTablePart", () => {
  it("builds CT_Table's required attributes, an autoFilter over the entry's own ref, and one tableColumn per column in order with 1-based ids", () => {
    const table = buildTablePart(
      {
        name: "Sales",
        ref: "A1:B3",
        sheet: "Sheet1",
        columns: ["Region", "Total"],
      },
      5,
    );

    expect(table.tag).toBe("table");
    expect(table.attributes).toContainEqual({
      name: "xmlns",
      value: "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    });
    expect(table.attributes).toContainEqual({ name: "id", value: "5" });
    expect(table.attributes).toContainEqual({
      name: "totalsRowShown",
      value: "0",
    });

    const [autoFilter, tableColumns] = table.children;
    if (autoFilter?.type !== "element" || tableColumns?.type !== "element") {
      throw new Error("expected both children to be elements");
    }
    expect(autoFilter.tag).toBe("autoFilter");
    expect(autoFilter.attributes).toContainEqual({
      name: "ref",
      value: "A1:B3",
    });

    expect(tableColumns.tag).toBe("tableColumns");
    expect(tableColumns.attributes).toContainEqual({
      name: "count",
      value: "2",
    });
    const columnIds = tableColumns.children.map((child) =>
      child.type === "element"
        ? child.attributes.find((a) => a.name === "id")?.value
        : undefined,
    );
    expect(columnIds).toEqual(["1", "2"]);
  });
});
