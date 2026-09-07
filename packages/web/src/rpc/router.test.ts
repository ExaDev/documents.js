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
});
