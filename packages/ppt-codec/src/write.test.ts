import {
  ContentDocumentSchema,
  DocumentTreeSchema,
  type ContentDocument,
  assembleTree,
  flattenTree,
} from "document-schema.js";
import { describe, expect, it } from "vitest";
import { type PptDiagnostic, PptDiagnosticCodes } from "./diagnostics";
import { PptUnsupportedContentError } from "./errors";
import { readPptContent, readPpt } from "./read";
import { writePpt, writePptContent, writePptStreams } from "./write";

// The primary verification method this package's own README already establishes for its record fixtures: write real records, then read them back through the package's own existing reader, and assert the recovered content equals what was written. A round trip through readPptContent proves the writer's bytes are genuinely conformant [MS-PPT] — not merely internally self-consistent — because the reader was built and tested entirely independently of the writer, against the specification alone.
import { slide } from "./test-support/write-fixtures";

describe("writePptContent / readPptContent round trip", () => {
  it("round-trips a single slide with a single plain-text paragraph", () => {
    const document = {
      metadata: {},
      slides: [
        slide({
          shapes: [
            {
              frame: { xPt: 72, yPt: 36, widthPt: 360, heightPt: 180 },
              insetLeftPt: 0,
              insetTopPt: 0,
              insetRightPt: 0,
              insetBottomPt: 0,
              blocks: [
                {
                  kind: "paragraph" as const,
                  runs: [{ text: "Hello, PowerPoint" }],
                },
              ],
            },
          ],
        }),
      ],
    };

    const bytes = writePptContent(document);
    const { metadata, slides } = readPptContent(bytes);

    expect(metadata).toEqual({});
    expect(slides).toHaveLength(1);
    expect(slides[0]?.size).toEqual({ widthPt: 720, heightPt: 540 });
    expect(slides[0]?.notes).toBe("");
    expect(slides[0]?.shapes).toHaveLength(1);
    expect(slides[0]?.shapes[0]?.frame).toEqual({
      xPt: 72,
      yPt: 36,
      widthPt: 360,
      heightPt: 180,
    });
    expect(slides[0]?.shapes[0]?.blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "Hello, PowerPoint" }] },
    ]);
  });

  it("round-trips several paragraphs, splitting on the carriage-return separator", () => {
    const document = {
      metadata: {},
      slides: [
        slide({
          shapes: [
            {
              frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
              insetLeftPt: 0,
              insetTopPt: 0,
              insetRightPt: 0,
              insetBottomPt: 0,
              blocks: [
                { kind: "paragraph" as const, runs: [{ text: "First point" }] },
                {
                  kind: "paragraph" as const,
                  runs: [{ text: "Second point" }],
                },
                { kind: "paragraph" as const, runs: [{ text: "Third point" }] },
              ],
            },
          ],
        }),
      ],
    };

    const { slides } = readPptContent(writePptContent(document));
    expect(slides[0]?.shapes[0]?.blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "First point" }] },
      { kind: "paragraph", runs: [{ text: "Second point" }] },
      { kind: "paragraph", runs: [{ text: "Third point" }] },
    ]);
  });

  it("round-trips an empty paragraph with no runs", () => {
    const document = {
      metadata: {},
      slides: [
        slide({
          shapes: [
            {
              frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
              insetLeftPt: 0,
              insetTopPt: 0,
              insetRightPt: 0,
              insetBottomPt: 0,
              blocks: [
                { kind: "paragraph" as const, runs: [{ text: "Before" }] },
                { kind: "paragraph" as const, runs: [] },
                { kind: "paragraph" as const, runs: [{ text: "After" }] },
              ],
            },
          ],
        }),
      ],
    };

    const { slides } = readPptContent(writePptContent(document));
    expect(slides[0]?.shapes[0]?.blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "Before" }] },
      { kind: "paragraph", runs: [] },
      { kind: "paragraph", runs: [{ text: "After" }] },
    ]);
  });

  it("round-trips a paragraph's alignment and list level", () => {
    const document = {
      metadata: {},
      slides: [
        slide({
          shapes: [
            {
              frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
              insetLeftPt: 0,
              insetTopPt: 0,
              insetRightPt: 0,
              insetBottomPt: 0,
              blocks: [
                {
                  kind: "paragraph" as const,
                  runs: [{ text: "Centered" }],
                  alignment: "center" as const,
                },
                {
                  kind: "paragraph" as const,
                  runs: [{ text: "Indented" }],
                  list: { level: 2 },
                },
              ],
            },
          ],
        }),
      ],
    };

    const { slides } = readPptContent(writePptContent(document));
    expect(slides[0]?.shapes[0]?.blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "Centered" }], alignment: "center" },
      { kind: "paragraph", runs: [{ text: "Indented" }], list: { level: 2 } },
    ]);
  });

  it("round-trips a paragraph's line spacing, before/after spacing, and left margin/indent", () => {
    const document = {
      metadata: {},
      slides: [
        slide({
          shapes: [
            {
              frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
              insetLeftPt: 0,
              insetTopPt: 0,
              insetRightPt: 0,
              insetBottomPt: 0,
              blocks: [
                {
                  kind: "paragraph" as const,
                  runs: [{ text: "Spaced" }],
                  lineSpacing: 1.5,
                  spacingBeforePt: 10,
                  spacingAfterPt: 5,
                  indentLeftPt: 36,
                  indentFirstLinePt: -18,
                },
              ],
            },
          ],
        }),
      ],
    };

    const { slides } = readPptContent(writePptContent(document));
    expect(slides[0]?.shapes[0]?.blocks).toEqual([
      {
        kind: "paragraph",
        runs: [{ text: "Spaced" }],
        lineSpacing: 1.5,
        spacingBeforePt: 10,
        spacingAfterPt: 5,
        indentLeftPt: 36,
        indentFirstLinePt: -18,
      },
    ]);
  });

  it("round-trips several character-formatted runs within one paragraph", () => {
    const document = {
      metadata: {},
      slides: [
        slide({
          shapes: [
            {
              frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
              insetLeftPt: 0,
              insetTopPt: 0,
              insetRightPt: 0,
              insetBottomPt: 0,
              blocks: [
                {
                  kind: "paragraph" as const,
                  runs: [
                    { text: "bold ", bold: true },
                    { text: "italic ", italic: true },
                    { text: "underline", underline: true },
                  ],
                },
              ],
            },
          ],
        }),
      ],
    };

    const { slides } = readPptContent(writePptContent(document));
    expect(slides[0]?.shapes[0]?.blocks).toEqual([
      {
        kind: "paragraph",
        runs: [
          { text: "bold ", bold: true },
          { text: "italic ", italic: true },
          { text: "underline", underline: true },
        ],
      },
    ]);
  });

  it("round-trips a run's explicit false formatting, distinct from stating nothing", () => {
    const document = {
      metadata: {},
      slides: [
        slide({
          shapes: [
            {
              frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
              insetLeftPt: 0,
              insetTopPt: 0,
              insetRightPt: 0,
              insetBottomPt: 0,
              blocks: [
                {
                  kind: "paragraph" as const,
                  runs: [{ text: "not bold", bold: false }],
                },
              ],
            },
          ],
        }),
      ],
    };

    const { slides } = readPptContent(writePptContent(document));
    expect(slides[0]?.shapes[0]?.blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "not bold", bold: false }] },
    ]);
  });

  it("round-trips a run's font family, size, and colour", () => {
    const document = {
      metadata: {},
      slides: [
        slide({
          shapes: [
            {
              frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
              insetLeftPt: 0,
              insetTopPt: 0,
              insetRightPt: 0,
              insetBottomPt: 0,
              blocks: [
                {
                  kind: "paragraph" as const,
                  runs: [
                    {
                      text: "styled",
                      fontFamily: "Verdana",
                      sizePt: 24,
                      color: { r: 0x33 / 255, g: 0x66 / 255, b: 0x99 / 255 },
                    },
                  ],
                },
              ],
            },
          ],
        }),
      ],
    };

    const { slides } = readPptContent(writePptContent(document));
    expect(slides[0]?.shapes[0]?.blocks).toEqual([
      {
        kind: "paragraph",
        runs: [
          {
            text: "styled",
            fontFamily: "Verdana",
            sizePt: 24,
            color: { r: 0x33 / 255, g: 0x66 / 255, b: 0x99 / 255 },
          },
        ],
      },
    ]);
  });

  it("resolves several distinct font families through one shared document font collection", () => {
    const document = {
      metadata: {},
      slides: [
        slide({
          shapes: [
            {
              frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
              insetLeftPt: 0,
              insetTopPt: 0,
              insetRightPt: 0,
              insetBottomPt: 0,
              blocks: [
                {
                  kind: "paragraph" as const,
                  runs: [
                    { text: "a", fontFamily: "Arial" },
                    { text: "b", fontFamily: "Verdana" },
                    { text: "c", fontFamily: "Arial" },
                  ],
                },
              ],
            },
          ],
        }),
      ],
    };

    const { slides } = readPptContent(writePptContent(document));
    expect(slides[0]?.shapes[0]?.blocks).toEqual([
      {
        kind: "paragraph",
        runs: [
          { text: "a", fontFamily: "Arial" },
          { text: "b", fontFamily: "Verdana" },
          { text: "c", fontFamily: "Arial" },
        ],
      },
    ]);
  });

  it("round-trips several shapes on one slide, each with its own frame and text", () => {
    const document = {
      metadata: {},
      slides: [
        slide({
          shapes: [
            {
              frame: { xPt: 10, yPt: 10, widthPt: 200, heightPt: 50 },
              insetLeftPt: 0,
              insetTopPt: 0,
              insetRightPt: 0,
              insetBottomPt: 0,
              blocks: [
                { kind: "paragraph" as const, runs: [{ text: "Title" }] },
              ],
            },
            {
              frame: { xPt: 10, yPt: 100, widthPt: 400, heightPt: 300 },
              insetLeftPt: 0,
              insetTopPt: 0,
              insetRightPt: 0,
              insetBottomPt: 0,
              blocks: [
                { kind: "paragraph" as const, runs: [{ text: "Body" }] },
              ],
            },
          ],
        }),
      ],
    };

    const { slides } = readPptContent(writePptContent(document));
    expect(slides[0]?.shapes).toHaveLength(2);
    expect(slides[0]?.shapes[0]?.frame).toEqual({
      xPt: 10,
      yPt: 10,
      widthPt: 200,
      heightPt: 50,
    });
    expect(slides[0]?.shapes[0]?.blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "Title" }] },
    ]);
    expect(slides[0]?.shapes[1]?.frame).toEqual({
      xPt: 10,
      yPt: 100,
      widthPt: 400,
      heightPt: 300,
    });
    expect(slides[0]?.shapes[1]?.blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "Body" }] },
    ]);
  });

  it("round-trips a shape carrying no text at all", () => {
    const document = {
      metadata: {},
      slides: [
        slide({
          shapes: [
            {
              frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
              insetLeftPt: 0,
              insetTopPt: 0,
              insetRightPt: 0,
              insetBottomPt: 0,
              blocks: [],
            },
          ],
        }),
      ],
    };

    const { slides } = readPptContent(writePptContent(document));
    expect(slides[0]?.shapes[0]?.blocks).toEqual([]);
  });

  it("round-trips several slides, each with its own persist object", () => {
    const document = {
      metadata: {},
      slides: [
        slide({
          shapes: [
            {
              frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
              insetLeftPt: 0,
              insetTopPt: 0,
              insetRightPt: 0,
              insetBottomPt: 0,
              blocks: [
                { kind: "paragraph" as const, runs: [{ text: "Slide one" }] },
              ],
            },
          ],
        }),
        slide({
          shapes: [
            {
              frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
              insetLeftPt: 0,
              insetTopPt: 0,
              insetRightPt: 0,
              insetBottomPt: 0,
              blocks: [
                { kind: "paragraph" as const, runs: [{ text: "Slide two" }] },
              ],
            },
          ],
        }),
        slide({
          shapes: [
            {
              frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
              insetLeftPt: 0,
              insetTopPt: 0,
              insetRightPt: 0,
              insetBottomPt: 0,
              blocks: [
                { kind: "paragraph" as const, runs: [{ text: "Slide three" }] },
              ],
            },
          ],
        }),
      ],
    };

    const { slides } = readPptContent(writePptContent(document));
    expect(slides).toHaveLength(3);
    expect(slides.map((s) => s.shapes[0]?.blocks)).toEqual([
      [{ kind: "paragraph", runs: [{ text: "Slide one" }] }],
      [{ kind: "paragraph", runs: [{ text: "Slide two" }] }],
      [{ kind: "paragraph", runs: [{ text: "Slide three" }] }],
    ]);
  });

  it("round-trips a presentation with no slides at all", () => {
    const document = { metadata: {}, slides: [] };
    const { slides } = readPptContent(writePptContent(document));
    expect(slides).toEqual([]);
  });

  it("drops a block kind this writer does not represent, keeping the paragraphs around it and naming the drop through the diagnostic sink", () => {
    const document = {
      metadata: {},
      slides: [
        slide({
          shapes: [
            {
              frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
              insetLeftPt: 0,
              insetTopPt: 0,
              insetRightPt: 0,
              insetBottomPt: 0,
              blocks: [
                { kind: "paragraph" as const, runs: [{ text: "Before" }] },
                { kind: "pageBreak" as const },
                { kind: "paragraph" as const, runs: [{ text: "After" }] },
              ],
            },
          ],
        }),
      ],
    };

    const diagnostics: PptDiagnostic[] = [];
    const { slides } = readPptContent(
      writePptContent(document, {
        sink: (diagnostic) => {
          diagnostics.push(diagnostic);
        },
      }),
    );
    expect(slides[0]?.shapes[0]?.blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "Before" }] },
      { kind: "paragraph", runs: [{ text: "After" }] },
    ]);
    expect(diagnostics).toEqual([
      {
        code: PptDiagnosticCodes.BLOCK_DROPPED,
        severity: "warning",
        message:
          "slide 1: a 'pageBreak' block is dropped; this writer produces no [MS-PPT] spelling for it",
      },
    ]);
  });

  it("throws the same drop as a PptUnsupportedContentError when onUnwritableBlock is 'throw', rather than merely reporting it", () => {
    const document = {
      metadata: {},
      slides: [
        slide({
          shapes: [
            {
              frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
              insetLeftPt: 0,
              insetTopPt: 0,
              insetRightPt: 0,
              insetBottomPt: 0,
              blocks: [{ kind: "pageBreak" as const }],
            },
          ],
        }),
      ],
    };

    expect(() =>
      writePptContent(document, { onUnwritableBlock: "throw" }),
    ).toThrow(PptUnsupportedContentError);
    expect(() =>
      writePptContent(document, { onUnwritableBlock: "throw" }),
    ).toThrow(
      "slide 1: a 'pageBreak' block is dropped; this writer produces no [MS-PPT] spelling for it",
    );

    // The default — and 'drop' stated explicitly — both keep reporting through the sink alone, exactly as the test above already pins.
    expect(() => writePptContent(document)).not.toThrow();
    expect(() =>
      writePptContent(document, { onUnwritableBlock: "drop" }),
    ).not.toThrow();
  });

  it("throws when two slides declare different sizes, which [MS-PPT] cannot express", () => {
    const document = {
      metadata: {},
      slides: [
        slide({ size: { widthPt: 720, heightPt: 540 } }),
        slide({ size: { widthPt: 960, heightPt: 540 } }),
      ],
    };
    expect(() => writePptContent(document)).toThrow(PptUnsupportedContentError);
  });
});

describe("writePptStreams", () => {
  it("produces the same two streams readPptStreams' own compound-file caller expects", () => {
    const document = { metadata: {}, slides: [slide()] };
    const { currentUserStream, powerPointDocumentStream } =
      writePptStreams(document);
    expect(currentUserStream.length).toBeGreaterThan(0);
    expect(powerPointDocumentStream.length).toBeGreaterThan(0);
  });
});

describe("writePpt / readPpt round trip", () => {
  it("writes a DocumentTree and reads an equal one back", () => {
    const content: ContentDocument = {
      kind: "presentation",
      metadata: {},
      slides: [
        slide({
          shapes: [
            {
              frame: { xPt: 72, yPt: 72, widthPt: 400, heightPt: 100 },
              insetLeftPt: 0.1 * 72,
              insetTopPt: 0.05 * 72,
              insetRightPt: 0.1 * 72,
              insetBottomPt: 0.05 * 72,
              blocks: [
                {
                  kind: "paragraph" as const,
                  runs: [{ text: "Tree round trip" }],
                },
              ],
            },
          ],
        }),
      ],
    };
    const tree = assembleTree(content);
    const bytes = writePpt(tree);
    const roundTripped = readPpt(bytes);
    expect(roundTripped.kind).toBe("presentation");
    expect(flattenTree(roundTripped)).toEqual(flattenTree(tree));
  });

  it("round-trips insets that differ from PowerPoint's own defaults", () => {
    const content: ContentDocument = {
      kind: "presentation",
      metadata: {},
      slides: [
        slide({
          shapes: [
            {
              frame: { xPt: 72, yPt: 72, widthPt: 400, heightPt: 100 },
              insetLeftPt: 20,
              insetTopPt: 10,
              insetRightPt: 15,
              insetBottomPt: 5,
              blocks: [
                {
                  kind: "paragraph" as const,
                  runs: [{ text: "Custom insets" }],
                },
              ],
            },
          ],
        }),
      ],
    };
    const tree = assembleTree(content);
    const roundTripped = readPpt(writePpt(tree));
    expect(flattenTree(roundTripped)).toEqual(flattenTree(tree));
  });

  it("throws when asked to write a non-presentation document", () => {
    const content: ContentDocument = {
      kind: "wordprocessing",
      metadata: {},
      sections: [],
    };
    expect(() => writePpt(assembleTree(content))).toThrow(
      PptUnsupportedContentError,
    );
    expect(() => writePpt(assembleTree(content))).toThrow(
      "ppt-codec's writer only writes presentation documents; got a 'wordprocessing' document",
    );
  });
});

describe("the shared schema accepts what the writer's own round trip produces", () => {
  it("parses the flat form written and read back as a presentation ContentDocument", () => {
    const document = {
      metadata: {},
      slides: [
        slide({
          shapes: [
            {
              frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
              insetLeftPt: 0,
              insetTopPt: 0,
              insetRightPt: 0,
              insetBottomPt: 0,
              blocks: [
                { kind: "paragraph" as const, runs: [{ text: "Valid" }] },
              ],
            },
          ],
        }),
      ],
    };
    const { metadata, slides } = readPptContent(writePptContent(document));
    expect(() =>
      ContentDocumentSchema.parse({ kind: "presentation", metadata, slides }),
    ).not.toThrow();
  });

  it("parses the tree form written and read back as a DocumentTree", () => {
    const document = {
      metadata: {},
      slides: [slide()],
    };
    expect(() =>
      DocumentTreeSchema.parse(readPpt(writePptContent(document))),
    ).not.toThrow();
  });
});

describe("requireOneSlideSize", () => {
  it("accepts every slide sharing the identical size", () => {
    const document = {
      metadata: {},
      slides: [
        slide({ size: { widthPt: 500, heightPt: 400 } }),
        slide({ size: { widthPt: 500, heightPt: 400 } }),
      ],
    };
    expect(() => writePptContent(document)).not.toThrow();
  });

  it("rejects a differing heightPt even when widthPt agrees", () => {
    // Isolates the second half of the widthPt/heightPt OR check: a fixture differing in both fields could pass even with the heightPt half of the check disabled entirely.
    const document = {
      metadata: {},
      slides: [
        slide({ size: { widthPt: 500, heightPt: 400 } }),
        slide({ size: { widthPt: 500, heightPt: 999 } }),
      ],
    };
    expect(() => writePptContent(document)).toThrow(PptUnsupportedContentError);
    expect(() => writePptContent(document)).toThrow(
      `ppt-codec's writer cannot express per-slide sizes: slide sizes ${JSON.stringify({ widthPt: 500, heightPt: 400 })} and ${JSON.stringify({ widthPt: 500, heightPt: 999 })} both appear, but [MS-PPT]'s DocumentAtom states exactly one slide size for the whole presentation`,
    );
  });

  it("rejects a differing widthPt even when heightPt agrees", () => {
    const document = {
      metadata: {},
      slides: [
        slide({ size: { widthPt: 500, heightPt: 400 } }),
        slide({ size: { widthPt: 999, heightPt: 400 } }),
      ],
    };
    expect(() => writePptContent(document)).toThrow(PptUnsupportedContentError);
  });
});
