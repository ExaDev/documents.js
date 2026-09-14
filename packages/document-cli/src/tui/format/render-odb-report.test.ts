import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDocx, openOdt } from "documents.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixtureCalibriFontBytes } from "../../test-support/font-fixture.js";
import { FORM_AND_REPORT_ODB_PATH } from "../../test-support/odb-fixture.js";
import type { OdbOpenDocument } from "../state/types.js";
import { renderOdbReportTo } from "./render-odb-report.js";

interface CellTextTable {
  rows(): readonly { cells(): readonly { readonly text: string }[] }[];
}

function allTableCellText(tables: readonly CellTextTable[]): string[] {
  return tables.flatMap((table) =>
    table.rows().flatMap((row) => row.cells().map((cell) => cell.text)),
  );
}

let workspace: string;
let doc: OdbOpenDocument;

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "document-cli-tui-odb-render-"));
  doc = {
    format: "odb",
    tables: [],
    forms: [],
    reports: [],
    path: FORM_AND_REPORT_ODB_PATH,
  };
});

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe("renderOdbReportTo", () => {
  it("renders the report to docx as real, editable table content", async () => {
    const output = join(workspace, "report.docx");
    await renderOdbReportTo(doc, output, {
      reportName: "SalesByRegion",
      onDiagnostic: () => undefined,
    });
    const editor = openDocx(new Uint8Array(await readFile(output)));
    expect(allTableCellText(editor.tables())).toContain("Acme Ltd");
  });

  it("renders the report to odt as real, editable table content", async () => {
    const output = join(workspace, "report.odt");
    await renderOdbReportTo(doc, output, {
      reportName: "SalesByRegion",
      onDiagnostic: () => undefined,
    });
    const editor = openOdt(new Uint8Array(await readFile(output)));
    expect(allTableCellText(editor.tables())).toContain("Acme Ltd");
  });

  it("renders the report to a real pdf", async () => {
    const output = join(workspace, "report.pdf");
    await renderOdbReportTo(doc, output, {
      reportName: "SalesByRegion",
      onDiagnostic: () => undefined,
    });
    const bytes = await readFile(output);
    expect(new TextDecoder("latin1").decode(bytes.subarray(0, 5))).toBe(
      "%PDF-",
    );
  });

  it("threads fontFiles through to the pdf render alone", async () => {
    const output = join(workspace, "report-fonts.pdf");
    await renderOdbReportTo(doc, output, {
      reportName: "SalesByRegion",
      onDiagnostic: () => undefined,
      fontFiles: [],
    });
    const bytes = await readFile(output);
    expect(new TextDecoder("latin1").decode(bytes.subarray(0, 5))).toBe(
      "%PDF-",
    );
  });

  it("rejects a destination with an extension outside docx/odt/pdf", async () => {
    const output = join(workspace, "never-written.xlsx");
    await expect(
      renderOdbReportTo(doc, output, {
        reportName: "SalesByRegion",
        onDiagnostic: () => undefined,
      }),
    ).rejects.toThrow(/give the destination one of those three extensions/);
  });

  it("rejects a destination with no recognisable extension at all", async () => {
    const output = join(workspace, "never-written");
    await expect(
      renderOdbReportTo(doc, output, {
        reportName: "SalesByRegion",
        onDiagnostic: () => undefined,
      }),
    ).rejects.toThrow(/give the destination one of those three extensions/);
  });

  it("propagates the underlying error naming the available reports for an unknown report name", async () => {
    const output = join(workspace, "never-written-2.docx");
    await expect(
      renderOdbReportTo(doc, output, {
        reportName: "NoSuchReport",
        onDiagnostic: () => undefined,
      }),
    ).rejects.toThrow(/SalesByRegion/);
  });

  it("genuinely threads the given report name through rather than dropping it, which the sole declared report would silently absorb as a default for any name including an unknown one", async () => {
    // FORM_AND_REPORT_ODB_PATH declares exactly one report ("SalesByRegion"). If { report: options.reportName } lost its `report` field entirely (rather than merely being given the wrong value), readOdbReportContent would still succeed by defaulting to that sole report -- so an empty reportName, which cannot coincide with any real report name, is the input that specifically proves the field survives the call rather than being dropped.
    await expect(
      renderOdbReportTo(doc, join(workspace, "never-written-4.docx"), {
        reportName: "",
        onDiagnostic: () => undefined,
      }),
    ).rejects.toThrow();
  });

  it("threads the given signal into loadProvidedFonts specifically -- isolated from the pdf render's own separate abort check by targeting docx, which never reaches toPdfOptions at all", async () => {
    const fontPath = join(workspace, "aborted-font-docx.ttf");
    await writeFile(fontPath, fixtureCalibriFontBytes());
    const output = join(workspace, "never-written-docx.docx");
    const controller = new AbortController();
    controller.abort();

    await expect(
      renderOdbReportTo(doc, output, {
        reportName: "SalesByRegion",
        onDiagnostic: () => undefined,
        fontFiles: [fontPath],
        signal: controller.signal,
      }),
    ).rejects.toThrow(/abort/i);
  });

  it("rejects instead of reading a fontFiles entry once the given signal is already aborted", async () => {
    const fontPath = join(workspace, "aborted-font.ttf");
    await writeFile(fontPath, fixtureCalibriFontBytes());
    const output = join(workspace, "never-written-3.pdf");
    const controller = new AbortController();
    controller.abort();

    await expect(
      renderOdbReportTo(doc, output, {
        reportName: "SalesByRegion",
        onDiagnostic: () => undefined,
        fontFiles: [fontPath],
        signal: controller.signal,
      }),
    ).rejects.toThrow(/abort/i);
  });
});
