import { describe, expect, it } from "vitest";
import type { ContentDocument } from "document-schema.js";
import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import { el, txt } from "../../xml/fragment";
import { attr, childrenWithTag, rootElement } from "../util";
import { readXlsxWorkbook } from "../xlsx";
import { buildXlsxPackageFromContent } from "./build";
import { readXlsxContent } from "./content";
import { readWorkbookDefinitions } from "./definitions";

// Names a workbook stores in attributes (sheet names, defined names, table and column names, a chart frame's name, a font's family name) arrive from the lossless layer exactly as written, entity and character references included. The readers decode them, so the name in the model is the name the file means and the writer's own encoding does not stack on top of the source's.

const RELATIONSHIP_BASE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

// Each written spelling and the sheet name it means: predefined entities, decimal and hexadecimal character references, and an apostrophe both as an entity and literally.
const SHEET_NAMES: readonly (readonly [string, string])[] = [
  ["A &amp; B", "A & B"],
  ["&lt;Draft&gt;", "<Draft>"],
  ["Q1 &#38; Q2", "Q1 & Q2"],
  ["Q3 &#x26; Q4", "Q3 & Q4"],
  ["Bob&apos;s", "Bob's"],
  ["Ann's", "Ann's"],
];

function relationship(id: string, type: string, target: string): XmlElement {
  return el("Relationship", {
    Id: id,
    Type: `${RELATIONSHIP_BASE}/${type}`,
    Target: target,
  });
}

function worksheet(value: string): XmlElement {
  return el("worksheet", {}, [
    el("sheetData", {}, [
      el("row", { r: "1" }, [
        el("c", { r: "A1" }, [el("v", {}, [txt(value)])]),
      ]),
    ]),
  ]);
}

function workbookPackage(
  sheetNames: readonly string[],
  definedNames: readonly XmlElement[] = [],
): Package {
  const parts: Package["parts"] = {
    "xl/workbook.xml": {
      kind: "xml",
      nodes: [
        el("workbook", {}, [
          el(
            "sheets",
            {},
            sheetNames.map((name, index) =>
              el("sheet", {
                name,
                sheetId: String(index + 1),
                "r:id": `rId${String(index + 1)}`,
              }),
            ),
          ),
          ...(definedNames.length === 0
            ? []
            : [el("definedNames", {}, definedNames)]),
        ]),
      ],
    },
    "xl/_rels/workbook.xml.rels": {
      kind: "xml",
      nodes: [
        el(
          "Relationships",
          {},
          sheetNames.map((_name, index) =>
            relationship(
              `rId${String(index + 1)}`,
              "worksheet",
              `worksheets/sheet${String(index + 1)}.xml`,
            ),
          ),
        ),
      ],
    },
  };
  sheetNames.forEach((_name, index) => {
    parts[`xl/worksheets/sheet${String(index + 1)}.xml`] = {
      kind: "xml",
      nodes: [worksheet(String(index + 1))],
    };
  });
  return { parts };
}

function spreadsheet(
  pkg: Package,
): Extract<ContentDocument, { kind: "spreadsheet" }> {
  const document = readXlsxContent(pkg);
  if (document.kind !== "spreadsheet") {
    throw new Error("expected a spreadsheet ContentDocument");
  }
  return document;
}

function writtenSheetNames(pkg: Package): (string | undefined)[] {
  const workbook = rootElement(pkg.parts["xl/workbook.xml"]);
  if (workbook === undefined) {
    throw new Error("expected a workbook part");
  }
  const sheets = childrenWithTag(workbook, "sheets")[0];
  if (sheets === undefined) {
    throw new Error("expected a sheets element");
  }
  return childrenWithTag(sheets, "sheet").map((sheet) => attr(sheet, "name"));
}

const writtenSpellings = SHEET_NAMES.map(([written]) => written);
const meantNames = SHEET_NAMES.map(([, meant]) => meant);

describe("readXlsxContent: entity and character references in sheet names", () => {
  it.each(SHEET_NAMES)(
    "reads the sheet name written %s as %s",
    (written, meant) => {
      expect(spreadsheet(workbookPackage([written])).sheets[0]?.name).toBe(
        meant,
      );
    },
  );

  it("keeps each sheet's cells with its decoded name", () => {
    const sheets = spreadsheet(workbookPackage(writtenSpellings)).sheets;
    expect(
      sheets.map((sheet) => [sheet.name, sheet.cells[0]?.displayText]),
    ).toEqual(meantNames.map((name, index) => [name, String(index + 1)]));
  });

  it("writes back the source's own spelling of a predefined entity, so write, read and write again is stable", () => {
    const first = buildXlsxPackageFromContent(
      spreadsheet(workbookPackage(writtenSpellings)),
    );
    const second = buildXlsxPackageFromContent(spreadsheet(first));
    expect(writtenSheetNames(first)).toEqual(writtenSheetNames(second));
    expect(spreadsheet(second).sheets.map((sheet) => sheet.name)).toEqual(
      meantNames,
    );
  });

  it("does not grow a name across repeated round trips", () => {
    let pkg = workbookPackage(["A &amp; B"]);
    for (let generation = 0; generation < 3; generation += 1) {
      pkg = buildXlsxPackageFromContent(spreadsheet(pkg));
    }
    expect(writtenSheetNames(pkg)).toEqual(["A &amp; B"]);
    expect(spreadsheet(pkg).sheets[0]?.name).toBe("A & B");
  });
});

describe("readXlsxContent: entity and character references in defined names", () => {
  it("decodes a defined name and still recognises a print area by its decoded name", () => {
    const pkg = workbookPackage(
      ["Data"],
      [
        el("definedName", { name: "Cost&#x5F;Centre" }, [txt("Data!$A$1")]),
        el("definedName", { name: "_xlnm&#46;Print_Area", localSheetId: "0" }, [
          txt("Data!$A$1:$B$2"),
        ]),
      ],
    );
    const document = spreadsheet(pkg);
    expect(document.names?.map((name) => name.name)).toEqual([
      "Cost_Centre",
      "_xlnm.Print_Area",
    ]);
    expect(document.sheets[0]?.printSettings.printRange).toEqual({
      startRow: 0,
      startColumn: 0,
      endRow: 1,
      endColumn: 1,
    });
  });
});

describe("readXlsxWorkbook: entity and character references in names", () => {
  it("projects decoded sheet and defined names", () => {
    const pkg = workbookPackage(
      ["A &amp; B", "Q1 &#38; Q2"],
      [el("definedName", { name: "R&amp;D" }, [txt("'A & B'!$A$1")])],
    );
    const workbook = readXlsxWorkbook(pkg);
    expect(workbook.sheets.map((sheet) => sheet.name)).toEqual([
      "A & B",
      "Q1 & Q2",
    ]);
    expect(workbook.definedNames.map((name) => name.name)).toEqual(["R&D"]);
  });
});

describe("readWorkbookDefinitions: entity and character references in table names", () => {
  it("decodes the table name, its columns and the sheet it sits on", () => {
    const pkg = workbookPackage(["P &amp; L"]);
    pkg.parts["xl/worksheets/_rels/sheet1.xml.rels"] = {
      kind: "xml",
      nodes: [
        el("Relationships", {}, [
          relationship("rIdTable", "table", "../tables/table1.xml"),
        ]),
      ],
    };
    pkg.parts["xl/tables/table1.xml"] = {
      kind: "xml",
      nodes: [
        el("table", { id: "1", name: "Sales&#x26;Costs", ref: "A1:B2" }, [
          el("tableColumns", { count: "2" }, [
            el("tableColumn", { id: "1", name: "Item &amp; Code" }),
            el("tableColumn", { id: "2", name: "&quot;Net&quot;" }),
          ]),
        ]),
      ],
    };
    expect(readWorkbookDefinitions(pkg)).toEqual({
      "table:Sales&Costs": {
        kind: "table",
        name: "Sales&Costs",
        ref: "A1:B2",
        sheet: "P & L",
        columns: ["Item & Code", '"Net"'],
      },
    });
  });
});

describe("readXlsxContent: entity and character references in a font family name", () => {
  it("decodes the family name a cell's font resolves to", () => {
    const pkg = workbookPackage(["Data"]);
    pkg.parts["xl/_rels/workbook.xml.rels"] = {
      kind: "xml",
      nodes: [
        el("Relationships", {}, [
          relationship("rId1", "worksheet", "worksheets/sheet1.xml"),
          relationship("rIdStyles", "styles", "styles.xml"),
        ]),
      ],
    };
    pkg.parts["xl/styles.xml"] = {
      kind: "xml",
      nodes: [
        el("styleSheet", {}, [
          el("fonts", { count: "2" }, [
            el("font", {}, [el("name", { val: "Calibri" })]),
            el("font", {}, [el("name", { val: "Smith &amp; Sons" })]),
          ]),
          el("cellXfs", { count: "2" }, [
            el("xf", { numFmtId: "0", fontId: "0" }),
            el("xf", { numFmtId: "0", fontId: "1" }),
          ]),
        ]),
      ],
    };
    pkg.parts["xl/worksheets/sheet1.xml"] = {
      kind: "xml",
      nodes: [
        el("worksheet", {}, [
          el("sheetData", {}, [
            el("row", { r: "1" }, [
              el("c", { r: "A1", s: "1" }, [el("v", {}, [txt("1")])]),
            ]),
          ]),
        ]),
      ],
    };
    expect(spreadsheet(pkg).sheets[0]?.cells[0]?.font?.fontFamily).toBe(
      "Smith & Sons",
    );
  });
});

describe("readXlsxContent: entity and character references in a chart frame's name", () => {
  it("names the chart's payload sheet after the decoded frame name", () => {
    const pkg = workbookPackage(["Data"]);
    const worksheetPart = pkg.parts["xl/worksheets/sheet1.xml"];
    if (
      worksheetPart?.kind !== "xml" ||
      worksheetPart.nodes[0]?.type !== "element"
    ) {
      throw new Error("expected the worksheet part");
    }
    worksheetPart.nodes[0].children.push(
      el("drawing", { "r:id": "rIdDrawing" }),
    );
    pkg.parts["xl/worksheets/_rels/sheet1.xml.rels"] = {
      kind: "xml",
      nodes: [
        el("Relationships", {}, [
          relationship("rIdDrawing", "drawing", "../drawings/drawing1.xml"),
        ]),
      ],
    };
    pkg.parts["xl/drawings/drawing1.xml"] = {
      kind: "xml",
      nodes: [
        el("xdr:wsDr", {}, [
          el("xdr:absoluteAnchor", {}, [
            el("xdr:pos", { x: "0", y: "0" }),
            el("xdr:ext", { cx: "914400", cy: "914400" }),
            el("xdr:graphicFrame", {}, [
              el("xdr:nvGraphicFramePr", {}, [
                el("xdr:cNvPr", { id: "2", name: "Profit &amp; Loss" }),
              ]),
              el("a:graphic", {}, [
                el(
                  "a:graphicData",
                  {
                    uri: "http://schemas.openxmlformats.org/drawingml/2006/chart",
                  },
                  [el("c:chart", { "r:id": "rIdChart" })],
                ),
              ]),
            ]),
            el("xdr:clientData"),
          ]),
        ]),
      ],
    };
    pkg.parts["xl/drawings/_rels/drawing1.xml.rels"] = {
      kind: "xml",
      nodes: [
        el("Relationships", {}, [
          relationship("rIdChart", "chart", "../charts/chart1.xml"),
        ]),
      ],
    };
    pkg.parts["xl/charts/chart1.xml"] = {
      kind: "xml",
      nodes: [
        el("c:chartSpace", {}, [
          el("c:chart", {}, [el("c:plotArea", {}, [el("c:barChart", {})])]),
        ]),
      ],
    };
    const chart = spreadsheet(pkg).sheets[0]?.embeddedObjects?.[0];
    const payload =
      chart?.document.kind === "spreadsheet"
        ? chart.document.sheets[0]
        : undefined;
    expect(payload?.name).toBe("Profit & Loss");
  });
});
