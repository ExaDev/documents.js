import { describe, expect, it } from "vitest";
import type { ContentSheet, ContentSheetCell } from "document-schema.js";
import {
  buildThreadedCommentElements,
  buildThreadedCommentsRoot,
  sheetHasComments,
  threadedCommentId,
} from "./comments-write";

const EMPTY_PRINT_SETTINGS = {
  pageSize: { widthPt: 612, heightPt: 792 },
  margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
  gridlines: false,
  headers: false,
  pageOrder: "downThenOver" as const,
};

function sheet(cells: ContentSheetCell[]): ContentSheet {
  return {
    name: "Sheet1",
    cells,
    columns: [],
    rows: [],
    images: [],
    printSettings: EMPTY_PRINT_SETTINGS,
  };
}

function numberCell(
  row: number,
  column: number,
  value: number,
  extra: Partial<ContentSheetCell> = {},
): ContentSheetCell {
  return {
    row,
    column,
    value: { kind: "number", value },
    displayText: String(value),
    ...extra,
  };
}

describe("threadedCommentId", () => {
  it("formats the counter as zero-padded, UPPERCASE hex inside the braced GUID shape", () => {
    expect(threadedCommentId(0)).toBe("{00000000-0000-0000-0000-000000000000}");
    // 10 in hex is "a" -- exercises the uppercase-vs-lowercase distinction the digits 0-9 alone cannot.
    expect(threadedCommentId(10)).toBe(
      "{00000000-0000-0000-0000-00000000000A}",
    );
  });
});

describe("sheetHasComments", () => {
  it("is false for a sheet with no cell comments at all", () => {
    expect(sheetHasComments(sheet([numberCell(0, 0, 1)]))).toBe(false);
  });

  it("is true when any cell carries a comment", () => {
    expect(
      sheetHasComments(
        sheet([numberCell(0, 0, 1, { comment: { text: "note" } })]),
      ),
    ).toBe(true);
  });
});

describe("buildThreadedCommentElements", () => {
  it("assigns sequential, increasing ids across two separately-commented cells, not just within one thread", () => {
    const s = sheet([
      numberCell(0, 0, 1, { comment: { text: "first" } }),
      numberCell(1, 0, 2, { comment: { text: "second" } }),
    ]);
    const elements = buildThreadedCommentElements(s);
    expect(
      elements.map((e) => e.attributes.find((a) => a.name === "id")?.value),
    ).toEqual([
      "{00000000-0000-0000-0000-000000000000}",
      "{00000000-0000-0000-0000-000000000001}",
    ]);
  });

  it("writes a reply immediately after its own root, carrying the root's own id as parentId", () => {
    const s = sheet([
      numberCell(0, 0, 1, {
        comment: { text: "root", replies: [{ text: "reply" }] },
      }),
    ]);
    const elements = buildThreadedCommentElements(s);
    expect(elements).toHaveLength(2);
    const rootId = elements[0]?.attributes.find((a) => a.name === "id")?.value;
    const replyParentId = elements[1]?.attributes.find(
      (a) => a.name === "parentId",
    )?.value;
    expect(replyParentId).toBe(rootId);
    expect(elements[0]?.attributes.some((a) => a.name === "parentId")).toBe(
      false,
    );
  });
});

describe("buildThreadedCommentsRoot", () => {
  it("declares the [MS-XLSX] threaded-comments namespace on the root element", () => {
    const root = buildThreadedCommentsRoot(sheet([]));
    expect(root.tag).toBe("ThreadedComments");
    expect(root.attributes).toEqual([
      {
        name: "xmlns",
        value:
          "http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments",
      },
    ]);
  });
});
