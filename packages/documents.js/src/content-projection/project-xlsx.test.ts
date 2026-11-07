import { describe, expect, it } from "vitest";
import {
  CONTENT_TYPE,
  cell,
  row,
  xlsx,
  zipParts,
  type PackagePart,
  type XlsxSpec,
} from "../test-support/content-projection";
import { listOpcParts, readOpcPart } from "./opc-package";
import { compareProjections } from "./compare-projections";
import { SHARED_FORMULA } from "./projection";
import { projectXlsxContent } from "./project-xlsx";

const BUDGET = 2 ** 30;
const project = async (spec: XlsxSpec) =>
  projectXlsxContent(xlsx(spec), { memoryBudgetBytes: BUDGET });

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 4, 5, 6]);

const ROW_ONE = row(1, [
  cell({ r: "A1", t: "s", v: "0" }),
  cell({ r: "B1", v: "1.0" }),
  cell({ r: "C1", t: "str", f: "A1&amp;B1", v: "alpha1" }),
]);
const ROW_TWO = row(2, [
  cell({ r: "A2", t: "inlineStr", inline: "inline text" }),
  cell({ r: "B2", t: "b", v: "1" }),
]);

const BASE: XlsxSpec = {
  sheets: [
    {
      name: "Data",
      rows: ROW_ONE + ROW_TWO,
      after: '<mergeCells count="1"><mergeCell ref="A1:B1"/></mergeCells>',
    },
    { name: "Second", rows: row(1, [cell({ r: "A1", v: "7" })]) },
  ],
  sharedStrings: ["alpha", "beta unused"],
  definedNames: ['<definedName name="Total">Data!$B$1</definedName>'],
  comments: ["cell note text"],
  threadedComments: ["threaded reply text"],
  drawingText: "drawing label",
  chartValues: ["Series A"],
  media: { "pic.png": PNG },
};

async function compare(original: XlsxSpec, rewrite: XlsxSpec) {
  return compareProjections(await project(original), await project(rewrite));
}

describe("projectXlsxContent cells", () => {
  it("resolves values through shared strings and inline strings, booleans and numbers, and keeps formulas beside values", async () => {
    const { cells } = await project(BASE);
    expect(cells.get("0!A1")).toEqual({ value: "alpha", formula: undefined });
    expect(cells.get("0!B1")).toEqual({ value: "1", formula: undefined });
    expect(cells.get("0!C1")).toEqual({ value: "alpha1", formula: "A1&B1" });
    expect(cells.get("0!A2")).toEqual({
      value: "inline text",
      formula: undefined,
    });
    expect(cells.get("0!B2")).toEqual({ value: "TRUE", formula: undefined });
    expect(cells.get("1!A1")).toEqual({ value: "7", formula: undefined });
  });

  it("keys cells by sheet position, so the name is not part of a cell's identity", async () => {
    const renamed = await project({
      ...BASE,
      sheets: BASE.sheets.map((s, i) =>
        i === 0 ? { ...s, name: "Renamed" } : s,
      ),
    });
    expect([...renamed.cells.keys()]).toEqual([
      ...(await project(BASE)).cells.keys(),
    ]);
  });

  it("takes the position a row or cell without a reference implies", async () => {
    const { cells } = await project({
      sheets: [
        {
          name: "S",
          rows:
            row(undefined, [
              cell({ v: "1" }),
              cell({ v: "2" }),
              cell({ r: "E1", v: "3" }),
              cell({ v: "4" }),
            ]) + row(undefined, [cell({ v: "5" })]),
        },
      ],
    });
    expect(
      Object.fromEntries([...cells].map(([k, c]) => [k, c.value])),
    ).toEqual({
      "0!A1": "1",
      "0!B1": "2",
      "0!E1": "3",
      "0!F1": "4",
      "0!A2": "5",
    });
  });

  it("counts a column letter carry correctly when implying references past Z", async () => {
    const { cells } = await project({
      sheets: [
        {
          name: "S",
          rows: row(1, [cell({ r: "Z1", v: "1" }), cell({ v: "2" })]),
        },
      ],
    });
    expect([...cells.keys()]).toEqual(["0!Z1", "0!AA1"]);
  });

  it("marks a cell that reads a shared formula's master, and skips cells with neither value nor formula", async () => {
    const { cells } = await project({
      sheets: [
        {
          name: "S",
          rows: row(1, [
            cell({
              r: "A1",
              fAttributes: 't="shared" ref="A1:A2" si="0"',
              f: "B1+1",
              v: "2",
            }),
            cell({ r: "A2", fAttributes: 't="shared" si="0"', v: "3" }),
            cell({ r: "A3" }),
          ]),
        },
      ],
    });
    expect(cells.get("0!A1")?.formula).toBe("B1+1");
    expect(cells.get("0!A2")?.formula).toBe(SHARED_FORMULA);
    expect(cells.has("0!A3")).toBe(false);
  });

  it("agrees on numbers across spellings", async () => {
    const left = await project({
      sheets: [
        {
          name: "S",
          rows: row(1, [
            cell({ r: "A1", v: "1.0" }),
            cell({ r: "B1", v: "1E2" }),
            cell({ r: "C1", v: "0.10" }),
          ]),
        },
      ],
    });
    const right = await project({
      sheets: [
        {
          name: "S",
          rows: row(1, [
            cell({ r: "A1", v: "1" }),
            cell({ r: "B1", v: "100" }),
            cell({ r: "C1", v: "0.1" }),
          ]),
        },
      ],
    });
    expect(left.cells).toEqual(right.cells);
  });

  it("leaves phonetic runs out of a shared string", async () => {
    const projection = await project({
      sheets: [
        { name: "S", rows: row(1, [cell({ r: "A1", t: "s", v: "0" })]) },
      ],
      sharedStringItems:
        '<si><r><t>Tok</t></r><r><t>yo</t></r><rPh sb="0" eb="2"><t>PHONETIC</t></rPh></si>',
    });
    expect(projection.cells.get("0!A1")?.value).toBe("Tokyo");
    expect([...(projection.units.get("shared-strings")?.keys() ?? [])]).toEqual(
      ["Tokyo"],
    );
  });

  it("skips a part that is not well-formed and keeps no cells from it", async () => {
    const projection = await project({
      ...BASE,
      extraParts: [],
      sheets: [{ name: "S", rows: '<row r="1"><c r="A1"><v>1</v></c></row' }],
    });
    expect(projection.skippedParts.map((part) => part.reason)).toEqual([
      "unparsed:XmlScanError",
    ]);
    expect(projection.cells.size).toBe(0);
  });
});

describe("projectXlsxContent other content", () => {
  it("projects names, strings, comments, drawings, charts and media", async () => {
    const projection = await project(BASE);
    expect(projection.units.get("sheet-names")).toEqual(
      new Map([
        ["Data", 1],
        ["Second", 1],
      ]),
    );
    expect(projection.units.get("defined-names")).toEqual(
      new Map([[":Total", 1]]),
    );
    expect(projection.units.get("shared-strings")?.get("unused")).toBe(1);
    expect(projection.units.get("comments")).toEqual(
      new Map([
        ["cell", 1],
        ["note", 1],
        ["text", 2],
        ["threaded", 1],
        ["reply", 1],
      ]),
    );
    expect(projection.units.get("drawings")?.get("label")).toBe(1);
    expect(projection.units.get("charts")?.get("Series")).toBe(1);
    expect(
      [...projection.media.keys()].map((key) => key.split(":")[0]),
    ).toEqual(["image"]);
    expect(projection.census.get("sheets")?.get("mergeCell")).toBe(1);
    expect(projection.census.get("sheets")?.get("c")).toBe(6);
    expect(projection.census.get("workbook")?.get("sheet")).toBe(2);
    expect(projection.census.get("comments")?.get("threadedComment")).toBe(1);
  });

  it("lists parts of kinds it does not read", async () => {
    const projection = await project({
      ...BASE,
      extraParts: [{ name: "xl/pivotTables/pivotTable1.xml", content: "<p/>" }],
      extraOverrides: {
        "xl/pivotTables/pivotTable1.xml": CONTENT_TYPE.pivotTable,
      },
    });
    expect(projection.unmodelledParts).toEqual([
      "xl/pivotTables/pivotTableN.xml",
    ]);
  });
});

describe("a clean rewrite is silent", () => {
  it("finds nothing in an identical package", async () => {
    expect((await compare(BASE, BASE)).verdict).toBe("equivalent");
  });

  it("finds nothing across container noise, a prefixed worksheet and character references", async () => {
    const original = xlsx(BASE);
    const noisy = zipParts(
      listOpcParts(original).map((entry): PackagePart => {
        const bytes = readOpcPart(original, entry.name);
        if (entry.name !== "xl/worksheets/sheet1.xml") {
          return { name: entry.name, content: bytes };
        }
        const text = new TextDecoder()
          .decode(bytes)
          .replace(/<(\/?)([A-Za-z])/g, "<$1x:$2")
          .replace("xmlns=", "xmlns:x=")
          .replace("inline text", "inline &#116;&#x65;xt")
          .replaceAll("/>", " />");
        return { name: entry.name, content: text };
      }),
      { reverse: true, store: true, mtime: new Date(Date.UTC(2031, 1, 1)) },
    );
    const comparison = compareProjections(
      await projectXlsxContent(original, { memoryBudgetBytes: BUDGET }),
      await projectXlsxContent(noisy, { memoryBudgetBytes: BUDGET }),
    );
    expect(comparison.findings).toEqual([]);
    expect(comparison.verdict).toBe("equivalent");
  });
});

describe("each simulated loss is caught and attributed", () => {
  const sheetOne = (rows: string) => ({
    ...BASE,
    sheets: [{ ...BASE.sheets[0]!, rows }, BASE.sheets[1]!],
  });

  it("a dropped cell", async () => {
    const comparison = await compare(
      BASE,
      sheetOne(
        row(1, [
          cell({ r: "A1", t: "s", v: "0" }),
          cell({ r: "B1", v: "1.0" }),
        ]) + ROW_TWO,
      ),
    );
    expect(comparison.cells).toMatchObject({
      missing: 1,
      extra: 0,
      valueDiffer: 0,
    });
    expect(comparison.findings).toContainEqual({
      area: "census",
      subject: "sheets:c",
      count: 1,
      class: "loss",
    });
    expect(comparison.verdict).toBe("loss");
  });

  it("a changed value", async () => {
    const comparison = await compare(
      BASE,
      sheetOne(ROW_ONE.replace("<v>1.0</v>", "<v>2</v>") + ROW_TWO),
    );
    expect(comparison.cells).toMatchObject({ missing: 0, valueDiffer: 1 });
    expect(comparison.verdict).toBe("loss");
  });

  it("a formula reduced to its cached value", async () => {
    const comparison = await compare(
      BASE,
      sheetOne(ROW_ONE.replace("<f>A1&amp;B1</f>", "") + ROW_TWO),
    );
    expect(comparison.cells).toMatchObject({ formulaLost: 1, valueDiffer: 0 });
    expect(comparison.findings).toContainEqual({
      area: "census",
      subject: "sheets:f",
      count: 1,
      class: "loss",
    });
  });

  it("a rewritten formula", async () => {
    const comparison = await compare(
      BASE,
      sheetOne(
        ROW_ONE.replace("<f>A1&amp;B1</f>", "<f>A1&amp;C1</f>") + ROW_TWO,
      ),
    );
    expect(comparison.cells).toMatchObject({
      formulaLost: 0,
      formulaDiffer: 1,
    });
    expect(comparison.verdict).toBe("loss");
  });

  it("a dropped sheet row", async () => {
    const comparison = await compare(BASE, sheetOne(ROW_ONE));
    expect(comparison.cells).toMatchObject({ missing: 2 });
    expect(comparison.findings).toContainEqual({
      area: "census",
      subject: "sheets:row",
      count: 1,
      class: "loss",
    });
  });

  it("a renamed sheet, which must not make its cells look lost", async () => {
    const comparison = await compare(BASE, {
      ...BASE,
      sheets: [{ ...BASE.sheets[0]!, name: "Data-copy" }, BASE.sheets[1]!],
    });
    expect(comparison.units.get("sheet-names")).toEqual({
      original: 2,
      missing: 1,
      extra: 1,
    });
    expect(comparison.cells).toMatchObject({
      missing: 0,
      extra: 0,
      valueDiffer: 0,
    });
    expect(comparison.verdict).toBe("loss");
  });

  it("a dropped sheet", async () => {
    const comparison = await compare(BASE, {
      ...BASE,
      sheets: [BASE.sheets[0]!],
    });
    expect(comparison.units.get("sheet-names")?.missing).toBe(1);
    expect(comparison.cells?.missing).toBe(1);
  });

  it("a dropped defined name", async () => {
    const comparison = await compare(BASE, { ...BASE, definedNames: [] });
    expect(comparison.units.get("defined-names")).toEqual({
      original: 1,
      missing: 1,
      extra: 0,
    });
    expect(comparison.findings).toContainEqual({
      area: "census",
      subject: "workbook:definedName",
      count: 1,
      class: "loss",
    });
  });

  it("a dropped merge, validation-free structure that held no text", async () => {
    const comparison = await compare(BASE, {
      ...BASE,
      sheets: [{ ...BASE.sheets[0]!, after: "" }, BASE.sheets[1]!],
    });
    expect(comparison.findings).toEqual([
      { area: "census", subject: "sheets:mergeCell", count: 1, class: "loss" },
    ]);
  });

  it("a dropped shared string that no cell uses", async () => {
    const comparison = await compare(BASE, {
      ...BASE,
      sharedStrings: ["alpha"],
    });
    expect(comparison.units.get("shared-strings")).toMatchObject({
      missing: 2,
    });
  });

  it("a dropped comment, threaded comment, drawing text, chart text and image", async () => {
    expect(
      (await compare(BASE, { ...BASE, comments: [] })).units.get("comments")
        ?.missing,
    ).toBe(3);
    expect(
      (await compare(BASE, { ...BASE, threadedComments: [] })).units.get(
        "comments",
      )?.missing,
    ).toBe(3);
    expect(
      (await compare(BASE, { ...BASE, drawingText: "" })).units.get("drawings")
        ?.missing,
    ).toBe(2);
    expect(
      (await compare(BASE, { ...BASE, chartValues: [] })).units.get("charts")
        ?.missing,
    ).toBe(2);
    expect((await compare(BASE, { ...BASE, media: {} })).media).toMatchObject({
      missing: 1,
    });
  });
});
