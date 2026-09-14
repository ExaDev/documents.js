import type { ContentDocument, ContentParagraph } from "documents.js";
import {
  DocumentTreeSchema,
  documentTreeWithSchema,
  readMarkdownContent,
} from "documents.js";
import { assembleTree } from "document-schema.js";
import { CODE_BLOCK_STYLE_ID, QUOTE_STYLE_ID } from "markdown-codec";
import { describe, expect, it } from "vitest";

import {
  createDoc,
  createDocx,
  encodeMarkdownText,
  openDocx,
} from "documents.js";
import {
  appendParagraphOf,
  normalizeContentForSource,
  sanitizeImageAsset,
  openEditorSession,
  paragraphsOf,
  paragraphTexts,
  setParagraphTextAt,
} from "./router";

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

  it("does not treat an empty paragraph with a bottom AND top border as a horizontal rule", () => {
    const content = wordprocessingWith({
      kind: "paragraph",
      runs: [],
      borders: { bottom: BOTTOM_BORDER, top: BOTTOM_BORDER },
    });
    const result = normalizeContentForSource(content, "docx");
    expect(firstStyleId(result)).toBeUndefined();
  });

  it("does not treat an empty paragraph with a bottom AND right border as a horizontal rule", () => {
    const content = wordprocessingWith({
      kind: "paragraph",
      runs: [],
      borders: { bottom: BOTTOM_BORDER, right: BOTTOM_BORDER },
    });
    const result = normalizeContentForSource(content, "docx");
    expect(firstStyleId(result)).toBeUndefined();
  });

  it("still detects the border-only rule when multiple whitespace-only runs join to nothing, not just a single run", () => {
    const content = wordprocessingWith({
      kind: "paragraph",
      runs: [{ text: " " }, { text: " " }],
      borders: { bottom: BOTTOM_BORDER },
    });
    const result = normalizeContentForSource(content, "docx");
    expect(firstStyleId(result)).toBe("horizontal-rule");
  });

  it("rewrites a paragraph with a headingLevel into the heading-{N} convention", () => {
    const content = wordprocessingWith({
      kind: "paragraph",
      runs: [{ text: "Title" }],
      headingLevel: 2,
    });
    const result = normalizeContentForSource(content, "docx");
    expect(firstStyleId(result)).toBe("heading-2");
  });

  it("rewrites a docx style literally named HeadingN into the heading-{N} convention via the fallback pattern, when headingLevel itself is absent", () => {
    const content = wordprocessingWith({
      kind: "paragraph",
      runs: [{ text: "Title" }],
      styleId: "Heading3",
    });
    const result = normalizeContentForSource(content, "docx");
    expect(firstStyleId(result)).toBe("heading-3");
  });

  it("rewrites a styleId containing only Code into the code-block convention", () => {
    const content = wordprocessingWith({
      kind: "paragraph",
      runs: [{ text: "x" }],
      styleId: "MyCodeStyle",
    });
    const result = normalizeContentForSource(content, "docx");
    expect(firstStyleId(result)).toBe("code-block");
  });

  it("rewrites a styleId containing only Source into the code-block convention", () => {
    const content = wordprocessingWith({
      kind: "paragraph",
      runs: [{ text: "x" }],
      styleId: "SourceListing",
    });
    const result = normalizeContentForSource(content, "docx");
    expect(firstStyleId(result)).toBe("code-block");
  });

  it("rewrites a styleId containing only Preformatted into the code-block convention", () => {
    const content = wordprocessingWith({
      kind: "paragraph",
      runs: [{ text: "x" }],
      styleId: "PreformattedText",
    });
    const result = normalizeContentForSource(content, "docx");
    expect(firstStyleId(result)).toBe("code-block");
  });

  it("does not treat a styleId containing only 'Horizontal' (not 'Line') as a horizontal rule", () => {
    const content = wordprocessingWith({
      kind: "paragraph",
      runs: [{ text: "x" }],
      styleId: "HorizontalSomethingElse",
    });
    const result = normalizeContentForSource(content, "docx");
    expect(firstStyleId(result)).toBe("HorizontalSomethingElse");
  });

  it("does not treat a styleId containing only 'Line' (not 'Horizontal') as a horizontal rule", () => {
    const content = wordprocessingWith({
      kind: "paragraph",
      runs: [{ text: "x" }],
      styleId: "SomeLineStyle",
    });
    const result = normalizeContentForSource(content, "docx");
    expect(firstStyleId(result)).toBe("SomeLineStyle");
  });

  it("recurses into a table's cells when normalizing wordprocessing semantics for docx/odt", () => {
    const content: ContentDocument = {
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          pageSize: { widthPt: 595, heightPt: 842 },
          margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
          blocks: [
            {
              kind: "table",
              columnWidthsPt: [100],
              rows: [
                {
                  cells: [
                    {
                      blocks: [
                        { kind: "paragraph", runs: [], styleId: "Heading1" },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const result = normalizeContentForSource(content, "docx");
    const block =
      result.kind === "wordprocessing"
        ? result.sections[0]?.blocks[0]
        : undefined;
    const cell = block?.kind === "table" ? block.rows[0]?.cells[0] : undefined;
    const cellBlock = cell?.blocks[0];
    expect(
      cellBlock?.kind === "paragraph" ? cellBlock.styleId : undefined,
    ).toBe("heading-1");
  });

  it("recurses into a table's cells when normalizing markdown styling too", () => {
    const content: ContentDocument = {
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          pageSize: { widthPt: 595, heightPt: 842 },
          margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
          blocks: [
            {
              kind: "table",
              columnWidthsPt: [100],
              rows: [
                {
                  cells: [
                    {
                      blocks: [
                        {
                          kind: "paragraph",
                          runs: [],
                          headingLevel: 2,
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const result = normalizeContentForSource(content, "markdown");
    const block =
      result.kind === "wordprocessing"
        ? result.sections[0]?.blocks[0]
        : undefined;
    const cell = block?.kind === "table" ? block.rows[0]?.cells[0] : undefined;
    const cellBlock = cell?.blocks[0];
    expect(
      cellBlock?.kind === "paragraph" ? cellBlock.styleId : undefined,
    ).toBe("heading-2");
  });

  it("dispatches to the markdown-specific rewrite only for a genuinely markdown source, not merely because a docx/odt paragraph happens to carry the same styleId", () => {
    // HORIZONTAL_RULE_STYLE_ID ("HorizontalRule") deliberately does not contain "Line", so docx/odt's own Horizontal+Line name heuristic never matches it -- only normalizeMarkdownStyling's exact-constant check does, making this genuinely distinguishing rather than coincidentally identical across both branches.
    const content = wordprocessingWith({
      kind: "paragraph",
      runs: [],
      styleId: "HorizontalRule",
    });
    expect(firstStyleId(normalizeContentForSource(content, "markdown"))).toBe(
      "horizontal-rule",
    );
    expect(firstStyleId(normalizeContentForSource(content, "docx"))).toBe(
      "HorizontalRule",
    );
  });

  it("rewrites markdown-codec's own QUOTE_STYLE_ID constant into the quote convention", () => {
    const content = wordprocessingWith({
      kind: "paragraph",
      runs: [{ text: "x" }],
      styleId: QUOTE_STYLE_ID,
    });
    expect(firstStyleId(normalizeContentForSource(content, "markdown"))).toBe(
      "quote",
    );
  });

  it("rewrites markdown-codec's own CODE_BLOCK_STYLE_ID constant into the code-block convention", () => {
    const content = wordprocessingWith({
      kind: "paragraph",
      runs: [{ text: "x" }],
      styleId: CODE_BLOCK_STYLE_ID,
    });
    expect(firstStyleId(normalizeContentForSource(content, "markdown"))).toBe(
      "code-block",
    );
  });

  it("leaves an unrelated styleId untouched for a markdown source, rather than always treating it as a horizontal rule", () => {
    const content = wordprocessingWith({
      kind: "paragraph",
      runs: [{ text: "x" }],
      styleId: "Normal",
    });
    expect(firstStyleId(normalizeContentForSource(content, "markdown"))).toBe(
      "Normal",
    );
  });

  it("leaves a wordprocessing-kind ContentDocument untouched for a source other than markdown/docx/odt", () => {
    // A source that is neither markdown nor docx/odt hits the function's final fallthrough (`return content` unchanged) even when its own document happens to carry a wordprocessing ContentDocument -- distinguishing this from forcing the docx/odt normalizeWordprocessingSemantics branch to always run, which would incorrectly rewrite Heading1 into heading-1 here too.
    const content = wordprocessingWith({
      kind: "paragraph",
      runs: [{ text: "Title" }],
      styleId: "Heading1",
    });
    expect(firstStyleId(normalizeContentForSource(content, "pptx"))).toBe(
      "Heading1",
    );
  });

  it("never touches bytes for an odt source, even when bytes are supplied and are not valid docx bytes", () => {
    const content = wordprocessingWith({
      kind: "paragraph",
      runs: [{ text: "x" }],
      styleId: "Quotations",
    });
    const notDocxBytes = new TextEncoder().encode("not a docx file at all");
    expect(() =>
      normalizeContentForSource(content, "odt", notDocxBytes),
    ).not.toThrow();
    expect(
      firstStyleId(normalizeContentForSource(content, "odt", notDocxBytes)),
    ).toBe("quote");
  });
});

describe("the Package / JSON tool's dump-to-restore pipeline", () => {
  it("round-trips a markdown document's tree through the stamped JSON dump and back as a schema-valid, identically-stamped artefact", () => {
    // The exact shape the Package / JSON route exchanges: the dump is documentTreeWithSchema(tree) as JSON, the restore parses and schema-validates it before rebuilding bytes. The byte-building half (buildDocumentBytes) is documents.js's own from-package suite's coverage -- asserted here at the tree boundary this package owns.
    const markdown = "# Title\n\nBody text.\n";
    const stamped = documentTreeWithSchema(
      assembleTree(readMarkdownContent(markdown)),
    );
    const dumped = JSON.stringify(stamped, null, 2);
    const restored = documentTreeWithSchema(
      DocumentTreeSchema.parse(JSON.parse(dumped)),
    );
    expect(restored).toEqual(stamped);
  });
});

describe("the Editors tool's session surface", () => {
  it("edits, adds, and removes paragraphs on a live markdown session and saves real markdown bytes", () => {
    const session = openEditorSession(
      "markdown",
      new TextEncoder().encode("first paragraph\n\nsecond paragraph\n"),
    );
    expect(paragraphTexts(session)).toEqual([
      "first paragraph",
      "second paragraph",
    ]);

    // The set-text primitive: first run takes the whole new text, remaining runs leave. A multi-run paragraph ("**bo" + "ld**") collapses to its edited text without losing its position.
    setParagraphTextAt(session, 0, "edited first");
    expect(paragraphTexts(session)).toEqual([
      "edited first",
      "second paragraph",
    ]);

    appendParagraphOf(session, "third");
    expect(paragraphTexts(session)).toEqual([
      "edited first",
      "second paragraph",
      "third",
    ]);

    paragraphsOf(session)[1]!.remove();
    expect(paragraphTexts(session)).toEqual(["edited first", "third"]);

    if (session.format !== "markdown") {
      throw new Error("expected a markdown session");
    }
    const saved = new TextDecoder().decode(
      encodeMarkdownText(session.editor.toMarkdownText()),
    );
    expect(saved).toContain("edited first");
    expect(saved).not.toContain("second paragraph");
    expect(saved).toContain("third");
  });

  it("opens a docx session and drives the same surface", () => {
    // A minimal real docx: the same createDocx path the editors package itself tests with, giving the session a genuine w:document tree to mutate.
    const editor = createDocx();
    editor.body.appendParagraph().appendRun({ text: "hello docx" });
    const session = openEditorSession("docx", editor.toBytes());
    expect(paragraphTexts(session)).toEqual(["hello docx"]);
    setParagraphTextAt(session, 0, "hello edited");
    expect(paragraphTexts(session)).toEqual(["hello edited"]);
    if (session.format !== "docx") {
      throw new Error("expected a docx session");
    }
    const savedBytes = session.editor.toBytes();
    const reopened = openDocx(savedBytes);
    expect(reopened.paragraphs()[0]!.text).toBe("hello edited");
  });

  it("opens a doc session, whose appendParagraph lives on the editor itself rather than a body", () => {
    const editor = createDoc();
    editor.appendParagraph({ text: "hello doc" });
    const session = openEditorSession("doc", editor.toBytes());
    expect(paragraphTexts(session)).toEqual(["hello doc"]);
    appendParagraphOf(session, "second paragraph");
    expect(paragraphTexts(session)).toEqual(["hello doc", "second paragraph"]);
  });

  it("collapses a genuinely multi-run paragraph to its edited text at the first run's position", () => {
    // markdown-codec splits "**bold** and plain" into a bold run followed by a plain run for the same paragraph -- setParagraphTextAt must remove every run past the first, not just overwrite the first one and leave the rest trailing.
    const session = openEditorSession(
      "markdown",
      new TextEncoder().encode("**bold** and plain\n"),
    );
    if (session.format !== "markdown") {
      throw new Error("expected a markdown session");
    }
    expect(session.editor.paragraphs()[0]!.runs().length).toBeGreaterThan(1);
    setParagraphTextAt(session, 0, "replaced");
    expect(paragraphTexts(session)).toEqual(["replaced"]);
    expect(session.editor.paragraphs()[0]!.runs().length).toBe(1);
  });

  it("appends a fresh run when setting text on a paragraph that starts with no runs at all", () => {
    const editor = createDocx();
    editor.body.appendParagraph();
    const session = openEditorSession("docx", editor.toBytes());
    if (session.format !== "docx") {
      throw new Error("expected a docx session");
    }
    expect(session.editor.paragraphs()[0]!.runs()).toEqual([]);
    setParagraphTextAt(session, 0, "now has text");
    expect(paragraphTexts(session)).toEqual(["now has text"]);
  });

  it("throws for setParagraphText at an index with no paragraph there", () => {
    const session = openEditorSession(
      "markdown",
      new TextEncoder().encode("only paragraph\n"),
    );
    expect(() => {
      setParagraphTextAt(session, 5, "x");
    }).toThrow("no paragraph at index 5");
  });
});

describe("sanitizeImageAsset", () => {
  it("estimates byteLength from the base64 string's own length, three bytes per four base64 characters", () => {
    // "AAAAAAAA" is 8 base64 characters (no padding), so the real decode is exactly 6 bytes -- a formula transposed to *3*4 or /3/4 would report 96 or 1 instead.
    const result = sanitizeImageAsset({
      format: "png",
      base64: "AAAAAAAA",
      widthPx: 4,
      heightPx: 4,
    });
    expect(result).toEqual({
      format: "png",
      widthPx: 4,
      heightPx: 4,
      byteLength: 6,
    });
  });
});
