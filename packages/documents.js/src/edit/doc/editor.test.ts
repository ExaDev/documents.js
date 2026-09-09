import { describe, expect, it } from "vitest";
import { fixedClock } from "../../ports/clock";
import { createDoc, DocEditor, openDoc } from "./editor";
import type { DocParagraph } from "./paragraph";

const FIXED_ISO = "2026-01-01T00:00:00.000Z";

function fixed(): ReturnType<typeof fixedClock> {
  return fixedClock(new Date(FIXED_ISO));
}

describe("createDoc", () => {
  it("builds a one-section Letter document with real metadata timestamps", () => {
    const editor = createDoc({ clock: fixed() });
    const [section] = editor.sections();
    expect(section!.pageSize).toEqual({ widthPt: 612, heightPt: 792 });
    expect(section!.margins).toEqual({
      topPt: 72,
      rightPt: 72,
      bottomPt: 72,
      leftPt: 72,
    });
    expect(editor.paragraphs()).toEqual([]);
  });

  it("round-trips an empty document through toBytes and openDoc", () => {
    const editor = createDoc();
    const reread = openDoc(editor.toBytes());
    // writeDocContent appends one trailing empty paragraph to an otherwise-empty section ([MS-DOC]'s own final-character requirement -- see its closeSection note), so an empty document reads back as exactly one empty paragraph, not zero.
    expect(reread.paragraphs()).toHaveLength(1);
    expect(reread.paragraphs()[0]!.text).toBe("");
    expect(reread.sections()[0]!.pageSize).toEqual(
      editor.sections()[0]!.pageSize,
    );
  });
});

describe("DocEditor paragraph and run round trips", () => {
  it("round-trips paragraphs, runs, and every run property the writer encodes", () => {
    const editor = createDoc();
    const paragraph = editor.appendParagraph();
    const run = paragraph.appendRun({ text: "Hello" });
    run.bold = true;
    run.italic = true;
    run.underline = true;
    run.strike = true;
    run.sizePt = 14;
    run.color = { r: 1, g: 0, b: 0 };
    run.fontFamily = "Arial";
    editor.appendParagraph({ text: "second" });

    const reread = openDoc(editor.toBytes());
    const [first, second] = reread.paragraphs();
    expect(first!.text).toBe("Hello");
    const rereadRun = first!.runs()[0]!;
    expect(rereadRun.bold).toBe(true);
    expect(rereadRun.italic).toBe(true);
    expect(rereadRun.underline).toBe(true);
    expect(rereadRun.strike).toBe(true);
    expect(rereadRun.sizePt).toBe(14);
    expect(rereadRun.color).toEqual({ r: 1, g: 0, b: 0 });
    expect(rereadRun.fontFamily).toBe("Arial");
    expect(second?.text).toBe("second");
  });

  it("round-trips paragraph alignment, heading level, and list membership", () => {
    const editor = createDoc();
    editor.appendParagraph({
      text: "Heading",
      headingLevel: 1,
      alignment: "center",
    });
    const item = editor.appendParagraph({ text: "bullet" });
    item.list = { numId: "list-1", level: 0 };

    const reread = openDoc(editor.toBytes());
    const [heading, bullet] = reread.paragraphs();
    expect(heading?.headingLevel).toBe(1);
    expect(heading?.alignment).toBe("center");
    // numId is the schema's own string-typed identity (the source format's numbering definition name); the reader remints it in its own first-occurrence order, so only the membership and level themselves are stable across a round trip -- the identical convention the odt editor's own list round trips follow.
    expect(bullet?.list?.level).toBe(0);
    expect(bullet?.list?.numId).toBe("1");
  });

  it("round-trips paragraph indents and spacing", () => {
    const editor = createDoc();
    const paragraph = editor.appendParagraph({ text: "spaced" });
    paragraph.indentLeftPt = 36;
    paragraph.indentRightPt = 18;
    paragraph.indentFirstLinePt = 12;
    paragraph.spacingBeforePt = 6;
    paragraph.spacingAfterPt = 10;

    const [reread] = openDoc(editor.toBytes()).paragraphs();
    expect(reread?.indentLeftPt).toBeCloseTo(36);
    expect(reread?.indentRightPt).toBeCloseTo(18);
    expect(reread?.indentFirstLinePt).toBeCloseTo(12);
    expect(reread?.spacingBeforePt).toBeCloseTo(6);
    expect(reread?.spacingAfterPt).toBeCloseTo(10);
  });
});

describe("DocEditor tables", () => {
  it("round-trips a table with cell text and a horizontal merge", () => {
    const editor = createDoc();
    const table = editor.appendTable({ rows: 2, columns: 2 });
    table.rows()[0]!.cells()[0]!.text = "top-left";
    table.rows()[0]!.cells()[1]!.text = "top-right";
    const bottomRow = table.rows()[1]!;
    bottomRow.cells()[0]!.text = "bottom";
    bottomRow.cells()[0]!.colSpan = 2;
    // A horizontal merge is the anchor's own colSpan covering a grid position the row no longer carries a cell for -- the covered cell leaves the row (see DocTableCell.remove's own note).
    bottomRow.cells()[1]!.remove();

    const reread = openDoc(editor.toBytes());
    const rereadTable = reread.tables()[0]!;
    expect(rereadTable.rows()).toHaveLength(2);
    expect(rereadTable.rows()[0]!.cells()[0]!.text).toBe("top-left");
    expect(rereadTable.rows()[0]!.cells()[1]!.text).toBe("top-right");
    const mergedRow = rereadTable.rows()[1]!;
    expect(mergedRow.cells()).toHaveLength(1);
    expect(mergedRow.cells()[0]!.text).toBe("bottom");
    expect(mergedRow.cells()[0]!.colSpan).toBe(2);
  });

  it("round-trips a multi-paragraph cell as multiple paragraphs", () => {
    const editor = createDoc();
    const cell = editor
      .appendTable({ rows: 1, columns: 1 })
      .rows()[0]!
      .cells()[0]!;
    cell.text = "one";
    cell.appendParagraph({ text: "two" });

    const reread = openDoc(editor.toBytes());
    const rereadCell = reread.tables()[0]!.rows()[0]!.cells()[0]!;
    expect(rereadCell.paragraphs().map((p) => p.text)).toEqual(["one", "two"]);
  });
});

describe("DocEditor sections", () => {
  it("round-trips multiple sections, each with its own page geometry", () => {
    const editor = createDoc();
    editor.appendParagraph({ text: "first section" });
    editor
      .appendSection({
        pageSize: { widthPt: 595.28, heightPt: 841.89 },
        margins: { topPt: 36, rightPt: 36, bottomPt: 36, leftPt: 36 },
        breakType: "continuous",
      })
      .appendParagraph({ text: "second section" });

    const reread = openDoc(editor.toBytes());
    expect(reread.sections()).toHaveLength(2);
    expect(reread.paragraphs()[0]!.text).toBe("first section");
    const second = reread.sections()[1]!;
    // Page geometry quantises to [MS-DOC]'s own twip unit (1/20pt) on the round trip: 595.28pt lands at 11906 twips and reads back as 595.3.
    expect(second.pageSize).toEqual({ widthPt: 595.3, heightPt: 841.9 });
    expect(second.margins).toEqual({
      topPt: 36,
      rightPt: 36,
      bottomPt: 36,
      leftPt: 36,
    });
    expect(second.paragraphs()[0]!.text).toBe("second section");
  });

  it("refuses to remove the last section", () => {
    const editor = createDoc();
    expect(() => {
      editor.sections()[0]!.remove();
    }).toThrow(/at least one section/);
  });

  it("removes a non-last section in place", () => {
    const editor = createDoc();
    editor.appendSection();
    expect(editor.sections()).toHaveLength(2);
    editor.sections()[1]!.remove();
    expect(editor.sections()).toHaveLength(1);
  });
});

describe("DocEditor live-view contract", () => {
  it("mutating through a stale handle throws once removed", () => {
    const editor = createDoc();
    const paragraph = editor.appendParagraph({ text: "doomed" });
    paragraph.remove();
    expect(() => paragraph.appendRun()).toThrow(/removed/);
  });

  it("refuses a wordprocessing document with no sections", () => {
    expect(
      () =>
        new DocEditor({
          kind: "wordprocessing",
          metadata: {},
          sections: [],
        }),
    ).toThrow(/at least one section/);
  });

  it("paragraphs() re-reads the section blocks on every call", () => {
    const editor = createDoc();
    const before: DocParagraph[] = editor.paragraphs();
    expect(before).toHaveLength(0);
    editor.appendParagraph({ text: "late" });
    // The live-view contract: an array captured before a mutation is stale, and a fresh call sees the mutation -- the exact behaviour document-cli's TUI render loop depends on (see that package's state/types.ts RULE note).
    expect(editor.paragraphs()).toHaveLength(1);
    expect(before).toHaveLength(0);
  });
});

describe("openDoc", () => {
  it("reads a written document's paragraphs back in order", () => {
    const editor = createDoc();
    editor.appendParagraph({ text: "alpha" });
    editor.appendParagraph({ text: "beta" });
    const reread = openDoc(editor.toBytes());
    expect(reread.paragraphs().map((p) => p.text)).toEqual(["alpha", "beta"]);
  });
});
