import { describe, expect, it } from "vitest";
import type { ContentBlock } from "document-schema.js";
import { reconstructWordprocessing } from "./reconstruct";
import type {
  LayoutDocument,
  LayoutItem,
  LayoutPage,
  LayoutStructureElement,
  LayoutText,
} from "pdf-codec";

// The reconstruct half of tagged structure (#760): the owning-element ids readPdf stamps on items drive true heading semantics (structure over geometry, and a geometry VETO where the producer says otherwise), lattice-free table recovery from /Table /TR /TH /TD ownership, and division constructs around /Part /Sect /Div extents. The reader half lives in pdf-codec's src/structure.test.ts; these tests hand-build LayoutDocuments so each rule is pinned independently of the fixture's coverage.

const BLACK = { r: 0, g: 0, b: 0 };

function text(overrides: {
  text: string;
  xPt: number;
  yPt: number;
  widthPt: number;
  sizePt?: number;
  structure?: string;
}): LayoutText {
  return {
    kind: "text",
    text: overrides.text,
    xPt: overrides.xPt,
    yPt: overrides.yPt,
    font: { family: "Helvetica", weight: "normal", style: "normal" },
    sizePt: overrides.sizePt ?? 12,
    color: BLACK,
    widthPt: overrides.widthPt,
    ...(overrides.structure !== undefined
      ? { structure: overrides.structure }
      : {}),
  };
}

function page(items: LayoutItem[]): LayoutPage {
  return { widthPt: 612, heightPt: 792, items };
}

function docFrom(
  pages: LayoutPage[],
  structure?: LayoutStructureElement[],
): LayoutDocument {
  return {
    formatVersion: 1,
    metadata: {},
    pages,
    images: {},
    ...(structure !== undefined ? { structure } : {}),
  };
}

function blocks(
  doc: ReturnType<typeof reconstructWordprocessing>,
): ContentBlock[] {
  if (doc.kind !== "wordprocessing") {
    throw new Error("expected a wordprocessing document");
  }
  return doc.sections.flatMap((s) => s.blocks);
}

function paragraphTexts(
  doc: ReturnType<typeof reconstructWordprocessing>,
): string[] {
  return blocks(doc)
    .filter(
      (b): b is Extract<ContentBlock, { kind: "paragraph" }> =>
        b.kind === "paragraph",
    )
    .map((b) => b.runs.map((r) => r.text).join(""));
}

describe("reconstructWordprocessing: heading levels from tagged structure (#760)", () => {
  const headingDoc = (): ReturnType<typeof reconstructWordprocessing> =>
    reconstructWordprocessing(
      docFrom(
        [
          page([
            text({
              text: "Tagged heading",
              xPt: 50,
              yPt: 700,
              widthPt: 80,
              structure: "struct1",
            }),
            text({
              text: "First body line",
              xPt: 50,
              yPt: 680,
              widthPt: 76,
              structure: "struct2",
            }),
            text({
              text: "Second body line",
              xPt: 50,
              yPt: 668,
              widthPt: 84,
              structure: "struct2",
            }),
            text({
              text: "Big tagged body",
              xPt: 50,
              yPt: 620,
              widthPt: 90,
              sizePt: 24,
              structure: "struct3",
            }),
            text({
              text: "Big untagged",
              xPt: 50,
              yPt: 580,
              widthPt: 84,
              sizePt: 24,
            }),
          ]),
        ],
        [
          { id: "struct1", type: "H1", children: [] },
          { id: "struct2", type: "P", children: [] },
          { id: "struct3", type: "P", children: [] },
        ],
      ),
    );

  it("takes the heading level from the owning H element even at body size", () => {
    const paragraphs = blocks(headingDoc()).filter(
      (b): b is Extract<ContentBlock, { kind: "paragraph" }> =>
        b.kind === "paragraph",
    );
    expect(paragraphs[0]).toMatchObject({
      headingLevel: 1,
      styleId: "Heading1",
    });
  });

  it("vetoes the geometric reading where the owning element is not a heading", () => {
    const paragraphs = blocks(headingDoc()).filter(
      (b): b is Extract<ContentBlock, { kind: "paragraph" }> =>
        b.kind === "paragraph",
    );
    // 24pt against a 12pt modal body is heading-sized to the geometry census; the /P ownership says body, and structure wins.
    expect(paragraphs[2]).not.toHaveProperty("headingLevel");
  });

  it("falls back to the geometric census for items no element owns", () => {
    const paragraphs = blocks(headingDoc()).filter(
      (b): b is Extract<ContentBlock, { kind: "paragraph" }> =>
        b.kind === "paragraph",
    );
    expect(paragraphs[3]).toMatchObject({
      headingLevel: 1,
      styleId: "Heading1",
    });
  });

  it("resolves the heading level through role-mapped and nested ancestors alike", () => {
    const doc = reconstructWordprocessing(
      docFrom(
        [
          page([
            text({
              text: "Deep heading",
              xPt: 50,
              yPt: 700,
              widthPt: 80,
              structure: "span1",
            }),
            text({
              text: "Body",
              xPt: 50,
              yPt: 660,
              widthPt: 30,
              structure: "para1",
            }),
          ]),
        ],
        [
          {
            id: "h2elem",
            type: "H2",
            children: [{ id: "span1", type: "Span", children: [] }],
          },
          {
            id: "sect1",
            type: "Sect",
            children: [{ id: "para1", type: "P", children: [] }],
          },
        ],
      ),
    );
    const paragraphs = blocks(doc).filter(
      (b): b is Extract<ContentBlock, { kind: "paragraph" }> =>
        b.kind === "paragraph",
    );
    expect(paragraphs[0]).toMatchObject({ headingLevel: 2 });
    expect(paragraphs[1]).not.toHaveProperty("headingLevel");
  });
});

describe("reconstructWordprocessing: tagged table recovery (#760)", () => {
  const tableDoc = (): ReturnType<typeof reconstructWordprocessing> =>
    reconstructWordprocessing(
      docFrom(
        [
          page([
            text({
              text: "Name",
              xPt: 50,
              yPt: 700,
              widthPt: 44,
              structure: "c1",
            }),
            text({
              text: "Value",
              xPt: 150,
              yPt: 700,
              widthPt: 40,
              structure: "c2",
            }),
            text({
              text: "Alpha",
              xPt: 50,
              yPt: 670,
              widthPt: 35,
              structure: "c3",
            }),
            text({
              text: "One",
              xPt: 150,
              yPt: 670,
              widthPt: 25,
              structure: "c4",
            }),
          ]),
        ],
        [
          {
            id: "t1",
            type: "Table",
            children: [
              {
                id: "r1",
                type: "TR",
                children: [
                  { id: "c1", type: "TH", children: [] },
                  { id: "c2", type: "TH", children: [] },
                ],
              },
              {
                id: "r2",
                type: "TR",
                children: [
                  { id: "c3", type: "TD", children: [] },
                  { id: "c4", type: "TD", children: [] },
                ],
              },
            ],
          },
        ],
      ),
    );

  it("recovers rows and positional cells from TD/TH ownership with no drawn gridlines at all", () => {
    const table = blocks(tableDoc()).find(
      (b): b is Extract<ContentBlock, { kind: "table" }> => b.kind === "table",
    );
    expect(table).toBeDefined();
    expect(table!.rows).toHaveLength(2);
    const rowTexts = table!.rows.map((row) =>
      row.cells.map((cell) =>
        cell.blocks
          .map((b) =>
            b.kind === "paragraph" ? b.runs.map((r) => r.text).join("") : "",
          )
          .join(""),
      ),
    );
    expect(rowTexts).toEqual([
      ["Name", "Value"],
      ["Alpha", "One"],
    ]);
  });

  it("measures column widths from the cells' own item geometry", () => {
    const table = blocks(tableDoc()).find(
      (b): b is Extract<ContentBlock, { kind: "table" }> => b.kind === "table",
    );
    expect(table!.columnWidthsPt).toEqual([44, 40]);
  });

  it("removes the claimed text from the paragraph flow", () => {
    expect(paragraphTexts(tableDoc()).join("")).not.toContain("Alpha");
  });
});

describe("reconstructWordprocessing: division constructs from tagged structure (#760)", () => {
  it("wraps each Sect extent in a balanced division pair around exactly its blocks", () => {
    const doc = reconstructWordprocessing(
      docFrom(
        [
          page([
            text({
              text: "Inside",
              xPt: 50,
              yPt: 700,
              widthPt: 40,
              structure: "p1",
            }),
            text({
              text: "Outside",
              xPt: 50,
              yPt: 670,
              widthPt: 44,
              structure: "p2",
            }),
          ]),
        ],
        [
          {
            id: "sec1",
            type: "Sect",
            children: [{ id: "p1", type: "P", children: [] }],
          },
          { id: "p2", type: "P", children: [] },
        ],
      ),
    );
    const list = blocks(doc);
    const start = list.findIndex(
      (b) => b.kind === "constructStart" && b.descriptor.kind === "division",
    );
    expect(start).toBeGreaterThanOrEqual(0);
    expect(list[start + 1]).toMatchObject({ kind: "paragraph" });
    expect(list[start + 2]).toMatchObject({ kind: "constructEnd" });
    // Exactly one pair, and the untagged-following paragraph sits after its end.
    expect(list.filter((b) => b.kind === "constructStart").length).toBe(1);
  });

  it("nests pairs for nested division elements and spans page breaks inside one pair", () => {
    const doc = reconstructWordprocessing(
      docFrom(
        [
          page([
            text({
              text: "Div only",
              xPt: 50,
              yPt: 700,
              widthPt: 52,
              structure: "pa",
            }),
          ]),
          page([
            text({
              text: "Div and sect",
              xPt: 50,
              yPt: 700,
              widthPt: 80,
              structure: "pb",
            }),
          ]),
        ],
        [
          {
            id: "div1",
            type: "Div",
            children: [
              { id: "pa", type: "P", children: [] },
              {
                id: "sec1",
                type: "Sect",
                children: [{ id: "pb", type: "P", children: [] }],
              },
            ],
          },
        ],
      ),
    );
    const kinds = blocks(doc).map((b) => b.kind);
    expect(kinds).toEqual([
      "constructStart",
      "paragraph",
      "pageBreak",
      "constructStart",
      "paragraph",
      "constructEnd",
      "constructEnd",
    ]);
  });
});
