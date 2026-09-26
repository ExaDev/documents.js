import { describe, expect, it } from "vitest";
import type { ContentBlock, ContentSection } from "document-schema.js";
import { rgbHexToColor } from "document-schema.js";
import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import { attr, childrenWithTag, elementsWithTag, rootElement } from "../util";
import { buildDocxPackageFromContent } from "./write";
import { DocxWriteDiagnosticCodes } from "./diagnostics";
import type { DocxWriteDiagnostic } from "./diagnostics";
function emptyBodySection(): ContentSection {
  return {
    pageSize: { widthPt: 612, heightPt: 792 },
    margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
    blocks: [],
  };
}

describe("buildDocxPackageFromContent: table grid and vertical-merge arithmetic", () => {
  interface TableFixtureCell {
    blocks: ContentBlock[];
    rowSpan?: number;
    colSpan?: number;
    borders?: Extract<
      ContentBlock,
      { kind: "table" }
    >["rows"][number]["cells"][number]["borders"];
  }

  interface TableFixtureRow {
    cells: TableFixtureCell[];
    heightPt?: number;
    isHeader?: boolean;
  }

  // Arbitrary equal-width fallback for tests below that don't care about column widths specifically.
  const DEFAULT_TABLE_COLUMN_WIDTH_PT = 100;

  function tableOf(
    rows: readonly TableFixtureRow[],
    columnWidthsPt: readonly number[] = [
      DEFAULT_TABLE_COLUMN_WIDTH_PT,
      DEFAULT_TABLE_COLUMN_WIDTH_PT,
    ],
  ): Extract<ContentBlock, { kind: "table" }> {
    return {
      kind: "table",
      rows: [...rows],
      columns: columnWidthsPt.map((widthPt) => ({ widthPt })),
    };
  }

  function writtenTable(written: Package): XmlElement {
    const documentRoot = rootElement(written.parts["word/document.xml"]);
    const table =
      documentRoot === undefined
        ? undefined
        : elementsWithTag([documentRoot], "w:tbl")[0];
    if (table === undefined) {
      throw new Error("expected a table");
    }
    return table;
  }

  function cellShapes(
    written: Package,
  ): { span: string | undefined; merge: string | undefined }[][] {
    const rows = elementsWithTag([writtenTable(written)], "w:tr");
    return rows.map((row) =>
      elementsWithTag([row], "w:tc").map((cell) => {
        const tcPr = childrenWithTag(cell, "w:tcPr")[0];
        if (tcPr === undefined) {
          return { span: undefined, merge: undefined };
        }
        const gridSpan = childrenWithTag(tcPr, "w:gridSpan")[0];
        const vMerge = childrenWithTag(tcPr, "w:vMerge")[0];
        return {
          span: gridSpan === undefined ? undefined : attr(gridSpan, "w:val"),
          merge:
            vMerge === undefined
              ? undefined
              : (attr(vMerge, "w:val") ?? "(bare)"),
        };
      }),
    );
  }

  it("restarts a vertical merge's anchor, continues its covered rows, and treats the row after the merge as a fresh anchor", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            tableOf([
              { cells: [{ blocks: [], rowSpan: 2 }, { blocks: [] }] },
              { cells: [{ blocks: [] }, { blocks: [] }] },
              { cells: [{ blocks: [] }, { blocks: [] }] },
            ]),
          ],
        },
      ],
    });
    expect(cellShapes(written)).toEqual([
      [
        { merge: "restart", span: undefined },
        { merge: undefined, span: undefined },
      ],
      [
        { merge: "(bare)", span: undefined },
        { merge: undefined, span: undefined },
      ],
      [
        { merge: undefined, span: undefined },
        { merge: undefined, span: undefined },
      ],
    ]);
  });

  it("continues both columns of two side-by-side vertical merges at their own grid columns", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            tableOf([
              {
                cells: [
                  { blocks: [], rowSpan: 2 },
                  { blocks: [], rowSpan: 2 },
                ],
              },
              { cells: [{ blocks: [] }, { blocks: [] }] },
            ]),
          ],
        },
      ],
    });
    expect(cellShapes(written)).toEqual([
      [
        { merge: "restart", span: undefined },
        { merge: "restart", span: undefined },
      ],
      [
        { merge: "(bare)", span: undefined },
        { merge: "(bare)", span: undefined },
      ],
    ]);
  });

  it("continues a merge at the grid column a leading colSpan anchor skips past", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            tableOf(
              [
                {
                  cells: [
                    { blocks: [], colSpan: 2, rowSpan: 2 },
                    { blocks: [] },
                    { blocks: [], rowSpan: 2 },
                  ],
                },
                { cells: [{ blocks: [] }, { blocks: [] }, { blocks: [] }] },
              ],
              [
                DEFAULT_TABLE_COLUMN_WIDTH_PT,
                DEFAULT_TABLE_COLUMN_WIDTH_PT,
                DEFAULT_TABLE_COLUMN_WIDTH_PT,
              ],
            ),
          ],
        },
      ],
    });
    expect(cellShapes(written)).toEqual([
      [
        { merge: "restart", span: "2" },
        { merge: "restart", span: undefined },
      ],
      [
        { merge: "(bare)", span: "2" },
        { merge: "(bare)", span: undefined },
      ],
    ]);
  });

  it("writes each of a cell's four border edges under its own side tag", () => {
    const border = (style?: "solid" | "dashed" | "dotted" | "double") => ({
      style,
      widthPt: 1,
      color: rgbHexToColor("112233"),
    });
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            tableOf([
              {
                cells: [
                  {
                    blocks: [],
                    borders: {
                      top: border(),
                      left: border("dashed"),
                      bottom: border("dotted"),
                      right: border("double"),
                    },
                  },
                ],
              },
            ]),
          ],
        },
      ],
    });
    const edges = elementsWithTag([writtenTable(written)], "w:tcBorders");
    expect(edges).toHaveLength(1);
    expect(
      edges[0]!.children
        .filter((child): child is XmlElement => child.type === "element")
        .map((child) => [child.tag, attr(child, "w:val"), attr(child, "w:sz")]),
    ).toEqual([
      ["w:top", "single", "8"],
      ["w:left", "dashed", "8"],
      ["w:bottom", "dotted", "8"],
      ["w:right", "double", "8"],
    ]);
  });

  it("writes a row's own height in the trPr/trHeight spelling and the grid's column widths in twips", () => {
    // 72pt and 144pt (double the first), chosen so the two resulting w:gridCol widths below are visibly distinct: 72 * 20 = 1440 twips, 144 * 20 = 2880 twips (20 twips per point, per ECMA-376).
    const FIRST_COLUMN_WIDTH_PT = 72;
    const SECOND_COLUMN_WIDTH_PT = 144;
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            tableOf(
              [{ cells: [{ blocks: [] }], heightPt: 30 }],
              [FIRST_COLUMN_WIDTH_PT, SECOND_COLUMN_WIDTH_PT],
            ),
          ],
        },
      ],
    });
    const table = writtenTable(written);
    const row = elementsWithTag([table], "w:tr")[0]!;
    const trPr = childrenWithTag(row, "w:trPr")[0]!;
    expect(attr(childrenWithTag(trPr, "w:trHeight")[0]!, "w:val")).toBe("600");
    const grid = childrenWithTag(table, "w:tblGrid")[0]!;
    expect(
      elementsWithTag([grid], "w:gridCol").map((col) => attr(col, "w:w")),
    ).toEqual(["1440", "2880"]);
  });

  it("writes a header row as a bare w:tblHeader, after the row's own w:trHeight", () => {
    // The single column's width doesn't matter to this test, which only checks w:trHeight/w:tblHeader markup.
    const ARBITRARY_COLUMN_WIDTH_PT = 72;
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            tableOf(
              [
                { cells: [{ blocks: [] }], heightPt: 30, isHeader: true },
                { cells: [{ blocks: [] }] },
              ],
              [ARBITRARY_COLUMN_WIDTH_PT],
            ),
          ],
        },
      ],
    });
    const rows = elementsWithTag([writtenTable(written)], "w:tr");
    const headerTrPr = childrenWithTag(rows[0]!, "w:trPr")[0]!;
    expect(
      headerTrPr.children
        .filter((child): child is XmlElement => child.type === "element")
        .map((child) => child.tag),
    ).toEqual(["w:trHeight", "w:tblHeader"]);
    expect(
      attr(childrenWithTag(headerTrPr, "w:tblHeader")[0]!, "w:val"),
    ).toBeUndefined();
    expect(childrenWithTag(rows[1]!, "w:trPr")).toHaveLength(0);
  });

  it("writes a header row carrying no height as a w:trPr holding w:tblHeader alone", () => {
    // The single column's width doesn't matter to this test, which only checks w:trPr/w:tblHeader markup.
    const ARBITRARY_COLUMN_WIDTH_PT = 72;
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            tableOf(
              [{ cells: [{ blocks: [] }], isHeader: true }],
              [ARBITRARY_COLUMN_WIDTH_PT],
            ),
          ],
        },
      ],
    });
    const row = elementsWithTag([writtenTable(written)], "w:tr")[0]!;
    const trPr = childrenWithTag(row, "w:trPr")[0]!;
    expect(
      trPr.children
        .filter((child): child is XmlElement => child.type === "element")
        .map((child) => child.tag),
    ).toEqual(["w:tblHeader"]);
  });
});

describe("buildDocxPackageFromContent: tracked-change paragraph marks and ids", () => {
  function bodyParagraphs(written: Package): XmlElement[] {
    const documentRoot = rootElement(written.parts["word/document.xml"]);
    const body =
      documentRoot === undefined
        ? undefined
        : childrenWithTag(documentRoot, "w:body")[0];
    if (body === undefined) {
      throw new Error("expected body");
    }
    return body.children.filter(
      (child): child is XmlElement =>
        child.type === "element" && child.tag === "w:p",
    );
  }

  const insertion = {
    kind: "provenance" as const,
    change: "insertion" as const,
    author: "Editor",
    dateIso: "2026-09-16T10:00:00Z",
  };

  it("marks both the paragraph mark and the runs of every paragraph in a tracked-change extent, minting one id per element", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            { kind: "constructStart", descriptor: insertion },
            { kind: "paragraph", runs: [{ text: "first" }] },
            { kind: "paragraph", runs: [{ text: "second" }] },
            { kind: "constructEnd" },
          ],
        },
      ],
    });
    const paragraphs = bodyParagraphs(written);
    expect(paragraphs).toHaveLength(2);
    const ids: string[] = [];
    for (const paragraph of paragraphs) {
      const pPr = childrenWithTag(paragraph, "w:pPr")[0]!;
      const rPr = childrenWithTag(pPr, "w:rPr")[0]!;
      const markChange = elementsWithTag([rPr], "w:ins")[0]!;
      expect(attr(markChange, "w:author")).toBe("Editor");
      expect(attr(markChange, "w:date")).toBe("2026-09-16T10:00:00Z");
      ids.push(attr(markChange, "w:id") ?? "");
      const runWrapper = childrenWithTag(paragraph, "w:ins")[0]!;
      expect(attr(runWrapper, "w:author")).toBe("Editor");
      ids.push(attr(runWrapper, "w:id") ?? "");
    }
    expect(ids).toEqual(["1", "2", "3", "4"]);
  });

  it("gives a tracked paragraph with no other properties an empty pPr carrying only the change", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            { kind: "constructStart", descriptor: insertion },
            { kind: "paragraph", runs: [{ text: "bare" }] },
            { kind: "constructEnd" },
          ],
        },
      ],
    });
    const paragraph = bodyParagraphs(written)[0]!;
    const pPr = childrenWithTag(paragraph, "w:pPr")[0]!;
    expect(
      pPr.children
        .filter((child): child is XmlElement => child.type === "element")
        .map((child) => child.tag),
    ).toEqual(["w:rPr"]);
  });

  it("falls back to the unknown author spelling when a change carries none, and omits w:date when there is no date", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "constructStart",
              descriptor: {
                ...insertion,
                author: undefined,
                dateIso: undefined,
              },
            },
            { kind: "paragraph", runs: [{ text: "anon" }] },
            { kind: "constructEnd" },
          ],
        },
      ],
    });
    const paragraph = bodyParagraphs(written)[0]!;
    const wrapper = childrenWithTag(paragraph, "w:ins")[0]!;
    expect(attr(wrapper, "w:author")).toBe("Unknown");
    expect(
      wrapper.attributes.find((attribute) => attribute.name === "w:date"),
    ).toBeUndefined();
  });

  it("writes a moveFrom change under its own tag and leaves a formatChange extent's content unwrapped", () => {
    const moveWritten = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "constructStart",
              descriptor: { ...insertion, change: "moveFrom" },
            },
            { kind: "paragraph", runs: [{ text: "moved" }] },
            { kind: "constructEnd" },
          ],
        },
      ],
    });
    const moveParagraph = bodyParagraphs(moveWritten)[0]!;
    expect(childrenWithTag(moveParagraph, "w:moveFrom")).toHaveLength(1);

    const formatWritten = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "constructStart",
              descriptor: { ...insertion, change: "formatChange" },
            },
            {
              kind: "paragraph",
              styleId: "Styled",
              runs: [{ text: "reformatted" }],
            },
            { kind: "constructEnd" },
          ],
        },
      ],
    });
    const formatParagraph = bodyParagraphs(formatWritten)[0]!;
    expect(childrenWithTag(formatParagraph, "w:ins")).toHaveLength(0);
    expect(childrenWithTag(formatParagraph, "w:del")).toHaveLength(0);
    const pPr = childrenWithTag(formatParagraph, "w:pPr")[0]!;
    expect(
      elementsWithTag([pPr], "w:pStyle").map((style) => attr(style, "w:val")),
    ).toEqual(["Styled"]);
    expect(childrenWithTag(pPr, "w:rPr")).toHaveLength(0);
  });

  it("stops a nested formatChange extent from inheriting the outer tracked change's own wrapper", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            { kind: "constructStart", descriptor: insertion },
            {
              kind: "constructStart",
              descriptor: { ...insertion, change: "formatChange" },
            },
            {
              kind: "paragraph",
              styleId: "Styled",
              runs: [{ text: "reformatted" }],
            },
            { kind: "constructEnd" },
            { kind: "constructEnd" },
          ],
        },
      ],
    });
    const paragraph = bodyParagraphs(written)[0]!;
    expect(childrenWithTag(paragraph, "w:ins")).toHaveLength(0);
    const pPr = childrenWithTag(paragraph, "w:pPr")[0]!;
    expect(childrenWithTag(pPr, "w:rPr")).toHaveLength(0);
  });

  it("deletes a tracked deletion's runs through the delText spelling", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "constructStart",
              descriptor: { ...insertion, change: "deletion" },
            },
            { kind: "paragraph", runs: [{ text: "gone" }] },
            { kind: "constructEnd" },
          ],
        },
      ],
    });
    const paragraph = bodyParagraphs(written)[0]!;
    const wrapper = childrenWithTag(paragraph, "w:del")[0]!;
    expect(
      elementsWithTag([wrapper], "w:delText").map((t) =>
        t.children
          .map((child) => (child.type === "text" ? child.value : ""))
          .join(""),
      ),
    ).toEqual(["gone"]);
  });
});

describe("buildDocxPackageFromContent: a table column's own isHeader has no w:tblGrid spelling", () => {
  function tableWithHeaderColumn(
    sourcePath?: string,
  ): Extract<ContentBlock, { kind: "table" }> {
    return {
      kind: "table",
      sourcePath,
      columns: [{ widthPt: 100, isHeader: true }, { widthPt: 100 }],
      rows: [
        { cells: [{ blocks: [] }, { blocks: [] }] },
        { cells: [{ blocks: [] }, { blocks: [] }] },
      ],
    };
  }

  it("does not throw when no onDiagnostic is supplied", () => {
    expect(() =>
      buildDocxPackageFromContent({
        sections: [
          { ...emptyBodySection(), blocks: [tableWithHeaderColumn()] },
        ],
      }),
    ).not.toThrow();
  });

  it("calls onDiagnostic once, with TABLE_HEADER_COLUMN_DROPPED, naming the column's own index", () => {
    const diagnostics: DocxWriteDiagnostic[] = [];
    buildDocxPackageFromContent(
      {
        sections: [
          { ...emptyBodySection(), blocks: [tableWithHeaderColumn()] },
        ],
      },
      {
        onDiagnostic: (diagnostic) => {
          diagnostics.push(diagnostic);
        },
      },
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toEqual({
      code: DocxWriteDiagnosticCodes.TABLE_HEADER_COLUMN_DROPPED,
      severity: "warning",
      message:
        "buildDocxPackageFromContent: table column 0 is a header column, and that is dropped; w:tblGrid has no header-column marker, so the column is written exactly as any other",
    });
  });

  it("passes the table's own sourcePath as the diagnostic's context", () => {
    const contexts: { readonly sourcePath?: string }[] = [];
    buildDocxPackageFromContent(
      {
        sections: [
          {
            ...emptyBodySection(),
            blocks: [tableWithHeaderColumn("body/table[0]")],
          },
        ],
      },
      {
        onDiagnostic: (_diagnostic, context) => {
          contexts.push(context);
        },
      },
    );
    expect(contexts).toEqual([{ sourcePath: "body/table[0]" }]);
  });

  it("still writes the header column's own cells, exactly like any other column", () => {
    const written = buildDocxPackageFromContent({
      sections: [{ ...emptyBodySection(), blocks: [tableWithHeaderColumn()] }],
    });
    const grid = childrenWithTag(
      elementsWithTag(
        [rootElement(written.parts["word/document.xml"])!],
        "w:tbl",
      )[0]!,
      "w:tblGrid",
    )[0]!;
    expect(childrenWithTag(grid, "w:gridCol")).toHaveLength(2);
  });

  it("reports a diagnostic per flagged column, naming each one's own index, for non-adjacent header columns", () => {
    const diagnostics: DocxWriteDiagnostic[] = [];
    buildDocxPackageFromContent(
      {
        sections: [
          {
            ...emptyBodySection(),
            blocks: [
              {
                kind: "table",
                columns: [
                  { widthPt: 100, isHeader: true },
                  { widthPt: 100 },
                  { widthPt: 100, isHeader: true },
                ],
                rows: [
                  {
                    cells: [{ blocks: [] }, { blocks: [] }, { blocks: [] }],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        onDiagnostic: (diagnostic) => {
          diagnostics.push(diagnostic);
        },
      },
    );
    expect(diagnostics.map((d) => d.message)).toEqual([
      expect.stringContaining("table column 0 is a header column"),
      expect.stringContaining("table column 2 is a header column"),
    ]);
  });

  it("reports nothing at all for a table whose columns state no header flag", () => {
    const diagnostics: DocxWriteDiagnostic[] = [];
    buildDocxPackageFromContent(
      {
        sections: [
          {
            ...emptyBodySection(),
            blocks: [
              {
                kind: "table",
                columns: [{ widthPt: 100 }, { widthPt: 100 }],
                rows: [{ cells: [{ blocks: [] }, { blocks: [] }] }],
              },
            ],
          },
        ],
      },
      {
        onDiagnostic: (diagnostic) => {
          diagnostics.push(diagnostic);
        },
      },
    );
    expect(diagnostics).toEqual([]);
  });
});
