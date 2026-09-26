import {
  createDoc,
  createOds,
  createOdt,
  createPdf,
  createPpt,
  createXls,
  odsToXlsx,
  openDoc,
  openOdt,
  openPpt,
  openXls,
  readPdf,
  xlsxToPdf,
} from "documents.js";
import { describe, expect, it } from "vitest";
import { appReducer, createInitialState } from "./reducer.js";
import type {
  AppState,
  CsvOpenDocument,
  EpubOpenDocument,
  OdbOpenDocument,
  RtfOpenDocument,
  SvgOpenDocument,
  WpdOpenDocument,
  XlsxOpenDocument,
} from "./types.js";
function xlsxTestBytes(): Uint8Array<ArrayBuffer> {
  const editor = createOds();
  const sheet = editor.addSheet("Sheet1");
  sheet.cell(0, 0).value = { kind: "string", value: "Total" };
  return odsToXlsx(editor.toBytes());
}

// Mirrors format/open-document.ts's own xlsx branch exactly, so these reducer tests exercise OPEN_FILE_SUCCESS/UNDO against the identical XlsxOpenDocument shape the real TUI produces.
function openXlsxDocument(
  bytes: Uint8Array<ArrayBuffer>,
  path = "/tmp/workbook.xlsx",
): AppState {
  return appReducer(createInitialState(), {
    type: "OPEN_FILE_SUCCESS",
    path,
    doc: { format: "xlsx", layout: readPdf(xlsxToPdf(bytes)), bytes, path },
  });
}

// A minimal document for each of UNDO's own read-only formats: odb carries no layout/bytes at all (see OdbOpenDocument's own doc comment), the other six share the identical read-only-preview shape XlsxOpenDocument above already builds, populated through a real PdfEditor rather than a hand-authored LayoutDocument literal — these tests only exercise UNDO's own per-format branch, never the layout content itself.
function readOnlyOpenDocument(
  format: "odb" | "xlsx" | "csv" | "svg" | "rtf" | "wpd" | "epub",
):
  | OdbOpenDocument
  | XlsxOpenDocument
  | CsvOpenDocument
  | SvgOpenDocument
  | RtfOpenDocument
  | WpdOpenDocument
  | EpubOpenDocument {
  if (format === "odb") {
    return {
      format: "odb",
      tables: [],
      forms: [],
      reports: [],
      path: "/tmp/database.odb",
    };
  }
  return {
    format,
    layout: createPdf().toLayoutDocument(),
    bytes: createPdf().toBytes(),
    path: `/tmp/source.${format}`,
  };
}

describe("appReducer xlsx (read-only PDF-preview) documents", () => {
  it("opens with a status message pointing at the export-pdf flow, unlike every other format", () => {
    const bytes = xlsxTestBytes();
    const opened = openXlsxDocument(bytes, "/tmp/report.xlsx");

    expect(opened.openDocument?.format).toBe("xlsx");
    expect(opened.stack.map((screen) => screen.kind)).toEqual(["pdfPageList"]);
    expect(opened.status?.severity).toBe("info");
    expect(opened.status?.text).toContain("read-only PDF preview");
    expect(opened.status?.text).toContain("export pdf");

    const docxOpened = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "docx",
    });
    expect(docxOpened.status?.text).not.toContain("read-only");
  });

  it("has no undo history, the same as odb (pdf gained a real live-view editor and undo history of its own — see the PDF mutations describe block below)", () => {
    const opened = openXlsxDocument(xlsxTestBytes());
    const undone = appReducer(opened, { type: "UNDO" });
    expect(undone.status?.severity).toBe("warning");
    expect(undone.status?.text).toContain("read-only");
    expect(undone.openDocument).toBe(opened.openDocument);
  });
});

// OPEN_FILE_SUCCESS's own "opened as a read-only PDF preview" note names all nine of these formats individually in its own OR-chain (xlsx is exercised separately above, through its own dedicated describe block) — each one needs its own dispatch to prove that exact branch, not just the shared behaviour the OR-chain produces once any one of them matches.
describe("appReducer OPEN_FILE_SUCCESS's read-only-PDF-preview note names every one of its own nine formats", () => {
  it.each([
    ["csv", () => readOnlyOpenDocument("csv")],
    ["svg", () => readOnlyOpenDocument("svg")],
    ["rtf", () => readOnlyOpenDocument("rtf")],
    ["wpd", () => readOnlyOpenDocument("wpd")],
    [
      "doc",
      () => ({
        format: "doc" as const,
        editor: openDoc(createDoc().toBytes()),
        path: "/tmp/legacy.doc",
      }),
    ],
    [
      "xls",
      () => ({
        format: "xls" as const,
        editor: openXls(createXls().toBytes()),
        path: "/tmp/legacy.xls",
      }),
    ],
    [
      "ppt",
      () => ({
        format: "ppt" as const,
        editor: openPpt(createPpt().toBytes()),
        path: "/tmp/legacy.ppt",
      }),
    ],
    ["epub", () => readOnlyOpenDocument("epub")],
  ] as const)(
    "names %s specifically in the preview note",
    (format, buildDoc) => {
      const doc = buildDoc();
      const opened = appReducer(createInitialState(), {
        type: "OPEN_FILE_SUCCESS",
        path: doc.path,
        doc,
      });
      expect(opened.status?.text).toBe(
        `Opened ${doc.path} as a read-only PDF preview — press ':' then 'export pdf' to save it as a real PDF`,
      );
    },
  );

  it("does not add the preview note for a format with a real live-view editor of its own", () => {
    const opened = appReducer(createInitialState(), {
      type: "OPEN_FILE_SUCCESS",
      path: "/tmp/notes.odt",
      doc: {
        format: "odt",
        editor: openOdt(createOdt().toBytes()),
        path: "/tmp/notes.odt",
      },
    });
    expect(opened.status?.text).toBe("Opened /tmp/notes.odt");
  });
});

// A minimal real fixture: one page, one text item — built through the real PdfEditor (createPdf/appendText), never a hand-authored LayoutDocument literal, so these tests exercise the exact writer/reader pair the reducer wires against.
