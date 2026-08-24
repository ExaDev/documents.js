import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOds, odsToXlsx, readPdf, xlsxToPdf } from "documents.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { XlsxOpenDocument } from "../state/types.js";
import { exportToPdf } from "./export-pdf.js";

function xlsxTestBytes(): Uint8Array<ArrayBuffer> {
  const editor = createOds();
  const sheet = editor.addSheet("Sheet1");
  sheet.cell(0, 0).value = { kind: "string", value: "Quarterly Revenue" };
  return odsToXlsx(editor.toBytes());
}

// A distinct page size, not cell text, is this file's own signal for telling two workbooks' conversions apart: OdsSheet.cell() materialises a real but zero-width table:table-column with no styling (a genuine, already-documented documents.js limitation -- see this repo's own CLAUDE.md gotcha on OdsSheet/OdsEditor having no column-width setter), so a cell's own text never actually reaches a rendered PDF page to search for. Page size, set via the real OdsSheet.printSettings getter/setter, survives the odsToXlsx bridge and xlsxToPdf conversion untouched, and is exactly the kind of per-workbook fact that would go stale if exportToPdf ever read a cached `doc.layout` instead of re-converting `doc.bytes`.
function xlsxTestBytesWithPageSize(
  widthPt: number,
  heightPt: number,
): Uint8Array<ArrayBuffer> {
  const editor = createOds();
  const sheet = editor.addSheet("Sheet1");
  sheet.cell(0, 0).value = { kind: "string", value: "x" };
  sheet.printSettings = {
    pageSize: { widthPt, heightPt },
    margins: { topPt: 10, rightPt: 10, bottomPt: 10, leftPt: 10 },
    gridlines: false,
    headers: false,
    pageOrder: "downThenOver",
  };
  return odsToXlsx(editor.toBytes());
}

function openXlsxDocument(
  bytes: Uint8Array<ArrayBuffer>,
  path: string,
): XlsxOpenDocument {
  return { format: "xlsx", layout: readPdf(xlsxToPdf(bytes)), bytes, path };
}

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "document-cli-xlsx-export-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe("exportToPdf for an open xlsx document", () => {
  it("writes a real PDF file, reusing the exact xlsxToPdf conversion the reducer already ran once to build the read-only preview", async () => {
    const bytes = xlsxTestBytes();
    const sourcePath = join(workspace, "source.xlsx");
    const destination = join(workspace, "source.pdf");
    const doc = openXlsxDocument(bytes, sourcePath);

    const diagnostics: unknown[] = [];
    await exportToPdf(doc, destination, {
      onDiagnostic: (diagnostic) => {
        diagnostics.push(diagnostic);
      },
    });

    const written = await readFile(destination);
    expect(new TextDecoder("latin1").decode(written.subarray(0, 5))).toBe(
      "%PDF-",
    );
  });

  it("re-derives the PDF from `doc.bytes` rather than reusing `doc.layout` computed at open time", async () => {
    // `doc.layout` here is deliberately built from a 400x500pt workbook while `doc.bytes` carries an 800x900pt one -- a state real open-document.ts never produces, but exactly the shape that isolates which field exportToPdf actually reads. If it ever regressed to `writePdf(doc.layout)` (or otherwise ignored `doc.bytes`), the exported PDF's page would come back 400x500pt, not 800x900pt.
    const smallBytes = xlsxTestBytesWithPageSize(400, 500);
    const largeBytes = xlsxTestBytesWithPageSize(800, 900);

    const mismatchedDoc: XlsxOpenDocument = {
      format: "xlsx",
      layout: readPdf(xlsxToPdf(smallBytes)),
      bytes: largeBytes,
      path: join(workspace, "workbook.xlsx"),
    };
    const destination = join(workspace, "workbook.pdf");
    await exportToPdf(mismatchedDoc, destination, {
      onDiagnostic: () => undefined,
    });

    const exportedPage = readPdf(new Uint8Array(await readFile(destination)))
      .pages[0];
    expect(exportedPage?.widthPt).toBeCloseTo(800, 0);
    expect(exportedPage?.heightPt).toBeCloseTo(900, 0);
  });
});
