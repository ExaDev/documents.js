import { describe, expect, it } from "vitest";
import type { ContentTable } from "document-schema.js";
import { assertTableObeysGridRule } from "./table-grid";

const EMPTY = { blocks: [] };

describe("assertTableObeysGridRule", () => {
  it("accepts a table whose merged region has block-less covered entries", () => {
    const table: ContentTable = {
      kind: "table",
      columns: [{ widthPt: 10 }, { widthPt: 10 }],
      rows: [{ cells: [{ blocks: [], colSpan: 2 }, EMPTY] }],
    };
    expect(() => {
      assertTableObeysGridRule(table, "entryPoint");
    }).not.toThrow();
  });

  it("names the entry point and states the fault when the table breaks the rule", () => {
    const table: ContentTable = {
      kind: "table",
      columns: [{ widthPt: 10 }, { widthPt: 10 }],
      rows: [
        {
          cells: [
            { blocks: [], colSpan: 2 },
            { blocks: [{ kind: "paragraph", runs: [{ text: "copy" }] }] },
          ],
        },
      ],
    };
    expect(() => {
      assertTableObeysGridRule(table, "entryPoint");
    }).toThrow(
      "entryPoint: table breaks the grid rule (the cell at row 0, column 1 lies inside the merged region anchored at row 0, column 0 but carries content of its own, and a merged region's content belongs to its anchor)",
    );
  });
});
