import { describe, expect, it } from "vitest";
import type {
  ContentBlock,
  ContentImageBlock,
  ContentPageBreak,
  ContentParagraph,
  ContentTable,
} from "document-schema.js";
import { assignSourcePaths } from "./source-path";

function paragraph(...texts: string[]): ContentParagraph {
  return { kind: "paragraph", runs: texts.map((text) => ({ text })) };
}

function pageBreak(): ContentPageBreak {
  return { kind: "pageBreak" };
}

function image(): ContentImageBlock {
  return { kind: "image", format: "png", base64: "", widthPt: 1, heightPt: 1 };
}

function asParagraph(block: ContentBlock | undefined): ContentParagraph {
  if (block?.kind !== "paragraph") {
    throw new Error("expected a paragraph block");
  }
  return block;
}

// The two construct-boundary markers have no sourcePath field at all (a boundary is not content), so reading one off an unnarrowed ContentBlock no longer type-checks -- this narrows past them for the assertions below, which only ever look at real content blocks.
function sourcePathOf(block: ContentBlock | undefined): string | undefined {
  if (
    block === undefined ||
    block.kind === "constructStart" ||
    block.kind === "constructEnd"
  ) {
    return undefined;
  }
  return block.sourcePath;
}

describe("assignSourcePaths", () => {
  it("assigns each top-level block a path from the given prefix", () => {
    const blocks: ContentBlock[] = [paragraph("a"), pageBreak(), image()];
    assignSourcePaths(blocks, "sections[0]");
    expect(sourcePathOf(blocks[0])).toBe("sections[0].blocks[0]");
    expect(sourcePathOf(blocks[1])).toBe("sections[0].blocks[1]");
    expect(sourcePathOf(blocks[2])).toBe("sections[0].blocks[2]");
  });

  it("assigns each run within a paragraph a path nested under its own block path", () => {
    const blocks: ContentBlock[] = [paragraph("x"), paragraph("a", "b", "c")];
    assignSourcePaths(blocks, "sections[0]");
    const second = asParagraph(blocks[1]);
    expect(second.runs[0]?.sourcePath).toBe("sections[0].blocks[1].runs[0]");
    expect(second.runs[1]?.sourcePath).toBe("sections[0].blocks[1].runs[1]");
    expect(second.runs[2]?.sourcePath).toBe("sections[0].blocks[1].runs[2]");
  });

  it("recurses into a table's own rows and cells, nesting the grammar one level deeper", () => {
    const table: ContentTable = {
      kind: "table",
      columnWidthsPt: [100, 100],
      rows: [
        {
          cells: [
            { blocks: [paragraph("r0c0")] },
            { blocks: [paragraph("r0c1")] },
          ],
        },
        { cells: [{ blocks: [paragraph("r1c0"), paragraph("r1c1-second")] }] },
      ],
    };
    const blocks: ContentBlock[] = [paragraph("before"), table];
    assignSourcePaths(blocks, "sections[0]");
    expect(table.sourcePath).toBe("sections[0].blocks[1]");
    const r0c0 = asParagraph(table.rows[0]?.cells[0]?.blocks[0]);
    const r0c1 = asParagraph(table.rows[0]?.cells[1]?.blocks[0]);
    const r1c0 = asParagraph(table.rows[1]?.cells[0]?.blocks[0]);
    const r1c0Second = asParagraph(table.rows[1]?.cells[0]?.blocks[1]);
    expect(r0c0.sourcePath).toBe(
      "sections[0].blocks[1].rows[0].cells[0].blocks[0]",
    );
    expect(r0c1.sourcePath).toBe(
      "sections[0].blocks[1].rows[0].cells[1].blocks[0]",
    );
    expect(r1c0.sourcePath).toBe(
      "sections[0].blocks[1].rows[1].cells[0].blocks[0]",
    );
    expect(r1c0Second.sourcePath).toBe(
      "sections[0].blocks[1].rows[1].cells[0].blocks[1]",
    );
    expect(r0c0.runs[0]?.sourcePath).toBe(
      "sections[0].blocks[1].rows[0].cells[0].blocks[0].runs[0]",
    );
  });

  it("skips both construct-boundary markers while still counting their positions in the paths around them", () => {
    const blocks: ContentBlock[] = [
      {
        kind: "constructStart",
        descriptor: { kind: "anchor", anchorType: "bookmark", name: "intro" },
      },
      paragraph("a"),
      { kind: "constructEnd" },
      paragraph("b"),
    ];
    assignSourcePaths(blocks, "sections[0]");
    expect(blocks[0]).toEqual({
      kind: "constructStart",
      descriptor: { kind: "anchor", anchorType: "bookmark", name: "intro" },
    });
    expect(blocks[2]).toEqual({ kind: "constructEnd" });
    expect(sourcePathOf(blocks[1])).toBe("sections[0].blocks[1]");
    expect(sourcePathOf(blocks[3])).toBe("sections[0].blocks[3]");
  });

  it("works with a slides[N].shapes[N] prefix, matching the pptx grammar", () => {
    const blocks: ContentBlock[] = [paragraph("hello")];
    assignSourcePaths(blocks, "slides[2].shapes[1]");
    expect(sourcePathOf(blocks[0])).toBe("slides[2].shapes[1].blocks[0]");
    expect(asParagraph(blocks[0]).runs[0]?.sourcePath).toBe(
      "slides[2].shapes[1].blocks[0].runs[0]",
    );
  });
});
