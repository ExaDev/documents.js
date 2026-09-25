import type { ContentDocument } from "document-schema.js";
import { describe, expect, it } from "vitest";
import { paragraphsOf } from "./read-fixtures";

// Direct coverage for paragraphsOf (src/test-support/read-fixtures.ts) itself: every document read.test.ts and its split siblings build is a "wordprocessing" document holding nothing but paragraphs, so none of them exercises the non-wordprocessing throw or actually needs the "paragraph" filter to discriminate anything.

describe("paragraphsOf", () => {
  it("throws naming the document as expected to be wordprocessing when it is not", () => {
    const document = {
      kind: "spreadsheet",
      metadata: {},
      sheets: [],
    } as unknown as ContentDocument;
    expect(() => paragraphsOf(document)).toThrow(
      "expected a wordprocessing document",
    );
  });

  it("collects paragraphs across every section, in order, dropping non-paragraph blocks", () => {
    const document: ContentDocument = {
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
          blocks: [
            { kind: "paragraph", runs: [{ text: "first" }] },
            { kind: "pageBreak" },
            { kind: "paragraph", runs: [{ text: "second" }] },
          ],
        },
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
          blocks: [{ kind: "paragraph", runs: [{ text: "third" }] }],
        },
      ],
    };
    expect(paragraphsOf(document).map((p) => p.runs[0]?.text)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });
});
