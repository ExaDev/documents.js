import type { ContentDocument } from "document-schema.js";
import { describe, expect, it } from "vitest";
import { EPUB_MIME_TYPE } from "./format";
import { readEpubContent } from "./read";
import {
  assertMimetypeEntryLayout,
  localFileHeaderNames,
} from "./test-support/zip";
import { bytesToBase64 } from "./util/base64";
import { writeEpubContent } from "./write";

// A real end-to-end round trip: a hand-built ContentDocument covering most of the element list ExaDev/documents.js#801 asks for, written to a genuine EPUB 3 zip via writeEpubContent, then read back via readEpubContent -- proving the two sides agree on every convention this package invents (list numId grammar, footnote descriptor shape, HorizontalRule styleId, monospace-as-code-block detection) without a real EPUB library on either side to fall back on.
//
// The image fixture is a bare IHDR-only PNG (fakePng1x1 below), not a real decodable image file: this package's own reader never walks past a PNG's IHDR chunk (see src/image/dimensions.ts), so a genuinely complete PNG with real pixel data and a valid IDAT/IEND buys this test nothing a hand-built header does not already prove.

// A PNG carrying only what src/image/dimensions.ts reads: the 8-byte signature plus an IHDR chunk declaring 1x1 -- this package's own reader never walks past IHDR (no full pixel decode, see that module's own top-of-file note), so a real IDAT/IEND is not needed for this round trip to exercise real dimension detection.
function fakePng1x1(): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, 1);
  view.setUint32(20, 1);
  bytes.set([8, 6, 0, 0, 0], 24);
  return bytes;
}

describe("writeEpubContent -> readEpubContent round trip", () => {
  it("reproduces a document covering headings, styled text, lists, a table, an image, a hyperlink, a blockquote, pre/code, hr, and a footnote", () => {
    const document: ContentDocument = {
      kind: "wordprocessing",
      metadata: {
        title: "Round Trip Book",
        author: "Ada Lovelace",
        language: "en",
      },
      sections: [
        {
          pageSize: { widthPt: 595.28, heightPt: 841.89 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [
            {
              kind: "paragraph",
              headingLevel: 1,
              runs: [{ text: "Chapter One" }],
            },
            {
              kind: "paragraph",
              runs: [
                { text: "Plain, " },
                { text: "bold", bold: true },
                { text: ", " },
                { text: "italic", italic: true },
                { text: ", and " },
                { text: "linked", hyperlink: "https://example.com" },
                { text: " text." },
              ],
            },
            {
              kind: "paragraph",
              runs: [{ text: "first" }],
              list: { numId: "epub1:bullet", level: 0, itemId: "item1" },
            },
            {
              kind: "paragraph",
              runs: [{ text: "second" }],
              list: { numId: "epub1:bullet", level: 0, itemId: "item2" },
            },
            // A plain, list-less paragraph is required here to close the list scope before non-list content resumes: document-schema.js's own decompose() (src/xhtml/write.ts's own dependency) attaches a non-paragraph block (a table, an image, a construct) to whatever list item is still open rather than resetting the scope itself -- only a paragraph carrying no list membership does that. A real EPUB's own <ul>...</ul> closing tag makes this automatic on read (src/xhtml/read.ts's readList only ever consumes one list element's own <li> children), so this spacer exists purely because this fixture is a hand-built ContentDocument rather than something this package's own reader produced. Non-empty, deliberately: an empty paragraph carries no runs for buildInlineRuns to produce, so readContainerChildren's own "phrasing content that produced nothing is dropped" rule (needed so a bare `<p></p>` a producer emits for CSS spacing doesn't become a bogus empty ContentParagraph on read) would silently vanish it on the way back, breaking this exact round trip.
            { kind: "paragraph", runs: [{ text: "Back to plain flow." }] },
            {
              kind: "table",
              rows: [
                {
                  cells: [
                    {
                      blocks: [
                        {
                          kind: "paragraph",
                          runs: [{ text: "Head", bold: true }],
                        },
                      ],
                    },
                  ],
                },
                {
                  cells: [
                    {
                      blocks: [{ kind: "paragraph", runs: [{ text: "Cell" }] }],
                    },
                  ],
                },
              ],
              columnWidthsPt: [451.28],
            },
            {
              kind: "image",
              format: "png",
              base64: bytesToBase64(fakePng1x1()),
              widthPt: 0.75,
              heightPt: 0.75,
              altText: "a tiny white pixel",
            },
            { kind: "constructStart", descriptor: { kind: "division" } },
            {
              kind: "paragraph",
              runs: [{ text: "A quoted thought." }],
              indentLeftPt: 36,
              styleId: "Quote",
            },
            { kind: "constructEnd" },
            {
              kind: "paragraph",
              runs: [{ text: "const answer = 42;", fontFamily: "Courier New" }],
              preformatted: true,
              codeLanguage: "js",
            },
            { kind: "paragraph", runs: [], styleId: "HorizontalRule" },
            {
              kind: "paragraph",
              runs: [
                { text: "A footnoted claim" },
                { text: "1" },
                { text: "." },
              ],
              constructs: [
                {
                  descriptor: {
                    kind: "anchor",
                    anchorType: "footnote",
                    name: "fn1",
                  },
                  startRun: 1,
                  endRun: 2,
                },
              ],
            },
            {
              kind: "constructStart",
              descriptor: {
                kind: "anchor",
                anchorType: "footnote",
                name: "fn1",
              },
            },
            { kind: "paragraph", runs: [{ text: "The footnote's own body." }] },
            { kind: "constructEnd" },
          ],
        },
      ],
    };

    const bytes = writeEpubContent(document);
    const result = readEpubContent(bytes);

    expect(result.kind).toBe("wordprocessing");
    if (result.kind !== "wordprocessing") return;
    expect(result.metadata).toEqual(document.metadata);
    expect(result.sections).toHaveLength(1);
    const [section] = result.sections;
    expect(section).toBeDefined();
    if (section === undefined) return;

    // Page geometry is invented on read (EPUB has no page concept), so only the content is compared block for block.
    expect(section.blocks).toEqual(document.sections[0]?.blocks);
  });

  it("re-emits a section's own quarantined CSS residue verbatim on a same-format write", () => {
    const document: ContentDocument = {
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          pageSize: { widthPt: 595.28, heightPt: 841.89 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [{ kind: "paragraph", runs: [{ text: "Styled section." }] }],
          source: {
            format: "epub",
            xml: "<style>p { color: red; }</style>",
          },
        },
      ],
    };
    const result = readEpubContent(writeEpubContent(document));
    expect(result.kind).toBe("wordprocessing");
    if (result.kind !== "wordprocessing") return;
    expect(result.sections[0]?.source).toEqual(document.sections[0]?.source);
  });

  it("writes the OCF-mandated mimetype-first/stored byte layout at the full pipeline level", () => {
    // Not a byte-for-byte determinism check across two writes: writeOpf mints a fresh dc:identifier per call (ExaDev/documents.js#801's own explicit "generated identifier" write scope), so the OPF entry's own compressed bytes genuinely differ between two writes of the identical document -- that is correct, not a gap in the fixed-mtime/ordered-entries discipline src/zip.ts's own unit tests already pin at the fflate-wrapper level. What IS a fixed, checkable invariant at this full-pipeline level is the physical layout OCF requires: "mimetype" first, stored uncompressed, and META-INF/container.xml immediately after it.
    const document: ContentDocument = {
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          pageSize: { widthPt: 595.28, heightPt: 841.89 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [{ kind: "paragraph", runs: [{ text: "Hello." }] }],
        },
      ],
    };
    const bytes = writeEpubContent(document);
    expect(localFileHeaderNames(bytes).slice(0, 2)).toEqual([
      "mimetype",
      "META-INF/container.xml",
    ]);
    assertMimetypeEntryLayout(bytes, EPUB_MIME_TYPE);
  });
});
