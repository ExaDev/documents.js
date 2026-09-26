import { describe, expect, it } from "vitest";
import { assembleTree } from "./factor-styles";
import { flattenTree } from "./flatten";
import {
  type ContentDocument,
  ContentSectionSchema,
  isContentBlock,
} from "./content";
import {} from "./content-vocabulary";
import {} from "./content-sheet";

describe("ContentSection.breakType (the section-break kind)", () => {
  it("accepts each break kind a section can begin with, and rejects anything else", () => {
    for (const breakType of [
      "nextPage",
      "continuous",
      "evenPage",
      "oddPage",
    ] as const) {
      expect(
        ContentSectionSchema.parse({
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [],
          breakType,
        }),
      ).toMatchObject({ breakType });
    }
    expect(() =>
      ContentSectionSchema.parse({
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
        blocks: [],
        breakType: "column",
      }),
    ).toThrow();
  });

  it("stays optional, so a section spelling no break kind parses exactly as before", () => {
    const section = ContentSectionSchema.parse({
      pageSize: { widthPt: 612, heightPt: 792 },
      margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
      blocks: [],
    });
    expect(section).not.toHaveProperty("breakType");
  });

  it("rides the package boundary untouched, since the section descriptor is built by omit+extend", () => {
    const content: ContentDocument = {
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [],
          breakType: "continuous",
        },
      ],
    };
    const flat = flattenTree(assembleTree(content));
    expect(flat).toMatchObject({
      kind: "wordprocessing",
      sections: [{ breakType: "continuous" }],
    });
  });
});

describe("isContentBlock's per-kind guards reject a partly-invalid array, not just a wholly-invalid one", () => {
  it("rejects a paragraph whose runs array has even one invalid run", () => {
    expect(
      isContentBlock({
        kind: "paragraph",
        runs: [{ text: "ok" }, { text: 5 }],
      }),
    ).toBe(false);
  });

  it("rejects a paragraph whose constructs array has even one invalid extent", () => {
    expect(
      isContentBlock({
        kind: "paragraph",
        runs: [{ text: "ok" }],
        constructs: [
          {
            descriptor: { kind: "anchor", anchorType: "bookmark", name: "a" },
            startRun: 0,
            endRun: 1,
          },
          { startRun: 0, endRun: 1 },
        ],
      }),
    ).toBe(false);
  });

  it("rejects a table whose rows array has even one invalid row", () => {
    expect(
      isContentBlock({
        kind: "table",
        rows: [
          { cells: [{ blocks: [] }] },
          { cells: [{ blocks: [{ kind: "bogus" }] }] },
        ],
        columns: [{ widthPt: 10 }],
      }),
    ).toBe(false);
  });

  it("rejects a table whose columns array has even one entry with a non-number widthPt", () => {
    expect(
      isContentBlock({
        kind: "table",
        rows: [{ cells: [{ blocks: [] }] }],
        columns: [{ widthPt: 10 }, { widthPt: "20" }],
      }),
    ).toBe(false);
  });

  it("rejects a table whose columns array has even one entry with a non-boolean isHeader", () => {
    expect(
      isContentBlock({
        kind: "table",
        rows: [{ cells: [{ blocks: [] }] }],
        columns: [{ widthPt: 10, isHeader: "yes" }],
      }),
    ).toBe(false);
  });

  it("accepts a table column stating isHeader true, and one stating no isHeader at all", () => {
    expect(
      isContentBlock({
        kind: "table",
        rows: [{ cells: [{ blocks: [] }, { blocks: [] }] }],
        columns: [{ widthPt: 10, isHeader: true }, { widthPt: 20 }],
      }),
    ).toBe(true);
  });

  it("rejects a table row whose cells array has even one invalid cell", () => {
    expect(
      isContentBlock({
        kind: "table",
        rows: [
          {
            cells: [{ blocks: [] }, { blocks: [{ kind: "bogus" }] }],
          },
        ],
        columns: [{ widthPt: 10 }, { widthPt: 20 }],
      }),
    ).toBe(false);
  });

  it("rejects a table cell whose blocks array has even one invalid block", () => {
    expect(
      isContentBlock({
        kind: "table",
        rows: [
          {
            cells: [
              {
                blocks: [{ kind: "paragraph", runs: [] }, { kind: "bogus" }],
              },
            ],
          },
        ],
        columns: [{ widthPt: 10 }],
      }),
    ).toBe(false);
  });

  it("rejects an image whose base64 or heightPt is not the expected primitive type, even when every other field is valid", () => {
    expect(
      isContentBlock({
        kind: "image",
        format: "png",
        base64: 5,
        widthPt: 1,
        heightPt: 1,
      }),
    ).toBe(false);
    expect(
      isContentBlock({
        kind: "image",
        format: "png",
        base64: "AA==",
        widthPt: 1,
        heightPt: "1",
      }),
    ).toBe(false);
  });

  it("rejects a table row whose heightPt is present but not a number", () => {
    expect(
      isContentBlock({
        kind: "table",
        rows: [{ cells: [{ blocks: [] }], heightPt: "10" }],
        columns: [],
      }),
    ).toBe(false);
  });
});
