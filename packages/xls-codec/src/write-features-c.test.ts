// The cell-comments, images and embedded-object suites, split from write-features.test.ts, restating its harness verbatim.

// The write suites split from write.test.ts by family (write-a), restating its imports verbatim.

import type {
  ContentCellValue,
  ContentSheet,
  ContentSheetCell,
  ContentSheetDataValidation,
  ContentSheetPrintSettings,
} from "document-schema.js";
import {
  assembleTree,
  DocumentTreeSchema,
  PAGE_SIZE_LETTER,
} from "document-schema.js";
import { readCompoundFile } from "archive-codec";
import { describe, expect, it } from "vitest";

import {
  RECORD_CONTINUE,
  RECORD_MSODRAWING,
  RECORD_MSODRAWINGGROUP,
} from "./biff/record-types";
import { readRecords } from "./biff/records";
import {} from "./biff/xf-colors";
import { BiffWriteError } from "./biff/write-errors";
import type { XlsContentDocument } from "./content";
import {
  assertNeverContentCellValueKind,
  readXls,
  readXlsContent,
} from "./content";
import {} from "./container";
import { writeXls, writeXlsContent } from "./write";
import {} from "./workbook/conditional-format-write";
import { writeSheetDataValidations } from "./workbook/data-validation-write";

import {} from "./workbook/globals-writer";

// Genuine .xls bytes — a real [MS-CFB] compound file holding a real BIFF8 Workbook stream — built by this package's own writer and read back through its own reader, the "primary verification method" this session's writers use throughout (the CFB writer, rtf-codec, wpd-codec). Every test here is a round trip: build a ContentDocument, write it, read it back, and check the read result reflects what was written — exercising the writer against a reader whose own correctness is independently pinned by content.test.ts's hand-built byte sequences.

const POINTS_PER_INCH = 72;
/** Excel's own "Normal" preset, which is what a sheet with nothing else to say about printing carries — and, since the reader falls back to exactly these values for a file stating none of the print records, what a round trip through this pair reproduces either way. The print-settings round trips at the end of this file are the ones that exercise real, non-default values. */
const PRINT_SETTINGS: ContentSheetPrintSettings = {
  pageSize: PAGE_SIZE_LETTER,
  margins: {
    topPt: 0.75 * POINTS_PER_INCH,
    rightPt: 0.7 * POINTS_PER_INCH,
    bottomPt: 0.75 * POINTS_PER_INCH,
    leftPt: 0.7 * POINTS_PER_INCH,
  },
  gridlines: false,
  headers: false,
  pageOrder: "downThenOver",
};

function sheet(
  name: string,
  cells: readonly ContentSheetCell[],
  overrides: Partial<Omit<ContentSheet, "name" | "cells">> = {},
): ContentSheet {
  return {
    name,
    cells: [...cells],
    columns: [],
    rows: [],
    images: [],
    printSettings: PRINT_SETTINGS,
    ...overrides,
  };
}

function cell(
  row: number,
  column: number,
  value: ContentCellValue,
  extra: Partial<ContentSheetCell> = {},
): ContentSheetCell {
  return { row, column, value, displayText: displayTextFor(value), ...extra };
}

/** Mirrors content.ts's own private displayTextOf exactly, so a test fixture's displayText is what a real reader would also produce for the same value — required because ContentSheetCellSchema documents displayText as always present. */
function displayTextFor(value: ContentCellValue): string {
  switch (value.kind) {
    case "number":
    case "percentage":
    case "currency":
      return String(value.value);
    case "boolean":
      return value.value ? "TRUE" : "FALSE";
    case "date":
    case "time":
    case "dateTime":
    case "string":
    case "error":
      return value.value;
    case "empty":
      return "";
  }
  return assertNeverContentCellValueKind(value);
}

function document(sheets: readonly ContentSheet[]): XlsContentDocument {
  return { kind: "spreadsheet", metadata: {}, sheets: [...sheets] };
}

function findCell(
  content: ReturnType<typeof readXlsContent>,
  sheetIndex: number,
  row: number,
  column: number,
): ContentSheetCell | undefined {
  return content.sheets[sheetIndex]?.cells.find(
    (candidate) => candidate.row === row && candidate.column === column,
  );
}

describe("cell comments", () => {
  it("round-trips a comment's text and author on an otherwise-populated cell", () => {
    const content = document([
      sheet("Sheet1", [
        cell(
          0,
          0,
          { kind: "number", value: 1 },
          { comment: { text: "a note", author: "Reviewer" } },
        ),
      ]),
    ]);
    const read = readXlsContent(writeXlsContent(content));
    expect(findCell(read, 0, 0, 0)?.comment).toStrictEqual({
      text: "a note",
      author: "Reviewer",
    });
  });

  it("round-trips a comment anchored to an otherwise-empty cell", () => {
    const content = document([
      sheet("Sheet1", [
        {
          row: 2,
          column: 2,
          value: { kind: "empty" },
          displayText: "",
          comment: { text: "pinned to nothing" },
        },
      ]),
    ]);
    const read = readXlsContent(writeXlsContent(content));
    expect(findCell(read, 0, 2, 2)?.comment).toStrictEqual({
      text: "pinned to nothing",
    });
  });

  it("round-trips a comment with no author, carrying no author back", () => {
    const content = document([
      sheet("Sheet1", [
        cell(
          0,
          0,
          { kind: "number", value: 1 },
          { comment: { text: "anonymous" } },
        ),
      ]),
    ]);
    const read = readXlsContent(writeXlsContent(content));
    expect(findCell(read, 0, 0, 0)?.comment).toStrictEqual({
      text: "anonymous",
    });
  });

  it("round-trips an empty comment with no text at all", () => {
    const content = document([
      sheet("Sheet1", [
        cell(0, 0, { kind: "number", value: 1 }, { comment: { text: "" } }),
      ]),
    ]);
    const read = readXlsContent(writeXlsContent(content));
    expect(findCell(read, 0, 0, 0)?.comment).toStrictEqual({ text: "" });
  });

  it("round-trips multiple comments on the same sheet, each keeping its own cell and text", () => {
    const content = document([
      sheet("Sheet1", [
        cell(
          0,
          0,
          { kind: "string", value: "first" },
          { comment: { text: "note one" } },
        ),
        cell(
          5,
          1,
          { kind: "string", value: "second" },
          { comment: { text: "note two", author: "Someone" } },
        ),
      ]),
    ]);
    const read = readXlsContent(writeXlsContent(content));
    expect(findCell(read, 0, 0, 0)?.comment).toStrictEqual({
      text: "note one",
    });
    expect(findCell(read, 0, 5, 1)?.comment).toStrictEqual({
      text: "note two",
      author: "Someone",
    });
  });
});

describe("writeXlsContent: images and embedded objects written (#971)", () => {
  // A minimal but genuinely valid 1x1 PNG (a real signature, IHDR, IDAT, IEND chain) — the identical fixture drawing/blips.test.ts uses, since resolveBlip only checks image.format, never the bytes' own structure.
  const PNG_BYTES = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00,
    0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
    0x00, 0x03, 0x01, 0x01, 0x00, 0x18, 0xdd, 0x8d, 0xb0, 0x00, 0x00, 0x00,
    0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);

  function base64Of(bytes: Uint8Array): string {
    let binary = "";
    const chunkSize = 0x2000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(
        ...bytes.subarray(offset, offset + chunkSize),
      );
    }
    return btoa(binary);
  }

  const SMALL_PNG_BASE64 = base64Of(PNG_BYTES);

  /** Bytes large enough on their own to push a single BSE entry (or a single sheet's own shape tree, repeated many times over) past the 8224-byte single-record ceiling, forcing writeRecordChain to split its record onto a Continue chain — a non-repeating pattern so a byte-exact round trip can't pass by coincidence (e.g. every byte happening to be zero). */
  function largeBytes(length: number): Uint8Array {
    const bytes = new Uint8Array(length);
    for (let index = 0; index < length; index += 1) {
      bytes[index] = index % 251;
    }
    return bytes;
  }

  it("round-trips a sheet image's format, bytes, and cell anchor", () => {
    const content = document([
      sheet("Sheet1", [], {
        images: [
          {
            kind: "image",
            format: "png",
            base64: SMALL_PNG_BASE64,
            widthPt: 40,
            heightPt: 30,
            anchorRow: 2,
            anchorColumn: 1,
            offsetXPt: 5,
            offsetYPt: 3,
          },
        ],
      }),
    ]);
    const read = readXlsContent(writeXlsContent(content));
    const image = read.sheets[0]?.images[0];
    expect(image?.format).toBe("png");
    expect(image?.base64).toBe(SMALL_PNG_BASE64);
    expect(image?.anchorRow).toBe(2);
    expect(image?.anchorColumn).toBe(1);
    expect(image?.widthPt).toBeCloseTo(40, 0);
    expect(image?.heightPt).toBeCloseTo(30, 0);
  });

  it("round-trips an image large enough to force the workbook-wide Blip Store onto a Continue chain", () => {
    const bytes = largeBytes(9000);
    const base64 = base64Of(bytes);
    const content = document([
      sheet("Sheet1", [], {
        images: [
          {
            kind: "image",
            format: "png",
            base64,
            widthPt: 40,
            heightPt: 30,
            anchorRow: 0,
            anchorColumn: 0,
            offsetXPt: 0,
            offsetYPt: 0,
          },
        ],
      }),
    ]);
    const written = writeXlsContent(content);
    // Confirms the test actually exercises the Continue chain rather than passing by coincidence: a MSODRAWINGGROUP record this large MUST be followed by at least one CONTINUE record ([MS-XLS] 2.1.4's own 8224-byte single-record ceiling).
    const globalsRecords = readRecords(
      readCompoundFile(written).find((stream) => stream.path === "Workbook")
        ?.bytes ?? new Uint8Array(),
    );
    const drawingGroupIndex = globalsRecords.findIndex(
      (record) => record.type === RECORD_MSODRAWINGGROUP,
    );
    expect(drawingGroupIndex).toBeGreaterThanOrEqual(0);
    expect(globalsRecords[drawingGroupIndex + 1]?.type).toBe(RECORD_CONTINUE);

    const read = readXlsContent(written);
    const image = read.sheets[0]?.images[0];
    expect(image?.format).toBe("png");
    expect(image?.base64).toBe(base64);
  });

  it("round-trips many images on one sheet, forcing that sheet's own MsoDrawing record onto a Continue chain", () => {
    const imageCount = 150;
    const images = Array.from({ length: imageCount }, (_, index) => ({
      kind: "image" as const,
      format: "png" as const,
      base64: SMALL_PNG_BASE64,
      widthPt: 10,
      heightPt: 10,
      anchorRow: index,
      anchorColumn: 0,
      offsetXPt: 0,
      offsetYPt: 0,
    }));
    const content = document([sheet("Sheet1", [], { images })]);
    const written = writeXlsContent(content);
    const workbookBytes =
      readCompoundFile(written).find((stream) => stream.path === "Workbook")
        ?.bytes ?? new Uint8Array();
    const records = readRecords(workbookBytes);
    const drawingIndex = records.findIndex(
      (record) => record.type === RECORD_MSODRAWING,
    );
    expect(drawingIndex).toBeGreaterThanOrEqual(0);
    expect(records[drawingIndex + 1]?.type).toBe(RECORD_CONTINUE);

    const read = readXlsContent(written);
    expect(read.sheets[0]?.images).toHaveLength(imageCount);
    expect(
      read.sheets[0]?.images.every(
        (image) => image.base64 === SMALL_PNG_BASE64,
      ),
    ).toBe(true);
  });

  it("round-trips a non-chart embedded OLE object through its own Embedding Storage", () => {
    const embeddedDocument = {
      kind: "drawing" as const,
      metadata: {},
      pages: [
        {
          size: { widthPt: 50, heightPt: 40 },
          shapes: [],
          vectors: [],
        },
      ],
    };
    const content = document([
      sheet("Sheet1", [], {
        embeddedObjects: [
          {
            objectKind: "drawing",
            document: embeddedDocument,
            frame: { xPt: 0, yPt: 0, widthPt: 50, heightPt: 40 },
            anchorRow: 3,
            anchorColumn: 2,
            offsetXPt: 4,
            offsetYPt: 2,
          },
        ],
      }),
    ]);
    const written = writeXlsContent(content);
    const streams = readCompoundFile(written);
    expect(
      streams.some((stream) => /^MBD[0-9A-F]{8}\/Package$/.test(stream.path)),
    ).toBe(true);

    const read = readXlsContent(written);
    const embedded = read.sheets[0]?.embeddedObjects?.[0];
    expect(embedded?.objectKind).toBe("drawing");
    expect(embedded?.document).toStrictEqual(embeddedDocument);
  });

  it("throws when asked to write a 'chart' embedded object", () => {
    const content = document([
      sheet("Sheet1", [], {
        embeddedObjects: [
          {
            objectKind: "chart",
            document: {
              kind: "spreadsheet",
              metadata: {},
              sheets: [
                {
                  name: "Chart",
                  cells: [],
                  columns: [],
                  rows: [],
                  images: [],
                  printSettings: PRINT_SETTINGS,
                },
              ],
            },
            frame: { xPt: 0, yPt: 0, widthPt: 50, heightPt: 40 },
          },
        ],
      }),
    ]);
    expect(() => writeXlsContent(content)).toThrow(BiffWriteError);
  });
});

describe("writeXlsContent: data validations written (#971)", () => {
  it("round-trips a whole-number comparison rule with every optional field", () => {
    const rule = {
      ranges: [{ startRow: 0, endRow: 4, startColumn: 0, endColumn: 0 }],
      type: "whole" as const,
      operator: "greaterThan" as const,
      formula1: "5",
      allowBlank: true,
      showInputMessage: true,
      promptTitle: "Enter",
      prompt: "A number over 5",
      showErrorMessage: true,
      errorStyle: "warning" as const,
      errorTitle: "Wrong",
      error: "Must exceed 5",
    };
    const reread = readXlsContent(
      writeXlsContent(document([sheet("S", [], { dataValidations: [rule] })])),
    );
    expect(reread.sheets[0]?.dataValidations).toStrictEqual([rule]);
  });

  it("round-trips a between rule's two formulas, a list rule's quoted literal, and a custom rule's expression", () => {
    const rules: ContentSheetDataValidation[] = [
      {
        ranges: [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 2 }],
        type: "decimal",
        operator: "between",
        formula1: "1",
        formula2: "10",
      },
      {
        ranges: [{ startRow: 1, endRow: 1, startColumn: 1, endColumn: 1 }],
        type: "list",
        formula1: '"a,b,c"',
      },
      {
        ranges: [{ startRow: 2, endRow: 2, startColumn: 0, endColumn: 0 }],
        type: "custom",
        formula1: "A1>5",
      },
    ];
    const reread = readXlsContent(
      writeXlsContent(document([sheet("S", [], { dataValidations: rules })])),
    );
    expect(reread.sheets[0]?.dataValidations).toStrictEqual(rules);
  });

  it("round-trips a notBetween rule's two formulas", () => {
    // 'between' alone does not prove the writer's own isTwoOperand check actually names BOTH two-operand operators rather than just the one the sibling test above already exercises — a rule refused for missing its second formula only when it should be, or accepted with one only for the operator that never needed it, would pass that test regardless.
    const rule: ContentSheetDataValidation = {
      ranges: [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 }],
      type: "decimal",
      operator: "notBetween",
      formula1: "1",
      formula2: "10",
    };
    const reread = readXlsContent(
      writeXlsContent(document([sheet("S", [], { dataValidations: [rule] })])),
    );
    expect(reread.sheets[0]?.dataValidations).toStrictEqual([rule]);
  });

  it("refuses an operator-less comparison type and a two-operand operator without its second formula", () => {
    expect(() =>
      writeXlsContent(
        document([
          sheet("S", [], {
            dataValidations: [
              {
                ranges: [
                  { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
                ],
                type: "whole",
                formula1: "5",
              } as unknown as ContentSheetDataValidation,
            ],
          }),
        ]),
      ),
    ).toThrow(/no operator/);
    expect(() =>
      writeXlsContent(
        document([
          sheet("S", [], {
            dataValidations: [
              {
                ranges: [
                  { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
                ],
                type: "decimal",
                operator: "between",
                formula1: "1",
              } as unknown as ContentSheetDataValidation,
            ],
          }),
        ]),
      ),
    ).toThrow(/no second formula/);
  });

  it("refuses a data-validation type or operator the schema's own closed vocabularies never name", () => {
    expect(() =>
      writeXlsContent(
        document([
          sheet("S", [], {
            dataValidations: [
              {
                ranges: [
                  { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
                ],
                type: "notARealType",
                formula1: "5",
              } as unknown as ContentSheetDataValidation,
            ],
          }),
        ]),
      ),
    ).toThrow(/has no Dv valType value/);
    expect(() =>
      writeXlsContent(
        document([
          sheet("S", [], {
            dataValidations: [
              {
                ranges: [
                  { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
                ],
                type: "whole",
                operator: "notARealOperator",
                formula1: "5",
              } as unknown as ContentSheetDataValidation,
            ],
          }),
        ]),
      ),
    ).toThrow(/has no Dv typOperator value/);
  });

  it("refuses a non-two-operand rule carrying a second formula", () => {
    expect(() =>
      writeXlsContent(
        document([
          sheet("S", [], {
            dataValidations: [
              {
                ranges: [
                  { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
                ],
                type: "whole",
                operator: "greaterThan",
                formula1: "5",
                formula2: "10",
              },
            ],
          }),
        ]),
      ),
    ).toThrow(/carries a second formula/);
  });

  it("refuses a rule carrying no range", () => {
    expect(() =>
      writeXlsContent(
        document([
          sheet("S", [], {
            dataValidations: [
              {
                ranges: [],
                type: "whole",
                operator: "greaterThan",
                formula1: "5",
              },
            ],
          }),
        ]),
      ),
    ).toThrow(/carrying no range states nothing/);
  });

  it("refuses a range outside BIFF8's own grid, at each of its four edges", () => {
    const base = {
      type: "whole" as const,
      operator: "greaterThan" as const,
      formula1: "5",
    };
    const overRow: ContentSheetDataValidation = {
      ...base,
      // endRow deliberately stays in-grid (0), unlike the other three edges below sharing one deviant field with its own pair: an overRow fixture whose own endRow ALSO exceeds 0xffff would still throw with the startRow check dropped entirely, since the endRow check alone already catches it — only isolating startRow as the sole out-of-range field actually exercises that check on its own.
      ranges: [{ startRow: 0x10000, endRow: 0, startColumn: 0, endColumn: 0 }],
    };
    const overEndRow: ContentSheetDataValidation = {
      ...base,
      ranges: [{ startRow: 0, endRow: 0x10000, startColumn: 0, endColumn: 0 }],
    };
    const overColumn: ContentSheetDataValidation = {
      ...base,
      ranges: [{ startRow: 0, endRow: 0, startColumn: 0x100, endColumn: 0 }],
    };
    const overEndColumn: ContentSheetDataValidation = {
      ...base,
      ranges: [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 0x100 }],
    };
    for (const rule of [overRow, overEndRow, overColumn, overEndColumn]) {
      expect(() =>
        writeXlsContent(
          document([sheet("S", [], { dataValidations: [rule] })]),
        ),
      ).toThrow(/outside BIFF8's own grid/);
    }
  });

  it("accepts a range sitting exactly on BIFF8's own grid boundary, not just short of it", () => {
    // 0xffff and 0xff are the largest row/column index BIFF8's own u16/u8 fields can carry — a range naming exactly these values is still addressable, unlike the one-past-the-edge values the previous test throws on, so the boundary check must be a strict `>`, not `>=`.
    const rule: ContentSheetDataValidation = {
      ranges: [
        {
          startRow: 0xffff,
          endRow: 0xffff,
          startColumn: 0xff,
          endColumn: 0xff,
        },
      ],
      type: "whole",
      operator: "greaterThan",
      formula1: "5",
    };
    expect(() =>
      writeXlsContent(document([sheet("S", [], { dataValidations: [rule] })])),
    ).not.toThrow();
  });

  it("writes no Dval/Dv records at all for a sheet stating an empty dataValidations array", () => {
    // A round trip through readXlsContent cannot distinguish this from a Dval-with-zero-Dv-records: mapDataValidations's own result is an empty array either way, and content.ts already omits the field for an empty array regardless of whether a genuinely empty Dval record was written at all. Calling the writer directly is the only way to check that no record is written in the first place.
    expect(
      writeSheetDataValidations(sheet("S", [], { dataValidations: [] })),
    ).toStrictEqual([]);
  });
});

describe("writeXls", () => {
  it("round-trips a DocumentTree end to end through assembleTree/flattenTree and this package's own readXls", () => {
    const content = document([
      sheet("Sheet1", [
        cell(0, 0, { kind: "number", value: 7 }),
        cell(0, 1, { kind: "string", value: "tree form" }),
      ]),
    ]);
    const tree = assembleTree(content);
    expect(() => DocumentTreeSchema.parse(tree)).not.toThrow();

    const bytes = writeXls(tree);
    const readTree = readXls(bytes);

    expect(readTree.kind).toBe("spreadsheet");
  });

  it("refuses a non-spreadsheet DocumentTree, naming the offending kind", () => {
    const wordTree: ReturnType<typeof assembleTree> = {
      kind: "wordprocessing",
      metadata: {},
      children: [],
    };
    expect(() => writeXls(wordTree)).toThrow(
      "writeXls was given a DocumentTree of kind 'wordprocessing', but a .xls workbook can only be written from a 'spreadsheet' document",
    );
  });
});
