import type { Package, XmlElement } from "odf.js";
import { findStyleElement, parseOdfLength } from "odf.js";
import { attr } from "ooxml.js";
import { describe, expect, it } from "vitest";
import { directChildElement } from "../../xml/edit";
import {
  COLUMN_REPEAT_ATTR,
  collectRunMembers,
  isElementWithTag,
  readRunRepeatCount,
  ROW_REPEAT_ATTR,
  ROW_TAG,
} from "../odf-repeated-runs";
import { COLUMN_TAG, HEADER_COLUMNS_TAG, HEADER_ROWS_TAG } from "./address";
import {
  ensureColumnDefaultWidth,
  ensureColumnElementDefaultWidth,
  ensureRowDefaultHeight,
  ensureRowElementDefaultHeight,
  writeColumnHidden,
  writeColumnManualBreak,
  writeColumnWidth,
  writeRowHeight,
  writeRowHidden,
  writeRowManualBreak,
} from "./column-row";
import { createOds } from "./editor";

function findTableElement(pkg: Package): XmlElement {
  const contentPart = pkg.parts["content.xml"];
  const root =
    contentPart?.kind === "xml"
      ? contentPart.nodes.find((n): n is XmlElement => n.type === "element")
      : undefined;
  const body =
    root === undefined ? undefined : directChildElement(root, "office:body");
  const spreadsheet =
    body === undefined
      ? undefined
      : directChildElement(body, "office:spreadsheet");
  const table =
    spreadsheet === undefined
      ? undefined
      : directChildElement(spreadsheet, "table:table");
  if (table === undefined) {
    throw new Error("expected a table:table element");
  }
  return table;
}

// Locates the run-member element that actually covers absolute `index`, the same way ensureColumnCoverage/replaceRun resolve a position: a table:table-column/table:table-row may still be a repeated run, so this is never simply "the nth direct child".
function memberAt(
  tableElement: XmlElement,
  tag: string,
  headerWrapperTag: string,
  repeatAttr: string,
  index: number,
): XmlElement {
  const members = collectRunMembers(
    tableElement.children,
    isElementWithTag(tag),
    headerWrapperTag,
  );
  let covered = 0;
  for (const member of members) {
    const count = readRunRepeatCount(member.node, repeatAttr);
    if (index < covered + count) {
      return member.node;
    }
    covered += count;
  }
  throw new Error(
    `no ${tag} run covers index ${index} (only ${covered} covered)`,
  );
}

function columnElementAt(tableElement: XmlElement, index: number): XmlElement {
  return memberAt(
    tableElement,
    COLUMN_TAG,
    HEADER_COLUMNS_TAG,
    COLUMN_REPEAT_ATTR,
    index,
  );
}

function rowElementAt(tableElement: XmlElement, index: number): XmlElement {
  return memberAt(
    tableElement,
    ROW_TAG,
    HEADER_ROWS_TAG,
    ROW_REPEAT_ATTR,
    index,
  );
}

function totalColumnCoverage(tableElement: XmlElement): number {
  return collectRunMembers(
    tableElement.children,
    isElementWithTag(COLUMN_TAG),
    HEADER_COLUMNS_TAG,
  ).reduce(
    (sum, member) => sum + readRunRepeatCount(member.node, COLUMN_REPEAT_ATTR),
    0,
  );
}

function totalRowCoverage(tableElement: XmlElement): number {
  return collectRunMembers(
    tableElement.children,
    isElementWithTag(ROW_TAG),
    HEADER_ROWS_TAG,
  ).reduce(
    (sum, member) => sum + readRunRepeatCount(member.node, ROW_REPEAT_ATTR),
    0,
  );
}

// Reads the persisted style state directly off the style chain (table:style-name -> style:style[family] -> its properties element) rather than through odf.js's own read-content interpretation, so these tests exercise exactly what column-row.ts itself wrote, not a separately-defaulted reading of it.
function columnStyleProperties(
  pkg: Package,
  columnElement: XmlElement,
): { widthPt: number | undefined; manualBreak: boolean } {
  const styleName = attr(columnElement, "table:style-name");
  const styleElement =
    styleName === undefined
      ? undefined
      : findStyleElement(styleName, "table-column", pkg);
  const properties =
    styleElement === undefined
      ? undefined
      : directChildElement(styleElement, "style:table-column-properties");
  const widthValue =
    properties === undefined
      ? undefined
      : attr(properties, "style:column-width");
  return {
    widthPt: widthValue === undefined ? undefined : parseOdfLength(widthValue),
    manualBreak:
      (properties === undefined
        ? undefined
        : attr(properties, "fo:break-before")) === "page",
  };
}

function rowStyleProperties(
  pkg: Package,
  rowElement: XmlElement,
): { heightPt: number | undefined; manualBreak: boolean } {
  const styleName = attr(rowElement, "table:style-name");
  const styleElement =
    styleName === undefined
      ? undefined
      : findStyleElement(styleName, "table-row", pkg);
  const properties =
    styleElement === undefined
      ? undefined
      : directChildElement(styleElement, "style:table-row-properties");
  const heightValue =
    properties === undefined ? undefined : attr(properties, "style:row-height");
  return {
    heightPt:
      heightValue === undefined ? undefined : parseOdfLength(heightValue),
    manualBreak:
      (properties === undefined
        ? undefined
        : attr(properties, "fo:break-before")) === "page",
  };
}

function freshTable(): { pkg: Package; tableElement: XmlElement } {
  const editor = createOds();
  const pkg = editor.toPackage();
  return { pkg, tableElement: findTableElement(pkg) };
}

describe("writeColumnManualBreak / writeRowManualBreak", () => {
  it("sets manualBreak true while preserving a width/height already set on the same index", () => {
    const { pkg, tableElement } = freshTable();
    writeColumnWidth(pkg, tableElement, 2, 111);
    writeRowHeight(pkg, tableElement, 2, 22);

    writeColumnManualBreak(pkg, tableElement, 2);
    writeRowManualBreak(pkg, tableElement, 2);

    const column = columnElementAt(tableElement, 2);
    const row = rowElementAt(tableElement, 2);
    expect(columnStyleProperties(pkg, column)).toEqual({
      widthPt: 111,
      manualBreak: true,
    });
    expect(rowStyleProperties(pkg, row)).toEqual({
      heightPt: 22,
      manualBreak: true,
    });
  });

  it("a width/height set AFTER a manual break preserves the break, not just the reverse order", () => {
    const { pkg, tableElement } = freshTable();
    writeColumnManualBreak(pkg, tableElement, 0);
    writeRowManualBreak(pkg, tableElement, 0);

    writeColumnWidth(pkg, tableElement, 0, 77);
    writeRowHeight(pkg, tableElement, 0, 33);

    const column = columnElementAt(tableElement, 0);
    const row = rowElementAt(tableElement, 0);
    expect(columnStyleProperties(pkg, column)).toEqual({
      widthPt: 77,
      manualBreak: true,
    });
    expect(rowStyleProperties(pkg, row)).toEqual({
      heightPt: 33,
      manualBreak: true,
    });
  });

  it("a column/row never touched has manualBreak false, not true", () => {
    const { pkg, tableElement } = freshTable();
    writeColumnWidth(pkg, tableElement, 0, 50);
    writeRowHeight(pkg, tableElement, 0, 20);
    const column = columnElementAt(tableElement, 0);
    const row = rowElementAt(tableElement, 0);
    expect(columnStyleProperties(pkg, column).manualBreak).toBe(false);
    expect(rowStyleProperties(pkg, row).manualBreak).toBe(false);
  });
});

describe("writeColumnWidth / writeRowHeight: coverage and style naming", () => {
  it("extends column/row coverage to exactly index + 1, not index - 1 or any other count", () => {
    const { pkg, tableElement } = freshTable();
    writeColumnWidth(pkg, tableElement, 3, 90);
    writeRowHeight(pkg, tableElement, 3, 40);
    expect(totalColumnCoverage(tableElement)).toBeGreaterThanOrEqual(4);
    expect(totalRowCoverage(tableElement)).toBeGreaterThanOrEqual(4);
    // The position actually asked for must itself be covered and styled: a coverage count alone doesn't prove index 3 itself (as opposed to some other position) was reached.
    expect(
      columnStyleProperties(pkg, columnElementAt(tableElement, 3)).widthPt,
    ).toBe(90);
    expect(
      rowStyleProperties(pkg, rowElementAt(tableElement, 3)).heightPt,
    ).toBe(40);
    // A gap-filled "before" run (positions 0-2) plus the styled target at position 3, exactly 2 table:table-column elements. ensureColumnCoverage running with index - 1 (2) instead of index + 1 (4) would leave a shorter initial run behind, so replaceRun's own fallback gap-fill has to mint a second separate run to reach position 3, leaving 3 elements instead of 2, the same logical column values but a fragmented, non-minimal run structure that gives away the wrong arithmetic.
    expect(
      collectRunMembers(
        tableElement.children,
        isElementWithTag(COLUMN_TAG),
        HEADER_COLUMNS_TAG,
      ).length,
    ).toBe(2);
    expect(
      collectRunMembers(
        tableElement.children,
        isElementWithTag(ROW_TAG),
        HEADER_ROWS_TAG,
      ).length,
    ).toBe(2);
  });

  it("mints a style:style element named with the OdsColumn/OdsRow prefix in the table-column/table-row family", () => {
    const { pkg, tableElement } = freshTable();
    writeColumnWidth(pkg, tableElement, 0, 60);
    writeRowHeight(pkg, tableElement, 0, 18);
    const column = columnElementAt(tableElement, 0);
    const row = rowElementAt(tableElement, 0);
    const columnStyleName = attr(column, "table:style-name");
    const rowStyleName = attr(row, "table:style-name");
    expect(columnStyleName).toMatch(/^OdsColumn/);
    expect(rowStyleName).toMatch(/^OdsRow/);
    const columnStyle =
      columnStyleName === undefined
        ? undefined
        : findStyleElement(columnStyleName, "table-column", pkg);
    const rowStyle =
      rowStyleName === undefined
        ? undefined
        : findStyleElement(rowStyleName, "table-row", pkg);
    expect(columnStyle?.tag).toBe("style:style");
    expect(rowStyle?.tag).toBe("style:style");
  });
});

describe("ensureColumnDefaultWidth / ensureRowDefaultHeight", () => {
  it("stamps DEFAULT_COLUMN_WIDTH_PT/DEFAULT_ROW_HEIGHT_PT on a column/row with no width/height style at all", () => {
    const { pkg, tableElement } = freshTable();
    ensureColumnDefaultWidth(pkg, tableElement, 0);
    ensureRowDefaultHeight(pkg, tableElement, 0);
    expect(
      columnStyleProperties(pkg, columnElementAt(tableElement, 0)).widthPt,
    ).toBe(64);
    expect(
      rowStyleProperties(pkg, rowElementAt(tableElement, 0)).heightPt,
    ).toBe(15);
  });

  it("extends coverage to exactly index + 1 on its own, not index - 1, when called directly (not only via writeColumnWidth)", () => {
    const { pkg, tableElement } = freshTable();
    ensureColumnDefaultWidth(pkg, tableElement, 3);
    ensureRowDefaultHeight(pkg, tableElement, 3);
    expect(
      columnStyleProperties(pkg, columnElementAt(tableElement, 3)).widthPt,
    ).toBe(64);
    expect(
      rowStyleProperties(pkg, rowElementAt(tableElement, 3)).heightPt,
    ).toBe(15);
    // Same reasoning as the writeColumnWidth/writeRowHeight coverage test above: a gap-filled "before" run plus the styled target is exactly 2 elements; index - 1 instead of index + 1 would fragment the "before" span into 2 runs instead of 1, leaving 3.
    expect(
      collectRunMembers(
        tableElement.children,
        isElementWithTag(COLUMN_TAG),
        HEADER_COLUMNS_TAG,
      ).length,
    ).toBe(2);
    expect(
      collectRunMembers(
        tableElement.children,
        isElementWithTag(ROW_TAG),
        HEADER_ROWS_TAG,
      ).length,
    ).toBe(2);
  });

  it("never overwrites a width/height already explicitly set", () => {
    const { pkg, tableElement } = freshTable();
    writeColumnWidth(pkg, tableElement, 0, 130);
    writeRowHeight(pkg, tableElement, 0, 45);
    ensureColumnDefaultWidth(pkg, tableElement, 0);
    ensureRowDefaultHeight(pkg, tableElement, 0);
    expect(
      columnStyleProperties(pkg, columnElementAt(tableElement, 0)).widthPt,
    ).toBe(130);
    expect(
      rowStyleProperties(pkg, rowElementAt(tableElement, 0)).heightPt,
    ).toBe(45);
  });

  it("calling it a second time on an already-defaulted column/row does not mint a second style", () => {
    const { pkg, tableElement } = freshTable();
    ensureColumnDefaultWidth(pkg, tableElement, 0);
    const firstStyleName = attr(
      columnElementAt(tableElement, 0),
      "table:style-name",
    );
    ensureColumnDefaultWidth(pkg, tableElement, 0);
    const secondStyleName = attr(
      columnElementAt(tableElement, 0),
      "table:style-name",
    );
    expect(secondStyleName).toBe(firstStyleName);
  });
});

describe("ensureColumnElementDefaultWidth / ensureRowElementDefaultHeight", () => {
  it("stamps the default directly on an already-resolved column element with no width style, naming the fresh style OdsColumn/table-column", () => {
    const { pkg, tableElement } = freshTable();
    ensureColumnDefaultWidth(pkg, tableElement, 5); // individuates the element without styling it via a pre-existing width
    const columnElement = columnElementAt(tableElement, 5);
    // Undo the width ensureColumnDefaultWidth just applied so this test exercises ensureColumnElementDefaultWidth's OWN defaulting, not a pre-set one.
    columnElement.attributes = columnElement.attributes.filter(
      (a) => a.name !== "table:style-name",
    );

    ensureColumnElementDefaultWidth(pkg, columnElement);
    expect(columnStyleProperties(pkg, columnElement).widthPt).toBe(64);
    const styleName = attr(columnElement, "table:style-name");
    expect(styleName).toMatch(/^OdsColumn/);
    expect(
      styleName === undefined
        ? undefined
        : findStyleElement(styleName, "table-column", pkg)?.tag,
    ).toBe("style:style");
  });

  it("scans existing table-row family styles (not some other family) so a second defaulted row gets a genuinely fresh, non-colliding name", () => {
    const { pkg, tableElement } = freshTable();
    ensureRowDefaultHeight(pkg, tableElement, 5);
    ensureRowDefaultHeight(pkg, tableElement, 6);
    const firstRow = rowElementAt(tableElement, 5);
    const secondRow = rowElementAt(tableElement, 6);
    firstRow.attributes = firstRow.attributes.filter(
      (a) => a.name !== "table:style-name",
    );
    secondRow.attributes = secondRow.attributes.filter(
      (a) => a.name !== "table:style-name",
    );

    ensureRowElementDefaultHeight(pkg, firstRow);
    ensureRowElementDefaultHeight(pkg, secondRow);

    const firstStyleName = attr(firstRow, "table:style-name");
    const secondStyleName = attr(secondRow, "table:style-name");
    expect(firstStyleName).toBeDefined();
    expect(secondStyleName).toBeDefined();
    expect(secondStyleName).not.toBe(firstStyleName);
  });

  it("stamps the default directly on an already-resolved row element with no height style, naming the fresh style OdsRow/table-row", () => {
    const { pkg, tableElement } = freshTable();
    ensureRowDefaultHeight(pkg, tableElement, 5); // individuates the element without styling it via a pre-existing height
    const rowElement = rowElementAt(tableElement, 5);
    rowElement.attributes = rowElement.attributes.filter(
      (a) => a.name !== "table:style-name",
    );

    ensureRowElementDefaultHeight(pkg, rowElement);
    expect(rowStyleProperties(pkg, rowElement).heightPt).toBe(15);
    const styleName = attr(rowElement, "table:style-name");
    expect(styleName).toMatch(/^OdsRow/);
    expect(
      styleName === undefined
        ? undefined
        : findStyleElement(styleName, "table-row", pkg)?.tag,
    ).toBe("style:style");
  });

  it("no-ops (mints nothing new) when the element already has an explicit width/height", () => {
    const { pkg, tableElement } = freshTable();
    writeColumnWidth(pkg, tableElement, 0, 200);
    writeRowHeight(pkg, tableElement, 0, 70);
    const columnElement = columnElementAt(tableElement, 0);
    const rowElement = rowElementAt(tableElement, 0);
    const columnStyleNameBefore = attr(columnElement, "table:style-name");
    const rowStyleNameBefore = attr(rowElement, "table:style-name");

    ensureColumnElementDefaultWidth(pkg, columnElement);
    ensureRowElementDefaultHeight(pkg, rowElement);

    expect(attr(columnElement, "table:style-name")).toBe(columnStyleNameBefore);
    expect(attr(rowElement, "table:style-name")).toBe(rowStyleNameBefore);
    expect(columnStyleProperties(pkg, columnElement).widthPt).toBe(200);
    expect(rowStyleProperties(pkg, rowElement).heightPt).toBe(70);
  });
});

describe("writeColumnHidden / writeRowHidden", () => {
  it("sets table:visibility=collapse when hidden is true", () => {
    const { pkg, tableElement } = freshTable();
    writeColumnHidden(pkg, tableElement, 0, true);
    writeRowHidden(pkg, tableElement, 0, true);
    expect(attr(columnElementAt(tableElement, 0), "table:visibility")).toBe(
      "collapse",
    );
    expect(attr(rowElementAt(tableElement, 0), "table:visibility")).toBe(
      "collapse",
    );
  });

  it("removes table:visibility entirely when hidden is false, rather than writing some other value", () => {
    const { pkg, tableElement } = freshTable();
    writeColumnHidden(pkg, tableElement, 0, true);
    writeRowHidden(pkg, tableElement, 0, true);
    writeColumnHidden(pkg, tableElement, 0, false);
    writeRowHidden(pkg, tableElement, 0, false);
    expect(
      attr(columnElementAt(tableElement, 0), "table:visibility"),
    ).toBeUndefined();
    expect(
      attr(rowElementAt(tableElement, 0), "table:visibility"),
    ).toBeUndefined();
  });

  it("stamps the default width/height on a column/row hidden without ever having a width/height set", () => {
    const { pkg, tableElement } = freshTable();
    writeColumnHidden(pkg, tableElement, 0, true);
    writeRowHidden(pkg, tableElement, 0, true);
    expect(
      columnStyleProperties(pkg, columnElementAt(tableElement, 0)).widthPt,
    ).toBe(64);
    expect(
      rowStyleProperties(pkg, rowElementAt(tableElement, 0)).heightPt,
    ).toBe(15);
  });
});
