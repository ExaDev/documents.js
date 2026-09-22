import type { ContentSheetPrintSettings } from "document-schema.js";
import type { XmlElement } from "odf.js";
import { findStyleElement } from "odf.js";
import { attr } from "ooxml.js";
import { describe, expect, it } from "vitest";
import { readOdsContent } from "../../odf/ods/read";
import { setAttr } from "../../xml/edit";
import { createOds, type OdsEditor } from "./editor";
import {
  readSheetPrintSettings,
  writeSheetPrintSettings,
} from "./print-settings";

function directChild(parent: XmlElement, tag: string): XmlElement | undefined {
  return parent.children.find(
    (c): c is XmlElement => c.type === "element" && c.tag === tag,
  );
}

function findTableElement(editor: OdsEditor): XmlElement {
  const contentPart = editor.toPackage().parts["content.xml"];
  const root =
    contentPart?.kind === "xml"
      ? contentPart.nodes.find((n): n is XmlElement => n.type === "element")
      : undefined;
  const body =
    root === undefined ? undefined : directChild(root, "office:body");
  const spreadsheet =
    body === undefined ? undefined : directChild(body, "office:spreadsheet");
  const table =
    spreadsheet === undefined
      ? undefined
      : directChild(spreadsheet, "table:table");
  if (table === undefined) {
    throw new Error("expected a table:table element");
  }
  return table;
}

// The style:page-layout-properties element the most recently written printSettings minted — style:page-layout is always appended (never reused, see print-settings.ts's own top-of-file note), so the LAST one in styles.xml/office:automatic-styles is always the current sheet's.
function currentPageLayoutProperties(editor: OdsEditor): XmlElement {
  const stylesPart = editor.toPackage().parts["styles.xml"];
  const root =
    stylesPart?.kind === "xml"
      ? stylesPart.nodes.find((n): n is XmlElement => n.type === "element")
      : undefined;
  const automaticStyles =
    root === undefined
      ? undefined
      : directChild(root, "office:automatic-styles");
  const pageLayouts =
    automaticStyles === undefined
      ? []
      : automaticStyles.children.filter(
          (c): c is XmlElement =>
            c.type === "element" && c.tag === "style:page-layout",
        );
  const last = pageLayouts.at(-1);
  const properties =
    last === undefined
      ? undefined
      : directChild(last, "style:page-layout-properties");
  if (properties === undefined) {
    throw new Error("expected a style:page-layout-properties element");
  }
  return properties;
}

const BASE: ContentSheetPrintSettings = {
  pageSize: { widthPt: 612, heightPt: 792 },
  margins: { topPt: 72, rightPt: 90, bottomPt: 72, leftPt: 54 },
  gridlines: false,
  headers: false,
  pageOrder: "downThenOver",
};

describe("OdsSheet.printSettings: pageSize/margins/gridlines/headers/pageOrder", () => {
  it("round-trips pageSize, margins, and pageOrder=downThenOver with neither gridlines nor headers, writing no style:print attribute at all", () => {
    const editor = createOds();
    const sheet = editor.sheets()[0]!;
    sheet.printSettings = BASE;

    expect(sheet.printSettings).toEqual(BASE);
    const properties = currentPageLayoutProperties(editor);
    expect(attr(properties, "fo:page-width")).toBe("612pt");
    expect(attr(properties, "fo:page-height")).toBe("792pt");
    expect(attr(properties, "fo:margin-top")).toBe("72pt");
    expect(attr(properties, "fo:margin-right")).toBe("90pt");
    expect(attr(properties, "fo:margin-bottom")).toBe("72pt");
    expect(attr(properties, "fo:margin-left")).toBe("54pt");
    expect(attr(properties, "style:print")).toBeUndefined();
    expect(attr(properties, "style:print-page-order")).toBe("ttb");
  });

  it("round-trips pageOrder=overThenDown as style:print-page-order=ltr", () => {
    const editor = createOds();
    const sheet = editor.sheets()[0]!;
    sheet.printSettings = { ...BASE, pageOrder: "overThenDown" };

    expect(sheet.printSettings.pageOrder).toBe("overThenDown");
    expect(
      attr(currentPageLayoutProperties(editor), "style:print-page-order"),
    ).toBe("ltr");
  });

  it('gridlines alone writes style:print="grid" and reads back gridlines=true, headers=false', () => {
    const editor = createOds();
    const sheet = editor.sheets()[0]!;
    sheet.printSettings = { ...BASE, gridlines: true };

    expect(sheet.printSettings.gridlines).toBe(true);
    expect(sheet.printSettings.headers).toBe(false);
    expect(attr(currentPageLayoutProperties(editor), "style:print")).toBe(
      "grid",
    );
  });

  it('headers alone writes style:print="headers" and reads back gridlines=false, headers=true', () => {
    const editor = createOds();
    const sheet = editor.sheets()[0]!;
    sheet.printSettings = { ...BASE, headers: true };

    expect(sheet.printSettings.gridlines).toBe(false);
    expect(sheet.printSettings.headers).toBe(true);
    expect(attr(currentPageLayoutProperties(editor), "style:print")).toBe(
      "headers",
    );
  });

  it('both gridlines and headers write style:print="grid headers" and both read back true', () => {
    const editor = createOds();
    const sheet = editor.sheets()[0]!;
    sheet.printSettings = { ...BASE, gridlines: true, headers: true };

    expect(sheet.printSettings.gridlines).toBe(true);
    expect(sheet.printSettings.headers).toBe(true);
    expect(attr(currentPageLayoutProperties(editor), "style:print")).toBe(
      "grid headers",
    );
  });

  it("falls back to PAGE_SIZE_A4/DEFAULT_MARGINS/downThenOver when the sheet's own style chain never resolves a page layout at all", () => {
    const editor = createOds();
    const sheet = editor.sheets()[0]!;
    // A freshly-created sheet has no table:style-name at all yet — readSheetPrintSettings must fall back rather than throw.
    const settings = sheet.printSettings;
    expect(settings.pageSize).toEqual({ widthPt: 595.28, heightPt: 841.89 });
    expect(settings.margins).toEqual({
      topPt: 56.69291338582677,
      rightPt: 56.69291338582677,
      bottomPt: 56.69291338582677,
      leftPt: 56.69291338582677,
    });
    expect(settings.pageOrder).toBe("downThenOver");
    expect(settings.gridlines).toBe(false);
    expect(settings.headers).toBe(false);
  });
});

describe("OdsSheet.printSettings: printRange", () => {
  it("round-trips a printRange as SheetName-prefixed table:print-ranges", () => {
    const editor = createOds();
    const sheet = editor.sheets()[0]!;
    sheet.printSettings = {
      ...BASE,
      printRange: { startRow: 1, startColumn: 2, endRow: 9, endColumn: 4 },
    };

    expect(sheet.printSettings.printRange).toEqual({
      startRow: 1,
      startColumn: 2,
      endRow: 9,
      endColumn: 4,
    });
    const table = findTableElement(editor);
    expect(attr(table, "table:print-ranges")).toBe("Sheet1.C2:Sheet1.E10");
  });

  it("has no printRange when the field is omitted", () => {
    const editor = createOds();
    const sheet = editor.sheets()[0]!;
    sheet.printSettings = BASE;
    expect(sheet.printSettings.printRange).toBeUndefined();
  });

  it("parses a bare (no SheetName prefix) reference in table:print-ranges the same as a prefixed one", () => {
    const editor = createOds();
    const table = findTableElement(editor);
    setAttr(table, "table:print-ranges", "A1:C3");
    const settings = readSheetPrintSettings(editor.toPackage(), table);
    expect(settings.printRange).toEqual({
      startRow: 0,
      startColumn: 0,
      endRow: 2,
      endColumn: 2,
    });
  });

  it("table:print-ranges with no colon separator, or an unparseable cell reference, yields no printRange", () => {
    const editor = createOds();
    const table = findTableElement(editor);

    setAttr(table, "table:print-ranges", "Sheet1.A1");
    expect(
      readSheetPrintSettings(editor.toPackage(), table).printRange,
    ).toBeUndefined();

    setAttr(table, "table:print-ranges", "not-a-cell:C3");
    expect(
      readSheetPrintSettings(editor.toPackage(), table).printRange,
    ).toBeUndefined();
  });

  it("only the first of several space-separated table:print-ranges is read", () => {
    const editor = createOds();
    const table = findTableElement(editor);
    setAttr(
      table,
      "table:print-ranges",
      "Sheet1.A1:Sheet1.B2 Sheet1.D4:Sheet1.E5",
    );
    const settings = readSheetPrintSettings(editor.toPackage(), table);
    expect(settings.printRange).toEqual({
      startRow: 0,
      startColumn: 0,
      endRow: 1,
      endColumn: 1,
    });
  });
});

describe("OdsSheet.printSettings: scalePercent/fitToPages", () => {
  it("round-trips scalePercent", () => {
    const editor = createOds();
    const sheet = editor.sheets()[0]!;
    sheet.printSettings = { ...BASE, scalePercent: 150 };
    expect(sheet.printSettings.scalePercent).toBe(150);
    expect(attr(currentPageLayoutProperties(editor), "style:scale-to")).toBe(
      "150%",
    );
  });

  it("has no scalePercent when the field is omitted", () => {
    const editor = createOds();
    const sheet = editor.sheets()[0]!;
    sheet.printSettings = BASE;
    expect(sheet.printSettings.scalePercent).toBeUndefined();
  });

  it("an unparseable style:scale-to value yields no scalePercent", () => {
    const editor = createOds();
    const sheet = editor.sheets()[0]!;
    sheet.printSettings = BASE;
    const properties = currentPageLayoutProperties(editor);
    setAttr(properties, "style:scale-to", "not-a-percent");
    expect(
      readSheetPrintSettings(editor.toPackage(), findTableElement(editor))
        .scalePercent,
    ).toBeUndefined();
  });

  it("round-trips fitToPages", () => {
    const editor = createOds();
    const sheet = editor.sheets()[0]!;
    sheet.printSettings = { ...BASE, fitToPages: { width: 2, height: 3 } };
    expect(sheet.printSettings.fitToPages).toEqual({ width: 2, height: 3 });
    const properties = currentPageLayoutProperties(editor);
    expect(attr(properties, "style:scale-to-X")).toBe("2");
    expect(attr(properties, "style:scale-to-Y")).toBe("3");
  });

  it("has no fitToPages when the field is omitted", () => {
    const editor = createOds();
    const sheet = editor.sheets()[0]!;
    sheet.printSettings = BASE;
    expect(sheet.printSettings.fitToPages).toBeUndefined();
  });

  it("fitToPages is undefined when only one of style:scale-to-X/style:scale-to-Y is present", () => {
    const editor = createOds();
    const sheet = editor.sheets()[0]!;
    sheet.printSettings = BASE;
    const properties = currentPageLayoutProperties(editor);
    setAttr(properties, "style:scale-to-X", "4");
    expect(
      readSheetPrintSettings(editor.toPackage(), findTableElement(editor))
        .fitToPages,
    ).toBeUndefined();
  });

  it("a negative style:scale-to-X/Y value yields no fitToPages", () => {
    const editor = createOds();
    const sheet = editor.sheets()[0]!;
    sheet.printSettings = BASE;
    const properties = currentPageLayoutProperties(editor);
    setAttr(properties, "style:scale-to-X", "-1");
    setAttr(properties, "style:scale-to-Y", "3");
    expect(
      readSheetPrintSettings(editor.toPackage(), findTableElement(editor))
        .fitToPages,
    ).toBeUndefined();
  });

  it("Number.parseInt truncates a fractional style:scale-to-X/Y value rather than rejecting it, mirroring odf.js's own parseNonNegativeInteger", () => {
    const editor = createOds();
    const sheet = editor.sheets()[0]!;
    sheet.printSettings = BASE;
    const properties = currentPageLayoutProperties(editor);
    setAttr(properties, "style:scale-to-X", "2.5");
    setAttr(properties, "style:scale-to-Y", "3");
    expect(
      readSheetPrintSettings(editor.toPackage(), findTableElement(editor))
        .fitToPages,
    ).toEqual({ width: 2, height: 3 });
  });
});

describe("OdsSheet.printSettings: manualBreaks", () => {
  it("round-trips manual breaks on both columns and rows, preserving any width/height already set on the same column/row", () => {
    const editor = createOds();
    const sheet = editor.sheets()[0]!;
    sheet.setColumnWidth(0, 111);
    sheet.setRowHeight(2, 33);
    sheet.printSettings = {
      ...BASE,
      manualBreaks: { columns: [0, 4], rows: [2, 6] },
    };

    const settings = sheet.printSettings;
    expect(settings.manualBreaks?.columns).toEqual([0, 4]);
    expect(settings.manualBreaks?.rows).toEqual([2, 6]);

    // the pre-existing width/height on column 0 / row 2 survived the manual-break write
    const content = readOdsContent(editor.toPackage());
    if (content.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    expect(
      content.sheets[0]!.columns.find((c) => c.index === 0)?.widthPt,
    ).toBeCloseTo(111, 5);
    expect(
      content.sheets[0]!.rows.find((r) => r.index === 2)?.heightPt,
    ).toBeCloseTo(33, 5);
  });

  it("has no manualBreaks when the field is omitted", () => {
    const editor = createOds();
    const sheet = editor.sheets()[0]!;
    sheet.printSettings = BASE;
    expect(sheet.printSettings.manualBreaks).toBeUndefined();
  });
});

describe("OdsSheet.printSettings: repeatColumns/repeatRows", () => {
  it("round-trips repeatColumns and repeatRows as table:table-header-columns/-rows wrapping the given range", () => {
    const editor = createOds();
    const sheet = editor.sheets()[0]!;
    for (let column = 0; column < 5; column++) {
      sheet.cell(0, column).value = { kind: "number", value: column };
    }
    sheet.printSettings = {
      ...BASE,
      repeatColumns: { start: 0, end: 1 },
      repeatRows: { start: 0, end: 0 },
    };

    expect(sheet.printSettings.repeatColumns).toEqual({ start: 0, end: 1 });
    expect(sheet.printSettings.repeatRows).toEqual({ start: 0, end: 0 });

    const table = findTableElement(editor);
    expect(directChild(table, "table:table-header-columns")).toBeDefined();
    expect(directChild(table, "table:table-header-rows")).toBeDefined();
  });

  it("has no repeatColumns/repeatRows when the fields are omitted", () => {
    const editor = createOds();
    const sheet = editor.sheets()[0]!;
    sheet.printSettings = BASE;
    expect(sheet.printSettings.repeatColumns).toBeUndefined();
    expect(sheet.printSettings.repeatRows).toBeUndefined();
  });

  it("setting a new repeatColumns range dissolves the previous wrapper rather than nesting or duplicating it", () => {
    const editor = createOds();
    const sheet = editor.sheets()[0]!;
    for (let column = 0; column < 6; column++) {
      sheet.cell(0, column).value = { kind: "number", value: column };
    }
    sheet.printSettings = { ...BASE, repeatColumns: { start: 0, end: 1 } };
    expect(sheet.printSettings.repeatColumns).toEqual({ start: 0, end: 1 });
    sheet.printSettings = { ...BASE, repeatColumns: { start: 2, end: 3 } };

    expect(sheet.printSettings.repeatColumns).toEqual({ start: 2, end: 3 });
    const table = findTableElement(editor);
    const wrappers = table.children.filter(
      (c) => c.type === "element" && c.tag === "table:table-header-columns",
    );
    expect(wrappers).toHaveLength(1);
  });

  it("stamps a real default width/height on the exterior gap-filled columns/rows too, not just the in-range ones", () => {
    const editor = createOds();
    const sheet = editor.sheets()[0]!;
    // columns/rows 3-5 are individuated (and wrapped) by the repeat range below; positions 0-2 are gap-filled by replaceRun's own case-3 as one compressed run ahead of it, and would otherwise be left at an ambiguous, unstyled 0 — readOdsContent reports one compressed run as a single entry at its own start index (0), so only that index is checked for the exterior gap-fill.
    sheet.printSettings = {
      ...BASE,
      repeatColumns: { start: 3, end: 5 },
      repeatRows: { start: 3, end: 5 },
    };

    const content = readOdsContent(editor.toPackage());
    if (content.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    for (const index of [0, 3, 4, 5]) {
      expect(
        content.sheets[0]!.columns.find((c) => c.index === index)?.widthPt,
      ).toBeCloseTo(64, 5);
      expect(
        content.sheets[0]!.rows.find((r) => r.index === index)?.heightPt,
      ).toBeCloseTo(15, 5);
    }
  });
});

describe("hasManualBreak / scanTableStructure (via a hand-crafted table:style-name chain)", () => {
  it('a column/row style with no fo:break-before, or one set to something other than "page", is not a manual break', () => {
    const editor = createOds();
    const sheet = editor.sheets()[0]!;
    sheet.setColumnWidth(0, 80); // mints a style:table-column-properties with no fo:break-before at all
    const table = findTableElement(editor);
    const column = directChild(table, "table:table-column")!;
    const styleName = attr(column, "table:style-name")!;
    const styleElement = findStyleElement(
      styleName,
      "table-column",
      editor.toPackage(),
    )!;
    const properties = directChild(
      styleElement,
      "style:table-column-properties",
    )!;

    expect(
      readSheetPrintSettings(editor.toPackage(), table).manualBreaks,
    ).toBeUndefined();

    setAttr(properties, "fo:break-before", "auto");
    expect(
      readSheetPrintSettings(editor.toPackage(), table).manualBreaks,
    ).toBeUndefined();
  });
});

describe("writeSheetPrintSettings error handling", () => {
  it("throws when printRange is set but the table has no table:name", () => {
    const editor = createOds();
    const table = findTableElement(editor);
    setAttr(table, "table:name", undefined as unknown as string);
    // directly deleting the attribute: setAttr(undefined) is not the real removal path, so remove it via the attributes array instead.
    table.attributes = table.attributes.filter((a) => a.name !== "table:name");

    expect(() => {
      writeSheetPrintSettings(editor.toPackage(), table, {
        ...BASE,
        printRange: { startRow: 0, startColumn: 0, endRow: 1, endColumn: 1 },
      });
    }).toThrow(/table:name/);
  });
});
