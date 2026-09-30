import type { XmlElement } from "odf.js";
import { attr } from "ooxml.js";
import { describe, expect, it } from "vitest";
import { setAttr } from "../../xml/edit";
import { createOds, type OdsEditor } from "./editor";
import {
  readSheetPrintSettings,
  writeSheetPrintSettings,
} from "./print-settings";

// The structural edges of print-settings: the whole read of an unwritten sheet (strict, so every optional key stays absent), the names a write mints, the three missing-element refusals a stripped package raises, whitespace-tolerant print-ranges with the first range winning, a multi-dot scale spelling refused, and a header group whose columns were emptied reading back as no repeat at all.

const BASE = {
  pageSize: { widthPt: 612, heightPt: 792 },
  margins: { topPt: 72, rightPt: 90, bottomPt: 72, leftPt: 54 },
  gridlines: false,
  headers: false,
  pageOrder: "downThenOver" as const,
};

function directChild(parent: XmlElement, tag: string): XmlElement | undefined {
  return parent.children.find(
    (c): c is XmlElement => c.type === "element" && c.tag === tag,
  );
}

function rootOf(editor: OdsEditor, part: string): XmlElement | undefined {
  const partContent = editor.toPackage().parts[part];
  return partContent?.kind === "xml"
    ? partContent.nodes.find((n): n is XmlElement => n.type === "element")
    : undefined;
}

function tableOf(editor: OdsEditor): XmlElement {
  const spreadsheet = directChild(
    directChild(rootOf(editor, "content.xml")!, "office:body")!,
    "office:spreadsheet",
  )!;
  const table = directChild(spreadsheet, "table:table");
  if (table === undefined) {
    throw new Error("expected a table:table element");
  }
  return table;
}

function lastChild(parent: XmlElement, tag: string): XmlElement {
  const found = [...parent.children]
    .reverse()
    .find((c): c is XmlElement => c.type === "element" && c.tag === tag);
  if (found === undefined) {
    throw new Error(`expected a ${tag} element`);
  }
  return found;
}

function stripChild(element: XmlElement, tag: string): void {
  const index = element.children.findIndex(
    (c) => c.type === "element" && c.tag === tag,
  );
  if (index >= 0) {
    element.children.splice(index, 1);
  }
}

describe("OdsSheet.printSettings: structural edges", () => {
  it("an unwritten sheet reads back A4 with the default margins and no optional key at all", () => {
    const editor = createOds();
    expect(
      readSheetPrintSettings(editor.toPackage(), tableOf(editor)),
    ).toStrictEqual({
      pageSize: { widthPt: 595.28, heightPt: 841.89 },
      margins: {
        topPt: 56.69291338582677,
        rightPt: 56.69291338582677,
        bottomPt: 56.69291338582677,
        leftPt: 56.69291338582677,
      },
      gridlines: false,
      headers: false,
      pageOrder: "downThenOver",
    });
  });

  it("a first write mints one name in each of the three style homes", () => {
    const editor = createOds();
    const table = tableOf(editor);
    writeSheetPrintSettings(editor.toPackage(), table, BASE);
    const stylesRoot = rootOf(editor, "styles.xml")!;
    expect(
      attr(
        lastChild(
          directChild(stylesRoot, "office:automatic-styles")!,
          "style:page-layout",
        ),
        "style:name",
      ),
    ).toBe("OdsPageLayout1");
    expect(
      attr(
        lastChild(
          directChild(stylesRoot, "office:master-styles")!,
          "style:master-page",
        ),
        "style:name",
      ),
    ).toBe("OdsMasterPage1");
    expect(attr(table, "table:style-name")).toBe("OdsSheetPrint1");
  });

  it("a package missing its style homes refuses the write, naming the part and the element", () => {
    const noAuto = createOds();
    stripChild(rootOf(noAuto, "styles.xml")!, "office:automatic-styles");
    expect(() => {
      writeSheetPrintSettings(noAuto.toPackage(), tableOf(noAuto), BASE);
    }).toThrow("styles.xml has no office:automatic-styles element");

    const noMaster = createOds();
    stripChild(rootOf(noMaster, "styles.xml")!, "office:master-styles");
    expect(() => {
      writeSheetPrintSettings(noMaster.toPackage(), tableOf(noMaster), BASE);
    }).toThrow("styles.xml has no office:master-styles element");

    const noContentAuto = createOds();
    stripChild(
      rootOf(noContentAuto, "content.xml")!,
      "office:automatic-styles",
    );
    expect(() => {
      writeSheetPrintSettings(
        noContentAuto.toPackage(),
        tableOf(noContentAuto),
        BASE,
      );
    }).toThrow("content.xml has no office:automatic-styles element");
  });

  it("print-ranges tolerate surrounding whitespace and several ranges, keeping the first", () => {
    const editor = createOds();
    const table = tableOf(editor);
    setAttr(table, "table:print-ranges", "  Sheet1.A1:B2  ");
    expect(
      readSheetPrintSettings(editor.toPackage(), table).printRange,
    ).toEqual({
      startRow: 0,
      startColumn: 0,
      endRow: 1,
      endColumn: 1,
    });
    setAttr(table, "table:print-ranges", "Sheet1.A1:B2 Sheet1.C3:D4");
    expect(
      readSheetPrintSettings(editor.toPackage(), table).printRange,
    ).toEqual({
      startRow: 0,
      startColumn: 0,
      endRow: 1,
      endColumn: 1,
    });
  });

  it("a scale with two decimal points is not a percentage", () => {
    const editor = createOds();
    const table = tableOf(editor);
    const layout = lastChild(
      directChild(rootOf(editor, "styles.xml")!, "office:automatic-styles")!,
      "style:page-layout",
    );
    const properties = directChild(layout, "style:page-layout-properties");
    if (properties === undefined) {
      throw new Error("expected page-layout properties");
    }
    setAttr(properties, "style:scale-to", "1.2.3%");
    expect(
      readSheetPrintSettings(editor.toPackage(), table).scalePercent,
    ).toBeUndefined();
  });

  it("a header group whose columns were emptied reads back as no repeat at all", () => {
    const editor = createOds();
    const table = tableOf(editor);
    writeSheetPrintSettings(editor.toPackage(), table, {
      ...BASE,
      repeatColumns: { start: 0, end: 1 },
    });
    expect(
      readSheetPrintSettings(editor.toPackage(), table).repeatColumns,
    ).toEqual({
      start: 0,
      end: 1,
    });
    const headerGroup = table.children.find(
      (c): c is XmlElement =>
        c.type === "element" && c.tag === "table:table-header-columns",
    );
    if (headerGroup === undefined) {
      throw new Error("expected a table:table-header-columns element");
    }
    for (let i = headerGroup.children.length - 1; i >= 0; i -= 1) {
      const child = headerGroup.children[i]!;
      if (child.type === "element" && child.tag === "table:table-column") {
        headerGroup.children.splice(i, 1);
      }
    }
    expect(
      readSheetPrintSettings(editor.toPackage(), table).repeatColumns,
    ).toBeUndefined();
  });
});
