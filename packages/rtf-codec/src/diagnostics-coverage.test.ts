import { describe, expect, it } from "vitest";
import type {
  ContentBlock,
  ContentDocument,
  DocumentTree,
} from "document-schema.js";
import { RtfDiagnosticCodes, type RtfDiagnostic } from "./diagnostics";
import { readRtfContent } from "./read";
import { bytes } from "./test-support/bytes";
import { writeRtf, writeRtfContent } from "./write";

// Every code in RtfDiagnosticCodes is reachable from a real input, and this suite proves it by producing each one rather than by scanning the source for its name -- epub-codec's own diagnostics-coverage.test.ts precedent, and the stronger check of the two: a code whose emit site is unreachable (guarded by a condition that can never hold) would still pass a source scan.
//
// The final assertion is what stops the table growing dead entries: it compares the set of codes this file actually observed against the whole table, so adding a code without a fixture fails here rather than sitting unreachable and unnoticed.

const observed = new Set<string>();

function collect(diagnostics: readonly RtfDiagnostic[]): string[] {
  for (const diagnostic of diagnostics) {
    observed.add(diagnostic.code);
  }
  return diagnostics.map((diagnostic) => diagnostic.code);
}

function readCodes(source: string): string[] {
  return collect(readRtfContent(bytes(source)).diagnostics);
}

function writeCodes(document: ContentDocument): string[] {
  const codes: RtfDiagnostic[] = [];
  writeRtfContent(document, { sink: (diagnostic) => codes.push(diagnostic) });
  return collect(codes);
}

const SECTION = {
  pageSize: { widthPt: 612, heightPt: 792 },
  margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
} as const;

function wordprocessing(blocks: ContentBlock[]): ContentDocument {
  return {
    kind: "wordprocessing",
    metadata: {},
    sections: [{ ...SECTION, blocks }],
  };
}

const HEADER = "{\\rtf1\\ansi\\ansicpg1252\\deff0";

describe("every read-side diagnostic code is reachable", () => {
  it("rtf/unbalanced-group", () => {
    expect(readCodes(`${HEADER}\\pard x\\par}}`)).toContain(
      RtfDiagnosticCodes.UNBALANCED_GROUP,
    );
  });

  it("rtf/unknown-destination-skipped", () => {
    expect(readCodes(`${HEADER}\\pard{\\*\\notarealdest x}y\\par}`)).toContain(
      RtfDiagnosticCodes.UNKNOWN_DESTINATION_SKIPPED,
    );
  });

  it("rtf/content-destination-skipped", () => {
    expect(readCodes(`${HEADER}{\\footnote A note}\\pard x\\par}`)).toContain(
      RtfDiagnosticCodes.CONTENT_DESTINATION_SKIPPED,
    );
  });

  it("rtf/unsupported-codepage", () => {
    // 932 is Shift-JIS, one of the DBCS pages this package deliberately does not carry a table for.
    expect(
      readCodes("{\\rtf1\\ansi\\ansicpg932\\pard \\'82\\'a0\\par}"),
    ).toContain(RtfDiagnosticCodes.UNSUPPORTED_CODEPAGE);
  });

  it("rtf/unsupported-picture-format", () => {
    expect(
      readCodes(
        `${HEADER}\\pard{\\pict\\wmetafile8\\picwgoal720\\pichgoal720 abcd}\\par}`,
      ),
    ).toContain(RtfDiagnosticCodes.UNSUPPORTED_PICTURE_FORMAT);
  });

  it("rtf/picture-size-unstated", () => {
    expect(
      readCodes(`${HEADER}\\pard{\\pict\\pngblip 89504e470d0a1a0a}\\par}`),
    ).toContain(RtfDiagnosticCodes.PICTURE_SIZE_UNSTATED);
  });

  it("rtf/table-row-without-definition", () => {
    expect(readCodes(`${HEADER}\\pard\\intbl\\row\\pard x\\par}`)).toContain(
      RtfDiagnosticCodes.TABLE_ROW_WITHOUT_DEFINITION,
    );
  });

  it("rtf/table-column-width-invalid", () => {
    expect(
      readCodes(
        `${HEADER}\\trowd\\trleft0\\cellx1000\\cellx1000\\pard\\intbl A\\cell\\pard\\intbl B\\cell\\row\\pard x\\par}`,
      ),
    ).toContain(RtfDiagnosticCodes.TABLE_COLUMN_WIDTH_INVALID);
  });

  it("rtf/bookmark-unpaired", () => {
    expect(
      readCodes(`${HEADER}\\pard x{\\*\\bkmkstart never}y\\par}`),
    ).toContain(RtfDiagnosticCodes.BOOKMARK_UNPAIRED);
  });

  it("rtf/section-break-unrepresented", () => {
    expect(
      readCodes(`${HEADER}\\pard A\\par\\sect\\sectd\\sbkcol\\pard B\\par}`),
    ).toContain(RtfDiagnosticCodes.SECTION_BREAK_UNREPRESENTED);
  });

  it("rtf/nested-table-flattened", () => {
    expect(readCodes(`${HEADER}\\pard\\intbl inner\\nestcell\\par}`)).toContain(
      RtfDiagnosticCodes.NESTED_TABLE_FLATTENED,
    );
  });
});

describe("every write-side diagnostic code is reachable", () => {
  it("rtf/construct-unrepresented", () => {
    expect(
      writeCodes(
        wordprocessing([
          {
            // A bookmark anchor is written as a real {\*\bkmkstart ...} pair now, so the fixture for the unrepresented tier names a kind RTF genuinely has no spelling for.
            kind: "constructStart",
            descriptor: {
              kind: "contentControl",
              controlType: "richText",
              tag: "T",
            },
          },
          { kind: "constructEnd" },
        ]),
      ),
    ).toContain(RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED);
  });

  it("rtf/embedded-object-dropped", () => {
    expect(
      writeCodes(
        wordprocessing([
          {
            kind: "embeddedObject",
            objectKind: "spreadsheet",
            frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
            document: { kind: "spreadsheet", metadata: {}, sheets: [] },
          },
        ]),
      ),
    ).toContain(RtfDiagnosticCodes.EMBEDDED_OBJECT_DROPPED);
  });

  it("rtf/cell-border-dropped", () => {
    expect(
      writeCodes(
        wordprocessing([
          {
            kind: "table",
            columnWidthsPt: [72],
            rows: [
              {
                cells: [
                  {
                    blocks: [{ kind: "paragraph", runs: [{ text: "A" }] }],
                    background: { r: 1, g: 1, b: 0 },
                  },
                ],
              },
            ],
          },
        ]),
      ),
    ).toContain(RtfDiagnosticCodes.CELL_BORDER_DROPPED);
  });

  it("rtf/package-table-dropped", () => {
    const documentPackage: DocumentTree = {
      kind: "wordprocessing",
      metadata: {},
      definitions: {
        n1: {
          kind: "footnote",
          blocks: [{ kind: "paragraph", runs: [{ text: "note" }] }],
        },
      },
      children: [
        {
          node: { kind: "section", ...SECTION },
          children: [{ kind: "paragraph", runs: [{ text: "body" }] }],
        },
      ],
    };
    const codes: RtfDiagnostic[] = [];
    writeRtf(documentPackage, { sink: (diagnostic) => codes.push(diagnostic) });
    expect(collect(codes)).toContain(RtfDiagnosticCodes.PACKAGE_TABLE_DROPPED);
  });
});

describe("the code table has no dead entry", () => {
  it("every code in RtfDiagnosticCodes was produced by a fixture above", () => {
    expect(
      [...Object.values(RtfDiagnosticCodes)].filter(
        (code) => !observed.has(code),
      ),
    ).toEqual([]);
  });
});
