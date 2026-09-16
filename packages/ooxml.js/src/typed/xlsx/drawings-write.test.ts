import { describe, expect, it } from "vitest";
import type {
  ContentDocument,
  ContentEmbeddedObject,
  ContentSheet,
  ContentSheetImage,
} from "document-schema.js";
import { el, txt } from "../../xml/fragment";
import { ptToEmu } from "../shared/units";
import {
  CT_CHART,
  CT_DRAWING,
  buildSheetDrawing,
  newDrawingCounters,
} from "./drawings-write";

// This module has no round-trip read side of its own to lean on for coverage (unlike most of this package's write-side modules): typed/xlsx/drawings.ts's own reader never inspects an OOXML element's exact tag/attribute spelling, only its structural shape, so a content.test.ts round trip through readXlsxContent(buildXlsxPackageFromContent(x)) cannot tell "xdr:pic" from "xdr:foo" apart. Every constant here -- namespace URIs, element/attribute names, the fixed axis IDs -- is therefore asserted directly against buildSheetDrawing's own output, which is the only way any of them are ever actually exercised.

const PRINT_SETTINGS: ContentSheet["printSettings"] = {
  pageSize: { widthPt: 612, heightPt: 792 },
  margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
  gridlines: false,
  headers: false,
  pageOrder: "downThenOver",
};

function chartDocument(
  sheetName: string,
  seriesName: string,
  categoryLabel: string,
  value: string,
): ContentDocument {
  return {
    kind: "spreadsheet",
    metadata: {},
    sheets: [
      {
        name: sheetName,
        cells: [
          {
            row: 0,
            column: 1,
            value: { kind: "string", value: seriesName },
            displayText: seriesName,
          },
          {
            row: 1,
            column: 0,
            value: { kind: "string", value: categoryLabel },
            displayText: categoryLabel,
          },
          {
            row: 1,
            column: 1,
            value: { kind: "string", value },
            displayText: value,
          },
        ],
        columns: [],
        rows: [],
        images: [],
        printSettings: PRINT_SETTINGS,
      },
    ],
  };
}

function pngImage(
  overrides: Partial<ContentSheetImage> = {},
): ContentSheetImage {
  return {
    kind: "image",
    format: "png",
    base64: "aGVsbG8=",
    widthPt: 100,
    heightPt: 50,
    anchorRow: 2,
    anchorColumn: 3,
    offsetXPt: 5,
    offsetYPt: 10,
    ...overrides,
  };
}

function chartObject(
  overrides: Partial<ContentEmbeddedObject> = {},
): ContentEmbeddedObject {
  return {
    objectKind: "chart",
    document: chartDocument("Data", "Sales", "Q1", "100"),
    frame: { xPt: 0, yPt: 0, widthPt: 200, heightPt: 150 },
    anchorRow: 5,
    anchorColumn: 1,
    offsetXPt: 0,
    offsetYPt: 0,
    ...overrides,
  };
}

function sheet(overrides: Partial<ContentSheet> = {}): ContentSheet {
  return {
    name: "Sheet1",
    cells: [],
    columns: [],
    rows: [],
    images: [],
    printSettings: PRINT_SETTINGS,
    ...overrides,
  };
}

describe("buildSheetDrawing: undefined for a sheet with neither images nor embedded objects", () => {
  it("returns undefined, minting no drawing part at all", () => {
    expect(buildSheetDrawing(sheet(), newDrawingCounters())).toBeUndefined();
  });
});

describe("buildSheetDrawing: one image and one chart, every element and attribute exactly", () => {
  const result = buildSheetDrawing(
    sheet({ images: [pngImage()], embeddedObjects: [chartObject()] }),
    newDrawingCounters(),
  );
  if (result === undefined) {
    throw new Error("expected a SheetDrawingWrite");
  }

  it("builds the picture anchor with its own xdr:from/xdr:ext/xdr:pic/xdr:clientData shape", () => {
    const picAnchor = el("xdr:oneCellAnchor", {}, [
      el("xdr:from", {}, [
        el("xdr:col", {}, [txt("3")]),
        el("xdr:colOff", {}, [txt(String(ptToEmu(5)))]),
        el("xdr:row", {}, [txt("2")]),
        el("xdr:rowOff", {}, [txt(String(ptToEmu(10)))]),
      ]),
      el("xdr:ext", { cx: String(ptToEmu(100)), cy: String(ptToEmu(50)) }),
      el("xdr:pic", {}, [
        el("xdr:nvPicPr", {}, [
          el("xdr:cNvPr", { id: "2", name: "Picture 2" }),
          el("xdr:cNvPicPr", {}, [el("a:picLocks", { noChangeAspect: "1" })]),
        ]),
        el("xdr:blipFill", {}, [
          el("a:blip", { "r:embed": "rId1" }),
          el("a:stretch", {}, [el("a:fillRect")]),
        ]),
        el("xdr:spPr", {}, [
          el("a:xfrm", {}, [
            el("a:off", { x: "0", y: "0" }),
            el("a:ext", {
              cx: String(ptToEmu(100)),
              cy: String(ptToEmu(50)),
            }),
          ]),
          el("a:prstGeom", { prst: "rect" }, [el("a:avLst")]),
        ]),
      ]),
      el("xdr:clientData"),
    ]);
    expect(result.drawingRoot.children[0]).toEqual(picAnchor);
  });

  it("builds the chart anchor with its own xdr:from/xdr:ext/xdr:graphicFrame shape", () => {
    const chartAnchor = el("xdr:oneCellAnchor", {}, [
      el("xdr:from", {}, [
        el("xdr:col", {}, [txt("1")]),
        el("xdr:colOff", {}, [txt(String(ptToEmu(0)))]),
        el("xdr:row", {}, [txt("5")]),
        el("xdr:rowOff", {}, [txt(String(ptToEmu(0)))]),
      ]),
      el("xdr:ext", { cx: String(ptToEmu(200)), cy: String(ptToEmu(150)) }),
      el("xdr:graphicFrame", {}, [
        el("xdr:nvGraphicFramePr", {}, [
          el("xdr:cNvPr", { id: "3", name: "Chart 3" }),
          el("xdr:cNvGraphicFramePr"),
        ]),
        el("xdr:xfrm", {}, [
          el("a:off", { x: "0", y: "0" }),
          el("a:ext", {
            cx: String(ptToEmu(200)),
            cy: String(ptToEmu(150)),
          }),
        ]),
        el("a:graphic", {}, [
          el(
            "a:graphicData",
            { uri: "http://schemas.openxmlformats.org/drawingml/2006/chart" },
            [el("c:chart", { "r:id": "rId2" })],
          ),
        ]),
      ]),
      el("xdr:clientData"),
    ]);
    expect(result.drawingRoot.children[1]).toEqual(chartAnchor);
  });

  it("wraps both anchors in xdr:wsDr with the three drawingml namespace declarations", () => {
    expect(result.drawingRoot.tag).toBe("xdr:wsDr");
    expect(result.drawingRoot.attributes).toEqual([
      {
        name: "xmlns:xdr",
        value:
          "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing",
      },
      {
        name: "xmlns:a",
        value: "http://schemas.openxmlformats.org/drawingml/2006/main",
      },
      {
        name: "xmlns:r",
        value:
          "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
      },
    ]);
  });

  it("declares one image and one chart relationship, in order, each with its own real target path", () => {
    expect(result.drawingRelsRoot).toEqual(
      el(
        "Relationships",
        {
          xmlns: "http://schemas.openxmlformats.org/package/2006/relationships",
        },
        [
          el("Relationship", {
            Id: "rId1",
            Type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
            Target: "../media/image1.png",
          }),
          el("Relationship", {
            Id: "rId2",
            Type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart",
            Target: "../charts/chart1.xml",
          }),
        ],
      ),
    );
  });

  it("writes the image bytes verbatim under xl/media/image1.png, and reports png as a used format", () => {
    expect(result.extraParts["xl/media/image1.png"]).toEqual({
      kind: "binary",
      base64: "aGVsbG8=",
    });
    expect(result.usedImageFormats).toEqual(new Set(["png"]));
  });

  it("names the chart part xl/charts/chart1.xml and lists it in chartPartNames", () => {
    expect(result.chartPartNames).toEqual(["xl/charts/chart1.xml"]);
    expect(result.extraParts["xl/charts/chart1.xml"]).toBeDefined();
  });

  it("builds the chart XML declaration and c:chartSpace root with its own three namespace declarations", () => {
    const chartPart = result.extraParts["xl/charts/chart1.xml"];
    if (chartPart?.kind !== "xml") {
      throw new Error("expected an xml part");
    }
    expect(chartPart.nodes[0]).toEqual({
      type: "declaration",
      attributes: [
        { name: "version", value: "1.0" },
        { name: "encoding", value: "UTF-8" },
        { name: "standalone", value: "yes" },
      ],
    });
    const root = chartPart.nodes[1];
    if (root?.type !== "element") {
      throw new Error("expected an element");
    }
    expect(root.tag).toBe("c:chartSpace");
    expect(root.attributes).toEqual([
      {
        name: "xmlns:c",
        value: "http://schemas.openxmlformats.org/drawingml/2006/chart",
      },
      {
        name: "xmlns:a",
        value: "http://schemas.openxmlformats.org/drawingml/2006/main",
      },
      {
        name: "xmlns:r",
        value:
          "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
      },
    ]);
  });

  it("builds one c:ser per column, with its own idx/order, tx, and a real sheet-qualified cache range for both cat and val", () => {
    const chartPart = result.extraParts["xl/charts/chart1.xml"];
    if (chartPart?.kind !== "xml") {
      throw new Error("expected an xml part");
    }
    const root = chartPart.nodes[1];
    if (root?.type !== "element") {
      throw new Error("expected an element");
    }
    const chart = root.children.find(
      (n) => n.type === "element" && n.tag === "c:chart",
    );
    if (chart?.type !== "element") {
      throw new Error("expected c:chart");
    }
    const plotArea = chart.children.find(
      (n) => n.type === "element" && n.tag === "c:plotArea",
    );
    if (plotArea?.type !== "element") {
      throw new Error("expected c:plotArea");
    }
    const barChart = plotArea.children.find(
      (n) => n.type === "element" && n.tag === "c:barChart",
    );
    if (barChart?.type !== "element") {
      throw new Error("expected c:barChart");
    }
    const ser = barChart.children.find(
      (n) => n.type === "element" && n.tag === "c:ser",
    );
    expect(ser).toEqual(
      el("c:ser", {}, [
        el("c:idx", { val: "0" }),
        el("c:order", { val: "0" }),
        el("c:tx", {}, [el("c:v", {}, [txt("Sales")])]),
        el("c:cat", {}, [
          el("c:strRef", {}, [
            el("c:f", {}, [txt("Data!$A$2:$A$2")]),
            el("c:strCache", {}, [
              el("c:ptCount", { val: "1" }),
              el("c:pt", { idx: "0" }, [el("c:v", {}, [txt("Q1")])]),
            ]),
          ]),
        ]),
        el("c:val", {}, [
          el("c:numRef", {}, [
            el("c:f", {}, [txt("Data!$B$2:$B$2")]),
            el("c:numCache", {}, [
              el("c:ptCount", { val: "1" }),
              el("c:pt", { idx: "0" }, [el("c:v", {}, [txt("100")])]),
            ]),
          ]),
        ]),
      ]),
    );
  });

  it("builds c:barChart/c:catAx/c:valAx with fixed axis ids, bar direction, and grouping", () => {
    const chartPart = result.extraParts["xl/charts/chart1.xml"];
    if (chartPart?.kind !== "xml") {
      throw new Error("expected an xml part");
    }
    const root = chartPart.nodes[1];
    if (root?.type !== "element") {
      throw new Error("expected an element");
    }
    const chart = root.children.find(
      (n) => n.type === "element" && n.tag === "c:chart",
    );
    if (chart?.type !== "element") {
      throw new Error("expected c:chart");
    }
    const plotArea = chart.children.find(
      (n) => n.type === "element" && n.tag === "c:plotArea",
    );
    if (plotArea?.type !== "element") {
      throw new Error("expected c:plotArea");
    }
    expect(plotArea.children[0]).toEqual(el("c:layout"));
    const barChart = plotArea.children.find(
      (n) => n.type === "element" && n.tag === "c:barChart",
    );
    if (barChart?.type !== "element") {
      throw new Error("expected c:barChart");
    }
    expect(barChart.children[0]).toEqual(el("c:barDir", { val: "col" }));
    expect(barChart.children[1]).toEqual(
      el("c:grouping", { val: "clustered" }),
    );
    expect(barChart.children[barChart.children.length - 2]).toEqual(
      el("c:axId", { val: "111111111" }),
    );
    expect(barChart.children[barChart.children.length - 1]).toEqual(
      el("c:axId", { val: "222222222" }),
    );
    expect(
      plotArea.children.find(
        (n) => n.type === "element" && n.tag === "c:catAx",
      ),
    ).toEqual(
      el("c:catAx", {}, [
        el("c:axId", { val: "111111111" }),
        el("c:scaling", {}, [el("c:orientation", { val: "minMax" })]),
        el("c:delete", { val: "0" }),
        el("c:axPos", { val: "b" }),
        el("c:crossAx", { val: "222222222" }),
      ]),
    );
    expect(
      plotArea.children.find(
        (n) => n.type === "element" && n.tag === "c:valAx",
      ),
    ).toEqual(
      el("c:valAx", {}, [
        el("c:axId", { val: "222222222" }),
        el("c:scaling", {}, [el("c:orientation", { val: "minMax" })]),
        el("c:delete", { val: "0" }),
        el("c:axPos", { val: "l" }),
        el("c:crossAx", { val: "111111111" }),
      ]),
    );
  });
});

describe("buildSheetDrawing: series/category range arithmetic against a second, non-trivial category count", () => {
  it("closes the cache range at categories.length + 1, and derives each column's own letters from index + 1", () => {
    const document: ContentDocument = {
      kind: "spreadsheet",
      metadata: {},
      sheets: [
        {
          name: "Data",
          cells: [
            {
              row: 0,
              column: 1,
              value: { kind: "string", value: "A" },
              displayText: "A",
            },
            {
              row: 0,
              column: 2,
              value: { kind: "string", value: "B" },
              displayText: "B",
            },
            {
              row: 1,
              column: 0,
              value: { kind: "string", value: "Cat1" },
              displayText: "Cat1",
            },
            {
              row: 2,
              column: 0,
              value: { kind: "string", value: "Cat2" },
              displayText: "Cat2",
            },
            {
              row: 1,
              column: 1,
              value: { kind: "string", value: "1" },
              displayText: "1",
            },
            {
              row: 2,
              column: 1,
              value: { kind: "string", value: "2" },
              displayText: "2",
            },
            {
              row: 1,
              column: 2,
              value: { kind: "string", value: "3" },
              displayText: "3",
            },
            {
              row: 2,
              column: 2,
              value: { kind: "string", value: "4" },
              displayText: "4",
            },
          ],
          columns: [],
          rows: [],
          images: [],
          printSettings: PRINT_SETTINGS,
        },
      ],
    };
    const result = buildSheetDrawing(
      sheet({
        embeddedObjects: [chartObject({ document })],
      }),
      newDrawingCounters(),
    );
    if (result === undefined) {
      throw new Error("expected a SheetDrawingWrite");
    }
    const chartPart = result.extraParts["xl/charts/chart1.xml"];
    if (chartPart?.kind !== "xml") {
      throw new Error("expected an xml part");
    }
    const root = chartPart.nodes[1];
    if (root?.type !== "element") {
      throw new Error("expected an element");
    }
    const findAll = (tag: string, node: typeof root): (typeof root)[] => {
      const out: (typeof root)[] = [];
      const walk = (n: typeof root) => {
        if (n.tag === tag) {
          out.push(n);
        }
        for (const child of n.children) {
          if (child.type === "element") {
            walk(child);
          }
        }
      };
      walk(node);
      return out;
    };
    const fRanges = findAll("c:f", root).map((n) => {
      const first = n.children[0];
      return first?.type === "text" ? first.value : undefined;
    });
    // Two categories -> the cache range closes at row 3 (2 + 1), not row 1 (2 - 1); the second column's own letters are "C" (index 1 + 1), not "A" (index 1 - 1).
    expect(fRanges).toEqual([
      "Data!$A$2:$A$3",
      "Data!$B$2:$B$3",
      "Data!$A$2:$A$3",
      "Data!$C$2:$C$3",
    ]);
  });
});

describe("buildSheetDrawing: object-id and relationship-id counters advance forward, not backward", () => {
  it("assigns rId1/rId2 and cNvPr id 2/3 to two images in document order", () => {
    const result = buildSheetDrawing(
      sheet({
        images: [pngImage({ anchorColumn: 0 }), pngImage({ anchorColumn: 1 })],
      }),
      newDrawingCounters(),
    );
    if (result === undefined) {
      throw new Error("expected a SheetDrawingWrite");
    }
    const ids = result.drawingRelsRoot.children.map((n) =>
      n.type === "element"
        ? n.attributes.find((a) => a.name === "Id")?.value
        : undefined,
    );
    expect(ids).toEqual(["rId1", "rId2"]);
    const secondAnchor = result.drawingRoot.children[1];
    if (secondAnchor?.type !== "element") {
      throw new Error("expected an element");
    }
    const pic = secondAnchor.children.find(
      (n) => n.type === "element" && n.tag === "xdr:pic",
    );
    if (pic?.type !== "element") {
      throw new Error("expected xdr:pic");
    }
    const nvPicPr = pic.children.find(
      (n) => n.type === "element" && n.tag === "xdr:nvPicPr",
    );
    if (nvPicPr?.type !== "element") {
      throw new Error("expected xdr:nvPicPr");
    }
    const cNvPr = nvPicPr.children[0];
    expect(cNvPr?.type === "element" && cNvPr.attributes).toContainEqual({
      name: "id",
      value: "3",
    });
  });

  it("keeps media/chart numbering advancing across TWO separate buildSheetDrawing calls sharing one counters instance", () => {
    const counters = newDrawingCounters();
    const first = buildSheetDrawing(
      sheet({ name: "Sheet1", images: [pngImage()] }),
      counters,
    );
    const second = buildSheetDrawing(
      sheet({ name: "Sheet2", images: [pngImage()] }),
      counters,
    );
    expect(first?.extraParts["xl/media/image1.png"]).toBeDefined();
    expect(second?.extraParts["xl/media/image2.png"]).toBeDefined();

    const chartCounters = newDrawingCounters();
    const firstChart = buildSheetDrawing(
      sheet({ name: "Sheet1", embeddedObjects: [chartObject()] }),
      chartCounters,
    );
    const secondChart = buildSheetDrawing(
      sheet({ name: "Sheet2", embeddedObjects: [chartObject()] }),
      chartCounters,
    );
    expect(firstChart?.chartPartNames).toEqual(["xl/charts/chart1.xml"]);
    expect(secondChart?.chartPartNames).toEqual(["xl/charts/chart2.xml"]);
  });
});

describe("buildSheetDrawing: error paths", () => {
  it("throws for an svg image, naming the reason no raster blip exists", () => {
    expect(() =>
      buildSheetDrawing(
        sheet({ images: [pngImage({ format: "svg" })] }),
        newDrawingCounters(),
      ),
    ).toThrow(/svg/);
  });

  it("throws for a non-chart embedded object, naming its actual objectKind", () => {
    expect(() =>
      buildSheetDrawing(
        sheet({
          embeddedObjects: [chartObject({ objectKind: "oleObject" as never })],
        }),
        newDrawingCounters(),
      ),
    ).toThrow(/oleObject/);
  });

  it("throws for a chart embedded object missing any one of its four anchor fields", () => {
    expect(() =>
      buildSheetDrawing(
        sheet({
          embeddedObjects: [chartObject({ anchorRow: undefined })],
        }),
        newDrawingCounters(),
      ),
    ).toThrow(/anchorRow/);
  });

  it("throws for a chart embedded object whose document is not a spreadsheet ContentDocument", () => {
    expect(() =>
      buildSheetDrawing(
        sheet({
          embeddedObjects: [
            chartObject({
              document: { kind: "wordprocessing", metadata: {}, sections: [] },
            }),
          ],
        }),
        newDrawingCounters(),
      ),
    ).toThrow(/wordprocessing/);
  });

  it("throws for a chart embedded object whose spreadsheet document carries no sheet at all", () => {
    expect(() =>
      buildSheetDrawing(
        sheet({
          embeddedObjects: [
            chartObject({
              document: { kind: "spreadsheet", metadata: {}, sheets: [] },
            }),
          ],
        }),
        newDrawingCounters(),
      ),
    ).toThrow(/exactly one sheet/);
  });
});

describe("CT_DRAWING/CT_CHART content-type constants", () => {
  it("names the real ECMA-376 drawing and chart content types build.ts registers", () => {
    expect(CT_DRAWING).toBe(
      "application/vnd.openxmlformats-officedocument.drawing+xml",
    );
    expect(CT_CHART).toBe(
      "application/vnd.openxmlformats-officedocument.drawingml.chart+xml",
    );
  });
});
