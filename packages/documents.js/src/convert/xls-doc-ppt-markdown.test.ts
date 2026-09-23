import { describe, expect, it } from "vitest";
import { writeDocContent } from "doc-codec";
import { writeXlsContent } from "xls-codec";
import { decodeMarkdownText } from "../markdown/text";
import { writePptContent } from "../ppt/write";
import { docToMarkdown, pptToMarkdown, xlsToMarkdown } from "./convert";

// xlsToMarkdown/docToMarkdown/pptToMarkdown are the same convenience xlsxToMarkdown already offers (a caller with legacy-binary bytes wanting text, with no PDF layout pass), extended to the three other legacy binary formats that can reach the wordprocessing variant: xls (spreadsheet, cross-variant bridge), doc (already wordprocessing, same-variant bridge), and ppt (presentation, cross-variant bridge). See convert.ts's own comments on each function for which bridge resolves it and what it loses. The starting bytes are built through each format's own real writer directly, matching this suite's own fixture-independence convention (see convert.test.ts's docToPdf/xlsToPdf/pptToPdf describe blocks for the identical pattern).

describe("xlsToMarkdown", () => {
  function sampleXlsBytes(cellText: string): Uint8Array<ArrayBuffer> {
    return writeXlsContent({
      kind: "spreadsheet",
      metadata: {},
      sheets: [
        {
          name: "Sheet1",
          cells: [
            {
              row: 0,
              column: 0,
              value: { kind: "string", value: cellText },
              displayText: cellText,
            },
          ],
          columns: [],
          rows: [],
          images: [],
          printSettings: {
            pageSize: { widthPt: 612, heightPt: 792 },
            margins: {
              topPt: 54,
              rightPt: 50.4,
              bottomPt: 54,
              leftPt: 50.4,
            },
            gridlines: false,
            headers: false,
            pageOrder: "downThenOver",
          },
        },
      ],
    });
  }

  it("produces markdown carrying the rendered cell text from real xls bytes", () => {
    const markdown = decodeMarkdownText(
      xlsToMarkdown(sampleXlsBytes("Hello world")),
    );
    expect(markdown).toContain("Hello world");
  });
});

describe("docToMarkdown", () => {
  function sampleDocBytes(text: string): Uint8Array<ArrayBuffer> {
    return writeDocContent({
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [{ kind: "paragraph", runs: [{ text }] }],
        },
      ],
    });
  }

  it("produces markdown carrying the paragraph text from real doc bytes", () => {
    const markdown = decodeMarkdownText(
      docToMarkdown(sampleDocBytes("Hello world")),
    );
    expect(markdown).toContain("Hello world");
  });
});

describe("pptToMarkdown", () => {
  function samplePptBytes(text: string): Uint8Array<ArrayBuffer> {
    return writePptContent({
      kind: "presentation",
      metadata: {},
      slides: [
        {
          size: { widthPt: 720, heightPt: 540 },
          notes: "",
          shapes: [
            {
              frame: { xPt: 72, yPt: 36, widthPt: 360, heightPt: 180 },
              insetLeftPt: 0,
              insetTopPt: 0,
              insetRightPt: 0,
              insetBottomPt: 0,
              blocks: [{ kind: "paragraph", runs: [{ text }] }],
            },
          ],
        },
      ],
    });
  }

  it("produces markdown carrying the slide text from real ppt bytes", () => {
    const markdown = decodeMarkdownText(
      pptToMarkdown(samplePptBytes("Hello world")),
    );
    expect(markdown).toContain("Hello world");
  });
});
