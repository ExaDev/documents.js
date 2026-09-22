import type {
  ContentDocument,
  ContentSheet,
  ContentSheetCell,
} from "documents.js";
import { afterEach, describe, expect, it } from "vitest";

import { previewFrame } from "./previewPanel.css";
import { SAMPLE_PAGE_SIZE } from "../test/fixtures";
import { mountWithMantine } from "../test/mountComponent";
import { cell as cellRecipe } from "./SheetPreview.css";
import { SheetPreview, type SheetPreviewProps } from "./SheetPreview";

let unmount: (() => void) | undefined;

afterEach(() => {
  unmount?.();
  unmount = undefined;
});

function renderPreview(props: SheetPreviewProps): string {
  const mounted = mountWithMantine(<SheetPreview {...props} />);
  unmount = mounted.unmount;
  return mounted.container.innerHTML;
}

const PRINT_SETTINGS = {
  pageSize: SAMPLE_PAGE_SIZE,
  margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
  gridlines: true,
  headers: true,
  pageOrder: "downThenOver" as const,
};

function cell(overrides: Partial<ContentSheetCell> = {}): ContentSheetCell {
  return {
    row: 0,
    column: 0,
    value: { kind: "empty" },
    displayText: "",
    ...overrides,
  };
}

function sheet(overrides: Partial<ContentSheet> = {}): ContentSheet {
  return {
    name: "Sheet1",
    cells: [],
    columns: [{ index: 0 }, { index: 1 }],
    rows: [{ index: 0 }, { index: 1 }],
    images: [],
    printSettings: PRINT_SETTINGS,
    ...overrides,
  };
}

function spreadsheetDocument(sheets: readonly ContentSheet[]): ContentDocument {
  return { kind: "spreadsheet", metadata: {}, sheets: [...sheets] };
}

describe("SheetPreview", () => {
  it("always renders the label and format badge", () => {
    const html = renderPreview({ label: "Doc A", format: "xlsx" });
    expect(html).toContain("Doc A");
    expect(html).toContain("xlsx");
  });

  it("shows a loading overlay when loading", () => {
    const html = renderPreview({ label: "L", format: "xlsx", loading: true });
    expect(html).toContain("mantine-LoadingOverlay-root");
  });

  it("shows the unavailable message when an error is present", () => {
    const html = renderPreview({
      label: "L",
      format: "xlsx",
      content: spreadsheetDocument([sheet()]),
      error: new Error("boom"),
    });
    expect(html).toContain("Preview unavailable for this format.");
  });

  it("shows the not-yet-available message when there is no content at all", () => {
    const html = renderPreview({ label: "L", format: "xlsx" });
    expect(html).toContain("No preview yet.");
  });

  it("shows the not-yet-available message when the content is not a spreadsheet document", () => {
    const html = renderPreview({
      label: "L",
      format: "xlsx",
      content: { kind: "formula", metadata: {}, formula: { mathml: [] } },
    });
    expect(html).toContain("No preview yet.");
  });

  it("renders no SegmentedControl for a single sheet", () => {
    const html = renderPreview({
      label: "L",
      format: "xlsx",
      content: spreadsheetDocument([sheet()]),
    });
    expect(html).not.toContain("mantine-SegmentedControl-root");
  });

  it("renders a SegmentedControl naming every sheet when there is more than one", () => {
    const html = renderPreview({
      label: "L",
      format: "xlsx",
      content: spreadsheetDocument([
        sheet({ name: "First" }),
        sheet({ name: "Second" }),
      ]),
    });
    expect(html).toContain("mantine-SegmentedControl-root");
    expect(html).toContain("First");
    expect(html).toContain("Second");
  });

  it("shows the empty-sheet message when a sheet has no visible rows", () => {
    const html = renderPreview({
      label: "L",
      format: "xlsx",
      content: spreadsheetDocument([
        sheet({ rows: [{ index: 0, hidden: true }] }),
      ]),
    });
    expect(html).toContain("Empty sheet.");
  });

  it("shows the empty-sheet message when a sheet has no visible columns", () => {
    const html = renderPreview({
      label: "L",
      format: "xlsx",
      content: spreadsheetDocument([
        sheet({ columns: [{ index: 0, hidden: true }] }),
      ]),
    });
    expect(html).toContain("Empty sheet.");
  });

  it("hides a row marked hidden and still renders the rest", () => {
    const html = renderPreview({
      label: "L",
      format: "xlsx",
      content: spreadsheetDocument([
        sheet({
          rows: [{ index: 0, hidden: true }, { index: 1 }],
          cells: [
            cell({ row: 0, column: 0, displayText: "hiddenRowValue" }),
            cell({ row: 1, column: 0, displayText: "visibleRowValue" }),
          ],
        }),
      ]),
    });
    expect(html).not.toContain("hiddenRowValue");
    expect(html).toContain("visibleRowValue");
  });

  it("hides a column marked hidden and still renders the rest", () => {
    const html = renderPreview({
      label: "L",
      format: "xlsx",
      content: spreadsheetDocument([
        sheet({
          columns: [{ index: 0, hidden: true }, { index: 1 }],
          cells: [
            cell({ row: 0, column: 0, displayText: "hiddenColValue" }),
            cell({ row: 0, column: 1, displayText: "visibleColValue" }),
          ],
        }),
      ]),
    });
    expect(html).not.toContain("hiddenColValue");
    expect(html).toContain("visibleColValue");
  });

  it("orders rows and columns by their own index, not array position", () => {
    const html = renderPreview({
      label: "L",
      format: "xlsx",
      content: spreadsheetDocument([
        sheet({
          rows: [{ index: 1 }, { index: 0 }],
          columns: [{ index: 0 }],
          cells: [
            cell({ row: 0, column: 0, displayText: "row0" }),
            cell({ row: 1, column: 0, displayText: "row1" }),
          ],
        }),
      ]),
    });
    const row0At = html.indexOf("row0");
    const row1At = html.indexOf("row1");
    expect(row0At).toBeGreaterThan(-1);
    expect(row0At).toBeLessThan(row1At);
  });

  it("renders an empty cell's displayText as an empty string, not a placeholder", () => {
    const mounted = mountWithMantine(
      <SheetPreview
        label="L"
        format="xlsx"
        content={spreadsheetDocument([sheet()])}
      />,
    );
    unmount = mounted.unmount;
    const td = mounted.container.querySelector("td");
    expect(td).not.toBeNull();
    expect(td!.textContent).toBe("");
  });

  it("renders a cell's own displayText", () => {
    const html = renderPreview({
      label: "L",
      format: "xlsx",
      content: spreadsheetDocument([
        sheet({ cells: [cell({ displayText: "42" })] }),
      ]),
    });
    expect(html).toContain("42");
  });

  it("gives the preview frame the scrollable variant", () => {
    const html = renderPreview({
      label: "L",
      format: "xlsx",
      content: spreadsheetDocument([sheet()]),
    });
    expect(html).toContain(previewFrame({ scroll: true }));
    expect(html).not.toContain(previewFrame({ scroll: false }));
  });

  it("shows no loading overlay when not loading", () => {
    const html = renderPreview({ label: "L", format: "xlsx" });
    expect(html).not.toContain("mantine-LoadingOverlay-root");
  });

  it("switches to a clicked sheet and clamps back to the last real sheet once fewer sheets remain", () => {
    const mounted = mountWithMantine(
      <SheetPreview
        label="L"
        format="xlsx"
        content={spreadsheetDocument([
          sheet({ name: "First", cells: [cell({ displayText: "firstVal" })] }),
          sheet({
            name: "Second",
            cells: [cell({ displayText: "secondVal" })],
          }),
        ])}
      />,
    );
    unmount = mounted.unmount;
    expect(mounted.container.innerHTML).toContain("firstVal");
    const secondInput =
      mounted.container.querySelector<HTMLInputElement>('input[value="1"]');
    expect(secondInput).not.toBeNull();
    secondInput!.click();
    expect(mounted.container.innerHTML).toContain("secondVal");
    expect(mounted.container.innerHTML).not.toContain("firstVal");

    // Rerender with a single sheet — the previously-selected index (1) is now out of range, so clampedIndex must fall back to the last real sheet (index 0) rather than leaving the table blank.
    mounted.rerender(
      <SheetPreview
        label="L"
        format="xlsx"
        content={spreadsheetDocument([
          sheet({ name: "Only", cells: [cell({ displayText: "onlyVal" })] }),
        ])}
      />,
    );
    expect(mounted.container.innerHTML).toContain("onlyVal");
  });

  it("orders columns by their own index too, not array position", () => {
    const html = renderPreview({
      label: "L",
      format: "xlsx",
      content: spreadsheetDocument([
        sheet({
          columns: [{ index: 1 }, { index: 0 }],
          rows: [{ index: 0 }],
          cells: [
            cell({ row: 0, column: 0, displayText: "col0" }),
            cell({ row: 0, column: 1, displayText: "col1" }),
          ],
        }),
      ]),
    });
    const col0At = html.indexOf("col0");
    const col1At = html.indexOf("col1");
    expect(col0At).toBeGreaterThan(-1);
    expect(col0At).toBeLessThan(col1At);
  });

  it("labels header columns with their own spreadsheet letter", () => {
    const html = renderPreview({
      label: "L",
      format: "xlsx",
      content: spreadsheetDocument([
        sheet({ columns: [{ index: 0 }, { index: 1 }] }),
      ]),
    });
    expect(html).toContain(">A<");
    expect(html).toContain(">B<");
  });

  it("labels each row header with its one-based row number", () => {
    const html = renderPreview({
      label: "L",
      format: "xlsx",
      content: spreadsheetDocument([
        sheet({ rows: [{ index: 0 }, { index: 2 }] }),
      ]),
    });
    expect(html).toContain(">1<");
    expect(html).toContain(">3<");
    expect(html).not.toContain(">-1<");
  });

  it("classes a number/percentage/currency cell as right-aligned, a boolean cell as centered, and any other kind as left-aligned", () => {
    const html = renderPreview({
      label: "L",
      format: "xlsx",
      content: spreadsheetDocument([
        sheet({
          columns: [{ index: 0 }, { index: 1 }, { index: 2 }, { index: 3 }],
          rows: [{ index: 0 }],
          cells: [
            cell({
              row: 0,
              column: 0,
              value: { kind: "number", value: 1 },
              displayText: "1",
            }),
            cell({
              row: 0,
              column: 1,
              value: { kind: "boolean", value: true },
              displayText: "TRUE",
            }),
            cell({
              row: 0,
              column: 2,
              value: { kind: "string", value: "x" },
              displayText: "x",
            }),
            cell({
              row: 0,
              column: 3,
              value: { kind: "error", value: "#REF!" },
              displayText: "#REF!",
            }),
          ],
        }),
      ]),
    });
    expect(html).toContain(
      cellRecipe({ align: "right", verticalAlign: "bottom", error: false }),
    );
    expect(html).toContain(
      cellRecipe({ align: "center", verticalAlign: "bottom", error: false }),
    );
    expect(html).toContain(
      cellRecipe({ align: "left", verticalAlign: "bottom", error: false }),
    );
    expect(html).toContain(
      cellRecipe({ align: "left", verticalAlign: "bottom", error: true }),
    );
  });

  // A number cell already produces the identical right-aligned recipe class, so a shared assertion above would pass even if percentage or currency stopped being recognised at all — these two cases each render as the sheet's only cell specifically so their alignment is the sole recipe class present, distinguishing "recognised" from "fell through to the left-aligned default".
  it("classes a percentage cell as right-aligned on its own, not only alongside a number cell", () => {
    const html = renderPreview({
      label: "L",
      format: "xlsx",
      content: spreadsheetDocument([
        sheet({
          columns: [{ index: 0 }],
          rows: [{ index: 0 }],
          cells: [
            cell({
              row: 0,
              column: 0,
              value: { kind: "percentage", value: 0.5 },
              displayText: "50%",
            }),
          ],
        }),
      ]),
    });
    expect(html).toContain(
      cellRecipe({ align: "right", verticalAlign: "bottom", error: false }),
    );
    expect(html).not.toContain(
      cellRecipe({ align: "left", verticalAlign: "bottom", error: false }),
    );
  });

  it("classes a currency cell as right-aligned on its own, not only alongside a number cell", () => {
    const html = renderPreview({
      label: "L",
      format: "xlsx",
      content: spreadsheetDocument([
        sheet({
          columns: [{ index: 0 }],
          rows: [{ index: 0 }],
          cells: [
            cell({
              row: 0,
              column: 0,
              value: { kind: "currency", value: 9.99, currency: "USD" },
              displayText: "$9.99",
            }),
          ],
        }),
      ]),
    });
    expect(html).toContain(
      cellRecipe({ align: "right", verticalAlign: "bottom", error: false }),
    );
    expect(html).not.toContain(
      cellRecipe({ align: "left", verticalAlign: "bottom", error: false }),
    );
  });

  it("respects a cell's own explicit alignment and vertical alignment overrides", () => {
    const html = renderPreview({
      label: "L",
      format: "xlsx",
      content: spreadsheetDocument([
        sheet({
          cells: [
            cell({
              alignment: "justify",
              verticalAlignment: "top",
              displayText: "x",
            }),
          ],
        }),
      ]),
    });
    expect(html).toContain(
      cellRecipe({ align: "justify", verticalAlign: "top", error: false }),
    );
  });

  it("renders a solid fill's own colour as the cell background CSS variable", () => {
    const html = renderPreview({
      label: "L",
      format: "xlsx",
      content: spreadsheetDocument([
        sheet({
          cells: [
            cell({
              displayText: "x",
              background: { kind: "solid", color: { r: 0.2, g: 0.4, b: 0.6 } },
            }),
          ],
        }),
      ]),
    });
    expect(html).toContain("rgb(51 102 153)");
  });

  it("falls back to a pattern fill's backgroundColor when foregroundColor is absent", () => {
    const html = renderPreview({
      label: "L",
      format: "xlsx",
      content: spreadsheetDocument([
        sheet({
          cells: [
            cell({
              displayText: "x",
              background: {
                kind: "pattern",
                patternType: "percent50",
                backgroundColor: { r: 0.2, g: 0.4, b: 0.6 },
              },
            }),
          ],
        }),
      ]),
    });
    expect(html).toContain("rgb(51 102 153)");
  });

  it("prefers a pattern fill's own foregroundColor over its backgroundColor when both are present", () => {
    const html = renderPreview({
      label: "L",
      format: "xlsx",
      content: spreadsheetDocument([
        sheet({
          cells: [
            cell({
              displayText: "x",
              background: {
                kind: "pattern",
                patternType: "percent50",
                foregroundColor: { r: 1, g: 0, b: 0 },
                backgroundColor: { r: 0, g: 0, b: 1 },
              },
            }),
          ],
        }),
      ]),
    });
    expect(html).toContain("rgb(255 0 0)");
    expect(html).not.toContain("rgb(0 0 255)");
  });

  it("sets no background CSS variable at all for a cell with no fill", () => {
    const html = renderPreview({
      label: "L",
      format: "xlsx",
      content: spreadsheetDocument([
        sheet({ cells: [cell({ displayText: "x" })] }),
      ]),
    });
    expect(html).not.toContain("rgb(");
  });
});
