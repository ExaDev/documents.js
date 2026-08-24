import type { XmlElement, XmlNode } from "odf.js";
import { describe, expect, it } from "vitest";
import { el } from "../../xml/fragment";
import {
  COLUMN_REPEAT_ATTR,
  COLUMN_TAG,
  COVERED_CELL_TAG,
  ROW_REPEAT_ATTR,
  ROW_TAG,
  ensureColumnCoverage,
  isElementWithTag,
  replaceRun,
  resolveCellNode,
} from "./address";

function repeatAttr(node: XmlElement, name: string): string | undefined {
  return node.attributes.find((a) => a.name === name)?.value;
}

describe("replaceRun: appending beyond every existing run's coverage", () => {
  it("targetIndex 0 on an empty array creates exactly one element, no gap placeholder", () => {
    const children: XmlNode[] = [];
    const target = replaceRun(
      children,
      isElementWithTag(ROW_TAG),
      0,
      ROW_REPEAT_ATTR,
      () => el(ROW_TAG),
    );
    expect(children).toHaveLength(1);
    expect(children[0]).toBe(target);
    expect(repeatAttr(target, ROW_REPEAT_ATTR)).toBeUndefined();
  });

  it("a far-out targetIndex on an empty array creates exactly TWO elements -- a gap placeholder and the target -- never one per skipped position", () => {
    const children: XmlNode[] = [];
    const target = replaceRun(
      children,
      isElementWithTag(ROW_TAG),
      500,
      ROW_REPEAT_ATTR,
      () => el(ROW_TAG),
    );
    expect(children).toHaveLength(2);
    const [gap] = children;
    if (gap?.type !== "element") {
      throw new Error("expected the gap placeholder to be an element");
    }
    expect(repeatAttr(gap, ROW_REPEAT_ATTR)).toBe("500");
    expect(repeatAttr(target, ROW_REPEAT_ATTR)).toBeUndefined();
    expect(children[1]).toBe(target);
  });

  it("appending after existing real content only pads the NEW gap, not the whole range from zero", () => {
    const existingRow = el(ROW_TAG);
    const children: XmlNode[] = [existingRow];
    const target = replaceRun(
      children,
      isElementWithTag(ROW_TAG),
      10,
      ROW_REPEAT_ATTR,
      () => el(ROW_TAG),
    );
    expect(children).toHaveLength(3);
    expect(children[0]).toBe(existingRow);
    const gap = children[1];
    if (gap?.type !== "element") {
      throw new Error("expected the gap placeholder to be an element");
    }
    expect(repeatAttr(gap, ROW_REPEAT_ATTR)).toBe("9");
    expect(children[2]).toBe(target);
  });
});

describe("replaceRun: individuating within an existing repeated run", () => {
  it("a run whose own repeat count is already 1 is returned unchanged -- no split, no mutation", () => {
    const row = el(ROW_TAG, {}, [
      el("table:table-cell", { "office:value-type": "string" }),
    ]);
    const children: XmlNode[] = [row];
    const target = replaceRun(
      children,
      isElementWithTag(ROW_TAG),
      0,
      ROW_REPEAT_ATTR,
      () => el(ROW_TAG),
    );
    expect(target).toBe(row);
    expect(children).toHaveLength(1);
  });

  it('splitting the FIRST position of a repeated run produces [target, after] -- no empty "before" element', () => {
    const run = el(ROW_TAG);
    run.attributes.push({ name: ROW_REPEAT_ATTR, value: "10" });
    const children: XmlNode[] = [run];
    const target = replaceRun(
      children,
      isElementWithTag(ROW_TAG),
      0,
      ROW_REPEAT_ATTR,
      () => el(ROW_TAG),
    );
    expect(children).toHaveLength(2);
    expect(children[0]).toBe(target);
    expect(repeatAttr(target, ROW_REPEAT_ATTR)).toBeUndefined();
    const after = children[1];
    if (after?.type !== "element") {
      throw new Error("expected the after-run to be an element");
    }
    expect(repeatAttr(after, ROW_REPEAT_ATTR)).toBe("9");
  });

  it('splitting the LAST position of a repeated run produces [before, target] -- no empty "after" element', () => {
    const run = el(ROW_TAG, {}, []);
    run.attributes.push({ name: ROW_REPEAT_ATTR, value: "10" });
    const children: XmlNode[] = [run];
    const target = replaceRun(
      children,
      isElementWithTag(ROW_TAG),
      9,
      ROW_REPEAT_ATTR,
      () => el(ROW_TAG),
    );
    expect(children).toHaveLength(2);
    const before = children[0];
    if (before?.type !== "element") {
      throw new Error("expected the before-run to be an element");
    }
    expect(repeatAttr(before, ROW_REPEAT_ATTR)).toBe("9");
    expect(children[1]).toBe(target);
  });

  it("splitting the MIDDLE of a huge repeated run (a real LibreOffice-scale count) produces exactly three elements, in O(1) regardless of the run size", () => {
    const run = el(ROW_TAG, {}, []);
    run.attributes.push({ name: ROW_REPEAT_ATTR, value: "1016575" });
    const children: XmlNode[] = [run];
    const start = performance.now();
    const target = replaceRun(
      children,
      isElementWithTag(ROW_TAG),
      500000,
      ROW_REPEAT_ATTR,
      () => el(ROW_TAG),
    );
    const elapsedMs = performance.now() - start;
    expect(children).toHaveLength(3);
    const [before, middle, after] = children;
    if (before?.type !== "element" || after?.type !== "element") {
      throw new Error("expected before/after runs to be elements");
    }
    expect(middle).toBe(target);
    expect(repeatAttr(before, ROW_REPEAT_ATTR)).toBe("500000");
    expect(repeatAttr(target, ROW_REPEAT_ATTR)).toBeUndefined();
    expect(repeatAttr(after, ROW_REPEAT_ATTR)).toBe("516574");
    // Bounded-duration assertion (mirroring src/layout/sheets.test.ts's own cancellation test pattern): a genuinely O(1) split completes near-instantly regardless of the 1,016,575-row run it split -- a regression that accidentally started expanding the run element-by-element would blow this budget by orders of magnitude, not just run "a bit slower".
    expect(elapsedMs).toBeLessThan(500);
  });

  it("splitting a run that carries genuine repeated CONTENT preserves that content identically in every resulting part", () => {
    const cell = el("table:table-cell", {
      "office:value-type": "string",
      "office:string-value": "Q1",
    });
    const run = el(ROW_TAG, {}, [cell]);
    run.attributes.push({ name: ROW_REPEAT_ATTR, value: "4" });
    const children: XmlNode[] = [run];
    const target = replaceRun(
      children,
      isElementWithTag(ROW_TAG),
      2,
      ROW_REPEAT_ATTR,
      () => el(ROW_TAG),
    );
    expect(children).toHaveLength(3);
    for (const node of children) {
      if (node.type !== "element") {
        throw new Error("expected every split part to be an element");
      }
      const [innerCell] = node.children;
      if (innerCell?.type !== "element") {
        throw new Error(
          "expected each split part to carry its own clone of the repeated cell",
        );
      }
      expect(
        innerCell.attributes.find((a) => a.name === "office:string-value")
          ?.value,
      ).toBe("Q1");
    }
    // The clones are independent objects, not shared references -- mutating one must never affect a sibling part.
    if (target.children[0]?.type === "element") {
      target.children[0].attributes.push({
        name: "office:value-type",
        value: "string",
      });
    }
    const firstNode = children[0];
    if (
      firstNode?.type !== "element" ||
      firstNode.children[0]?.type !== "element"
    ) {
      throw new Error(
        "expected the first split part to carry its own element cell",
      );
    }
    expect(
      firstNode.children[0].attributes.filter(
        (a) => a.name === "office:value-type",
      ),
    ).toHaveLength(1);
  });
});

describe("ensureColumnCoverage", () => {
  it("adds exactly one new table:table-column run covering the shortfall when no columns exist yet", () => {
    const table = el("table:table", {}, [el(ROW_TAG)]);
    ensureColumnCoverage(table, 51);
    const columns = table.children.filter(isElementWithTag(COLUMN_TAG));
    expect(columns).toHaveLength(1);
    expect(repeatAttr(columns[0]!, COLUMN_REPEAT_ATTR)).toBe("51");
    // Columns must precede rows in table:table's own content model.
    expect(table.children.indexOf(columns[0]!)).toBeLessThan(
      table.children.findIndex(isElementWithTag(ROW_TAG)),
    );
  });

  it("extends the LAST column run rather than individuating or duplicating existing ones", () => {
    const firstColumn = el(COLUMN_TAG, { [COLUMN_REPEAT_ATTR]: "5" });
    const table = el("table:table", {}, [firstColumn]);
    ensureColumnCoverage(table, 20);
    const columns = table.children.filter(isElementWithTag(COLUMN_TAG));
    expect(columns).toHaveLength(2);
    expect(columns[0]).toBe(firstColumn);
    expect(repeatAttr(columns[1]!, COLUMN_REPEAT_ATTR)).toBe("15");
  });

  it("is a no-op once coverage already meets or exceeds the requested count", () => {
    const firstColumn = el(COLUMN_TAG, { [COLUMN_REPEAT_ATTR]: "20" });
    const table = el("table:table", {}, [firstColumn]);
    ensureColumnCoverage(table, 5);
    expect(table.children.filter(isElementWithTag(COLUMN_TAG))).toHaveLength(1);
  });
});

describe("resolveCellNode", () => {
  it("resolving a far-out cell on a fresh table materializes a bounded number of elements, never one per skipped row/column", () => {
    const table = el("table:table", { "table:name": "Sheet1" });
    const cell = resolveCellNode(table, 500, 50);
    expect(cell.tag).toBe("table:table-cell");
    const rowElements = table.children.filter(isElementWithTag(ROW_TAG));
    // Exactly two rows: a rows-0..499 placeholder, and row 500 itself.
    expect(rowElements).toHaveLength(2);
    const targetRow = rowElements[1];
    if (targetRow === undefined) {
      throw new Error("expected the individuated row");
    }
    const cellsInTargetRow = targetRow.children.filter(
      (c): c is XmlElement =>
        c.type === "element" && c.tag === "table:table-cell",
    );
    // Exactly two cells in that row: a columns-0..49 placeholder, and column 50 itself.
    expect(cellsInTargetRow).toHaveLength(2);
    expect(cellsInTargetRow[1]).toBe(cell);
  });

  it("also grows the table's own declared column coverage to at least column + 1", () => {
    const table = el("table:table", { "table:name": "Sheet1" });
    resolveCellNode(table, 0, 50);
    const columns = table.children.filter(isElementWithTag(COLUMN_TAG));
    const covered = columns.reduce(
      (sum, c) => sum + Number(repeatAttr(c, COLUMN_REPEAT_ATTR) ?? "1"),
      0,
    );
    expect(covered).toBeGreaterThanOrEqual(51);
  });

  it("resolving the same position twice returns the identical node both times", () => {
    const table = el("table:table", { "table:name": "Sheet1" });
    const first = resolveCellNode(table, 3, 3);
    const second = resolveCellNode(table, 3, 3);
    expect(first).toBe(second);
  });

  it("a position covered by a merge resolves to the table:covered-table-cell marker, not a fresh table:table-cell", () => {
    const table = el("table:table", { "table:name": "Sheet1" });
    const anchor = resolveCellNode(table, 0, 0);
    anchor.attributes.push({
      name: "table:number-columns-spanned",
      value: "2",
    });
    const covered = el(COVERED_CELL_TAG);
    const row = table.children.find(isElementWithTag(ROW_TAG));
    if (row === undefined) {
      throw new Error("expected a row to exist");
    }
    row.children = [anchor, covered];
    expect(resolveCellNode(table, 0, 1).tag).toBe(COVERED_CELL_TAG);
  });
});
