import type { ContentDocument, ContentParagraph } from "documents.js";
import { describe, expect, it } from "vitest";

import { normalizeContentForSource } from "./router";

function wordprocessingWith(paragraph: ContentParagraph): ContentDocument {
  return {
    kind: "wordprocessing",
    metadata: {},
    sections: [
      {
        pageSize: { widthPt: 595, heightPt: 842 },
        margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
        blocks: [paragraph],
      },
    ],
  };
}

function firstStyleId(document: ContentDocument): string | undefined {
  if (document.kind !== "wordprocessing") return undefined;
  const block = document.sections[0]?.blocks[0];
  return block?.kind === "paragraph" ? block.styleId : undefined;
}

describe("normalizeContentForSource", () => {
  it("rewrites odt's built-in Horizontal Line style into the horizontal-rule convention", () => {
    const content = wordprocessingWith({
      kind: "paragraph",
      runs: [],
      styleId: "Horizontal_20_Line",
    });
    const result = normalizeContentForSource(content, "odt");
    expect(firstStyleId(result)).toBe("horizontal-rule");
  });

  it("rewrites a docx style named Horizontal Line into the horizontal-rule convention too, mirroring the existing Quote/Code heuristic sharing both formats", () => {
    const content = wordprocessingWith({
      kind: "paragraph",
      runs: [],
      styleId: "HorizontalLine",
    });
    const result = normalizeContentForSource(content, "docx");
    expect(firstStyleId(result)).toBe("horizontal-rule");
  });

  it("leaves an unrelated styleId untouched", () => {
    const content = wordprocessingWith({
      kind: "paragraph",
      runs: [{ text: "x" }],
      styleId: "Normal",
    });
    const result = normalizeContentForSource(content, "odt");
    expect(firstStyleId(result)).toBe("Normal");
  });

  it("does not confuse the horizontal-rule heuristic with quote/code-block detection", () => {
    const content = wordprocessingWith({
      kind: "paragraph",
      runs: [{ text: "x" }],
      styleId: "Quotations",
    });
    const result = normalizeContentForSource(content, "odt");
    expect(firstStyleId(result)).toBe("quote");
  });

  const BOTTOM_BORDER = {
    color: { r: 0, g: 0, b: 0 },
    widthPt: 0.75,
  };

  it("rewrites a docx paragraph with no text and only a bottom border into the horizontal-rule convention, the shape Word's AutoCorrect produces", () => {
    const content = wordprocessingWith({
      kind: "paragraph",
      runs: [],
      borders: { bottom: BOTTOM_BORDER },
    });
    const result = normalizeContentForSource(content, "docx");
    expect(firstStyleId(result)).toBe("horizontal-rule");
  });

  it("still detects the border-only rule when a whitespace-only run remains, not just a genuinely empty runs array", () => {
    const content = wordprocessingWith({
      kind: "paragraph",
      runs: [{ text: "  " }],
      borders: { bottom: BOTTOM_BORDER },
    });
    const result = normalizeContentForSource(content, "docx");
    expect(firstStyleId(result)).toBe("horizontal-rule");
  });

  it("does not treat a paragraph with real text and a bottom border as a horizontal rule", () => {
    const content = wordprocessingWith({
      kind: "paragraph",
      runs: [{ text: "Real content" }],
      borders: { bottom: BOTTOM_BORDER },
    });
    const result = normalizeContentForSource(content, "docx");
    expect(firstStyleId(result)).toBeUndefined();
  });

  it("does not treat an empty paragraph carrying a top/left/right border (not bottom-only) as a horizontal rule", () => {
    const content = wordprocessingWith({
      kind: "paragraph",
      runs: [],
      borders: { top: BOTTOM_BORDER },
    });
    const result = normalizeContentForSource(content, "docx");
    expect(firstStyleId(result)).toBeUndefined();
  });

  it("does not treat an empty paragraph with a bottom border AND another edge as a horizontal rule", () => {
    const content = wordprocessingWith({
      kind: "paragraph",
      runs: [],
      borders: { bottom: BOTTOM_BORDER, left: BOTTOM_BORDER },
    });
    const result = normalizeContentForSource(content, "docx");
    expect(firstStyleId(result)).toBeUndefined();
  });

  it("the border-only detection is generic to both formats, not docx-specific, so it also matches an odt-sourced paragraph -- odf.js's own reader now populates ContentParagraph.borders from fo:border-* (ExaDev/documents.js#1086), the identical shape docx's own w:pBdr reading (#1082) already produces", () => {
    const content = wordprocessingWith({
      kind: "paragraph",
      runs: [],
      borders: { bottom: BOTTOM_BORDER },
    });
    const result = normalizeContentForSource(content, "odt");
    expect(firstStyleId(result)).toBe("horizontal-rule");
  });
});
