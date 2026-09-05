import type { ContentBlock } from "document-schema.js";
import { describe, expect, it } from "vitest";
import { buildXml } from "../xml/build";
import { readXhtmlBody } from "./read";
import { writeXhtmlBody } from "./write";

const CONTENT_WIDTH_PT = 451.28;

function write(blocks: ContentBlock[]): string {
  const body = writeXhtmlBody(blocks, {
    registerImage: () => "images/img1.png",
    sink: () => undefined,
    sourceHref: "chapter1.xhtml",
  });
  return `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">${buildXml([body])}</html>`;
}

function roundTrip(blocks: ContentBlock[]): ContentBlock[] {
  const xml = write(blocks);
  return readXhtmlBody(xml, {
    resolveImage: () => undefined,
    sink: () => undefined,
    sourceHref: "chapter1.xhtml",
    contentWidthPt: CONTENT_WIDTH_PT,
  }).blocks;
}

describe("writeXhtmlBody", () => {
  it("writes and re-reads a heading and a paragraph", () => {
    const blocks: ContentBlock[] = [
      { kind: "paragraph", headingLevel: 1, runs: [{ text: "Title" }] },
      { kind: "paragraph", runs: [{ text: "Body text." }] },
    ];
    expect(roundTrip(blocks)).toEqual(blocks);
  });

  it("writes and re-reads bold/italic/underline/strike/monospace runs", () => {
    const blocks: ContentBlock[] = [
      {
        kind: "paragraph",
        runs: [
          { text: "bold", bold: true },
          { text: "italic", italic: true },
          { text: "under", underline: true },
          { text: "strike", strike: true },
          { text: "mono", fontFamily: "Courier New" },
        ],
      },
    ];
    expect(roundTrip(blocks)).toEqual(blocks);
  });

  it("writes and re-reads a hyperlink", () => {
    const blocks: ContentBlock[] = [
      {
        kind: "paragraph",
        runs: [{ text: "site", hyperlink: "https://example.com" }],
      },
    ];
    expect(roundTrip(blocks)).toEqual(blocks);
  });

  it("writes and re-reads a bullet list", () => {
    const blocks: ContentBlock[] = [
      {
        kind: "paragraph",
        runs: [{ text: "a" }],
        list: { numId: "epub1:bullet", level: 0, itemId: "item1" },
      },
      {
        kind: "paragraph",
        runs: [{ text: "b" }],
        list: { numId: "epub1:bullet", level: 0, itemId: "item2" },
      },
    ];
    expect(roundTrip(blocks)).toEqual(blocks);
  });

  it("writes and re-reads an ordered list with a non-default start", () => {
    const blocks: ContentBlock[] = [
      {
        kind: "paragraph",
        runs: [{ text: "a" }],
        list: { numId: "epub1:ordered@3", level: 0, itemId: "item1" },
      },
    ];
    expect(roundTrip(blocks)).toEqual(blocks);
  });

  it("writes and re-reads a nested list, preserving level", () => {
    const blocks: ContentBlock[] = [
      {
        kind: "paragraph",
        runs: [{ text: "a" }],
        list: { numId: "epub1:bullet", level: 0, itemId: "item1" },
      },
      {
        kind: "paragraph",
        runs: [{ text: "a1" }],
        list: { numId: "epub1:bullet", level: 1, itemId: "item2" },
      },
    ];
    expect(roundTrip(blocks)).toEqual(blocks);
  });

  it("writes and re-reads a table with colspan", () => {
    const blocks: ContentBlock[] = [
      {
        kind: "table",
        rows: [
          {
            cells: [
              {
                blocks: [{ kind: "paragraph", runs: [{ text: "wide" }] }],
                colSpan: 2,
              },
            ],
          },
        ],
        columnWidthsPt: [100, 100],
      },
    ];
    const result = roundTrip(blocks);
    expect(result).toEqual([
      {
        kind: "table",
        rows: [
          {
            cells: [
              {
                blocks: [{ kind: "paragraph", runs: [{ text: "wide" }] }],
                colSpan: 2,
              },
            ],
          },
        ],
        columnWidthsPt: [CONTENT_WIDTH_PT],
      },
    ]);
  });

  it("writes and re-reads a horizontal rule", () => {
    const blocks: ContentBlock[] = [
      { kind: "paragraph", runs: [], styleId: "HorizontalRule" },
    ];
    expect(roundTrip(blocks)).toEqual(blocks);
  });

  it("writes and re-reads a code block with a language", () => {
    const blocks: ContentBlock[] = [
      {
        kind: "paragraph",
        runs: [
          { text: "const x = 1;\nconsole.log(x);", fontFamily: "Courier New" },
        ],
        preformatted: true,
        codeLanguage: "js",
      },
    ];
    expect(roundTrip(blocks)).toEqual(blocks);
  });

  // ExaDev/documents.js#994's round-8 regression: a <pre> containing a footnote reference and no language class produces 2+ runs on read (readPreRuns splits the reference into its own run range), which write.ts's own isPreBlockParagraph used to misclassify as an ordinary paragraph (its old heuristic only recognised a lone monospace run) -- silently rewriting the block as a <p> and destroying the verbatim whitespace <pre> exists to preserve. The paragraph's own `preformatted: true` flag is what makes this round-trip correctly regardless of run count.
  it("writes and re-reads a <pre> carrying a footnote reference and no language class, preserving both the verbatim block and the construct", () => {
    const blocks: ContentBlock[] = [
      {
        kind: "paragraph",
        runs: [
          { text: "line one\nsee", fontFamily: "Courier New" },
          { text: "1", fontFamily: "Courier New" },
          { text: "\nline two", fontFamily: "Courier New" },
        ],
        preformatted: true,
        constructs: [
          {
            descriptor: { kind: "anchor", anchorType: "footnote", name: "fn1" },
            startRun: 1,
            endRun: 2,
          },
        ],
      },
      {
        kind: "constructStart",
        descriptor: { kind: "anchor", anchorType: "footnote", name: "fn1" },
      },
      { kind: "paragraph", runs: [{ text: "Note body." }] },
      { kind: "constructEnd" },
    ];
    expect(roundTrip(blocks)).toEqual(blocks);
  });

  it("writes and re-reads a blockquote as a division construct pair", () => {
    const blocks: ContentBlock[] = [
      { kind: "constructStart", descriptor: { kind: "division" } },
      { kind: "paragraph", runs: [{ text: "quoted" }] },
      { kind: "constructEnd" },
    ];
    const result = roundTrip(blocks);
    // The read side re-applies Quote styling + indent from the blockquote wrapper alone -- a fact the write side deliberately does not need to have carried through the input for the wrapper to round-trip.
    expect(result).toEqual([
      { kind: "constructStart", descriptor: { kind: "division" } },
      {
        kind: "paragraph",
        runs: [{ text: "quoted" }],
        indentLeftPt: 36,
        styleId: "Quote",
      },
      { kind: "constructEnd" },
    ]);
  });

  it("writes and re-reads a footnote reference and body", () => {
    const blocks: ContentBlock[] = [
      {
        kind: "paragraph",
        runs: [{ text: "See" }, { text: "1" }, { text: "." }],
        constructs: [
          {
            descriptor: { kind: "anchor", anchorType: "footnote", name: "fn1" },
            startRun: 1,
            endRun: 2,
          },
        ],
      },
      {
        kind: "constructStart",
        descriptor: { kind: "anchor", anchorType: "footnote", name: "fn1" },
      },
      { kind: "paragraph", runs: [{ text: "Note body." }] },
      { kind: "constructEnd" },
    ];
    expect(roundTrip(blocks)).toEqual(blocks);
  });

  it("writes an image using the registered manifest href", () => {
    const xml = write([
      {
        kind: "image",
        format: "png",
        base64: "aGVsbG8=",
        widthPt: 72,
        heightPt: 72,
        altText: "alt",
      },
    ]);
    expect(xml).toContain('src="images/img1.png"');
    expect(xml).toContain('alt="alt"');
  });
});
