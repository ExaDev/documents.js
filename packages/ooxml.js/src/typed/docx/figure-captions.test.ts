import { describe, expect, it } from "vitest";
import type { ContentBlock, ContentImageBlock } from "document-schema.js";
import { associateFigureCaptions } from "./figure-captions";

function paragraph(text: string, styleId?: string): ContentBlock {
  return {
    kind: "paragraph",
    runs: text === "" ? [] : [{ text }],
    ...(styleId === undefined ? {} : { styleId }),
  };
}

function image(): ContentImageBlock {
  return {
    kind: "image",
    format: "png",
    base64: "iVBORw0KGgo=",
    widthPt: 100,
    heightPt: 80,
  };
}

const captionsOf = (blocks: ContentBlock[]): (string | undefined)[] =>
  associateFigureCaptions(blocks)
    .filter((block) => block.kind === "image")
    .map((block) => block.caption);

describe("associateFigureCaptions", () => {
  it("takes the Caption-styled paragraph below the figure", () => {
    const blocks = [
      paragraph("Body text"),
      image(),
      paragraph("Figure 1: Revenue by region", "Caption"),
    ];

    expect(captionsOf(blocks)).toEqual(["Figure 1: Revenue by region"]);
  });

  it("falls back to the one above when there is none below", () => {
    const blocks = [
      paragraph("Figure 1: Current state", "Caption"),
      image(),
      paragraph("Body text"),
    ];

    expect(captionsOf(blocks)).toEqual(["Figure 1: Current state"]);
  });

  it("leaves the caption paragraph in place rather than moving or removing it", () => {
    // The caption is real prose the document contains: a consumer projecting the block list to text
    // must still find it, and must find it exactly once.
    const blocks = [image(), paragraph("Figure 1: Revenue", "Caption")];

    const result = associateFigureCaptions(blocks);

    expect(result).toHaveLength(2);
    expect(result[1]).toEqual(paragraph("Figure 1: Revenue", "Caption"));
  });

  it("lets only one figure claim a caption sandwiched between two", () => {
    const blocks = [
      image(),
      paragraph("Figure 1: Only one of us gets this", "Caption"),
      image(),
    ];

    expect(captionsOf(blocks)).toEqual([
      "Figure 1: Only one of us gets this",
      undefined,
    ]);
  });

  it("ignores an ordinary paragraph beside a figure, and a blank Caption-styled one", () => {
    expect(captionsOf([image(), paragraph("Ordinary body prose")])).toEqual([
      undefined,
    ]);
    expect(captionsOf([image(), paragraph("   ", "Caption")])).toEqual([
      undefined,
    ]);
  });

  it("joins a caption's multiple runs directly with no separator between them", () => {
    const caption: ContentBlock = {
      kind: "paragraph",
      runs: [{ text: "Figure " }, { text: "1" }, { text: ": Split runs" }],
      styleId: "Caption",
    };
    expect(captionsOf([image(), caption])).toEqual(["Figure 1: Split runs"]);
  });

  it("matches the style id case-insensitively", () => {
    // w:pStyle/@w:val is a producer's own spelling, and ContentParagraph.styleId documents it as such.
    expect(
      captionsOf([image(), paragraph("Figure 1: Lowercased", "caption")]),
    ).toEqual(["Figure 1: Lowercased"]);
  });

  it("leaves both figures uncaptioned when neither neighbour is a paragraph at all", () => {
    expect(captionsOf([image(), image(), image()])).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("never attaches a caption to a non-image block, even one sitting directly beside a genuine Caption-styled paragraph", () => {
    // A plain paragraph is never a figure -- it must be returned exactly as given, without ever entering the candidate-claiming logic a caption-styled neighbour would otherwise feed it.
    const blocks = [
      paragraph("Body text"),
      paragraph("Figure 1: X", "Caption"),
    ];

    const result = associateFigureCaptions(blocks);

    expect(result[0]).toEqual(paragraph("Body text"));
    expect(result[0]).not.toHaveProperty("caption");
  });

  it("preserves the block count and order, which the extent indices depend on", () => {
    const blocks = [
      paragraph("A"),
      image(),
      paragraph("Figure 1", "Caption"),
      paragraph("B"),
      image(),
    ];

    const result = associateFigureCaptions(blocks);

    expect(result).toHaveLength(blocks.length);
    expect(result.map((block) => block.kind)).toEqual(
      blocks.map((block) => block.kind),
    );
  });
});
