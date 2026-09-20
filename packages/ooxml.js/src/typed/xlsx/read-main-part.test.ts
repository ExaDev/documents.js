import { describe, expect, it } from "vitest";
import type { Package, Part } from "../../model/package";
import { el, txt } from "../../xml/fragment";
import { readXlsxContent } from "./content";

// A workbook whose main part is not xl/workbook.xml. The same OPC rule the docx reader now follows applies here: the package root's officeDocument relationship names the workbook, and the workbook's own relationships name its worksheets, styles and shared strings (ExaDev/documents.js#1314).

const RELATIONSHIPS_NS =
  "http://schemas.openxmlformats.org/package/2006/relationships";
const REL_BASE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

interface RelationshipSpec {
  readonly id: string;
  readonly type: string;
  readonly target: string;
}

function relsPart(relationships: readonly RelationshipSpec[]): Part {
  return {
    kind: "xml",
    nodes: [
      el(
        "Relationships",
        { xmlns: RELATIONSHIPS_NS },
        relationships.map((rel) =>
          el("Relationship", {
            Id: rel.id,
            Type: rel.type,
            Target: rel.target,
          }),
        ),
      ),
    ],
  };
}

function workbookPart(): Part {
  return {
    kind: "xml",
    nodes: [
      el("workbook", {}, [
        el("workbookPr", { date1904: "true" }),
        el("sheets", {}, [
          el("sheet", { name: "Renamed", sheetId: "1", "r:id": "rId2" }),
        ]),
        el("definedNames", {}, [
          el("definedName", { name: "Total" }, [txt("Renamed!$A$1")]),
        ]),
      ]),
    ],
  };
}

function worksheetPart(): Part {
  return {
    kind: "xml",
    nodes: [
      el("worksheet", {}, [
        el("sheetData", {}, [
          el("row", { r: "1" }, [
            el("c", { r: "A1", t: "s" }, [el("v", {}, [txt("0")])]),
          ]),
        ]),
      ]),
    ],
  };
}

function sharedStringsPart(): Part {
  return {
    kind: "xml",
    nodes: [
      el("sst", {}, [el("si", {}, [el("t", {}, [txt("Renamed cell")])])]),
    ],
  };
}

function spreadsheetOf(pkg: Package) {
  const document = readXlsxContent(pkg);
  if (document.kind !== "spreadsheet") {
    throw new Error("expected a spreadsheet ContentDocument");
  }
  return document;
}

function renamedWorkbookPackage(): Package {
  return {
    parts: {
      "_rels/.rels": relsPart([
        {
          id: "rId1",
          type: `${REL_BASE}/officeDocument`,
          target: "xl/workbook2.xml",
        },
      ]),
      "xl/workbook2.xml": workbookPart(),
      "xl/_rels/workbook2.xml.rels": relsPart([
        {
          id: "rId2",
          type: `${REL_BASE}/worksheet`,
          target: "worksheets/sheet1.xml",
        },
        {
          id: "rId3",
          type: `${REL_BASE}/sharedStrings`,
          target: "strings2.xml",
        },
      ]),
      "xl/worksheets/sheet1.xml": worksheetPart(),
      "xl/strings2.xml": sharedStringsPart(),
    },
  };
}

describe("readXlsxContent: main part named by the officeDocument relationship", () => {
  it("reads sheets from a workbook the package puts at xl/workbook2.xml", () => {
    const doc = spreadsheetOf(renamedWorkbookPackage());
    expect(doc.sheets.map((sheet) => sheet.name)).toEqual(["Renamed"]);
  });

  it("dereferences a cell through the shared-string part the renamed workbook names", () => {
    const doc = spreadsheetOf(renamedWorkbookPackage());
    expect(doc.sheets[0]?.cells[0]?.value).toEqual({
      kind: "string",
      value: "Renamed cell",
    });
  });

  it("reads the renamed workbook's own defined names", () => {
    const doc = spreadsheetOf(renamedWorkbookPackage());
    expect(doc.names?.map((name) => name.name)).toEqual(["Total"]);
  });

  it("reads the 1904 date system from the renamed workbook, not from a missing conventional one", () => {
    const pkg = renamedWorkbookPackage();
    pkg.parts["xl/worksheets/sheet1.xml"] = {
      kind: "xml",
      nodes: [
        el("worksheet", {}, [
          el("sheetData", {}, [
            el("row", { r: "1" }, [
              el("c", { r: "A1", s: "0" }, [el("v", {}, [txt("0")])]),
            ]),
          ]),
        ]),
      ],
    };
    pkg.parts["xl/styles2.xml"] = {
      kind: "xml",
      nodes: [
        el("styleSheet", {}, [
          el("cellXfs", {}, [el("xf", { numFmtId: "14" })]),
        ]),
      ],
    };
    pkg.parts["xl/_rels/workbook2.xml.rels"] = relsPart([
      {
        id: "rId2",
        type: `${REL_BASE}/worksheet`,
        target: "worksheets/sheet1.xml",
      },
      { id: "rId4", type: `${REL_BASE}/styles`, target: "styles2.xml" },
    ]);
    // Serial 0 under the 1904 epoch is 1904-01-01; under the 1900 default it would be 1899-12-31, so this asserts both the styles part and the workbookPr came from the renamed parts.
    expect(spreadsheetOf(pkg).sheets[0]?.cells[0]?.value).toEqual({
      kind: "date",
      value: "1904-01-01",
    });
  });

  it("still reads a workbook at the conventional path when the package declares no root relationships", () => {
    const pkg: Package = {
      parts: {
        "xl/workbook.xml": workbookPart(),
        "xl/_rels/workbook.xml.rels": relsPart([
          {
            id: "rId2",
            type: `${REL_BASE}/worksheet`,
            target: "worksheets/sheet1.xml",
          },
        ]),
        "xl/worksheets/sheet1.xml": worksheetPart(),
        "xl/sharedStrings.xml": sharedStringsPart(),
      },
    };
    const doc = spreadsheetOf(pkg);
    expect(doc.sheets.map((sheet) => sheet.name)).toEqual(["Renamed"]);
    expect(doc.sheets[0]?.cells[0]?.value).toEqual({
      kind: "string",
      value: "Renamed cell",
    });
  });
});
