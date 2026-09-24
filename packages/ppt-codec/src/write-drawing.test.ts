// The drawing half of the writePptContent round trip: pictures and rotation, the document-wide drawing group, tables, and metadata. Split from write.test.ts, which keeps the plain text-and-shape round trips; the fixtures all three write suites share live in test-support/write-fixtures.ts.

import { readCompoundFile } from "archive-codec";
import { bytesToBase64, encodePng } from "byte-codec";
import {
  type ContentBlock,
  type ContentImageBlock,
  type ContentShape,
} from "document-schema.js";
import { describe, expect, it } from "vitest";
import { type PptDiagnostic, PptDiagnosticCodes } from "./diagnostics";
import { PptUnsupportedContentError } from "./errors";
import { readPptContent } from "./read";
import { childRecords, findChild, readRecordSequence } from "./record/tree";
import {
  OfficeArtBStoreContainer,
  OfficeArtDggContainer,
  OfficeArtFDGGBlock,
  RT_DrawingGroup,
} from "./record/types";
import { writePptContent, writePptStreams } from "./write";

// The primary verification method this package's own README already establishes for its record fixtures: write real records, then read them back through the package's own existing reader, and assert the recovered content equals what was written. A round trip through readPptContent proves the writer's bytes are genuinely conformant [MS-PPT] — not merely internally self-consistent — because the reader was built and tested entirely independently of the writer, against the specification alone.
import {
  paragraph,
  requireRecord,
  slide,
  topLevelRecords,
} from "./test-support/write-fixtures";

describe("writePptContent / readPptContent round trip", () => {
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
      const document = {
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
      };
      // Two entries, not three: base64-comparing the round-tripped images alone (below) can't distinguish a shared store entry from three separate ones carrying byte-identical content, since either way every shape reads back the same bytes — only the store's own entry count actually proves the duplicate PNG was deduplicated rather than re-added.
      const { powerPointDocumentStream } = writePptStreams(document);
      const documentRecord = readRecordSequence(
        powerPointDocumentStream,
        0,
        powerPointDocumentStream.length,
      )[0];
      if (documentRecord === undefined) {
        throw new Error("expected the DocumentContainer first");
      }
      const drawingGroup = findChild(
        childRecords(documentRecord),
        RT_DrawingGroup,
      );
      const dgg =
        drawingGroup === undefined
          ? undefined
          : findChild(childRecords(drawingGroup), OfficeArtDggContainer);
      const store =
        dgg === undefined
          ? undefined
          : findChild(childRecords(dgg), OfficeArtBStoreContainer);
      if (store === undefined) {
        throw new Error("expected an OfficeArtBStoreContainer");
      }
      expect(store.header.recInstance).toBe(2);

      const { slides } = readPptContent(writePptContent(document));
      const secondSlideImages = slides[1]?.shapes
        .map((shape) => shape.blocks.find((block) => block.kind === "image"))
        .filter((block): block is ContentImageBlock => block !== undefined);
      expect(secondSlideImages).toHaveLength(2);
      expect(secondSlideImages?.[0]?.base64).toBe(bytesToBase64(PNG));
      expect(secondSlideImages?.[1]?.base64).toBe(bytesToBase64(OTHER_PNG));
      // The identical PNG on slide 1 reads back there too — a shared store entry, not a copy per slide.
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
          {
            sink: (diagnostic) => {
              diagnostics.push(diagnostic);
            },
          },
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
          {
            sink: (diagnostic) => {
              diagnostics.push(diagnostic);
            },
          },
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
    // The OfficeArtFDGG's own four count fields ([MS-ODRAW] 2.2.47): spidMax, cidcl, cspSaved, cdgSaved, in order — read straight out of the written stream so the counts are checked against the bytes, not against the writer's own bookkeeping.
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

    it("counts a table's group shape and its cells in the document-wide shape totals", () => {
      const { powerPointDocumentStream } = writePptStreams({
        metadata: {},
        slides: [
          slide({
            shapes: [
              {
                frame: { xPt: 60, yPt: 90, widthPt: 240, heightPt: 120 },
                insetLeftPt: 0,
                insetTopPt: 0,
                insetRightPt: 0,
                insetBottomPt: 0,
                blocks: [
                  {
                    kind: "table" as const,
                    rows: [
                      {
                        cells: [{ blocks: [] }, { blocks: [] }],
                        heightPt: 60,
                      },
                      {
                        cells: [{ blocks: [] }, { blocks: [] }],
                        heightPt: 60,
                      },
                    ],
                    columns: [{ widthPt: 120 }, { widthPt: 120 }],
                  },
                ],
              },
            ],
          }),
        ],
      });
      // The master's six shapes, then the slide drawing's six — its patriarch, the table's group shape and its four cells: twelve shape containers across two drawings, spidMax 6 from the master's placeholders.
      expect(fdggFields(powerPointDocumentStream)).toEqual([6, 2, 12, 2]);
    });
  });

  describe("tables", () => {
    function tableShape(blocks: readonly ContentBlock[]): ContentShape {
      return {
        frame: { xPt: 60, yPt: 90, widthPt: 240, heightPt: 120 },
        insetLeftPt: 0.1 * 72,
        insetTopPt: 0.05 * 72,
        insetRightPt: 0.1 * 72,
        insetBottomPt: 0.05 * 72,
        blocks: [...blocks],
      };
    }

    it("resolves a font family used only inside a table cell's own text", () => {
      // collectFontFamilies scans each shape's own top-level blocks; a table shape's own blocks list carries one "table" block, never the rows/cells nested inside it, so a font family named only inside a cell's own run is invisible to that scan unless collectFontFamilies is taught to descend into table cells too.
      const { slides } = readPptContent(
        writePptContent({
          metadata: {},
          slides: [
            slide({
              shapes: [
                tableShape([
                  {
                    kind: "table",
                    rows: [
                      {
                        cells: [
                          {
                            blocks: [
                              {
                                kind: "paragraph",
                                runs: [
                                  {
                                    text: "Cell font",
                                    fontFamily: "Courier New",
                                  },
                                ],
                              },
                            ],
                          },
                        ],
                      },
                    ],
                    columns: [{ widthPt: 200 }],
                  },
                ]),
              ],
            }),
          ],
        }),
      );
      const [entry] = slides[0]?.shapes[0]?.blocks ?? [];
      if (entry?.kind !== "table") {
        throw new Error("expected a table block");
      }
      expect(entry.rows[0]?.cells[0]?.blocks[0]).toMatchObject({
        runs: [{ text: "Cell font", fontFamily: "Courier New" }],
      });
    });

    it("round-trips a table as one group whose cells read back as the same grid", () => {
      const { slides } = readPptContent(
        writePptContent({
          metadata: {},
          slides: [
            slide({
              shapes: [
                tableShape([
                  {
                    kind: "table",
                    rows: [
                      {
                        cells: [
                          { blocks: [paragraph("A1")] },
                          { blocks: [paragraph("B1")] },
                        ],
                        heightPt: 60,
                      },
                      {
                        cells: [
                          { blocks: [paragraph("A2")] },
                          { blocks: [paragraph("B2")] },
                        ],
                        heightPt: 60,
                      },
                    ],
                    columns: [{ widthPt: 100 }, { widthPt: 140 }],
                  },
                ]),
              ],
            }),
          ],
        }),
      );
      expect(slides[0]?.shapes[0]?.blocks).toEqual([
        {
          kind: "table",
          rows: [
            {
              cells: [
                { blocks: [{ kind: "paragraph", runs: [{ text: "A1" }] }] },
                { blocks: [{ kind: "paragraph", runs: [{ text: "B1" }] }] },
              ],
              heightPt: 60,
            },
            {
              cells: [
                { blocks: [{ kind: "paragraph", runs: [{ text: "A2" }] }] },
                { blocks: [{ kind: "paragraph", runs: [{ text: "B2" }] }] },
              ],
              heightPt: 60,
            },
          ],
          // 100pt and 140pt are whole master units (800 and 1120), so the widths read back exactly.
          columns: [{ widthPt: 100 }, { widthPt: 140 }],
        },
      ]);
    });

    it("round-trips a rotated table group's rotation", () => {
      const { slides } = readPptContent(
        writePptContent({
          metadata: {},
          slides: [
            slide({
              shapes: [
                {
                  ...tableShape([]),
                  rotationDeg: 180,
                  blocks: [
                    {
                      kind: "table",
                      rows: [{ cells: [{ blocks: [paragraph("x")] }] }],
                      columns: [{ widthPt: 240 }],
                    },
                  ],
                },
              ],
            }),
          ],
        }),
      );
      expect(slides[0]?.shapes[0]?.rotationDeg).toBe(180);
    });

    it("drops a paragraph block alongside the table, naming it through the diagnostic sink", () => {
      const diagnostics: PptDiagnostic[] = [];
      const { slides } = readPptContent(
        writePptContent(
          {
            metadata: {},
            slides: [
              slide({
                shapes: [
                  tableShape([
                    { kind: "paragraph", runs: [{ text: "stray" }] },
                    {
                      kind: "table",
                      rows: [
                        {
                          cells: [{ blocks: [paragraph("kept")] }],
                          heightPt: 120,
                        },
                      ],
                      columns: [{ widthPt: 240 }],
                    },
                  ]),
                ],
              }),
            ],
          },
          {
            sink: (diagnostic) => {
              diagnostics.push(diagnostic);
            },
          },
        ),
      );
      expect(slides[0]?.shapes[0]?.blocks).toEqual([
        {
          kind: "table",
          rows: [
            {
              cells: [
                {
                  blocks: [{ kind: "paragraph", runs: [{ text: "kept" }] }],
                },
              ],
              heightPt: 120,
            },
          ],
          columns: [{ widthPt: 240 }],
        },
      ]);
      expect(diagnostics).toEqual([
        {
          code: PptDiagnosticCodes.BLOCK_DROPPED,
          severity: "warning",
          message:
            "slide 1: a 'paragraph' block is dropped; a shape carrying a table becomes a table group, which holds its text in cells rather than a text body of its own",
        },
      ]);
    });

    it("drops a second table block on one shape, whose single group the first table already consumed", () => {
      const diagnostics: PptDiagnostic[] = [];
      const table = {
        kind: "table" as const,
        rows: [{ cells: [{ blocks: [] }] }],
        columns: [{ widthPt: 240 }],
      };
      const { slides } = readPptContent(
        writePptContent(
          {
            metadata: {},
            slides: [slide({ shapes: [tableShape([table, table])] })],
          },
          {
            sink: (diagnostic) => {
              diagnostics.push(diagnostic);
            },
          },
        ),
      );
      expect(slides[0]?.shapes[0]?.blocks).toHaveLength(1);
      expect(diagnostics).toEqual([
        {
          code: PptDiagnosticCodes.BLOCK_DROPPED,
          severity: "warning",
          message:
            "slide 1: a second 'table' block is dropped; a shape becomes one table group, and an earlier table already did",
        },
      ]);
    });

    it("drops a cell's colSpan and rowSpan, which the format's strict grid cannot state", () => {
      const diagnostics: PptDiagnostic[] = [];
      const { slides } = readPptContent(
        writePptContent(
          {
            metadata: {},
            slides: [
              slide({
                shapes: [
                  tableShape([
                    {
                      kind: "table",
                      rows: [
                        {
                          cells: [
                            { blocks: [], colSpan: 2, rowSpan: 3 },
                            { blocks: [] },
                          ],
                        },
                        { cells: [{ blocks: [] }, { blocks: [] }] },
                        { cells: [{ blocks: [] }, { blocks: [] }] },
                      ],
                      columns: [{ widthPt: 120 }, { widthPt: 120 }],
                    },
                  ]),
                ],
              }),
            ],
          },
          {
            sink: (diagnostic) => {
              diagnostics.push(diagnostic);
            },
          },
        ),
      );
      // The spanning cell is written one column wide and one row tall, and reads back as a plain cell.
      expect(slides[0]?.shapes[0]?.blocks[0]).toMatchObject({
        kind: "table",
        rows: [
          { cells: [{ blocks: [] }, { blocks: [] }] },
          { cells: [{ blocks: [] }, { blocks: [] }] },
          { cells: [{ blocks: [] }, { blocks: [] }] },
        ],
      });
      expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
        PptDiagnosticCodes.TABLE_SPAN_DROPPED,
        PptDiagnosticCodes.TABLE_SPAN_DROPPED,
      ]);
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
      expect(() => writePptContent(document)).toThrow(
        'LayoutMetadata.createdIso "not-a-real-date" is not a valid date string',
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
      expect(() => writePptContent(document)).toThrow(
        'LayoutMetadata.modifiedIso "not-a-real-date" is not a valid date string',
      );
    });
  });
});
