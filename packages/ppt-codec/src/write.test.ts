import { readCompoundFile } from "archive-codec";
import { encodePng } from "byte-codec";
import {
  ContentDocumentSchema,
  DocumentTreeSchema,
  type ContentDocument,
  type ContentImageBlock,
  type ContentShape,
  type ContentSlide,
  assembleTree,
  flattenTree,
} from "document-schema.js";
import { describe, expect, it } from "vitest";
import { bytesToBase64 } from "./base64";
import { readNotesContainerAtom } from "./document/notes";
import { readNotesListWithText } from "./document/notes-list";
import { readSlideListWithText } from "./document/slide-list";
import { type PptDiagnostic, PptDiagnosticCodes } from "./diagnostics";
import { PptUnsupportedContentError } from "./errors";
import { readPptContent, readPpt } from "./read";
import {
  type PptRecord,
  childRecords,
  readRecordAt,
  readRecordSequence,
} from "./record/tree";
import {
  OfficeArtBStoreContainer,
  OfficeArtDggContainer,
  OfficeArtFDGGBlock,
  RT_ColorSchemeAtom,
  RT_DrawingGroup,
  RT_Notes,
  RT_SlideListWithText,
  SLIDE_LIST_INSTANCE_NOTES,
  SLIDE_LIST_INSTANCE_SLIDES,
} from "./record/types";
import { readCurrentUserAtom } from "./stream/current-user";
import { buildPersistDirectory } from "./stream/persist";
import { writePpt, writePptContent, writePptStreams } from "./write";

// The primary verification method this package's own README already establishes for its record fixtures: write real records, then read them back through the package's own existing reader, and assert the recovered content equals what was written. A round trip through readPptContent proves the writer's bytes are genuinely conformant [MS-PPT] -- not merely internally self-consistent -- because the reader was built and tested entirely independently of the writer, against the specification alone.

function slide(overrides: Partial<ContentSlide> = {}): ContentSlide {
  return {
    size: { widthPt: 720, heightPt: 540 },
    shapes: [],
    notes: "",
    ...overrides,
  };
}

// The PowerPoint Document stream's own top-level record sequence: the document container, every slide and notes container, the persist directory and the user edit, in the order the writer laid them out.
function topLevelRecords(streamBytes: Uint8Array<ArrayBuffer>): PptRecord[] {
  return readRecordSequence(streamBytes, 0, streamBytes.length);
}

function recordTypesIn(streamBytes: Uint8Array<ArrayBuffer>): number[] {
  return topLevelRecords(streamBytes).map((record) => record.header.recType);
}

// Narrows a lookup that the surrounding assertion has already established must succeed, so a test reads a record's fields without an `as` cast standing in for the check.
function requireRecord(
  record: PptRecord | undefined,
  describe_: string,
): PptRecord {
  if (record === undefined) {
    throw new Error(`the writer produced no ${describe_}`);
  }
  return record;
}

function listWithInstance(
  documentContainer: PptRecord,
  instance: number,
): PptRecord | undefined {
  return childRecords(documentContainer).find(
    (record) =>
      record.header.recType === RT_SlideListWithText &&
      record.header.recInstance === instance,
  );
}

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
        sink: (diagnostic) => diagnostics.push(diagnostic),
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

  describe("pictures and rotation", () => {
    const PNG = encodePng({
      width: 1,
      height: 1,
      channels: 3,
      data: new Uint8Array([0x11, 0x22, 0x33]),
    });
    const OTHER_PNG = encodePng({
      width: 1,
      height: 1,
      channels: 3,
      data: new Uint8Array([0x44, 0x55, 0x66]),
    });
    const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

    function pictureShape(
      image: { format: "png" | "jpeg"; bytes: Uint8Array<ArrayBuffer> },
      rotationDeg?: number,
    ): ContentShape {
      return {
        frame: { xPt: 40, yPt: 60, widthPt: 200, heightPt: 150 },
        ...(rotationDeg === undefined ? {} : { rotationDeg }),
        insetLeftPt: 0,
        insetTopPt: 0,
        insetRightPt: 0,
        insetBottomPt: 0,
        blocks: [
          {
            kind: "image",
            format: image.format,
            base64: bytesToBase64(image.bytes),
            widthPt: 200,
            heightPt: 150,
          },
        ],
      };
    }

    it("round-trips a picture through the document's blip store, sized to its frame", () => {
      const { slides } = readPptContent(
        writePptContent({
          metadata: {},
          slides: [
            slide({
              shapes: [
                pictureShape({ format: "png", bytes: PNG }),
                pictureShape({ format: "jpeg", bytes: JPEG }, 45),
              ],
            }),
          ],
        }),
      );
      expect(slides[0]?.shapes[0]).toEqual({
        frame: { xPt: 40, yPt: 60, widthPt: 200, heightPt: 150 },
        insetLeftPt: 0,
        insetTopPt: 0,
        insetRightPt: 0,
        insetBottomPt: 0,
        blocks: [
          {
            kind: "image",
            format: "png",
            base64: bytesToBase64(PNG),
            widthPt: 200,
            heightPt: 150,
          },
        ],
      });
    });

    it("round-trips a rotated shape's rotationDeg through its property table", () => {
      const { slides } = readPptContent(
        writePptContent({
          metadata: {},
          slides: [
            slide({
              shapes: [
                pictureShape({ format: "jpeg", bytes: JPEG }, 45),
                {
                  frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
                  rotationDeg: 270,
                  insetLeftPt: 0.1 * 72,
                  insetTopPt: 0.05 * 72,
                  insetRightPt: 0.1 * 72,
                  insetBottomPt: 0.05 * 72,
                  blocks: [{ kind: "paragraph", runs: [{ text: "tilted" }] }],
                },
              ],
            }),
          ],
        }),
      );
      expect(slides[0]?.shapes[0]?.rotationDeg).toBe(45);
      expect(slides[0]?.shapes[1]?.rotationDeg).toBe(270);
    });

    it("writes one store entry for an image shown on several slides, so every showing reads back", () => {
      const { slides } = readPptContent(
        writePptContent({
          metadata: {},
          slides: [
            slide({ shapes: [pictureShape({ format: "png", bytes: PNG })] }),
            slide({
              shapes: [
                pictureShape({ format: "png", bytes: PNG }),
                pictureShape({ format: "png", bytes: OTHER_PNG }),
              ],
            }),
          ],
        }),
      );
      const secondSlideImages = slides[1]?.shapes
        .map((shape) => shape.blocks.find((block) => block.kind === "image"))
        .filter((block): block is ContentImageBlock => block !== undefined);
      expect(secondSlideImages).toHaveLength(2);
      expect(secondSlideImages?.[0]?.base64).toBe(bytesToBase64(PNG));
      expect(secondSlideImages?.[1]?.base64).toBe(bytesToBase64(OTHER_PNG));
      // The identical PNG on slide 1 reads back there too -- a shared store entry, not a copy per slide.
      const firstSlideImage = slides[0]?.shapes[0]?.blocks.find(
        (block): block is ContentImageBlock => block.kind === "image",
      );
      expect(firstSlideImage?.base64).toBe(bytesToBase64(PNG));
    });

    it("drops an image whose format has no MSOBLIPTYPE token here, naming it through the diagnostic sink", () => {
      const diagnostics: PptDiagnostic[] = [];
      const { slides } = readPptContent(
        writePptContent(
          {
            metadata: {},
            slides: [
              slide({
                shapes: [
                  {
                    frame: {
                      xPt: 0,
                      yPt: 0,
                      widthPt: 100,
                      heightPt: 100,
                    },
                    insetLeftPt: 0,
                    insetTopPt: 0,
                    insetRightPt: 0,
                    insetBottomPt: 0,
                    blocks: [
                      {
                        kind: "image",
                        format: "svg",
                        base64: "eyJub3RoaW5nIjo",
                        widthPt: 100,
                        heightPt: 100,
                      },
                      { kind: "paragraph", runs: [{ text: "kept" }] },
                    ],
                  },
                ],
              }),
            ],
          },
          { sink: (diagnostic) => diagnostics.push(diagnostic) },
        ),
      );
      expect(slides[0]?.shapes[0]?.blocks).toEqual([
        { kind: "paragraph", runs: [{ text: "kept" }] },
      ]);
      expect(diagnostics).toEqual([
        {
          code: PptDiagnosticCodes.IMAGE_DROPPED,
          severity: "warning",
          message:
            "slide 1: an image block in format 'svg' is dropped; MSOBLIPTYPE gives this writer a blip record for PNG and JPEG only",
        },
      ]);
    });

    it("drops a second image on one shape, whose single blip reference the first image consumed", () => {
      const diagnostics: PptDiagnostic[] = [];
      const { slides } = readPptContent(
        writePptContent(
          {
            metadata: {},
            slides: [
              slide({
                shapes: [
                  {
                    frame: {
                      xPt: 0,
                      yPt: 0,
                      widthPt: 100,
                      heightPt: 100,
                    },
                    insetLeftPt: 0,
                    insetTopPt: 0,
                    insetRightPt: 0,
                    insetBottomPt: 0,
                    blocks: [
                      {
                        kind: "image",
                        format: "png",
                        base64: bytesToBase64(PNG),
                        widthPt: 100,
                        heightPt: 100,
                      },
                      {
                        kind: "image",
                        format: "jpeg",
                        base64: bytesToBase64(JPEG),
                        widthPt: 100,
                        heightPt: 100,
                      },
                    ],
                  },
                ],
              }),
            ],
          },
          { sink: (diagnostic) => diagnostics.push(diagnostic) },
        ),
      );
      const images = slides[0]?.shapes[0]?.blocks.filter(
        (block): block is ContentImageBlock => block.kind === "image",
      );
      expect(images).toHaveLength(1);
      expect(images?.[0]?.base64).toBe(bytesToBase64(PNG));
      expect(diagnostics).toEqual([
        {
          code: PptDiagnosticCodes.IMAGE_DROPPED,
          severity: "warning",
          message:
            "slide 1: a second image block is dropped; a shape carries exactly one blip-store reference, and an earlier image already consumed it",
        },
      ]);
    });
  });

  describe("the document-wide drawing group", () => {
    // The OfficeArtFDGG's own four count fields ([MS-ODRAW] 2.2.47): spidMax, cidcl, cspSaved, cdgSaved, in order.
    function fdggFields(
      streamBytes: Uint8Array<ArrayBuffer>,
    ): [number, number, number, number] {
      const document = requireRecord(
        topLevelRecords(streamBytes)[0],
        "document container",
      );
      const drawingGroup = requireRecord(
        childRecords(document).find(
          (record) => record.header.recType === RT_DrawingGroup,
        ),
        "drawing group container",
      );
      const dgg = requireRecord(
        childRecords(drawingGroup).find(
          (record) => record.header.recType === OfficeArtDggContainer,
        ),
        "OfficeArtDggContainer",
      );
      const fdgg = requireRecord(
        childRecords(dgg).find(
          (record) => record.header.recType === OfficeArtFDGGBlock,
        ),
        "OfficeArtFDGGBlock",
      );
      const view = new DataView(
        fdgg.data.buffer,
        fdgg.data.byteOffset,
        fdgg.data.byteLength,
      );
      return [
        view.getUint32(0, true),
        view.getUint32(4, true),
        view.getUint32(8, true),
        view.getUint32(12, true),
      ];
    }

    it("states shape, drawing and identifier counts derived from the drawings actually written", () => {
      const { powerPointDocumentStream } = writePptStreams({
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
                blocks: [{ kind: "paragraph", runs: [{ text: "one" }] }],
              },
              {
                frame: { xPt: 0, yPt: 120, widthPt: 100, heightPt: 100 },
                insetLeftPt: 0,
                insetTopPt: 0,
                insetRightPt: 0,
                insetBottomPt: 0,
                blocks: [{ kind: "paragraph", runs: [{ text: "two" }] }],
              },
            ],
            notes: "with notes",
          }),
        ],
      });
      // The master's drawing carries its patriarch and five placeholders (spids 1..6), the slide's its patriarch and two shapes (spids 1..4), the notes slide's its patriarch and one body (spids 1..2): eleven shape containers across three drawings, and 6 the highest identifier any of them minted.
      expect(fdggFields(powerPointDocumentStream)).toEqual([6, 2, 11, 3]);
    });

    it("still states a drawing group for a picture-free document, with no blip store in it", () => {
      const { powerPointDocumentStream } = writePptStreams({
        metadata: {},
        slides: [slide()],
      });
      // The master's six shapes and the slide drawing's lone patriarch: seven containers, two drawings, spidMax 6.
      expect(fdggFields(powerPointDocumentStream)).toEqual([6, 2, 7, 2]);
      const document = requireRecord(
        topLevelRecords(powerPointDocumentStream)[0],
        "document container",
      );
      const drawingGroup = requireRecord(
        childRecords(document).find(
          (record) => record.header.recType === RT_DrawingGroup,
        ),
        "drawing group container",
      );
      const dgg = requireRecord(
        childRecords(drawingGroup).find(
          (record) => record.header.recType === OfficeArtDggContainer,
        ),
        "OfficeArtDggContainer",
      );
      expect(
        childRecords(dgg).find(
          (record) => record.header.recType === OfficeArtBStoreContainer,
        ),
      ).toBeUndefined();
    });
  });

  describe("metadata", () => {
    it('round-trips title/subject/author/keywords/dates through a real "\\x05SummaryInformation" stream', () => {
      const document = {
        metadata: {
          title: "Quarterly review",
          subject: "Finance",
          author: "Joe",
          keywords: ["finance", "quarterly"],
          createdIso: "2024-01-15T09:00:00.000Z",
          modifiedIso: "2024-03-20T14:30:00.000Z",
        },
        slides: [slide()],
      };
      const bytes = writePptContent(document);
      expect(readPptContent(bytes).metadata).toEqual(document.metadata);
    });

    it('writes no "\\x05SummaryInformation" stream at all when metadata carries nothing that stream can hold', () => {
      const bytes = writePptContent({ metadata: {}, slides: [slide()] });
      const streams = readCompoundFile(bytes);
      expect(
        streams.some((stream) => stream.path === "\x05SummaryInformation"),
      ).toBe(false);
      expect(readPptContent(bytes).metadata).toEqual({});
    });

    it("throws a PptUnsupportedContentError, not a raw RangeError, for a malformed createdIso", () => {
      const document = {
        metadata: { createdIso: "not-a-real-date" },
        slides: [slide()],
      };
      expect(() => writePptContent(document)).toThrow(
        PptUnsupportedContentError,
      );
    });

    it("throws a PptUnsupportedContentError, not a raw RangeError, for a malformed modifiedIso", () => {
      const document = {
        metadata: { modifiedIso: "not-a-real-date" },
        slides: [slide()],
      };
      expect(() => writePptContent(document)).toThrow(
        PptUnsupportedContentError,
      );
    });
  });
});

describe("speaker notes", () => {
  it("round-trips a slide's speaker notes", () => {
    const document = {
      metadata: {},
      slides: [slide({ notes: "Remember to mention the budget." })],
    };
    const { slides } = readPptContent(writePptContent(document));
    expect(slides[0]?.notes).toBe("Remember to mention the budget.");
  });

  it("round-trips notes carrying several paragraphs", () => {
    const notes = "Open with the summary.\nThen the three risks.\nClose early.";
    const { slides } = readPptContent(
      writePptContent({ metadata: {}, slides: [slide({ notes })] }),
    );
    expect(slides[0]?.notes).toBe(notes);
  });

  it("keeps each slide's own notes with that slide", () => {
    const document = {
      metadata: {},
      slides: [
        slide({ notes: "Notes for the first slide." }),
        slide({ notes: "Different notes, second slide." }),
        slide({ notes: "Third slide, third note." }),
      ],
    };
    const { slides } = readPptContent(writePptContent(document));
    expect(slides.map((s) => s.notes)).toEqual([
      "Notes for the first slide.",
      "Different notes, second slide.",
      "Third slide, third note.",
    ]);
  });

  it("gives a slide with no notes no NotesContainer at all, rather than an empty one", () => {
    const { powerPointDocumentStream } = writePptStreams({
      metadata: {},
      slides: [slide(), slide()],
    });
    // A fabricated empty NotesContainer would be a real notes slide that happens to say nothing -- a different fact from the absent notes slide the input actually describes, and one no round trip could tell apart from it.
    expect(recordTypesIn(powerPointDocumentStream)).not.toContain(RT_Notes);
  });

  it("writes a NotesContainer only for the slides that carry notes", () => {
    const { powerPointDocumentStream } = writePptStreams({
      metadata: {},
      slides: [
        slide({ notes: "Only this slide has notes." }),
        slide(),
        slide({ notes: "And this one." }),
      ],
    });
    const types = recordTypesIn(powerPointDocumentStream);
    expect(types.filter((type) => type === RT_Notes)).toHaveLength(2);
  });

  it("reads back nothing for the slides between two that carry notes", () => {
    const document = {
      metadata: {},
      slides: [slide({ notes: "First." }), slide(), slide({ notes: "Third." })],
    };
    const { slides } = readPptContent(writePptContent(document));
    expect(slides.map((s) => s.notes)).toEqual(["First.", "", "Third."]);
  });

  it("keeps every persist identifier below the seed a next edit would mint from", () => {
    // [MS-PPT] 2.3.3: persistIdSeed is the identifier a subsequent user edit would allocate, so every entry already in the directory has to sit below it. Notes slides take persist identifiers of their own after the slides', which is what makes a seed derived from the slide count alone wrong.
    const { currentUserStream, powerPointDocumentStream } = writePptStreams({
      metadata: {},
      slides: [
        slide({ notes: "First." }),
        slide({ notes: "Second." }),
        slide({ notes: "Third." }),
      ],
    });
    const { offsetToCurrentEdit } = readCurrentUserAtom(currentUserStream);
    const { directory, currentEdit } = buildPersistDirectory(
      powerPointDocumentStream,
      offsetToCurrentEdit,
    );
    expect(currentEdit.persistIdSeed).toBeGreaterThan(
      Math.max(...directory.keys()),
    );
  });

  it("gives a notes slide an identifier no slide's own identifier can collide with", () => {
    // NotesId and SlideId are separate identifier spaces ([MS-PPT] 2.2.14 and 2.2.26). A reader pairing the two lists would mis-associate every notes slide if one writer's notes ids happened to reuse its slide ids.
    const { powerPointDocumentStream } = writePptStreams({
      metadata: {},
      slides: Array.from({ length: 4 }, (_unused, index) =>
        slide({ notes: `Notes ${index}` }),
      ),
    });
    const document = readRecordAt(powerPointDocumentStream, 0);
    const slideIds = readSlideListWithText(
      requireRecord(
        listWithInstance(document, SLIDE_LIST_INSTANCE_SLIDES),
        "slide list",
      ),
    ).map((persist) => persist.slideId);
    const notesIds = readNotesListWithText(
      requireRecord(
        listWithInstance(document, SLIDE_LIST_INSTANCE_NOTES),
        "notes list",
      ),
    ).map((persist) => persist.notesId);
    expect(notesIds).toHaveLength(slideIds.length);
    expect(notesIds.filter((id) => slideIds.includes(id))).toEqual([]);
  });

  it("names each notes slide's own presentation slide in its NotesAtom", () => {
    const { powerPointDocumentStream } = writePptStreams({
      metadata: {},
      slides: [slide(), slide({ notes: "Second slide's notes." })],
    });
    const document = readRecordAt(powerPointDocumentStream, 0);
    const secondSlideId = readSlideListWithText(
      requireRecord(
        listWithInstance(document, SLIDE_LIST_INSTANCE_SLIDES),
        "slide list",
      ),
    )[1]?.slideId;
    const notesContainer = requireRecord(
      topLevelRecords(powerPointDocumentStream).find(
        (record) => record.header.recType === RT_Notes,
      ),
      "NotesContainer",
    );
    expect(readNotesContainerAtom(notesContainer).slideIdRef).toBe(
      secondSlideId,
    );
  });

  it("mints every slide id well clear of the 0x80000000 MasterId range readNotesBySlideId relies on staying unreachable", () => {
    // read.ts's own readNotesBySlideId keys a notes container by slideIdRef, and [MS-PPT] 2.2.13 reserves 0x80000000 and above for MasterId -- a real producer's own notes-master entry can state a slideIdRef up in that range (LibreOffice writes 0x80000001) rather than the spec-mandated 0x00000000. That lookup only stays unambiguous because this writer's own slide ids (FIRST_SLIDE_ID + index, see write.ts's own note beside that constant) never reach anywhere near it. Pinned here rather than only in a comment, so a future change to the minting base or increment fails a test instead of silently drifting toward the reserved range.
    const { powerPointDocumentStream } = writePptStreams({
      metadata: {},
      slides: Array.from({ length: 5 }, () => slide()),
    });
    const document = readRecordAt(powerPointDocumentStream, 0);
    const slideIds = readSlideListWithText(
      requireRecord(
        listWithInstance(document, SLIDE_LIST_INSTANCE_SLIDES),
        "slide list",
      ),
    ).map((persist) => persist.slideId);
    for (const slideId of slideIds) {
      expect(slideId).toBeLessThan(0x80000000);
    }
  });

  it("gives each notes slide the colour scheme its own NotesAtom says it does not inherit", () => {
    // [MS-PPT] 2.5.6 lists a NotesContainer's slideSchemeColorSchemeAtom without the "optional" its slideNameAtom and slideProgTagsContainer carry, and makes the notes master's scheme apply only "if notesAtom.slideFlags.fMasterScheme is set". This writer leaves that bit clear, since it writes no notes master to inherit from, so the notes slide has to state a scheme of its own or name one that does not exist.
    const { powerPointDocumentStream } = writePptStreams({
      metadata: {},
      slides: [slide({ notes: "Notes needing a colour scheme." })],
    });
    const notesContainer = requireRecord(
      topLevelRecords(powerPointDocumentStream).find(
        (record) => record.header.recType === RT_Notes,
      ),
      "NotesContainer",
    );
    expect(readNotesContainerAtom(notesContainer).slideFlags & 0b010).toBe(0);
    const scheme = requireRecord(
      childRecords(notesContainer).find(
        (record) => record.header.recType === RT_ColorSchemeAtom,
      ),
      "SlideSchemeColorSchemeAtom",
    );
    // [MS-PPT] 2.9.51: rh.recInstance MUST be 0x001, and rh.recLen MUST be 0x00000020 -- eight four-byte ColorStructs.
    expect(scheme.header.recInstance).toBe(0x001);
    expect(scheme.data.length).toBe(0x20);
  });

  it("round-trips notes through the tree form as well as the flat one", () => {
    const content: ContentDocument = {
      kind: "presentation",
      metadata: {},
      slides: [slide({ notes: "Notes that must survive decomposition." })],
    };
    const tree = assembleTree(content);
    expect(flattenTree(readPpt(writePpt(tree)))).toEqual(flattenTree(tree));
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
              // readPpt always reports PowerPoint's own default insets (0.1in/0.05in) regardless of what a file's own OfficeArtFOPT states -- a documented reader-side gap, not something this writer's own insets ever reach -- so the input must state those same defaults for a whole-tree equality check to hold.
              insetLeftPt: 7.2,
              insetTopPt: 3.6,
              insetRightPt: 7.2,
              insetBottomPt: 3.6,
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

  it("throws when asked to write a non-presentation document", () => {
    const content: ContentDocument = {
      kind: "wordprocessing",
      metadata: {},
      sections: [],
    };
    expect(() => writePpt(assembleTree(content))).toThrow(
      PptUnsupportedContentError,
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
