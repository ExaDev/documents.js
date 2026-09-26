import { describe, expect, it } from "vitest";
import type { ContentDocument, ContentSheet } from "document-schema.js";
import { PAGE_SIZE_A4, PAGE_SIZE_LETTER } from "document-schema.js";
import type { XmlElement } from "../../model/node";
import { encodePackage } from "../../codec";
import { parsePackage } from "../../package-io/read";
import { attr, childrenWithTag, rootElement } from "../util";
import { buildXlsxPackageFromContent } from "./build";
import { readXlsxContent } from "./content";
const DEFAULT_PRINT_SETTINGS: ContentSheet["printSettings"] = {
  pageSize: PAGE_SIZE_LETTER,
  margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
  gridlines: false,
  headers: false,
  pageOrder: "downThenOver",
};

function singleSheetDocument(cells: ContentSheet["cells"]): ContentDocument {
  return {
    kind: "spreadsheet",
    metadata: {},
    sheets: [
      {
        name: "Sheet1",
        cells,
        columns: [],
        rows: [],
        images: [],
        printSettings: DEFAULT_PRINT_SETTINGS,
      },
    ],
  };
}

const DECORATED_SHEET: ContentSheet = {
  name: "Decorated",
  cells: [
    {
      row: 0,
      column: 0,
      value: { kind: "string", value: "Header" },
      displayText: "Header",
      background: { kind: "solid", color: { r: 1, g: 0, b: 0 } },
      borders: {
        left: { color: { r: 0, g: 0, b: 0 }, widthPt: 0.75 },
        right: { color: { r: 0, g: 0, b: 0 }, widthPt: 0.75 },
        top: { color: { r: 0, g: 0, b: 0 }, widthPt: 0.75 },
        bottom: { color: { r: 0, g: 0, b: 0 }, widthPt: 0.75 },
      },
      alignment: "center",
      verticalAlignment: "middle",
    },
    {
      row: 1,
      column: 0,
      value: { kind: "number", value: 42 },
      displayText: "42",
      background: { kind: "solid", color: { r: 1, g: 1, b: 0 } },
    },
  ],
  columns: [],
  rows: [],
  images: [],
  printSettings: {
    pageSize: PAGE_SIZE_A4,
    margins: { topPt: 36, rightPt: 36, bottomPt: 36, leftPt: 36 },
    gridlines: true,
    headers: true,
    pageOrder: "downThenOver",
  },
};

const FONTED_SHEET: ContentSheet = {
  name: "Fonted",
  cells: [
    {
      row: 0,
      column: 0,
      value: { kind: "string", value: "Header" },
      displayText: "Header",
      font: { bold: true, color: { r: 1, g: 0, b: 0 } },
    },
    {
      row: 1,
      column: 0,
      value: { kind: "number", value: 42 },
      displayText: "42",
      font: { fontFamily: "Courier New", sizePt: 14, strike: true },
    },
    {
      row: 2,
      column: 0,
      value: { kind: "number", value: 7 },
      displayText: "7",
      // bold: false against this writer's own not-bold default font restates the default, so this cell must share font entry 0 and mint nothing.
      font: { bold: false },
    },
  ],
  columns: [],
  rows: [],
  images: [],
  printSettings: {
    pageSize: PAGE_SIZE_A4,
    margins: { topPt: 36, rightPt: 36, bottomPt: 36, leftPt: 36 },
    gridlines: true,
    headers: true,
    pageOrder: "downThenOver",
  },
};

describe("buildXlsxPackageFromContent: writes the per-cell font into xl/styles.xml", () => {
  const pkg = buildXlsxPackageFromContent({
    kind: "spreadsheet",
    metadata: {
      title: undefined,
      author: undefined,
      subject: undefined,
      keywords: undefined,
      creator: undefined,
      producer: undefined,
      createdIso: undefined,
      modifiedIso: undefined,
    },
    sheets: [FONTED_SHEET],
  });
  const styles = rootElement(pkg.parts["xl/styles.xml"]);
  if (styles === undefined) {
    throw new Error("expected xl/styles.xml to have a root element");
  }
  const required = (
    element: XmlElement | undefined,
    message: string,
  ): XmlElement => {
    if (element === undefined) {
      throw new Error(message);
    }
    return element;
  };

  it("writes the default Calibri-11 font at index 0, then one entry per distinct cell font", () => {
    const fontsEl = required(
      childrenWithTag(styles, "fonts")[0],
      "expected a <fonts> element",
    );
    const fonts = childrenWithTag(fontsEl, "font");
    // The default font (index 0), the bold red header font, and the Courier New strike font: row 2's bold: false restates the default and mints no font of its own.
    const EXPECTED_FONT_COUNT = 3;
    expect(fonts).toHaveLength(EXPECTED_FONT_COUNT);
    const defaultFont = required(fonts[0], "expected the default <font> at 0");
    expect(
      childrenWithTag(defaultFont, "sz")[0]?.attributes.find(
        (a) => a.name === "val",
      )?.value,
    ).toBe("11");
    expect(
      childrenWithTag(defaultFont, "name")[0]?.attributes.find(
        (a) => a.name === "val",
      )?.value,
    ).toBe("Calibri");
    const boldRed = required(fonts[1], "expected a bold <font> at 1");
    expect(childrenWithTag(boldRed, "b")).toHaveLength(1);
    expect(
      childrenWithTag(boldRed, "color")[0]?.attributes.find(
        (a) => a.name === "rgb",
      )?.value,
    ).toBe("FFff0000");
    const courier = required(fonts[2], "expected a courier <font> at 2");
    expect(childrenWithTag(courier, "strike")).toHaveLength(1);
    expect(
      childrenWithTag(courier, "sz")[0]?.attributes.find(
        (a) => a.name === "val",
      )?.value,
    ).toBe("14");
    expect(
      childrenWithTag(courier, "name")[0]?.attributes.find(
        (a) => a.name === "val",
      )?.value,
    ).toBe("Courier New");
  });

  it("writes fontId and applyFont on a fonted xf, leaving the default xf free of both", () => {
    const cellXfsEl = required(
      childrenWithTag(styles, "cellXfs")[0],
      "expected a <cellXfs> element",
    );
    const xfs = childrenWithTag(cellXfsEl, "xf");
    // xf[0] = default (General + default font, shared with the bold:false cell); xf[1] = bold red; xf[2] = courier
    const EXPECTED_XF_COUNT = 3;
    expect(xfs).toHaveLength(EXPECTED_XF_COUNT);
    const defaultXf = required(xfs[0], "expected the default <xf> at 0");
    expect(defaultXf.attributes.map((a) => a.name)).not.toContain("applyFont");
    expect(defaultXf.attributes.find((a) => a.name === "fontId")?.value).toBe(
      "0",
    );
    const boldRedXf = required(xfs[1], "expected a fonted <xf> at 1");
    expect(boldRedXf.attributes.find((a) => a.name === "fontId")?.value).toBe(
      "1",
    );
    expect(boldRedXf.attributes.map((a) => a.name)).toContain("applyFont");
    expect(xfs[2]?.attributes.find((a) => a.name === "fontId")?.value).toBe(
      "2",
    );
  });
});

describe("readXlsxContent(buildXlsxPackageFromContent(x)) round-trips the per-cell font", () => {
  const result = readXlsxContent(
    buildXlsxPackageFromContent({
      kind: "spreadsheet",
      metadata: {
        title: undefined,
        author: undefined,
        subject: undefined,
        keywords: undefined,
        creator: undefined,
        producer: undefined,
        createdIso: undefined,
        modifiedIso: undefined,
      },
      sheets: [FONTED_SHEET],
    }),
  );
  if (result.kind !== "spreadsheet") {
    throw new Error("expected a spreadsheet ContentDocument");
  }
  const cells = result.sheets[0]?.cells ?? [];

  it("preserves each distinct cell font through the round trip", () => {
    expect(cells[0]?.font).toEqual({
      bold: true,
      color: { r: 1, g: 0, b: 0 },
    });
    expect(cells[1]?.font).toEqual({
      fontFamily: "Courier New",
      sizePt: 14,
      strike: true,
    });
  });

  it("reads a font that normalised back to the default as no font of its own", () => {
    expect(cells[2]?.font).toBeUndefined();
  });
});

describe("buildXlsxPackageFromContent: writes cell decoration (fills/borders/alignment) into xl/styles.xml", () => {
  const pkg = buildXlsxPackageFromContent({
    kind: "spreadsheet",
    metadata: {
      title: undefined,
      author: undefined,
      subject: undefined,
      keywords: undefined,
      creator: undefined,
      producer: undefined,
      createdIso: undefined,
      modifiedIso: undefined,
    },
    sheets: [DECORATED_SHEET],
  });
  const styles = rootElement(pkg.parts["xl/styles.xml"]);
  if (styles === undefined) {
    throw new Error("expected xl/styles.xml to have a root element");
  }
  // Required-element accessor: the structure below is asserted to exist by the test's own intent, so a missing element is a genuine test failure (thrown here) rather than a silently-skipped assertion.
  const required = (
    element: XmlElement | undefined,
    message: string,
  ): XmlElement => {
    if (element === undefined) {
      throw new Error(message);
    }
    return element;
  };

  it("writes the two reserved fills (none/gray125) before the solid fills, one per distinct background colour", () => {
    const fillsEl = required(
      childrenWithTag(styles, "fills")[0],
      "expected a <fills> element",
    );
    const fills = childrenWithTag(fillsEl, "fill");
    // The two reserved fills (none, gray125) plus one solid fill per distinct background colour (red, yellow).
    const EXPECTED_FILL_COUNT = 4;
    expect(fills).toHaveLength(EXPECTED_FILL_COUNT);
    const patternType = (fill: XmlElement | undefined): string | undefined =>
      fill === undefined
        ? undefined
        : childrenWithTag(fill, "patternFill")[0]?.attributes.find(
            (a) => a.name === "patternType",
          )?.value;
    expect(patternType(fills[0])).toBe("none");
    expect(patternType(fills[1])).toBe("gray125");
    expect(patternType(fills[2])).toBe("solid");
    const solidFill = required(fills[2], "expected a solid <fill> at index 2");
    const solidRed = required(
      childrenWithTag(solidFill, "patternFill")[0],
      "expected a <patternFill>",
    );
    expect(
      childrenWithTag(solidRed, "fgColor")[0]?.attributes.find(
        (a) => a.name === "rgb",
      )?.value,
    ).toBe("FFff0000");
  });

  it("writes the reserved empty border at index 0, then the real per-edge border", () => {
    const bordersEl = required(
      childrenWithTag(styles, "borders")[0],
      "expected a <borders> element",
    );
    const borders = childrenWithTag(bordersEl, "border");
    expect(borders).toHaveLength(2);
    const reservedBorder = required(
      borders[0],
      "expected a reserved <border> at index 0",
    );
    const realBorder = required(
      borders[1],
      "expected a real <border> at index 1",
    );
    // reserved empty: every edge present but with no style attribute
    const reservedLeft = childrenWithTag(reservedBorder, "left")[0];
    expect(
      reservedLeft?.attributes.find((a) => a.name === "style"),
    ).toBeUndefined();
    // real border: four thin edges with black colour
    const realLeft = required(
      childrenWithTag(realBorder, "left")[0],
      "expected a real <left>",
    );
    expect(realLeft.attributes.find((a) => a.name === "style")?.value).toBe(
      "thin",
    );
    expect(
      childrenWithTag(realLeft, "color")[0]?.attributes.find(
        (a) => a.name === "rgb",
      )?.value,
    ).toBe("FF000000");
  });

  it("writes applyFill/applyBorder/applyAlignment and an inline <alignment> on the decorated xf", () => {
    const cellXfsEl = required(
      childrenWithTag(styles, "cellXfs")[0],
      "expected a <cellXfs> element",
    );
    const xfs = childrenWithTag(cellXfsEl, "xf");
    // xf[0] = default General/no-decoration; xf[1] = red + bordered + centred; xf[2] = yellow only
    const decorated = required(xfs[1], "expected a decorated <xf> at index 1");
    const attrs = decorated.attributes.map((a) => a.name);
    expect(attrs).toContain("applyFill");
    expect(attrs).toContain("applyBorder");
    expect(attrs).toContain("applyAlignment");
    const alignment = childrenWithTag(decorated, "alignment")[0];
    expect(
      alignment?.attributes.find((a) => a.name === "horizontal")?.value,
    ).toBe("center");
    expect(
      alignment?.attributes.find((a) => a.name === "vertical")?.value,
    ).toBe("center");
  });
});

describe("readXlsxContent(buildXlsxPackageFromContent(x)) round-trips cell decoration", () => {
  const pkg = buildXlsxPackageFromContent({
    kind: "spreadsheet",
    metadata: {
      title: undefined,
      author: undefined,
      subject: undefined,
      keywords: undefined,
      creator: undefined,
      producer: undefined,
      createdIso: undefined,
      modifiedIso: undefined,
    },
    sheets: [DECORATED_SHEET],
  });
  const result = readXlsxContent(pkg);
  if (result.kind !== "spreadsheet") {
    throw new Error("expected a spreadsheet ContentDocument");
  }
  const cells = result.sheets[0]?.cells ?? [];

  it("preserves a cell background colour through the round trip", () => {
    expect(cells[0]?.background).toEqual({
      kind: "solid",
      color: { r: 1, g: 0, b: 0 },
    });
    expect(cells[1]?.background).toEqual({
      kind: "solid",
      color: { r: 1, g: 1, b: 0 },
    });
  });

  it("preserves per-edge borders, recovering the same thin solid width the writer emitted", () => {
    const borders = cells[0]?.borders;
    expect(borders?.left).toEqual({
      color: { r: 0, g: 0, b: 0 },
      widthPt: 0.75,
    });
    expect(borders?.right).toEqual({
      color: { r: 0, g: 0, b: 0 },
      widthPt: 0.75,
    });
    expect(borders?.top).toEqual({
      color: { r: 0, g: 0, b: 0 },
      widthPt: 0.75,
    });
    expect(borders?.bottom).toEqual({
      color: { r: 0, g: 0, b: 0 },
      widthPt: 0.75,
    });
  });

  it('preserves horizontal and vertical alignment (middle round-trips through xlsx "center")', () => {
    expect(cells[0]?.alignment).toBe("center");
    expect(cells[0]?.verticalAlignment).toBe("middle");
  });
});

describe("readXlsxContent(buildXlsxPackageFromContent(x)) round-trips a genuine two-colour pattern fill (ExaDev/documents.js#951)", () => {
  const pkg = buildXlsxPackageFromContent(
    singleSheetDocument([
      {
        row: 0,
        column: 0,
        value: { kind: "string", value: "grey" },
        displayText: "grey",
        background: {
          kind: "pattern",
          patternType: "mediumGray",
          foregroundColor: { r: 0, g: 0, b: 0 },
          backgroundColor: { r: 1, g: 1, b: 1 },
        },
      },
      {
        row: 0,
        column: 1,
        value: { kind: "string", value: "crosshatch" },
        displayText: "crosshatch",
        background: {
          kind: "pattern",
          patternType: "darkTrellis",
          foregroundColor: { r: 1, g: 0, b: 0 },
          backgroundColor: { r: 0, g: 0, b: 1 },
        },
      },
    ]),
  );
  const result = readXlsxContent(pkg);
  if (result.kind !== "spreadsheet") {
    throw new Error("expected a spreadsheet ContentDocument");
  }
  const cells = result.sheets[0]?.cells ?? [];

  it("round-trips a percentage-grey pattern fill instead of dropping it", () => {
    expect(cells[0]?.background).toEqual({
      kind: "pattern",
      patternType: "mediumGray",
      foregroundColor: { r: 0, g: 0, b: 0 },
      backgroundColor: { r: 1, g: 1, b: 1 },
    });
  });

  it("round-trips a crosshatch pattern fill instead of dropping it", () => {
    expect(cells[1]?.background).toEqual({
      kind: "pattern",
      patternType: "darkTrellis",
      foregroundColor: { r: 1, g: 0, b: 0 },
      backgroundColor: { r: 0, g: 0, b: 1 },
    });
  });

  it("throws writing a WordprocessingML-only pattern type ST_PatternType has no member for", () => {
    expect(() =>
      buildXlsxPackageFromContent(
        singleSheetDocument([
          {
            row: 0,
            column: 0,
            value: { kind: "string", value: "x" },
            displayText: "x",
            background: { kind: "pattern", patternType: "diagonalCross" },
          },
        ]),
      ),
    ).toThrow(/diagonalCross/);
  });
});

describe("buildXlsxPackageFromContent: cell comments (ExaDev/documents.js#949)", () => {
  it("writes no threadedComments part, no worksheet rels, and no Content_Types override at all when no cell carries a comment", () => {
    const pkg = buildXlsxPackageFromContent(
      singleSheetDocument([
        {
          row: 0,
          column: 0,
          value: { kind: "string", value: "x" },
          displayText: "x",
        },
      ]),
    );
    expect(Object.keys(pkg.parts)).not.toContain(
      "xl/worksheets/_rels/sheet1.xml.rels",
    );
    expect(Object.keys(pkg.parts)).not.toContain(
      "xl/threadedComments/threadedComment1.xml",
    );
    const contentTypes = rootElement(pkg.parts["[Content_Types].xml"]);
    if (contentTypes === undefined) {
      throw new Error("expected [Content_Types].xml to have a root element");
    }
    const overrides = childrenWithTag(contentTypes, "Override").map((el) =>
      attr(el, "PartName"),
    );
    expect(
      overrides.some((name) => name?.includes("threadedComment") === true),
    ).toBe(false);
  });

  it("writes a worksheet rels part, a threadedComments part, and a matching Content_Types override for a sheet carrying a commented cell", () => {
    const pkg = buildXlsxPackageFromContent(
      singleSheetDocument([
        {
          row: 0,
          column: 0,
          value: { kind: "string", value: "x" },
          displayText: "x",
          comment: { text: "A note" },
        },
      ]),
    );
    expect(Object.keys(pkg.parts)).toContain(
      "xl/worksheets/_rels/sheet1.xml.rels",
    );
    expect(Object.keys(pkg.parts)).toContain(
      "xl/threadedComments/threadedComment1.xml",
    );
    const contentTypes = rootElement(pkg.parts["[Content_Types].xml"]);
    if (contentTypes === undefined) {
      throw new Error("expected [Content_Types].xml to have a root element");
    }
    const overrides = childrenWithTag(contentTypes, "Override").map((el) =>
      attr(el, "PartName"),
    );
    expect(overrides).toContain("/xl/threadedComments/threadedComment1.xml");
    const rels = rootElement(pkg.parts["xl/worksheets/_rels/sheet1.xml.rels"]);
    if (rels === undefined) {
      throw new Error(
        "expected the worksheet rels part to have a root element",
      );
    }
    const relationship = childrenWithTag(rels, "Relationship")[0];
    if (relationship === undefined) {
      throw new Error(
        "expected the worksheet rels part to have a Relationship",
      );
    }
    expect(attr(relationship, "Target")).toBe(
      "../threadedComments/threadedComment1.xml",
    );
  });

  it("round-trips through the lossless byte codec (encodePackage -> parsePackage -> byte-identical structure) once comments are in play", () => {
    const pkg = buildXlsxPackageFromContent(
      singleSheetDocument([
        {
          row: 0,
          column: 0,
          value: { kind: "string", value: "x" },
          displayText: "x",
          comment: {
            text: "Root note",
            author: "Alice",
            createdAt: "2026-01-02T03:04:05Z",
            replies: [{ text: "A reply", author: "Bob" }],
          },
        },
      ]),
    );
    const bytes = encodePackage(pkg);
    const reparsed = parsePackage(bytes);
    expect(reparsed).toEqual(pkg);
  });

  it("round-trips a full comment thread (text, author, createdAt, replies) back through readXlsxContent", () => {
    const cells: ContentSheet["cells"] = [
      {
        row: 0,
        column: 0,
        value: { kind: "string", value: "x" },
        displayText: "x",
        comment: {
          text: "Root note",
          author: "Alice",
          createdAt: "2026-01-02T03:04:05Z",
          replies: [
            { text: "First reply", author: "Bob" },
            { text: "Second reply, no author" },
          ],
        },
      },
    ];
    const pkg = buildXlsxPackageFromContent(singleSheetDocument(cells));
    const roundTripped = readXlsxContent(pkg);
    if (roundTripped.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    const cell = roundTripped.sheets[0]?.cells[0];
    expect(cell?.comment).toEqual({
      text: "Root note",
      author: "Alice",
      createdAt: "2026-01-02T03:04:05Z",
      replies: [
        { text: "First reply", author: "Bob" },
        { text: "Second reply, no author" },
      ],
    });
  });

  it("round-trips a comment whose text needs XML escaping (& < > carried through the thread's own <text> element)", () => {
    const pkg = buildXlsxPackageFromContent(
      singleSheetDocument([
        {
          row: 2,
          column: 1,
          value: { kind: "string", value: "x" },
          displayText: "x",
          comment: { text: "Tom & Jerry <b>bold</b>", author: "A & B" },
        },
      ]),
    );
    const roundTripped = readXlsxContent(pkg);
    if (roundTripped.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    const cell = roundTripped.sheets[0]?.cells[0];
    expect(cell?.comment).toEqual({
      text: "Tom & Jerry <b>bold</b>",
      author: "A & B",
    });
  });

  it("only writes a threadedComments part for the sheet that actually has a commented cell, correctly indexed, in a multi-sheet workbook", () => {
    const document: ContentDocument = {
      kind: "spreadsheet",
      metadata: {},
      sheets: [
        {
          name: "Sheet1",
          cells: [
            {
              row: 0,
              column: 0,
              value: { kind: "string", value: "x" },
              displayText: "x",
            },
          ],
          columns: [],
          rows: [],
          images: [],
          printSettings: DEFAULT_PRINT_SETTINGS,
        },
        {
          name: "Sheet2",
          cells: [
            {
              row: 0,
              column: 0,
              value: { kind: "string", value: "y" },
              displayText: "y",
              comment: { text: "Only on sheet 2" },
            },
          ],
          columns: [],
          rows: [],
          images: [],
          printSettings: DEFAULT_PRINT_SETTINGS,
        },
      ],
    };
    const pkg = buildXlsxPackageFromContent(document);
    expect(Object.keys(pkg.parts)).not.toContain(
      "xl/threadedComments/threadedComment1.xml",
    );
    expect(Object.keys(pkg.parts)).toContain(
      "xl/threadedComments/threadedComment2.xml",
    );
    const roundTripped = readXlsxContent(pkg);
    if (roundTripped.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    expect(roundTripped.sheets[0]?.cells[0]?.comment).toBeUndefined();
    expect(roundTripped.sheets[1]?.cells[0]?.comment).toEqual({
      text: "Only on sheet 2",
    });
  });

  it("gives each reply its own id and points it back at its own thread's root via parentId, never at another cell's thread", () => {
    const pkg = buildXlsxPackageFromContent(
      singleSheetDocument([
        {
          row: 0,
          column: 0,
          value: { kind: "string", value: "x" },
          displayText: "x",
          comment: {
            text: "First cell",
            replies: [{ text: "Reply to first" }],
          },
        },
        {
          row: 1,
          column: 0,
          value: { kind: "string", value: "y" },
          displayText: "y",
          comment: {
            text: "Second cell",
            replies: [{ text: "Reply to second" }],
          },
        },
      ]),
    );
    const roundTripped = readXlsxContent(pkg);
    if (roundTripped.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    const firstCell = roundTripped.sheets[0]?.cells[0];
    const secondCell = roundTripped.sheets[0]?.cells[1];
    expect(firstCell?.comment).toEqual({
      text: "First cell",
      replies: [{ text: "Reply to first" }],
    });
    expect(secondCell?.comment).toEqual({
      text: "Second cell",
      replies: [{ text: "Reply to second" }],
    });
  });
});

// ExaDev/documents.js#973's own two one-way rows, closed: a worksheet's own drawing layer (charts and pictures) and the workbook's own definitions table (general defined names and Table/List objects) now both survive buildXlsxPackageFromContent — typed/xlsx/content.test.ts carries the byte-level decodePackage/encodePackage round trips for the drawing layer (one per anchor spelling); this suite checks the XML shape directly, the same way the comment tests above do, plus one round trip per row through readXlsxContent/readWorkbookDefinitions.
