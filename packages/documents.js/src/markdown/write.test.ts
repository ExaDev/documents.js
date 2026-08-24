import type { ContentBlock, ContentDocument } from "document-schema.js";

import { MarkdownUnsupportedDocumentKindError } from "markdown-codec";
import { describe, expect, it } from "vitest";
import { MarkdownUnbalancedConstructMarkersError } from "markdown-codec";
import { richMarkdownText } from "../test-support/markdown";
import { readMarkdownContent } from "./read";
import { buildMarkdownText } from "./write";

const CONSTRUCT_START: ContentBlock = {
  kind: "constructStart",
  descriptor: { kind: "anchor", anchorType: "bookmark", name: "b1" },
};
const CONSTRUCT_END: ContentBlock = { kind: "constructEnd" };

function markerDocument(blocks: ContentBlock[]): ContentDocument {
  return {
    kind: "wordprocessing",
    metadata: {},
    sections: [
      {
        pageSize: { widthPt: 595, heightPt: 842 },
        margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
        blocks,
      },
    ],
  };
}

describe("buildMarkdownText", () => {
  it("round-trips a wordprocessing ContentDocument back to markdown text carrying its heading, bold/italic run, list, and table", () => {
    const content = readMarkdownContent(richMarkdownText());
    const text = buildMarkdownText(content);
    expect(text).toContain("Report Title");
    expect(text).toContain("First item");
    expect(text).toContain("A1");
  });

  // A pageBreak block is the one block kind every PDF-to-X reconstruction emits that markdown-codec's own writer silently drops (emit.ts has no page construct to lose fidelity from, by that package's own documented model) -- this package's marker mapping is what carries a reconstructed page boundary into the markdown text at all (ExaDev/documents.js#584).
  it("emits an HTML comment page-break marker for a pageBreak block, positioned between the content it separates", () => {
    const document = markerDocument([
      { kind: "paragraph", runs: [{ text: "First page content" }] },
      { kind: "pageBreak" },
      { kind: "paragraph", runs: [{ text: "Second page content" }] },
    ]);
    const text = buildMarkdownText(document);
    expect(text).toContain("<!-- page break -->");
    expect(text.indexOf("First page content")).toBeLessThan(
      text.indexOf("<!-- page break -->"),
    );
    expect(text.indexOf("<!-- page break -->")).toBeLessThan(
      text.indexOf("Second page content"),
    );
  });

  it("emits no page-break marker for a document without pageBreak blocks", () => {
    const document = markerDocument([
      { kind: "paragraph", runs: [{ text: "Just one page" }] },
    ]);
    expect(buildMarkdownText(document)).not.toContain("<!-- page break -->");
  });

  it("throws MarkdownUnsupportedDocumentKindError for a non-wordprocessing ContentDocument", () => {
    const presentation: ContentDocument = {
      kind: "presentation",
      metadata: {},
      slides: [],
    };
    expect(() => buildMarkdownText(presentation)).toThrow(
      MarkdownUnsupportedDocumentKindError,
    );
  });

  it("throws when the signal is already aborted", () => {
    const content = readMarkdownContent(richMarkdownText());
    const controller = new AbortController();
    controller.abort();
    expect(() =>
      buildMarkdownText(content, { signal: controller.signal }),
    ).toThrow();
  });

  // Markers pass through to markdown-codec's own bracket-resolving writer: a construct with a markdown spelling renders as that syntax, one without renders its extent transparently, and only a genuinely unbalanced list is refused -- by markdown-codec's own MarkdownUnbalancedConstructMarkersError, the shared definition of that check.
  it("renders a balanced marker pair through markdown-codec's writer, the wrapped extent surviving and the construct itself transparent when markdown has no spelling for it", () => {
    const document = markerDocument([
      CONSTRUCT_START,
      { kind: "paragraph", runs: [{ text: "inside" }] },
      CONSTRUCT_END,
    ]);
    expect(buildMarkdownText(document)).toBe("inside");
  });

  it("throws MarkdownUnbalancedConstructMarkersError for an unpaired constructEnd", () => {
    const document = markerDocument([
      { kind: "paragraph", runs: [{ text: "before" }] },
      CONSTRUCT_END,
    ]);
    expect(() => buildMarkdownText(document)).toThrow(
      MarkdownUnbalancedConstructMarkersError,
    );
  });

  it("renders a balanced marker pair nested inside a table cell", () => {
    const document = markerDocument([
      {
        kind: "table",
        rows: [
          {
            cells: [
              {
                blocks: [
                  CONSTRUCT_START,
                  { kind: "paragraph", runs: [{ text: "cell" }] },
                  CONSTRUCT_END,
                ],
              },
            ],
          },
        ],
        columnWidthsPt: [80],
      },
    ]);
    expect(buildMarkdownText(document)).toContain("cell");
  });
});
