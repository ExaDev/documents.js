import { describe, expect, it } from "vitest";
import type { Package } from "../../model/package";
import { el } from "../../xml/fragment";
import { readWorkbookDefinitions } from "./definitions";

const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const REL_WORKSHEET =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet";
const REL_TABLE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/table";
const REL_DRAWING =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing";

function basePackage(sheetRels: ReturnType<typeof el>[]): Package {
  return {
    parts: {
      "xl/workbook.xml": {
        kind: "xml",
        nodes: [
          el("workbook", {}, [
            el("sheets", {}, [
              el("sheet", { name: "Sheet1", sheetId: "1", "r:id": "rId1" }),
            ]),
          ]),
        ],
      },
      "xl/_rels/workbook.xml.rels": {
        kind: "xml",
        nodes: [
          el("Relationships", { xmlns: REL_NS }, [
            el("Relationship", {
              Id: "rId1",
              Type: REL_WORKSHEET,
              Target: "worksheets/sheet1.xml",
            }),
          ]),
        ],
      },
      "xl/worksheets/sheet1.xml": {
        kind: "xml",
        nodes: [el("worksheet", {}, [])],
      },
      "xl/worksheets/_rels/sheet1.xml.rels": {
        kind: "xml",
        nodes: [el("Relationships", { xmlns: REL_NS }, sheetRels)],
      },
      "xl/drawings/drawing1.xml": {
        kind: "xml",
        nodes: [el("xdr:wsDr", {}, [])],
      },
    },
  };
}

function tablePart(attrs: Record<string, string>): Package["parts"][string] {
  return {
    kind: "xml",
    nodes: [
      el("table", attrs, [
        el("tableColumns", {}, [
          el("tableColumn", { name: "Col1" }),
          el("tableColumn", { name: "Col2" }),
        ]),
      ]),
    ],
  };
}

describe("readWorkbookDefinitions", () => {
  it("returns undefined for a workbook whose sheet carries no table relationship at all", () => {
    const pkg = basePackage([
      el("Relationship", {
        Id: "rId1",
        Type: REL_DRAWING,
        Target: "../drawings/drawing1.xml",
      }),
    ]);
    expect(readWorkbookDefinitions(pkg)).toBeUndefined();
  });

  it("skips a non-table relationship and reads only the genuine table relationship among several", () => {
    const pkg = basePackage([
      el("Relationship", {
        Id: "rId1",
        Type: REL_DRAWING,
        Target: "../drawings/drawing1.xml",
      }),
      el("Relationship", {
        Id: "rId2",
        Type: REL_TABLE,
        Target: "../tables/table1.xml",
      }),
    ]);
    pkg.parts["xl/tables/table1.xml"] = tablePart({
      name: "SalesTable",
      ref: "A1:B2",
    });
    expect(readWorkbookDefinitions(pkg)).toEqual({
      "table:SalesTable": {
        kind: "table",
        name: "SalesTable",
        ref: "A1:B2",
        sheet: "Sheet1",
        columns: ["Col1", "Col2"],
      },
    });
  });

  it("skips a table part missing its own name attribute", () => {
    const pkg = basePackage([
      el("Relationship", {
        Id: "rId1",
        Type: REL_TABLE,
        Target: "../tables/table1.xml",
      }),
    ]);
    pkg.parts["xl/tables/table1.xml"] = tablePart({ ref: "A1:B2" });
    expect(readWorkbookDefinitions(pkg)).toBeUndefined();
  });

  it("skips a table part missing its own ref attribute", () => {
    const pkg = basePackage([
      el("Relationship", {
        Id: "rId1",
        Type: REL_TABLE,
        Target: "../tables/table1.xml",
      }),
    ]);
    pkg.parts["xl/tables/table1.xml"] = tablePart({ name: "SalesTable" });
    expect(readWorkbookDefinitions(pkg)).toBeUndefined();
  });
});
