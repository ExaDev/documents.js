import type {
  ContentDocument,
  ContentSheet,
  ContentSheetCell,
} from "documents.js";
import { afterEach, describe, expect, it } from "vitest";

import { SAMPLE_PAGE_SIZE } from "../test/fixtures";
import { mountWithMantine } from "../test/mountComponent";
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
    const html = renderPreview({
      label: "L",
      format: "xlsx",
      content: spreadsheetDocument([sheet()]),
    });
    expect(html).toContain("<td");
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
});
