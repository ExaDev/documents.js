import { describe, expect, it } from "vitest";
import { directChildElement } from "../../xml/edit";
import { el } from "../../xml/fragment";
import { buildDrawingTable, buildTableGraphicFrame, PptxTable } from "./table";

describe("buildDrawingTable / PptxTable", () => {
  it("builds a grid with the requested row/column count", () => {
    const tableElement = buildDrawingTable({ rows: 2, columns: 3 });
    const table = new PptxTable(tableElement);
    expect(table.rows()).toHaveLength(2);
    expect(table.rows()[0]?.cells()).toHaveLength(3);
    expect(table.rows()[1]?.cells()).toHaveLength(3);
  });

  it("uses explicit column widths when given, converting points to EMU", () => {
    const tableElement = buildDrawingTable({
      rows: 1,
      columns: 2,
      columnWidthsPt: [100, 200],
    });
    const tblGrid = tableElement.children.find(
      (c) => c.type === "element" && c.tag === "a:tblGrid",
    );
    if (tblGrid?.type !== "element") {
      throw new Error("expected a:tblGrid");
    }
    const widths = tblGrid.children.map((c) =>
      c.type === "element"
        ? c.attributes.find((a) => a.name === "w")?.value
        : undefined,
    );
    expect(widths).toEqual(["1270000", "2540000"]);
  });

  it("cell(row, col) returns the right cell, and setParagraphs replaces its own a:txBody content", () => {
    const tableElement = buildDrawingTable({ rows: 2, columns: 2 });
    const table = new PptxTable(tableElement);
    table.cell(1, 1).setParagraphs([{ runs: [{ text: "B2" }] }]);
    const row = tableElement.children.filter(
      (c) => c.type === "element" && c.tag === "a:tr",
    )[1];
    const cellElement =
      row?.type === "element"
        ? row.children.filter(
            (c) => c.type === "element" && c.tag === "a:tc",
          )[1]
        : undefined;
    const txBody =
      cellElement?.type === "element"
        ? cellElement.children.find(
            (c) => c.type === "element" && c.tag === "a:txBody",
          )
        : undefined;
    const paragraph =
      txBody?.type === "element"
        ? txBody.children.find((c) => c.type === "element" && c.tag === "a:p")
        : undefined;
    const run =
      paragraph?.type === "element"
        ? paragraph.children.find(
            (c) => c.type === "element" && c.tag === "a:r",
          )
        : undefined;
    const text =
      run?.type === "element"
        ? run.children.find((c) => c.type === "element" && c.tag === "a:t")
        : undefined;
    const textNode =
      text?.type === "element"
        ? text.children.find((c) => c.type === "text")
        : undefined;
    expect(textNode?.type === "text" ? textNode.value : undefined).toBe("B2");
  });

  it("throws for an out-of-range row or column", () => {
    const tableElement = buildDrawingTable({ rows: 1, columns: 1 });
    const table = new PptxTable(tableElement);
    expect(() => table.cell(5, 0)).toThrow();
    expect(() => table.cell(0, 5)).toThrow();
  });

  it("colSpan/rowSpan write and read plain a:tc attributes, and clearing them removes the attribute", () => {
    const tableElement = buildDrawingTable({ rows: 1, columns: 2 });
    const table = new PptxTable(tableElement);
    const cell = table.cell(0, 0);
    expect(cell.colSpan).toBeUndefined();
    expect(cell.rowSpan).toBeUndefined();
    cell.colSpan = 2;
    cell.rowSpan = 3;
    expect(cell.colSpan).toBe(2);
    expect(cell.rowSpan).toBe(3);
    cell.colSpan = undefined;
    cell.rowSpan = undefined;
    expect(cell.colSpan).toBeUndefined();
    expect(cell.rowSpan).toBeUndefined();
  });

  it('horizontalMerge/verticalMerge write hMerge/vMerge="1" and can both be set on the same covered cell', () => {
    const tableElement = buildDrawingTable({ rows: 2, columns: 2 });
    const table = new PptxTable(tableElement);
    const cell = table.cell(1, 1);
    cell.horizontalMerge = true;
    cell.verticalMerge = true;
    const tc = tableElement.children.filter(
      (c) => c.type === "element" && c.tag === "a:tr",
    )[1];
    const cellElement =
      tc?.type === "element"
        ? tc.children.filter((c) => c.type === "element" && c.tag === "a:tc")[1]
        : undefined;
    expect(
      cellElement?.type === "element" ? cellElement.attributes : undefined,
    ).toContainEqual({ name: "hMerge", value: "1" });
    expect(
      cellElement?.type === "element" ? cellElement.attributes : undefined,
    ).toContainEqual({ name: "vMerge", value: "1" });
    cell.horizontalMerge = false;
    cell.verticalMerge = false;
    expect(
      cellElement?.type === "element"
        ? cellElement.attributes.some((a) => a.name === "hMerge")
        : true,
    ).toBe(false);
    expect(
      cellElement?.type === "element"
        ? cellElement.attributes.some((a) => a.name === "vMerge")
        : true,
    ).toBe(false);
  });

  it("borders round-trip colour and width through get/set, but not stroke style", () => {
    const tableElement = buildDrawingTable({ rows: 1, columns: 1 });
    const table = new PptxTable(tableElement);
    const cell = table.cell(0, 0);
    cell.borders = {
      left: { color: { r: 1, g: 0, b: 0 }, widthPt: 2, style: "dashed" },
      top: { color: { r: 0, g: 0, b: 1 }, widthPt: 0.5 },
    };
    expect(cell.borders).toEqual({
      left: { color: { r: 1, g: 0, b: 0 }, widthPt: 2 },
      top: { color: { r: 0, g: 0, b: 1 }, widthPt: 0.5 },
    });
  });

  it("borders getter treats a resolved zero-width or non-numeric-width edge as no border", () => {
    const tableElement = buildDrawingTable({ rows: 1, columns: 1 });
    const table = new PptxTable(tableElement);
    const cell = table.cell(0, 0);
    const tcPr = directChildElement(cell.element, "a:tcPr");
    if (tcPr === undefined) {
      throw new Error("expected a:tcPr");
    }
    tcPr.children.push(
      el("a:lnL", { w: "0" }, [
        el("a:solidFill", {}, [el("a:srgbClr", { val: "FF0000" })]),
      ]),
      el("a:lnR", { w: "abc" }, [
        el("a:solidFill", {}, [el("a:srgbClr", { val: "0000FF" })]),
      ]),
    );
    expect(cell.borders).toBeUndefined();
  });

  it("borders getter rejects a numeric-prefixed @w rather than truncating it, unlike Number.parseInt", () => {
    const tableElement = buildDrawingTable({ rows: 1, columns: 1 });
    const table = new PptxTable(tableElement);
    const cell = table.cell(0, 0);
    const tcPr = directChildElement(cell.element, "a:tcPr");
    if (tcPr === undefined) {
      throw new Error("expected a:tcPr");
    }
    tcPr.children.push(
      el("a:lnT", { w: "12700abc" }, [
        el("a:solidFill", {}, [el("a:srgbClr", { val: "FF0000" })]),
      ]),
    );
    expect(cell.borders).toBeUndefined();
  });
});

describe("buildTableGraphicFrame", () => {
  it("wraps the table in a p:graphicFrame with the given frame, in EMU", () => {
    const tableElement = buildDrawingTable({ rows: 1, columns: 1 });
    const frame = { xPt: 50, yPt: 60, widthPt: 300, heightPt: 150 };
    const graphicFrame = buildTableGraphicFrame(
      frame,
      tableElement,
      4,
      undefined,
    );
    expect(graphicFrame.tag).toBe("p:graphicFrame");
    const xfrm = graphicFrame.children.find(
      (c) => c.type === "element" && c.tag === "p:xfrm",
    );
    expect(
      xfrm?.type === "element"
        ? xfrm.attributes.some((a) => a.name === "rot")
        : false,
    ).toBe(false);
    const graphic = graphicFrame.children.find(
      (c) => c.type === "element" && c.tag === "a:graphic",
    );
    const graphicData =
      graphic?.type === "element"
        ? graphic.children.find(
            (c) => c.type === "element" && c.tag === "a:graphicData",
          )
        : undefined;
    expect(
      graphicData?.type === "element"
        ? graphicData.children.includes(tableElement)
        : false,
    ).toBe(true);
  });

  it("writes a:xfrm/@rot in 60,000ths of a degree when rotationDeg is given", () => {
    const tableElement = buildDrawingTable({ rows: 1, columns: 1 });
    const frame = { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 };
    const graphicFrame = buildTableGraphicFrame(frame, tableElement, 4, 45);
    const xfrm = graphicFrame.children.find(
      (c) => c.type === "element" && c.tag === "p:xfrm",
    );
    expect(
      xfrm?.type === "element" ? xfrm.attributes : undefined,
    ).toContainEqual({ name: "rot", value: "2700000" });
  });
});
