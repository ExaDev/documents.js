import {
  createDoc,
  createOdg,
  createOdp,
  createOds,
  createOdt,
  createPdf,
  createPpt,
  createPptx,
  createXls,
  drawingOfBlock,
  formulaOfBlock,
  type MathMlNode,
  odsToXlsx,
  openDoc,
  openDocx,
  openMarkdown,
  openOdg,
  openOdp,
  openOds,
  openOdt,
  openPdf,
  openPpt,
  openPptx,
  openXls,
  readDocxContent,
  readOdpContent,
  readOdsContent,
  readOdtContent,
  readPdf,
  readPptxContent,
  xlsxToPdf,
} from "documents.js";
import { describe, expect, it } from "vitest";
import type { Action } from "./actions.js";
import { appReducer, createInitialState } from "./reducer.js";
import type {
  AppState,
  CsvOpenDocument,
  DocOpenDocument,
  DocxOpenDocument,
  EpubOpenDocument,
  MarkdownOpenDocument,
  OdbOpenDocument,
  OdgOpenDocument,
  OdpOpenDocument,
  OdsOpenDocument,
  OdtOpenDocument,
  PdfOpenDocument,
  PptxOpenDocument,
  RtfOpenDocument,
  SvgOpenDocument,
  WpdOpenDocument,
  XlsxOpenDocument,
} from "./types.js";
import { isEditableDocument } from "./types.js";

// A real, minimal PNG -- the signature bytes plus a few arbitrary trailing ones, matching docx/paragraph-detail.test.tsx's own fixture. ADD_SHEET_IMAGE only stores/embeds these bytes and declares the media part's type from the caller's own explicit `format`, so a genuine decodable pixel grid is not needed to prove the round trip.
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
]);

// A genuinely decodable 1x1 red PNG (real IHDR/IDAT/IEND chunks, truecolor, no filter). Unlike PNG_BYTES above, PdfPage.appendImage -> registerImageBytes DOES decode the pixel grid (to size the image asset it registers), so a fake signature-only PNG throws "PNG file does not begin with an IHDR chunk" here.
const REAL_PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02,
  0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44,
  0x41, 0x54, 0x78, 0xda, 0x63, 0xf8, 0xcf, 0xc0, 0x00, 0x00, 0x03, 0x01, 0x01,
  0x00, 0xf7, 0x03, 0x41, 0x43, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
  0xae, 0x42, 0x60, 0x82,
]);

function applyAll(
  actions: readonly Action[],
  from: AppState = createInitialState(),
): AppState {
  return actions.reduce<AppState>(appReducer, from);
}

function docxDocument(state: AppState): DocxOpenDocument {
  const doc = state.openDocument;
  if (doc?.format !== "docx") {
    throw new Error("expected an open docx document");
  }
  return doc;
}

function docDocument(state: AppState): DocOpenDocument {
  const doc = state.openDocument;
  if (doc?.format !== "doc") {
    throw new Error("expected an open doc document");
  }
  return doc;
}

function odsDocument(state: AppState): OdsOpenDocument {
  const doc = state.openDocument;
  if (doc?.format !== "ods") {
    throw new Error("expected an open ods document");
  }
  return doc;
}

function pptxDocument(state: AppState): PptxOpenDocument {
  const doc = state.openDocument;
  if (doc?.format !== "pptx") {
    throw new Error("expected an open pptx document");
  }
  return doc;
}

function odpDocument(state: AppState): OdpOpenDocument {
  const doc = state.openDocument;
  if (doc?.format !== "odp") {
    throw new Error("expected an open odp document");
  }
  return doc;
}

function odtDocument(state: AppState): OdtOpenDocument {
  const doc = state.openDocument;
  if (doc?.format !== "odt") {
    throw new Error("expected an open odt document");
  }
  return doc;
}

function odgDocument(state: AppState): OdgOpenDocument {
  const doc = state.openDocument;
  if (doc?.format !== "odg") {
    throw new Error("expected an open odg document");
  }
  return doc;
}

function pdfDocument(state: AppState): PdfOpenDocument {
  const doc = state.openDocument;
  if (doc?.format !== "pdf") {
    throw new Error("expected an open pdf document");
  }
  return doc;
}

function openPptxDocument(
  bytes: Uint8Array<ArrayBuffer>,
  path = "/tmp/deck.pptx",
): AppState {
  return appReducer(createInitialState(), {
    type: "OPEN_FILE_SUCCESS",
    path,
    doc: { format: "pptx", editor: openPptx(bytes), path },
  });
}

function openOdpDocument(
  bytes: Uint8Array<ArrayBuffer>,
  path = "/tmp/deck.odp",
): AppState {
  return appReducer(createInitialState(), {
    type: "OPEN_FILE_SUCCESS",
    path,
    doc: { format: "odp", editor: openOdp(bytes), path },
  });
}

function openOdtDocument(
  bytes: Uint8Array<ArrayBuffer>,
  path = "/tmp/doc.odt",
): AppState {
  return appReducer(createInitialState(), {
    type: "OPEN_FILE_SUCCESS",
    path,
    doc: { format: "odt", editor: openOdt(bytes), path },
  });
}

function openOdsDocument(
  bytes: Uint8Array<ArrayBuffer>,
  path = "/tmp/workbook.ods",
): AppState {
  return appReducer(createInitialState(), {
    type: "OPEN_FILE_SUCCESS",
    path,
    doc: { format: "ods", editor: openOds(bytes), path },
  });
}

function openOdgDocument(
  bytes: Uint8Array<ArrayBuffer>,
  path = "/tmp/drawing.odg",
): AppState {
  return appReducer(createInitialState(), {
    type: "OPEN_FILE_SUCCESS",
    path,
    doc: { format: "odg", editor: openOdg(bytes), path },
  });
}

function openPdfDocument(
  bytes: Uint8Array<ArrayBuffer>,
  path = "/tmp/document.pdf",
): AppState {
  const editor = openPdf(bytes);
  return appReducer(createInitialState(), {
    type: "OPEN_FILE_SUCCESS",
    path,
    doc: { format: "pdf", editor, layout: editor.toLayoutDocument(), path },
  });
}

function openDocDocument(
  bytes: Uint8Array<ArrayBuffer>,
  path = "/tmp/legacy.doc",
): AppState {
  return appReducer(createInitialState(), {
    type: "OPEN_FILE_SUCCESS",
    path,
    doc: { format: "doc", editor: openDoc(bytes), path },
  });
}

function openXlsDocument(
  bytes: Uint8Array<ArrayBuffer>,
  path = "/tmp/legacy.xls",
): AppState {
  return appReducer(createInitialState(), {
    type: "OPEN_FILE_SUCCESS",
    path,
    doc: { format: "xls", editor: openXls(bytes), path },
  });
}

function openPptDocument(
  bytes: Uint8Array<ArrayBuffer>,
  path = "/tmp/legacy.ppt",
): AppState {
  return appReducer(createInitialState(), {
    type: "OPEN_FILE_SUCCESS",
    path,
    doc: { format: "ppt", editor: openPpt(bytes), path },
  });
}

// Real xlsx bytes with no XlsxEditor to build one directly: createOds() -> odsToXlsx() is documents.js's own PDF-bypassing bridge, reused here purely as a source of genuine xlsx bytes for the reducer tests below.
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

// A minimal document for each of UNDO's own read-only formats: odb carries no layout/bytes at all (see OdbOpenDocument's own doc comment), the other six share the identical read-only-preview shape XlsxOpenDocument above already builds, populated through a real PdfEditor rather than a hand-authored LayoutDocument literal -- these tests only exercise UNDO's own per-format branch, never the layout content itself.
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

function markdownDocument(state: AppState): MarkdownOpenDocument {
  const doc = state.openDocument;
  if (doc?.format !== "markdown") {
    throw new Error("expected an open markdown document");
  }
  return doc;
}

// A MarkdownOpenDocument seeded from real source text (as opposed to CREATE_DOCUMENT's fresh, empty one -- see the "creates a new markdown document" test below) via OPEN_FILE_SUCCESS, the same action openDocumentAtPath's own real caller dispatches, with a genuine live-view MarkdownEditor built via openMarkdown -- the same one open-document.ts's own markdown branch builds.
function openMarkdownDocument(
  source: string,
  path = "/tmp/notes.md",
): AppState {
  return appReducer(createInitialState(), {
    type: "OPEN_FILE_SUCCESS",
    path,
    doc: {
      format: "markdown",
      editor: openMarkdown(source),
      originalText: source,
      path,
    },
  });
}

describe("appReducer navigation", () => {
  it("pushes, pops and resets the screen stack, never emptying it", () => {
    const pushed = applyAll([
      { type: "PUSH_SCREEN", screen: { kind: "bodyList" } },
      {
        type: "PUSH_SCREEN",
        screen: { kind: "paragraphDetail", blockIndex: 2 },
      },
    ]);
    expect(pushed.stack.map((screen) => screen.kind)).toEqual([
      "launcher",
      "bodyList",
      "paragraphDetail",
    ]);

    const popped = applyAll(
      [{ type: "POP_SCREEN" }, { type: "POP_SCREEN" }, { type: "POP_SCREEN" }],
      pushed,
    );
    expect(popped.stack.map((screen) => screen.kind)).toEqual(["launcher"]);

    const reset = appReducer(pushed, {
      type: "RESET_STACK",
      screen: { kind: "slideList" },
    });
    expect(reset.stack.map((screen) => screen.kind)).toEqual(["slideList"]);
  });

  it("quits straight away with nothing unsaved and asks first when there is", () => {
    expect(
      appReducer(createInitialState(), { type: "REQUEST_QUIT" }).isExiting,
    ).toBe(true);

    const dirty = applyAll([
      { type: "CREATE_DOCUMENT", format: "docx" },
      {
        type: "APPEND_PARAGRAPH",
        text: "x",
        styleId: undefined,
        alignment: undefined,
      },
    ]);
    const asked = appReducer(dirty, { type: "REQUEST_QUIT" });
    expect(asked.overlays.confirmQuit).toBe(true);
    expect(asked.isExiting).toBe(false);
    expect(appReducer(asked, { type: "CONFIRM_QUIT" }).isExiting).toBe(true);
  });
});

describe("appReducer document lifecycle", () => {
  it("lands a newly created document on its own format root screen", () => {
    const cases: readonly [Action & { type: "CREATE_DOCUMENT" }, string][] = [
      [{ type: "CREATE_DOCUMENT", format: "docx" }, "bodyList"],
      [{ type: "CREATE_DOCUMENT", format: "odp" }, "slideList"],
      [{ type: "CREATE_DOCUMENT", format: "ods" }, "sheetList"],
      [{ type: "CREATE_DOCUMENT", format: "odg" }, "pageList"],
      [{ type: "CREATE_DOCUMENT", format: "markdown" }, "bodyList"],
    ];
    for (const [action, expectedKind] of cases) {
      const state = appReducer(createInitialState(), action);
      expect(state.stack.map((screen) => screen.kind)).toEqual([expectedKind]);
      expect(state.openDocument?.format).toBe(action.format);
      expect(state.hasUnsavedChanges).toBe(false);
    }
  });

  it("creates a new markdown document with a genuine live-view editor and no original text to compare against", () => {
    const state = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "markdown",
    });
    const doc = markdownDocument(state);
    expect(doc.originalText).toBeUndefined();
    expect(doc.path).toBeUndefined();

    // Genuinely live: mutating through the editor is visible without any further dispatch, exactly as CREATE_DOCUMENT's own docx/odt/... branches already are.
    doc.editor.body.appendParagraph({ text: "Hello" });
    expect(doc.editor.toMarkdownText()).toContain("Hello");
  });

  it("clears the document and history on close", () => {
    const closed = applyAll([
      { type: "CREATE_DOCUMENT", format: "docx" },
      {
        type: "APPEND_PARAGRAPH",
        text: "x",
        styleId: undefined,
        alignment: undefined,
      },
      { type: "CLOSE_DOCUMENT" },
    ]);
    expect(closed.openDocument).toBeUndefined();
    expect(closed.undoStack).toEqual([]);
    expect(closed.hasUnsavedChanges).toBe(false);
    expect(closed.stack.map((screen) => screen.kind)).toEqual(["launcher"]);
  });
});

describe("appReducer SAVE_SUCCESS", () => {
  it("says so when there is no open document to record the path against", () => {
    const result = appReducer(createInitialState(), {
      type: "SAVE_SUCCESS",
      path: "/tmp/orphan.docx",
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.hasUnsavedChanges).toBe(false);
  });

  // documentWithPath's own read-only-preview branches (xlsx/csv/svg/rtf) are otherwise never reached by any other action -- SAVE_AS on one of these formats is the only path that dispatches SAVE_SUCCESS against them, so this proves the layout/bytes pair survives the rewrite untouched alongside the new path.
  it("updates a read-only preview document's own path while keeping its layout and bytes untouched", () => {
    const bytes = xlsxTestBytes();
    const layout = readPdf(xlsxToPdf(bytes));
    const cases: readonly ["xlsx" | "csv" | "svg" | "rtf", string][] = [
      ["xlsx", "/tmp/renamed.xlsx"],
      ["csv", "/tmp/renamed.csv"],
      ["svg", "/tmp/renamed.svg"],
      ["rtf", "/tmp/renamed.rtf"],
    ];
    for (const [format, newPath] of cases) {
      const opened = appReducer(createInitialState(), {
        type: "OPEN_FILE_SUCCESS",
        path: "/tmp/original",
        doc: { format, layout, bytes, path: "/tmp/original" },
      });
      const saved = appReducer(opened, {
        type: "SAVE_SUCCESS",
        path: newPath,
      });
      const doc = saved.openDocument;
      if (doc?.format !== format) {
        throw new Error(`expected a ${format} document, got ${doc?.format}`);
      }
      expect(doc.path).toBe(newPath);
      expect(doc.layout).toBe(layout);
      expect(doc.bytes).toBe(bytes);
      expect(saved.hasUnsavedChanges).toBe(false);
    }
  });
});

describe("appReducer OPEN_OVERLAY / CLOSE_OVERLAY", () => {
  it("opens and closes the confirmClose overlay without touching any other overlay", () => {
    const opened = appReducer(createInitialState(), {
      type: "OPEN_OVERLAY",
      overlay: "confirmClose",
    });
    expect(opened.overlays.confirmClose).toBe(true);
    expect(opened.overlays.confirmQuit).toBe(false);

    const closed = appReducer(opened, {
      type: "CLOSE_OVERLAY",
      overlay: "confirmClose",
    });
    expect(closed.overlays.confirmClose).toBe(false);
  });
});

describe("appReducer REQUEST_CLOSE / CONFIRM_CLOSE / CANCEL_CLOSE", () => {
  it("says so when there is no open document to close", () => {
    const result = appReducer(createInitialState(), { type: "REQUEST_CLOSE" });
    expect(result.status?.severity).toBe("info");
  });

  it("closes immediately, with no confirmation overlay, when there are no unsaved changes", () => {
    const created = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "docx",
    });
    const requested = appReducer(created, { type: "REQUEST_CLOSE" });
    expect(requested.openDocument).toBeUndefined();
    expect(requested.overlays.confirmClose).toBe(false);
  });

  it("opens the confirmClose overlay instead of closing outright when there are unsaved changes", () => {
    const edited = applyAll([
      { type: "CREATE_DOCUMENT", format: "docx" },
      {
        type: "APPEND_PARAGRAPH",
        text: "x",
        styleId: undefined,
        alignment: undefined,
      },
    ]);
    const requested = appReducer(edited, { type: "REQUEST_CLOSE" });
    expect(requested.overlays.confirmClose).toBe(true);
    expect(requested.openDocument).toBeDefined();
  });

  it("CONFIRM_CLOSE closes the document and its own confirmation overlay together", () => {
    const edited = applyAll([
      { type: "CREATE_DOCUMENT", format: "docx" },
      {
        type: "APPEND_PARAGRAPH",
        text: "x",
        styleId: undefined,
        alignment: undefined,
      },
      { type: "REQUEST_CLOSE" },
    ]);
    expect(edited.overlays.confirmClose).toBe(true);

    const confirmed = appReducer(edited, { type: "CONFIRM_CLOSE" });
    expect(confirmed.openDocument).toBeUndefined();
    expect(confirmed.overlays.confirmClose).toBe(false);
  });

  it("CANCEL_CLOSE dismisses the overlay and keeps the document open with its edits intact", () => {
    const edited = applyAll([
      { type: "CREATE_DOCUMENT", format: "docx" },
      {
        type: "APPEND_PARAGRAPH",
        text: "x",
        styleId: undefined,
        alignment: undefined,
      },
      { type: "REQUEST_CLOSE" },
    ]);

    const cancelled = appReducer(edited, { type: "CANCEL_CLOSE" });
    expect(cancelled.overlays.confirmClose).toBe(false);
    expect(cancelled.openDocument).toBe(edited.openDocument);
    expect(cancelled.hasUnsavedChanges).toBe(true);
  });
});

describe("appReducer SET_METADATA", () => {
  it("patches a real docx document's metadata through the live editor.metadata setter", () => {
    const created = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "docx",
    });
    const edited = appReducer(created, {
      type: "SET_METADATA",
      overrides: { title: "A real title", author: "Ada Lovelace" },
    });
    expect(edited.hasUnsavedChanges).toBe(true);
    expect(docxDocument(edited).editor.metadata.title).toBe("A real title");
    expect(docxDocument(edited).editor.metadata.author).toBe("Ada Lovelace");
  });

  it("patches a real odt document's metadata too, matching MetadataOverrides across every editable format", () => {
    const created = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "odt",
    });
    const edited = appReducer(created, {
      type: "SET_METADATA",
      overrides: { subject: "A subject" },
    });
    expect(edited.hasUnsavedChanges).toBe(true);
    expect(odtDocument(edited).editor.metadata.subject).toBe("A subject");
  });

  it("only overwrites the fields explicitly present, leaving the rest untouched (partial-merge semantics)", () => {
    const created = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "docx",
    });
    const first = appReducer(created, {
      type: "SET_METADATA",
      overrides: { title: "First title", author: "Original author" },
    });
    const second = appReducer(first, {
      type: "SET_METADATA",
      overrides: { title: "Second title" },
    });
    expect(docxDocument(second).editor.metadata.title).toBe("Second title");
    expect(docxDocument(second).editor.metadata.author).toBe("Original author");
  });

  it("warns instead of mutating when there is no open document", () => {
    const result = appReducer(createInitialState(), {
      type: "SET_METADATA",
      overrides: { title: "x" },
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.hasUnsavedChanges).toBe(false);
  });
});

describe("appReducer docx mutations", () => {
  it("toggles a real run bold through the live editor and marks the document dirty", () => {
    const state = applyAll([
      { type: "CREATE_DOCUMENT", format: "docx" },
      {
        type: "APPEND_PARAGRAPH",
        text: undefined,
        styleId: undefined,
        alignment: undefined,
      },
      { type: "APPEND_RUN", blockIndex: 0, text: "Hello" },
    ]);

    const doc = docxDocument(state);
    const paragraph = doc.editor.paragraphs()[0];
    if (paragraph === undefined) {
      throw new Error("expected an appended paragraph");
    }
    const run = paragraph.runs()[0];
    if (run === undefined) {
      throw new Error("expected an appended run");
    }
    expect(run.bold).toBe(false);

    const bolded = appReducer(state, {
      type: "TOGGLE_RUN_BOLD",
      blockIndex: 0,
      runIndex: 0,
    });
    expect(bolded.hasUnsavedChanges).toBe(true);
    expect(bolded).not.toBe(state);
    // The live view means the run object captured before the action already reflects the mutation -- there is no new object to re-read.
    expect(run.bold).toBe(true);

    const unbolded = appReducer(bolded, {
      type: "TOGGLE_RUN_BOLD",
      blockIndex: 0,
      runIndex: 0,
    });
    expect(run.bold).toBe(false);
    expect(unbolded.hasUnsavedChanges).toBe(true);
  });

  it("reports a missing run rather than throwing", () => {
    const state = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "docx",
    });
    const missed = appReducer(state, {
      type: "TOGGLE_RUN_BOLD",
      blockIndex: 7,
      runIndex: 0,
    });
    expect(missed.status?.severity).toBe("warning");
    expect(missed.status?.text).toBe("There is no paragraph at index 7");
    expect(missed.hasUnsavedChanges).toBe(false);
  });

  it("warns instead of mutating when the open document is the wrong format", () => {
    const state = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "ods",
    });
    const warned = appReducer(state, {
      type: "APPEND_PARAGRAPH",
      text: "x",
      styleId: undefined,
      alignment: undefined,
    });
    expect(warned.status?.severity).toBe("warning");
    expect(warned.hasUnsavedChanges).toBe(false);
  });
});

describe.each(["docx", "odt"] as const)(
  "appReducer SET_RUN_FONT_FAMILY / SET_RUN_FONT_SIZE on %s",
  (format) => {
    it("sets a real font family and size through the live DocxRun/OdtRun setters, verified by re-decoding the package", () => {
      const state = applyAll([
        { type: "CREATE_DOCUMENT", format },
        {
          type: "APPEND_PARAGRAPH",
          text: undefined,
          styleId: undefined,
          alignment: undefined,
        },
        { type: "APPEND_RUN", blockIndex: 0, text: "Hello" },
      ]);

      const withFamily = appReducer(state, {
        type: "SET_RUN_FONT_FAMILY",
        blockIndex: 0,
        runIndex: 0,
        fontFamily: "Georgia",
      });
      const withSize = appReducer(withFamily, {
        type: "SET_RUN_FONT_SIZE",
        blockIndex: 0,
        runIndex: 0,
        sizePt: 18,
      });
      expect(withSize.hasUnsavedChanges).toBe(true);

      const doc = state.openDocument;
      if (doc?.format !== format) {
        throw new Error(`expected an open ${format} document`);
      }
      const content =
        format === "docx"
          ? readDocxContent(doc.editor.toPackage())
          : readOdtContent(doc.editor.toPackage());
      if (content.kind !== "wordprocessing") {
        throw new Error(
          `expected a wordprocessing ContentDocument, got ${content.kind}`,
        );
      }
      const paragraph = content.sections[0]?.blocks[0];
      if (paragraph?.kind !== "paragraph") {
        throw new Error(`expected a paragraph block, got ${paragraph?.kind}`);
      }
      expect(paragraph.runs[0]?.fontFamily).toBe("Georgia");
      expect(paragraph.runs[0]?.sizePt).toBe(18);
    });

    it("reports a missing run rather than throwing", () => {
      const state = appReducer(createInitialState(), {
        type: "CREATE_DOCUMENT",
        format,
      });
      const missed = appReducer(state, {
        type: "SET_RUN_FONT_FAMILY",
        blockIndex: 7,
        runIndex: 0,
        fontFamily: "Georgia",
      });
      expect(missed.status?.severity).toBe("warning");
      expect(missed.status?.text).toBe("There is no paragraph at index 7");
      expect(missed.hasUnsavedChanges).toBe(false);
    });
  },
);

describe("appReducer APPEND_TABLE and MERGE_TABLE_CELLS on docx/odt", () => {
  it("appends a real docx table with cells pre-merged in one pass, verified through readDocxContent", () => {
    const created = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "docx",
    });
    const withTable = appReducer(created, {
      type: "APPEND_TABLE",
      rows: 3,
      columns: 3,
      merge: { startRow: 0, startColumn: 0, rowSpan: 2, colSpan: 2 },
    });
    expect(withTable.hasUnsavedChanges).toBe(true);

    const content = readDocxContent(docxDocument(withTable).editor.toPackage());
    if (content.kind !== "wordprocessing") {
      throw new Error(
        `expected a wordprocessing ContentDocument, got ${content.kind}`,
      );
    }
    const tableBlock = content.sections[0]?.blocks[0];
    if (tableBlock?.kind !== "table") {
      throw new Error(`expected a table block, got ${tableBlock?.kind}`);
    }
    const anchor = tableBlock.rows[0]?.cells[0];
    expect(anchor?.colSpan).toBe(2);
    expect(anchor?.rowSpan).toBe(2);
    // docx collapses a horizontal merge into one real w:tc -- row 0 now has 2 real cells (the merged one plus the untouched third column), not 3.
    expect(tableBlock.rows[0]?.cells).toHaveLength(2);
  });

  it("appends a real odt table with cells pre-merged in one pass, verified through readOdtContent", () => {
    const created = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "odt",
    });
    const withTable = appReducer(created, {
      type: "APPEND_TABLE",
      rows: 3,
      columns: 3,
      merge: { startRow: 0, startColumn: 0, rowSpan: 2, colSpan: 2 },
    });
    expect(withTable.hasUnsavedChanges).toBe(true);

    const content = readOdtContent(odtDocument(withTable).editor.toPackage());
    if (content.kind !== "wordprocessing") {
      throw new Error(
        `expected a wordprocessing ContentDocument, got ${content.kind}`,
      );
    }
    const tableBlock = content.sections[0]?.blocks[0];
    if (tableBlock?.kind !== "table") {
      throw new Error(`expected a table block, got ${tableBlock?.kind}`);
    }
    const anchor = tableBlock.rows[0]?.cells[0];
    expect(anchor?.colSpan).toBe(2);
    expect(anchor?.rowSpan).toBe(2);
    // ODF always writes one real (possibly covered) cell per grid position, unlike docx -- row 0 still has all 3 columns.
    expect(tableBlock.rows[0]?.cells).toHaveLength(3);
  });

  it("appends a plain docx table with no merge field at all, unchanged from before this feature existed", () => {
    const created = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "docx",
    });
    const withTable = appReducer(created, {
      type: "APPEND_TABLE",
      rows: 2,
      columns: 2,
    });
    expect(withTable.hasUnsavedChanges).toBe(true);
    const table = docxDocument(withTable).editor.tables()[0];
    expect(table?.rows()).toHaveLength(2);
    expect(table?.rows()[0]?.cells()).toHaveLength(2);
  });

  it("merges cells in an already-built docx table after the fact (retrofit), verified through readDocxContent", () => {
    const built = applyAll([
      { type: "CREATE_DOCUMENT", format: "docx" },
      { type: "APPEND_TABLE", rows: 3, columns: 3 },
    ]);
    const merged = appReducer(built, {
      type: "MERGE_TABLE_CELLS",
      tableIndex: 0,
      startRow: 1,
      startColumn: 1,
      rowSpan: 2,
      colSpan: 2,
    });
    expect(merged.hasUnsavedChanges).toBe(true);

    const content = readDocxContent(docxDocument(merged).editor.toPackage());
    if (content.kind !== "wordprocessing") {
      throw new Error(
        `expected a wordprocessing ContentDocument, got ${content.kind}`,
      );
    }
    const tableBlock = content.sections[0]?.blocks[0];
    if (tableBlock?.kind !== "table") {
      throw new Error(`expected a table block, got ${tableBlock?.kind}`);
    }
    const anchor = tableBlock.rows[1]?.cells[1];
    expect(anchor?.colSpan).toBe(2);
    expect(anchor?.rowSpan).toBe(2);

    // Round-trips through re-decoding the package as a completely fresh docx, not just the live in-memory object.
    const reopenedContent = readDocxContent(
      openDocx(docxDocument(merged).editor.toBytes()).toPackage(),
    );
    if (reopenedContent.kind !== "wordprocessing") {
      throw new Error(
        `expected a wordprocessing ContentDocument, got ${reopenedContent.kind}`,
      );
    }
    const reopenedTable = reopenedContent.sections[0]?.blocks[0];
    if (reopenedTable?.kind !== "table") {
      throw new Error(`expected a table block, got ${reopenedTable?.kind}`);
    }
    expect(reopenedTable.rows[1]?.cells[1]?.colSpan).toBe(2);
    expect(reopenedTable.rows[1]?.cells[1]?.rowSpan).toBe(2);
  });

  it("merges cells in an already-built odt table after the fact (retrofit), verified through readOdtContent", () => {
    const built = applyAll([
      { type: "CREATE_DOCUMENT", format: "odt" },
      { type: "APPEND_TABLE", rows: 3, columns: 3 },
    ]);
    const merged = appReducer(built, {
      type: "MERGE_TABLE_CELLS",
      tableIndex: 0,
      startRow: 1,
      startColumn: 1,
      rowSpan: 2,
      colSpan: 2,
    });
    expect(merged.hasUnsavedChanges).toBe(true);

    const content = readOdtContent(odtDocument(merged).editor.toPackage());
    if (content.kind !== "wordprocessing") {
      throw new Error(
        `expected a wordprocessing ContentDocument, got ${content.kind}`,
      );
    }
    const tableBlock = content.sections[0]?.blocks[0];
    if (tableBlock?.kind !== "table") {
      throw new Error(`expected a table block, got ${tableBlock?.kind}`);
    }
    const anchor = tableBlock.rows[1]?.cells[1];
    expect(anchor?.colSpan).toBe(2);
    expect(anchor?.rowSpan).toBe(2);
  });

  it("surfaces a thrown merge error as a warning status instead of crashing (APPEND_TABLE with an out-of-range merge)", () => {
    const created = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "docx",
    });
    const result = appReducer(created, {
      type: "APPEND_TABLE",
      rows: 2,
      columns: 2,
      merge: { startRow: 0, startColumn: 0, rowSpan: 5, colSpan: 2 },
    });
    expect(result.status?.severity).toBe("warning");
  });

  it("surfaces a thrown merge error as a warning status instead of crashing (MERGE_TABLE_CELLS out of range)", () => {
    const built = applyAll([
      { type: "CREATE_DOCUMENT", format: "docx" },
      { type: "APPEND_TABLE", rows: 2, columns: 2 },
    ]);
    const result = appReducer(built, {
      type: "MERGE_TABLE_CELLS",
      tableIndex: 0,
      startRow: 0,
      startColumn: 0,
      rowSpan: 5,
      colSpan: 2,
    });
    expect(result.status?.severity).toBe("warning");
  });

  it("warns rather than crashing for a table index that does not exist", () => {
    const created = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "docx",
    });
    const result = appReducer(created, {
      type: "MERGE_TABLE_CELLS",
      tableIndex: 3,
      startRow: 0,
      startColumn: 0,
      rowSpan: 1,
      colSpan: 1,
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.hasUnsavedChanges).toBe(false);
  });
});

describe("appReducer SET_LIST_ITEM_TEXT on odt", () => {
  it("replaces a real list item's text and the change round-trips through re-decoding the package", () => {
    const editor = createOdt();
    const list = editor.body.appendList();
    list.addItem().appendParagraph({ text: "first" });
    list.addItem().appendParagraph({ text: "second" });
    const opened = openOdtDocument(editor.toBytes());
    const blockIndex = odtDocument(opened).editor.lists().length - 1;

    const edited = appReducer(opened, {
      type: "SET_LIST_ITEM_TEXT",
      blockIndex,
      itemIndex: 1,
      text: "SECOND, EDITED",
    });
    expect(edited.hasUnsavedChanges).toBe(true);
    const items = odtDocument(edited).editor.lists()[blockIndex]?.items();
    expect(items?.[0]?.text).toBe("first");
    expect(items?.[1]?.text).toBe("SECOND, EDITED");

    // Re-decoding the saved bytes as a completely fresh package proves the edit was written into the real text:list-item tree, not just held on the live in-memory object.
    const reopened = openOdt(odtDocument(edited).editor.toBytes());
    const reopenedItems = reopened.lists()[blockIndex]?.items();
    expect(reopenedItems?.[0]?.text).toBe("first");
    expect(reopenedItems?.[1]?.text).toBe("SECOND, EDITED");
  });

  it("warns rather than crashing for a list index that does not exist", () => {
    const editor = createOdt();
    editor.body.appendList().addItem().appendParagraph({ text: "only" });
    const opened = openOdtDocument(editor.toBytes());

    const result = appReducer(opened, {
      type: "SET_LIST_ITEM_TEXT",
      blockIndex: 5,
      itemIndex: 0,
      text: "x",
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.hasUnsavedChanges).toBe(false);
  });

  it("warns rather than crashing for an item index that does not exist", () => {
    const editor = createOdt();
    const list = editor.body.appendList();
    list.addItem().appendParagraph({ text: "only" });
    const opened = openOdtDocument(editor.toBytes());
    const blockIndex = odtDocument(opened).editor.lists().length - 1;

    const result = appReducer(opened, {
      type: "SET_LIST_ITEM_TEXT",
      blockIndex,
      itemIndex: 3,
      text: "x",
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.hasUnsavedChanges).toBe(false);
  });

  it("warns instead of mutating when the open document is docx (lists are an odt-only concept)", () => {
    const state = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "docx",
    });
    const warned = appReducer(state, {
      type: "SET_LIST_ITEM_TEXT",
      blockIndex: 0,
      itemIndex: 0,
      text: "x",
    });
    expect(warned.status?.severity).toBe("warning");
    expect(warned.hasUnsavedChanges).toBe(false);
  });
});

describe("appReducer ADD_LIST_ITEM on docx", () => {
  // docx (and markdown) have no separate "list" object the way odt does -- list membership is flat per-paragraph metadata, so ADD_LIST_ITEM's own docx/markdown branch appends a brand-new paragraph and copies the anchor paragraph's own ContentListMembership onto it, rather than extending an OdtList (the odt branch this file's own "ADD_LIST on odt"/"INDENT_LIST_ITEM on odt" describe blocks already cover).
  it("appends a new paragraph copying the anchor paragraph's own list membership", () => {
    const created = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "docx",
    });
    const doc = docxDocument(created);
    const anchor = doc.editor.body.appendParagraph({ text: "First item" });
    anchor.list = { level: 0, numId: "7" };
    const anchorIndex = doc.editor.paragraphs().length - 1;

    const added = appReducer(created, {
      type: "ADD_LIST_ITEM",
      blockIndex: anchorIndex,
      text: "Second item",
    });

    const paragraphs = docxDocument(added).editor.paragraphs();
    const appended = paragraphs[paragraphs.length - 1];
    expect(appended?.text).toBe("Second item");
    expect(appended?.list).toStrictEqual({ level: 0, numId: "7" });
    expect(added.hasUnsavedChanges).toBe(true);
  });

  it("warns rather than crashing when blockIndex names no paragraph", () => {
    const created = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "docx",
    });

    const result = appReducer(created, {
      type: "ADD_LIST_ITEM",
      blockIndex: 999,
      text: "x",
    });

    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toContain("no paragraph");
    expect(result.hasUnsavedChanges).toBe(false);
  });

  it("warns rather than crashing when the anchor paragraph is not part of a list", () => {
    const created = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "docx",
    });
    const doc = docxDocument(created);
    doc.editor.body.appendParagraph({ text: "Not a list item" });
    const anchorIndex = doc.editor.paragraphs().length - 1;

    const result = appReducer(created, {
      type: "ADD_LIST_ITEM",
      blockIndex: anchorIndex,
      text: "x",
    });

    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toContain("not part of a list");
    expect(result.hasUnsavedChanges).toBe(false);
  });
});

describe("appReducer ADD_LIST on odt", () => {
  it("creates a real, brand-new, empty list, navigable through the existing listEditor screen", () => {
    const created = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "odt",
    });
    const withList = appReducer(created, { type: "ADD_LIST" });
    expect(withList.hasUnsavedChanges).toBe(true);

    const doc = odtDocument(withList);
    expect(doc.editor.lists()).toHaveLength(1);

    // Round-trips through re-decoding the package as a completely fresh document, not just the live in-memory object -- proving OdtBody.appendList() wrote a real, empty text:list, exactly the shape the listEditor screen's own 'a' (ADD_LIST_ITEM) then extends.
    const reopened = openOdt(doc.editor.toBytes());
    expect(reopened.lists()).toHaveLength(1);
    expect(reopened.lists()[0]?.items()).toHaveLength(0);

    // A second ADD_LIST appends a second list rather than replacing the first -- the new list's own index (adapter.lists().length computed before dispatch, per paragraph-family.tsx's own 'L' handler) is what a caller navigates the freshly pushed listEditor screen to.
    const withSecondList = appReducer(withList, { type: "ADD_LIST" });
    expect(odtDocument(withSecondList).editor.lists()).toHaveLength(2);
  });

  it("warns instead of mutating when the open document is docx (lists are an odt-only concept)", () => {
    const state = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "docx",
    });
    const result = appReducer(state, { type: "ADD_LIST" });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toContain("odt");
    expect(result.hasUnsavedChanges).toBe(false);
  });
});

describe("appReducer INDENT_LIST_ITEM on odt", () => {
  it("nests a real item under its preceding sibling and the change round-trips through re-decoding the package", () => {
    const editor = createOdt();
    const list = editor.body.appendList();
    list.addItem().appendParagraph({ text: "first" });
    list.addItem().appendParagraph({ text: "second" });
    const opened = openOdtDocument(editor.toBytes());
    const blockIndex = odtDocument(opened).editor.lists().length - 1;

    const indented = appReducer(opened, {
      type: "INDENT_LIST_ITEM",
      blockIndex,
      itemIndex: 1,
    });
    expect(indented.hasUnsavedChanges).toBe(true);
    const doc = odtDocument(indented);
    const list0 = doc.editor.lists()[blockIndex];
    expect(list0?.items().map((i) => i.text)).toEqual(["first"]);
    expect(
      list0
        ?.items()[0]
        ?.nestedLists()[0]
        ?.items()
        .map((i) => i.text),
    ).toEqual(["second"]);

    const reopened = openOdt(doc.editor.toBytes());
    const reopenedList = reopened.lists()[blockIndex];
    expect(reopenedList?.items().map((i) => i.text)).toEqual(["first"]);
    expect(
      reopenedList
        ?.items()[0]
        ?.nestedLists()[0]
        ?.items()
        .map((i) => i.text),
    ).toEqual(["second"]);
  });

  it("warns rather than crashing for the first item, which has no preceding sibling", () => {
    const editor = createOdt();
    editor.body.appendList().addItem().appendParagraph({ text: "only" });
    const opened = openOdtDocument(editor.toBytes());
    const blockIndex = odtDocument(opened).editor.lists().length - 1;

    const result = appReducer(opened, {
      type: "INDENT_LIST_ITEM",
      blockIndex,
      itemIndex: 0,
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.hasUnsavedChanges).toBe(false);
  });

  it("warns rather than crashing for a list index that does not exist", () => {
    const editor = createOdt();
    editor.body.appendList().addItem().appendParagraph({ text: "only" });
    const opened = openOdtDocument(editor.toBytes());

    const result = appReducer(opened, {
      type: "INDENT_LIST_ITEM",
      blockIndex: 5,
      itemIndex: 0,
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.hasUnsavedChanges).toBe(false);
  });

  it("warns instead of mutating when the open document is docx (lists are an odt-only concept)", () => {
    const state = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "docx",
    });
    const warned = appReducer(state, {
      type: "INDENT_LIST_ITEM",
      blockIndex: 0,
      itemIndex: 0,
    });
    expect(warned.status?.severity).toBe("warning");
    expect(warned.hasUnsavedChanges).toBe(false);
  });
});

describe("appReducer ods mutations", () => {
  it("writes a cell value through the real OdsCell setter", () => {
    const created = applyAll([
      { type: "CREATE_DOCUMENT", format: "ods" },
      { type: "ADD_SHEET", name: "Data" },
    ]);
    const sheetIndex = odsDocument(created).editor.sheets().length - 1;

    const written = appReducer(created, {
      type: "SET_CELL_VALUE",
      sheetIndex,
      row: 2,
      column: 3,
      value: { kind: "string", value: "Total" },
    });
    expect(written.hasUnsavedChanges).toBe(true);

    const sheet = odsDocument(written).editor.sheets()[sheetIndex];
    if (sheet === undefined) {
      throw new Error("expected the added sheet");
    }
    expect(sheet.cell(2, 3).value).toEqual({ kind: "string", value: "Total" });
  });
});

describe("appReducer SET_CELL_FORMULA on ods", () => {
  it("writes a real table:formula through the live OdsCell.formula setter, coexisting with the cell's own typed value, verified through readOdsContent", () => {
    const created = applyAll([
      { type: "CREATE_DOCUMENT", format: "ods" },
      { type: "ADD_SHEET", name: "Data" },
    ]);
    const sheetIndex = odsDocument(created).editor.sheets().length - 1;
    const seeded = appReducer(created, {
      type: "SET_CELL_VALUE",
      sheetIndex,
      row: 0,
      column: 0,
      value: { kind: "number", value: 42 },
    });

    const withFormula = appReducer(seeded, {
      type: "SET_CELL_FORMULA",
      sheetIndex,
      row: 0,
      column: 0,
      formula: "of:=1+41",
    });
    expect(withFormula.hasUnsavedChanges).toBe(true);

    const content = readOdsContent(odsDocument(withFormula).editor.toPackage());
    if (content.kind !== "spreadsheet") {
      throw new Error(
        `expected a spreadsheet ContentDocument, got ${content.kind}`,
      );
    }
    // createOds() already seeds a default 'Sheet1' at index 0 -- ADD_SHEET appends 'Data' after it, so the sheet under test sits at `sheetIndex`, not index 0.
    const cell = content.sheets[sheetIndex]?.cells.find(
      (candidate) => candidate.row === 0 && candidate.column === 0,
    );
    expect(cell?.formula).toBe("of:=1+41");
    // The formula coexists with the cell's own typed value -- setting one never clobbers the other.
    expect(cell?.value).toEqual({ kind: "number", value: 42 });

    // A subsequent undefined formula clears it back out, again without touching the typed value.
    const cleared = appReducer(withFormula, {
      type: "SET_CELL_FORMULA",
      sheetIndex,
      row: 0,
      column: 0,
      formula: undefined,
    });
    const clearedContent = readOdsContent(
      odsDocument(cleared).editor.toPackage(),
    );
    if (clearedContent.kind !== "spreadsheet") {
      throw new Error(
        `expected a spreadsheet ContentDocument, got ${clearedContent.kind}`,
      );
    }
    const clearedCell = clearedContent.sheets[sheetIndex]?.cells.find(
      (candidate) => candidate.row === 0 && candidate.column === 0,
    );
    expect(clearedCell?.formula).toBeUndefined();
    expect(clearedCell?.value).toEqual({ kind: "number", value: 42 });
  });

  it("warns rather than crashing for a sheet index that does not exist", () => {
    const created = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "ods",
    });
    const result = appReducer(created, {
      type: "SET_CELL_FORMULA",
      sheetIndex: 4,
      row: 0,
      column: 0,
      formula: "of:=1",
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.hasUnsavedChanges).toBe(false);
  });

  it("warns rather than crashing when the open document is not ods", () => {
    const created = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "docx",
    });
    const result = appReducer(created, {
      type: "SET_CELL_FORMULA",
      sheetIndex: 0,
      row: 0,
      column: 0,
      formula: "of:=1",
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toContain("ods");
  });
});

describe("appReducer ADD_SHEET_IMAGE on ods", () => {
  it("adds a real floating image, positioned by resolving the anchor cell against the sheet's own explicit column widths/row heights, verified through readOdsContent", () => {
    // Explicit widths/heights for every column/row strictly before the anchor, set through the live editor BEFORE the image is added -- matching OdsSheet.addImage's own doc comment ("Call this AFTER any setColumnWidth/setColumnHidden/setRowHeight/setRowHidden calls this sheet needs") -- so the expected absolute position asserted below is derived from values this test itself set, never from OdsSheet.addImage's own internal default-size fallback.
    const editor = createOds();
    const sheet = editor.addSheet("Data");
    const columnWidthsPt = [30, 40, 50];
    const rowHeightsPt = [20, 25];
    columnWidthsPt.forEach((widthPt, index) => {
      sheet.setColumnWidth(index, widthPt);
    });
    rowHeightsPt.forEach((heightPt, index) => {
      sheet.setRowHeight(index, heightPt);
    });
    const opened = openOdsDocument(editor.toBytes());
    const sheetIndex = odsDocument(opened).editor.sheets().length - 1;

    const withImage = appReducer(opened, {
      type: "ADD_SHEET_IMAGE",
      sheetIndex,
      anchorRow: rowHeightsPt.length,
      anchorColumn: columnWidthsPt.length,
      offsetXPt: 5,
      offsetYPt: 10,
      format: "png",
      bytes: PNG_BYTES,
      widthPt: 80,
      heightPt: 40,
      altText: "a logo",
    });
    expect(withImage.hasUnsavedChanges).toBe(true);

    const content = readOdsContent(odsDocument(withImage).editor.toPackage());
    if (content.kind !== "spreadsheet") {
      throw new Error(
        `expected a spreadsheet ContentDocument, got ${content.kind}`,
      );
    }
    // createOds() already seeds a default 'Sheet1' at index 0 -- addSheet('Data') appends a second sheet after it, so the sheet under test sits at `sheetIndex`, not index 0.
    const image = content.sheets[sheetIndex]?.images[0];
    if (image === undefined) {
      throw new Error("expected a real image on the added sheet");
    }
    // A spreadsheet's own table:shapes container (the direct parent of every floating image, always table:table's own first child) carries no per-cell anchor at all -- its svg:x/svg:y is always sheet-absolute -- so odf.js's own reader always reports anchorRow/anchorColumn 0 with that absolute position carried through as the offset (see odf.js's own typed/ods/read.ts top-of-file note: "cell (0,0)'s own top-left IS the sheet origin, so the two coordinate systems coincide exactly there"). This is a genuine, documented ODF format limitation, not a round-trip bug -- the WRITE side still resolved the given anchor correctly against the sheet's real column/row sizing, which is exactly what the derived offset values below prove.
    expect(image.anchorRow).toBe(0);
    expect(image.anchorColumn).toBe(0);
    expect(image.offsetXPt).toBe(
      columnWidthsPt.reduce((sum, width) => sum + width, 0) + 5,
    );
    expect(image.offsetYPt).toBe(
      rowHeightsPt.reduce((sum, height) => sum + height, 0) + 10,
    );
    expect(image.format).toBe("png");
    expect(image.widthPt).toBe(80);
    expect(image.heightPt).toBe(40);
    // altText does NOT round-trip here -- confirmed directly against the installed documents.js: OdsSheet.addImage's own write path (src/edit/ods/floating.ts's insertSheetImage) never writes a floating image's svg:title/svg:desc at all, even though odf.js's own reader (readDrawFrame, which every OTHER image-insertion path in this codebase already reads altText through) fully supports reading them back. A real, confirmed write-side gap in the installed documents.js dependency, not a bug in this action/reducer -- ADD_SHEET_IMAGE still forwards the caller's altText through to OdsSheet.addImage unconditionally (the field is a genuine, schema-valid ContentSheetImage member), so a future documents.js release that starts writing it needs no change on this side at all.
    expect(image.altText).toBeUndefined();
  });

  it("warns rather than crashing for a sheet index that does not exist", () => {
    const created = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "ods",
    });
    const result = appReducer(created, {
      type: "ADD_SHEET_IMAGE",
      sheetIndex: 4,
      anchorRow: 0,
      anchorColumn: 0,
      offsetXPt: 0,
      offsetYPt: 0,
      format: "png",
      bytes: PNG_BYTES,
      widthPt: 10,
      heightPt: 10,
      altText: undefined,
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.hasUnsavedChanges).toBe(false);
  });

  it("warns rather than crashing when the open document is not ods", () => {
    const created = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "docx",
    });
    const result = appReducer(created, {
      type: "ADD_SHEET_IMAGE",
      sheetIndex: 0,
      anchorRow: 0,
      anchorColumn: 0,
      offsetXPt: 0,
      offsetYPt: 0,
      format: "png",
      bytes: PNG_BYTES,
      widthPt: 10,
      heightPt: 10,
      altText: undefined,
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toContain("ods");
  });
});

describe("appReducer MERGE_CELLS on ods", () => {
  it("merges a real rectangle of cells through the live OdsSheet.mergeCells, and a covered cell is rejected by cell() afterwards", () => {
    const created = applyAll([
      { type: "CREATE_DOCUMENT", format: "ods" },
      { type: "ADD_SHEET", name: "Data" },
    ]);
    const sheetIndex = odsDocument(created).editor.sheets().length - 1;
    const seeded = appReducer(created, {
      type: "SET_CELL_VALUE",
      sheetIndex,
      row: 0,
      column: 0,
      value: { kind: "string", value: "Merged" },
    });

    const merged = appReducer(seeded, {
      type: "MERGE_CELLS",
      sheetIndex,
      startRow: 0,
      startColumn: 0,
      rowSpan: 2,
      colSpan: 2,
    });
    expect(merged.hasUnsavedChanges).toBe(true);

    const sheet = odsDocument(merged).editor.sheets()[sheetIndex];
    if (sheet === undefined) {
      throw new Error("expected the added sheet");
    }
    expect(sheet.cell(0, 0).value).toEqual({ kind: "string", value: "Merged" });
    expect(() => sheet.cell(0, 1)).toThrow(/covered/);
    expect(() => sheet.cell(1, 0)).toThrow(/covered/);
    expect(() => sheet.cell(1, 1)).toThrow(/covered/);

    // Round-trips through re-decoding the package as a completely fresh workbook, not just the live in-memory object.
    const reopened = openOds(odsDocument(merged).editor.toBytes());
    const reopenedSheet = reopened.sheets()[sheetIndex];
    if (reopenedSheet === undefined) {
      throw new Error("expected the added sheet to survive a fresh decode");
    }
    expect(reopenedSheet.cell(0, 0).value).toEqual({
      kind: "string",
      value: "Merged",
    });
    expect(() => reopenedSheet.cell(0, 1)).toThrow(/covered/);
  });

  it("surfaces a thrown merge error as a warning status instead of crashing", () => {
    const created = applyAll([
      { type: "CREATE_DOCUMENT", format: "ods" },
      { type: "ADD_SHEET", name: "Data" },
    ]);
    const sheetIndex = odsDocument(created).editor.sheets().length - 1;

    const result = appReducer(created, {
      type: "MERGE_CELLS",
      sheetIndex,
      startRow: 0,
      startColumn: 0,
      rowSpan: 0,
      colSpan: 2,
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toContain("rowSpan");
    // hasUnsavedChanges is unchanged from before this dispatch (ADD_SHEET already set it true) -- the guarded merge neither adds a further change nor resets it.
    expect(result.hasUnsavedChanges).toBe(created.hasUnsavedChanges);
  });

  it("warns rather than crashing for a sheet index that does not exist", () => {
    const created = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "ods",
    });
    const result = appReducer(created, {
      type: "MERGE_CELLS",
      sheetIndex: 4,
      startRow: 0,
      startColumn: 0,
      rowSpan: 1,
      colSpan: 1,
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.hasUnsavedChanges).toBe(false);
  });

  it("warns rather than crashing when the open document is not ods", () => {
    const created = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "docx",
    });
    const result = appReducer(created, {
      type: "MERGE_CELLS",
      sheetIndex: 0,
      startRow: 0,
      startColumn: 0,
      rowSpan: 1,
      colSpan: 1,
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toContain("ods");
  });
});

describe("appReducer markdown mutations", () => {
  it("lands an opened markdown document on the bodyList root screen, with a real live-view editor and originalText kept alongside", () => {
    const state = openMarkdownDocument("# Title\n\nBody text");
    expect(state.stack.map((screen) => screen.kind)).toEqual(["bodyList"]);
    const doc = markdownDocument(state);
    expect(doc.originalText).toBe("# Title\n\nBody text");
    expect(doc.editor.paragraphs()).toHaveLength(2);
    expect(doc.editor.paragraphs()[1]?.text).toBe("Body text");
  });

  it("appends a paragraph and a run through the same generic actions docx/odt already share, marking the document dirty", () => {
    const opened = openMarkdownDocument("Intro");
    const appended = appReducer(opened, {
      type: "APPEND_PARAGRAPH",
      text: "New paragraph",
      styleId: undefined,
      alignment: undefined,
    });
    expect(markdownDocument(appended).editor.paragraphs()).toHaveLength(2);
    expect(appended.hasUnsavedChanges).toBe(true);
    expect(appended.undoStack).toHaveLength(1);

    const withRun = appReducer(appended, {
      type: "APPEND_RUN",
      blockIndex: 1,
      text: " more",
    });
    expect(markdownDocument(withRun).editor.paragraphs()[1]?.text).toBe(
      "New paragraph more",
    );
  });

  it("toggles bold/italic on a markdown run through the same generic action docx/odt already share", () => {
    const opened = openMarkdownDocument("Intro");
    const bolded = appReducer(opened, {
      type: "TOGGLE_RUN_BOLD",
      blockIndex: 0,
      runIndex: 0,
    });
    expect(
      markdownDocument(bolded).editor.paragraphs()[0]?.runs()[0]?.bold,
    ).toBe(true);

    const italicised = appReducer(bolded, {
      type: "TOGGLE_RUN_ITALIC",
      blockIndex: 0,
      runIndex: 0,
    });
    expect(
      markdownDocument(italicised).editor.paragraphs()[0]?.runs()[0]?.italic,
    ).toBe(true);
  });

  // MarkdownRun/MarkdownParagraph genuinely have no underline/colour/font-family/font-size/alignment field at all -- these four actions are narrowed to docx/odt only in the reducer (styledWordprocessingDocument/withStyledRun), so dispatching one against a markdown document reports why rather than throwing or silently doing nothing.
  it("warns rather than mutating for run/paragraph styling fields markdown has no counterpart for at all", () => {
    const opened = openMarkdownDocument("Intro");

    const underlineResult = appReducer(opened, {
      type: "TOGGLE_RUN_UNDERLINE",
      blockIndex: 0,
      runIndex: 0,
    });
    expect(underlineResult.status?.severity).toBe("warning");
    expect(underlineResult.status?.text).toBe(
      "That action needs a docx, odt or doc document; the open document is markdown",
    );
    expect(underlineResult.hasUnsavedChanges).toBe(false);

    const colorResult = appReducer(opened, {
      type: "SET_RUN_COLOR",
      blockIndex: 0,
      runIndex: 0,
      color: { r: 1, g: 0, b: 0 },
    });
    expect(colorResult.status?.severity).toBe("warning");

    const fontFamilyResult = appReducer(opened, {
      type: "SET_RUN_FONT_FAMILY",
      blockIndex: 0,
      runIndex: 0,
      fontFamily: "Calibri",
    });
    expect(fontFamilyResult.status?.severity).toBe("warning");

    const fontSizeResult = appReducer(opened, {
      type: "SET_RUN_FONT_SIZE",
      blockIndex: 0,
      runIndex: 0,
      sizePt: 14,
    });
    expect(fontSizeResult.status?.severity).toBe("warning");

    const alignmentResult = appReducer(opened, {
      type: "SET_PARAGRAPH_ALIGNMENT",
      blockIndex: 0,
      alignment: "center",
    });
    expect(alignmentResult.status?.severity).toBe("warning");

    const imageResult = appReducer(opened, {
      type: "INSERT_PARAGRAPH_IMAGE",
      blockIndex: 0,
      format: "png",
      bytes: PNG_BYTES,
      widthPt: 10,
      heightPt: 10,
      altText: undefined,
    });
    expect(imageResult.status?.severity).toBe("warning");
  });

  // GFM tables have no cell-merge concept at all -- MarkdownTable has no mergeCells -- so a merge requested alongside table creation still creates the (unmerged) table and reports why the merge didn't happen, rather than silently dropping the merge or refusing to create the table.
  it("creates a real markdown table via the shared APPEND_TABLE action, and declines a requested merge with a warning", () => {
    const opened = openMarkdownDocument("Intro");
    const created = appReducer(opened, {
      type: "APPEND_TABLE",
      rows: 2,
      columns: 2,
      merge: { startRow: 0, startColumn: 0, rowSpan: 2, colSpan: 2 },
    });
    expect(markdownDocument(created).editor.tables()).toHaveLength(1);
    expect(created.status?.severity).toBe("warning");
    expect(created.status?.text).toContain("do not support merged cells");
  });

  it("warns rather than mutating a wordprocessing action against a non-wordprocessing document", () => {
    const state = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "ods",
    });
    const warned = appReducer(state, {
      type: "APPEND_PARAGRAPH",
      text: "x",
      styleId: undefined,
      alignment: undefined,
    });
    expect(warned.status?.severity).toBe("warning");
    expect(warned.hasUnsavedChanges).toBe(false);
  });
});

describe("appReducer doc (legacy Word) mutations", () => {
  // wordprocessingDocument's own format union admits doc alongside docx/odt/markdown -- covered here specifically because every other member is already exercised elsewhere by name, and a mutant collapsing this one arm of the union would only ever be caught by a doc-format dispatch.
  it("appends a paragraph through the same generic action docx/odt/markdown already share", () => {
    const opened = openDocDocument(createDoc().toBytes());
    const before = docDocument(opened).editor.paragraphs().length;
    const appended = appReducer(opened, {
      type: "APPEND_PARAGRAPH",
      text: "New paragraph",
      styleId: undefined,
      alignment: undefined,
    });
    expect(appended.status?.severity).not.toBe("warning");
    expect(docDocument(appended).editor.paragraphs()).toHaveLength(before + 1);
  });

  // styledWordprocessingDocument's own format union admits doc alongside docx/odt (never markdown, which has no such fields at all -- see the markdown describe block above) -- covered here for the identical reason: doc is the one arm nothing else in this file dispatches through this specific function.
  it("toggles bold on a run through the same generic action docx/odt already share", () => {
    const withRun = applyAll(
      [
        {
          type: "APPEND_PARAGRAPH",
          text: undefined,
          styleId: undefined,
          alignment: undefined,
        },
        { type: "APPEND_RUN", blockIndex: 0, text: "Hello" },
      ],
      openDocDocument(createDoc().toBytes()),
    );
    const bolded = appReducer(withRun, {
      type: "TOGGLE_RUN_BOLD",
      blockIndex: 0,
      runIndex: 0,
    });
    expect(bolded.status?.severity).not.toBe("warning");
    expect(docDocument(bolded).editor.paragraphs()[0]?.runs()[0]?.bold).toBe(
      true,
    );
  });
});

describe("appReducer undo", () => {
  // Proves undo generalises to markdown's own live-view MarkdownEditor with zero markdown-specific reducer code beyond toUndoSnapshot's own byte<->text branch -- the same encodeMarkdownText/decodeMarkdownText round trip through the shared undo stack every other mutating action already uses.
  it("restores a markdown document to its paragraphs before the last edit", () => {
    const opened = openMarkdownDocument("One\n\nTwo");
    const edited = appReducer(opened, {
      type: "APPEND_RUN",
      blockIndex: 1,
      text: " more",
    });
    expect(markdownDocument(edited).editor.paragraphs()[1]?.text).toBe(
      "Two more",
    );
    expect(edited.undoStack).toHaveLength(1);

    const undone = appReducer(edited, { type: "UNDO" });
    expect(undone.undoStack).toHaveLength(0);
    expect(markdownDocument(undone).editor.paragraphs()[1]?.text).toBe("Two");
    expect(undone.hasUnsavedChanges).toBe(true);
  });

  it("restores the snapshot taken before the last mutation", () => {
    const created = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "docx",
    });
    const paragraphsBefore = docxDocument(created).editor.paragraphs().length;

    const appended = appReducer(created, {
      type: "APPEND_PARAGRAPH",
      text: "undo me",
      styleId: undefined,
      alignment: undefined,
    });
    expect(docxDocument(appended).editor.paragraphs()).toHaveLength(
      paragraphsBefore + 1,
    );
    expect(appended.undoStack).toHaveLength(1);

    const undone = appReducer(appended, { type: "UNDO" });
    expect(undone.undoStack).toHaveLength(0);
    expect(docxDocument(undone).editor.paragraphs()).toHaveLength(
      paragraphsBefore,
    );
    // Undo replaces the editor wholesale by re-opening the snapshot bytes, so the old editor object is not the one in state any more.
    expect(docxDocument(undone).editor).not.toBe(docxDocument(appended).editor);
  });

  it("says so when there is nothing to undo", () => {
    const created = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "docx",
    });
    const undone = appReducer(created, { type: "UNDO" });
    expect(undone.status?.severity).toBe("info");
    expect(undone.openDocument).toBe(created.openDocument);
  });

  it("caps the undo stack at 20 snapshots, dropping the oldest ones first", () => {
    let state = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "docx",
    });
    for (let i = 0; i < 25; i++) {
      state = appReducer(state, {
        type: "APPEND_PARAGRAPH",
        text: `p${i}`,
        styleId: undefined,
        alignment: undefined,
      });
    }
    expect(state.undoStack).toHaveLength(20);

    // Undoing 20 times empties the capped stack exactly -- proving the retained entries are the 20 MOST RECENT snapshots (the tail), not an arbitrary 20, since undoing keeps peeling paragraphs off the end down to a stable, non-empty prefix rather than running out early or restoring past the true starting point.
    for (let i = 0; i < 20; i++) {
      state = appReducer(state, { type: "UNDO" });
    }
    expect(state.undoStack).toHaveLength(0);
    expect(docxDocument(state).editor.paragraphs()).toHaveLength(
      docxDocument(
        appReducer(createInitialState(), {
          type: "CREATE_DOCUMENT",
          format: "docx",
        }),
      ).editor.paragraphs().length + 5,
    );
  });

  // reopenEditable's own switch has one case per EditableOpenDocument format -- docx and pdf are already exercised by the undo tests above, so this covers every remaining branch (pptx/odt/odp/ods/odg/doc/xls/ppt) the same way: mutate via SET_METADATA (the one action every editable format's own editor.metadata setter accepts identically), then undo, and prove the format survived the reopen and a genuinely fresh editor replaced the mutated one.
  it.each([
    ["pptx", () => openPptxDocument(createPptx().toBytes())],
    ["odt", () => openOdtDocument(createOdt().toBytes())],
    ["odp", () => openOdpDocument(createOdp().toBytes())],
    ["ods", () => openOdsDocument(createOds().toBytes())],
    ["odg", () => openOdgDocument(createOdg().toBytes())],
    ["doc", () => openDocDocument(createDoc().toBytes())],
    ["xls", () => openXlsDocument(createXls().toBytes())],
    ["ppt", () => openPptDocument(createPpt().toBytes())],
  ] as const)(
    "reopens a %s document from its undo snapshot with a fresh editor",
    (format, open) => {
      const opened = open();
      const mutated = appReducer(opened, {
        type: "SET_METADATA",
        overrides: { title: "Undo me" },
      });
      if (
        mutated.openDocument === undefined ||
        !isEditableDocument(mutated.openDocument)
      ) {
        throw new Error("expected an editable open document");
      }
      expect(mutated.openDocument.format).toBe(format);
      const mutatedEditor = mutated.openDocument.editor;

      const undone = appReducer(mutated, { type: "UNDO" });
      expect(undone.undoStack).toHaveLength(0);
      if (
        undone.openDocument === undefined ||
        !isEditableDocument(undone.openDocument)
      ) {
        throw new Error("expected an editable open document");
      }
      expect(undone.openDocument.format).toBe(format);
      expect(undone.openDocument.editor).not.toBe(mutatedEditor);
    },
  );

  // The genuinely read-only formats (no live-view editor, so nothing ever pushes an undo snapshot for them) each get their own dedicated warning naming that exact format, rather than falling through to the "nothing to undo" info message every editable format's own empty undo stack produces above.
  it.each(["odb", "xlsx", "csv", "svg", "rtf", "wpd", "epub"] as const)(
    "says a %s document is read-only with nothing to undo",
    (format) => {
      const doc = readOnlyOpenDocument(format);
      const opened = appReducer(createInitialState(), {
        type: "OPEN_FILE_SUCCESS",
        path: doc.path,
        doc,
      });

      const undone = appReducer(opened, { type: "UNDO" });
      expect(undone.status?.severity).toBe("warning");
      expect(undone.status?.text).toBe(
        `A ${format} document is read-only, so it has no history to undo`,
      );
      expect(undone.openDocument).toBe(opened.openDocument);
      expect(undone.undoStack).toHaveLength(0);
    },
  );
});

describe("appReducer ADD_SLIDE_TABLE", () => {
  it("adds a real table to a pptx slide, reachable through documents.js own PptxSlide.addTable", () => {
    const editor = createPptx();
    editor.addSlide();
    const opened = openPptxDocument(editor.toBytes());

    const withTable = appReducer(opened, {
      type: "ADD_SLIDE_TABLE",
      slideIndex: 0,
      frame: { xPt: 10, yPt: 10, widthPt: 200, heightPt: 100 },
      rows: 3,
      columns: 2,
    });
    expect(withTable.hasUnsavedChanges).toBe(true);

    // PptxSlide.shapes() never returns a table graphicFrame at all (documents.js's own shapes() walk only matches p:sp/p:pic), so the only way to observe the table this reducer just added is the same read-only pivot readPptxContent already uses -- proving the mutation reached the real package, not just that the action was accepted.
    const content = readPptxContent(pptxDocument(withTable).editor.toPackage());
    if (content.kind !== "presentation") {
      throw new Error(
        `expected a presentation ContentDocument from readPptxContent, got ${content.kind}`,
      );
    }
    const tableBlock = content.slides[0]?.shapes[0]?.blocks[0];
    if (tableBlock?.kind !== "table") {
      throw new Error(
        `expected a table block on slide 0's first shape, got ${tableBlock?.kind}`,
      );
    }
    expect(tableBlock.rows).toHaveLength(3);
    expect(tableBlock.rows[0]?.cells).toHaveLength(2);
  });

  it("adds a real table to an odp slide, reachable through documents.js own OdpSlide.addTable", () => {
    const editor = createOdp();
    editor.addSlide();
    const opened = openOdpDocument(editor.toBytes());

    const withTable = appReducer(opened, {
      type: "ADD_SLIDE_TABLE",
      slideIndex: 0,
      frame: { xPt: 10, yPt: 10, widthPt: 200, heightPt: 100 },
      rows: 2,
      columns: 4,
    });
    expect(withTable.hasUnsavedChanges).toBe(true);

    const content = readOdpContent(odpDocument(withTable).editor.toPackage());
    if (content.kind !== "presentation") {
      throw new Error(
        `expected a presentation ContentDocument from readOdpContent, got ${content.kind}`,
      );
    }
    const tableBlock = content.slides[0]?.shapes[0]?.blocks[0];
    if (tableBlock?.kind !== "table") {
      throw new Error(
        `expected a table block on slide 0's first shape, got ${tableBlock?.kind}`,
      );
    }
    expect(tableBlock.rows).toHaveLength(2);
    expect(tableBlock.rows[0]?.cells).toHaveLength(4);
  });

  it("warns rather than crashing for a slide index that does not exist", () => {
    const editor = createPptx();
    editor.addSlide();
    const opened = openPptxDocument(editor.toBytes());

    const result = appReducer(opened, {
      type: "ADD_SLIDE_TABLE",
      slideIndex: 5,
      frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
      rows: 2,
      columns: 2,
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.hasUnsavedChanges).toBe(false);
  });

  it("warns rather than crashing when the open document is not a pptx or odp document", () => {
    const created = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "docx",
    });
    const result = appReducer(created, {
      type: "ADD_SLIDE_TABLE",
      slideIndex: 0,
      frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
      rows: 2,
      columns: 2,
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toContain("pptx or odp");
  });
});

describe("appReducer MERGE_SLIDE_TABLE_CELLS", () => {
  it("merges a real rectangle of cells in a pptx slide table through the live PptxTable, verified through readPptxContent", () => {
    const editor = createPptx();
    editor.addSlide();
    const opened = openPptxDocument(editor.toBytes());

    const withTable = appReducer(opened, {
      type: "ADD_SLIDE_TABLE",
      slideIndex: 0,
      frame: { xPt: 10, yPt: 10, widthPt: 200, heightPt: 100 },
      rows: 3,
      columns: 3,
    });
    const merged = appReducer(withTable, {
      type: "MERGE_SLIDE_TABLE_CELLS",
      slideIndex: 0,
      tableIndex: 0,
      startRow: 0,
      startColumn: 0,
      rowSpan: 2,
      colSpan: 2,
    });
    expect(merged.hasUnsavedChanges).toBe(true);

    const content = readPptxContent(pptxDocument(merged).editor.toPackage());
    if (content.kind !== "presentation") {
      throw new Error(
        `expected a presentation ContentDocument, got ${content.kind}`,
      );
    }
    const tableBlock = content.slides[0]?.shapes[0]?.blocks[0];
    if (tableBlock?.kind !== "table") {
      throw new Error(`expected a table block, got ${tableBlock?.kind}`);
    }
    // The anchor carries the real merge attributes; every other cell in the rectangle reads back with no blocks at all (hMerge/vMerge covered), matching readTableCell's own short-circuit -- see ooxml.js's own typed/pptx/read.js.
    expect(tableBlock.rows[0]?.cells[0]?.colSpan).toBe(2);
    expect(tableBlock.rows[0]?.cells[0]?.rowSpan).toBe(2);
    expect(tableBlock.rows[0]?.cells[1]?.blocks).toEqual([]);
    expect(tableBlock.rows[1]?.cells[0]?.blocks).toEqual([]);
    expect(tableBlock.rows[1]?.cells[1]?.blocks).toEqual([]);
    // The untouched third row/column stay real, ordinary cells.
    expect(tableBlock.rows[2]?.cells[2]?.colSpan).toBeUndefined();
  });

  it("merges a real rectangle of cells in an odp slide table through the live OdtTable, verified through readOdpContent", () => {
    const editor = createOdp();
    editor.addSlide();
    const opened = openOdpDocument(editor.toBytes());

    const withTable = appReducer(opened, {
      type: "ADD_SLIDE_TABLE",
      slideIndex: 0,
      frame: { xPt: 10, yPt: 10, widthPt: 200, heightPt: 100 },
      rows: 3,
      columns: 3,
    });
    const merged = appReducer(withTable, {
      type: "MERGE_SLIDE_TABLE_CELLS",
      slideIndex: 0,
      tableIndex: 0,
      startRow: 1,
      startColumn: 1,
      rowSpan: 2,
      colSpan: 2,
    });
    expect(merged.hasUnsavedChanges).toBe(true);

    const content = readOdpContent(odpDocument(merged).editor.toPackage());
    if (content.kind !== "presentation") {
      throw new Error(
        `expected a presentation ContentDocument, got ${content.kind}`,
      );
    }
    const tableBlock = content.slides[0]?.shapes[0]?.blocks[0];
    if (tableBlock?.kind !== "table") {
      throw new Error(`expected a table block, got ${tableBlock?.kind}`);
    }
    expect(tableBlock.rows[1]?.cells[1]?.colSpan).toBe(2);
    expect(tableBlock.rows[1]?.cells[1]?.rowSpan).toBe(2);
  });

  it("surfaces a thrown merge error as a warning status instead of crashing", () => {
    const editor = createPptx();
    editor.addSlide();
    const opened = openPptxDocument(editor.toBytes());
    const withTable = appReducer(opened, {
      type: "ADD_SLIDE_TABLE",
      slideIndex: 0,
      frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
      rows: 2,
      columns: 2,
    });

    const result = appReducer(withTable, {
      type: "MERGE_SLIDE_TABLE_CELLS",
      slideIndex: 0,
      tableIndex: 0,
      startRow: 0,
      startColumn: 0,
      rowSpan: 5,
      colSpan: 2,
    });
    expect(result.status?.severity).toBe("warning");
  });

  it("warns rather than crashing for a table index that does not exist", () => {
    const editor = createPptx();
    editor.addSlide();
    const opened = openPptxDocument(editor.toBytes());

    const result = appReducer(opened, {
      type: "MERGE_SLIDE_TABLE_CELLS",
      slideIndex: 0,
      tableIndex: 0,
      startRow: 0,
      startColumn: 0,
      rowSpan: 1,
      colSpan: 1,
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.hasUnsavedChanges).toBe(false);
  });

  it("warns rather than crashing when the open document is not pptx or odp", () => {
    const created = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "docx",
    });
    const result = appReducer(created, {
      type: "MERGE_SLIDE_TABLE_CELLS",
      slideIndex: 0,
      tableIndex: 0,
      startRow: 0,
      startColumn: 0,
      rowSpan: 1,
      colSpan: 1,
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toContain("pptx or odp");
  });

  // wrongDocument's own "actual" half names the real open format when there is one (covered just above), but falls back to the literal words "no document" when state.openDocument is undefined -- distinct from any real format string, so it must come from its own ternary branch rather than always compute an actual format.
  it("says 'no document' rather than a format name when nothing is open at all", () => {
    const result = appReducer(createInitialState(), {
      type: "MERGE_SLIDE_TABLE_CELLS",
      slideIndex: 0,
      tableIndex: 0,
      startRow: 0,
      startColumn: 0,
      rowSpan: 1,
      colSpan: 1,
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toBe(
      "That action needs a pptx or odp document; the open document is no document",
    );
  });

  it("rejects a non-integer or non-positive rowSpan/colSpan instead of merging anything", () => {
    const editor = createPptx();
    editor.addSlide();
    const opened = openPptxDocument(editor.toBytes());
    const withTable = appReducer(opened, {
      type: "ADD_SLIDE_TABLE",
      slideIndex: 0,
      frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
      rows: 3,
      columns: 3,
    });

    const cases: readonly [number, number][] = [
      [0, 1], // rowSpan below 1
      [1, 0], // colSpan below 1
      [1.5, 1], // rowSpan not an integer
      [1, 1.5], // colSpan not an integer
    ];
    for (const [rowSpan, colSpan] of cases) {
      const result = appReducer(withTable, {
        type: "MERGE_SLIDE_TABLE_CELLS",
        slideIndex: 0,
        tableIndex: 0,
        startRow: 0,
        startColumn: 0,
        rowSpan,
        colSpan,
      });
      expect(result.status?.severity).toBe("warning");
      expect(result.status?.text).toContain("positive integers");
      // Rejected outright, before any cell was ever touched -- the same open document object survives untouched, not a partially-applied merge.
      expect(result.openDocument).toBe(withTable.openDocument);
    }
  });

  it("rejects a colSpan that overruns the table's own column count", () => {
    const editor = createPptx();
    editor.addSlide();
    const opened = openPptxDocument(editor.toBytes());
    const withTable = appReducer(opened, {
      type: "ADD_SLIDE_TABLE",
      slideIndex: 0,
      frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
      rows: 2,
      columns: 2,
    });

    const result = appReducer(withTable, {
      type: "MERGE_SLIDE_TABLE_CELLS",
      slideIndex: 0,
      tableIndex: 0,
      startRow: 0,
      startColumn: 0,
      rowSpan: 1,
      colSpan: 3,
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toContain("exceeds this table's own 2 columns");
    expect(result.openDocument).toBe(withTable.openDocument);
  });

  // mergePptxTableCells's own row/column bounds checks compare with a strict `>`, not `>=` -- a merge landing exactly on the table's own last row/column is valid, not an overrun. rowSpan=1/colSpan=1 here also proves the "must be positive integers" guard rejects only BELOW 1, not AT 1.
  it("accepts a 1x1 merge landing exactly on the table's own last row and column", () => {
    const editor = createPptx();
    editor.addSlide();
    const opened = openPptxDocument(editor.toBytes());
    const withTable = appReducer(opened, {
      type: "ADD_SLIDE_TABLE",
      slideIndex: 0,
      frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
      rows: 2,
      columns: 2,
    });

    const result = appReducer(withTable, {
      type: "MERGE_SLIDE_TABLE_CELLS",
      slideIndex: 0,
      tableIndex: 0,
      startRow: 1,
      startColumn: 1,
      rowSpan: 1,
      colSpan: 1,
    });
    expect(result.status?.severity).not.toBe("warning");
    expect(result.hasUnsavedChanges).toBe(true);
  });

  // startRow=2/rowSpan=2 on a 3-row table overruns by exactly one row -- distinguishes the real check from a mutant that flips `+` to `-` (2-2=0, which would never exceed 3 and would fall through to a table access that is merely undefined rather than out of range) or drops the whole guard block outright, both of which would surface a DIFFERENT warning than this one.
  it("names the exact rowSpan/startRow/row-count in the row-overrun message", () => {
    const editor = createPptx();
    editor.addSlide();
    const opened = openPptxDocument(editor.toBytes());
    const withTable = appReducer(opened, {
      type: "ADD_SLIDE_TABLE",
      slideIndex: 0,
      frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
      rows: 3,
      columns: 2,
    });

    const result = appReducer(withTable, {
      type: "MERGE_SLIDE_TABLE_CELLS",
      slideIndex: 0,
      tableIndex: 0,
      startRow: 2,
      startColumn: 0,
      rowSpan: 2,
      colSpan: 1,
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toBe(
      "mergeSlideTableCells: rowSpan 2 starting at row 2 exceeds this table's own 3 rows",
    );
    expect(result.openDocument).toBe(withTable.openDocument);
  });

  // A rectangle taller than 1 row but only 1 column wide: the covered cell directly below the anchor must carry verticalMerge alone, never horizontalMerge (columnOffset is always 0 in a 1-wide merge, so the "columnOffset > 0" branch must never fire), and the row just past rowSpan must be left completely untouched by the row loop.
  it("sets only verticalMerge on the covered cell of a 1-column-wide, multi-row merge, and never touches the row past rowSpan", () => {
    const editor = createPptx();
    editor.addSlide();
    const opened = openPptxDocument(editor.toBytes());
    const withTable = appReducer(opened, {
      type: "ADD_SLIDE_TABLE",
      slideIndex: 0,
      frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
      rows: 3,
      columns: 2,
    });

    const merged = appReducer(withTable, {
      type: "MERGE_SLIDE_TABLE_CELLS",
      slideIndex: 0,
      tableIndex: 0,
      startRow: 0,
      startColumn: 0,
      rowSpan: 2,
      colSpan: 1,
    });
    const rows = pptxDocument(merged).editor.slides()[0]?.tables()[0]?.rows();
    const coveredBelow = rows?.[1]?.cells()[0];
    const pastRowSpan = rows?.[2]?.cells()[0];
    expect(coveredBelow?.element.attributes).toContainEqual({
      name: "vMerge",
      value: "1",
    });
    expect(
      coveredBelow?.element.attributes.some((a) => a.name === "hMerge"),
    ).toBe(false);
    expect(pastRowSpan?.element.attributes).toEqual([]);
  });

  // The column-wide counterpart: a rectangle wider than 1 column but only 1 row tall must set horizontalMerge alone on its covered cell (rowOffset is always 0, so "rowOffset > 0" must never fire), and the column just past colSpan must be left completely untouched by the column loop.
  it("sets only horizontalMerge on the covered cell of a 1-row-tall, multi-column merge, and never touches the column past colSpan", () => {
    const editor = createPptx();
    editor.addSlide();
    const opened = openPptxDocument(editor.toBytes());
    const withTable = appReducer(opened, {
      type: "ADD_SLIDE_TABLE",
      slideIndex: 0,
      frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
      rows: 2,
      columns: 3,
    });

    const merged = appReducer(withTable, {
      type: "MERGE_SLIDE_TABLE_CELLS",
      slideIndex: 0,
      tableIndex: 0,
      startRow: 0,
      startColumn: 0,
      rowSpan: 1,
      colSpan: 2,
    });
    const firstRowCells = pptxDocument(merged)
      .editor.slides()[0]
      ?.tables()[0]
      ?.rows()[0]
      ?.cells();
    const coveredRight = firstRowCells?.[1];
    const pastColSpan = firstRowCells?.[2];
    expect(coveredRight?.element.attributes).toContainEqual({
      name: "hMerge",
      value: "1",
    });
    expect(
      coveredRight?.element.attributes.some((a) => a.name === "vMerge"),
    ).toBe(false);
    expect(pastColSpan?.element.attributes).toEqual([]);
  });
});

describe("appReducer SET_SLIDE_NOTES on pptx", () => {
  it("sets real speaker notes on a pptx slide, not just an odp one", () => {
    const editor = createPptx();
    editor.addSlide();
    const opened = openPptxDocument(editor.toBytes());

    const withNotes = appReducer(opened, {
      type: "SET_SLIDE_NOTES",
      slideIndex: 0,
      notes: "Remember to mention Q3 growth",
    });
    expect(withNotes.hasUnsavedChanges).toBe(true);
    expect(pptxDocument(withNotes).editor.slides()[0]?.notes).toBe(
      "Remember to mention Q3 growth",
    );
  });
});

describe("appReducer SET_SHAPE_ROTATION on pptx", () => {
  it("rotates a real pptx shape, not just an odp one, and the rotation round-trips through re-decoding the package", () => {
    const editor = createPptx();
    const slide = editor.addSlide();
    slide.addTextBox({
      frame: { xPt: 10, yPt: 10, widthPt: 100, heightPt: 50 },
      text: "Title",
    });
    const opened = openPptxDocument(editor.toBytes());

    const rotated = appReducer(opened, {
      type: "SET_SHAPE_ROTATION",
      containerIndex: 0,
      shapeIndex: 0,
      rotationDeg: 30,
    });
    expect(rotated.hasUnsavedChanges).toBe(true);
    // The live view means the shape object captured before the action already reflects the mutation.
    expect(
      pptxDocument(rotated).editor.slides()[0]?.shapes()[0]?.rotationDeg,
    ).toBeCloseTo(30, 5);

    // Re-decoding the saved bytes as a completely fresh package proves the rotation was written into the real docx/pptx tree, not just held on the live in-memory object.
    const reopened = openPptx(pptxDocument(rotated).editor.toBytes());
    expect(reopened.slides()[0]?.shapes()[0]?.rotationDeg).toBeCloseTo(30, 5);
  });

  it("warns rather than crashing for a shape index that does not exist, naming the slide it looked on", () => {
    const editor = createPptx();
    editor.addSlide();
    const opened = openPptxDocument(editor.toBytes());

    const result = appReducer(opened, {
      type: "SET_SHAPE_ROTATION",
      containerIndex: 0,
      shapeIndex: 5,
      rotationDeg: 30,
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.hasUnsavedChanges).toBe(false);
    expect(result.status?.text).toBe("There is no shape 5 on slide 0");
  });

  // withShape's own missing-shape message says "page" for odg specifically, "slide" for every other shape-host format -- the pptx test above only ever exercises the "slide" branch of that ternary.
  it("warns with 'page' rather than 'slide' when the missing shape is on an odg page", () => {
    const editor = createOdg();
    editor.addPage();
    const opened = openOdgDocument(editor.toBytes());

    const result = appReducer(opened, {
      type: "SET_SHAPE_TEXT",
      containerIndex: 0,
      shapeIndex: 3,
      text: "unreachable",
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toBe("There is no shape 3 on page 0");
  });
});

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

  it("has no undo history, the same as odb (pdf gained a real live-view editor and undo history of its own -- see the PDF mutations describe block below)", () => {
    const opened = openXlsxDocument(xlsxTestBytes());
    const undone = appReducer(opened, { type: "UNDO" });
    expect(undone.status?.severity).toBe("warning");
    expect(undone.status?.text).toContain("read-only");
    expect(undone.openDocument).toBe(opened.openDocument);
  });
});

// OPEN_FILE_SUCCESS's own "opened as a read-only PDF preview" note names all nine of these formats individually in its own OR-chain (xlsx is exercised separately above, through its own dedicated describe block) -- each one needs its own dispatch to prove that exact branch, not just the shared behaviour the OR-chain produces once any one of them matches.
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
        `Opened ${doc.path} as a read-only PDF preview -- press ':' then 'export pdf' to save it as a real PDF`,
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

// A minimal real fixture: one page, one text item -- built through the real PdfEditor (createPdf/appendText), never a hand-authored LayoutDocument literal, so these tests exercise the exact writer/reader pair the reducer wires against.
function pdfTestBytes(): Uint8Array<ArrayBuffer> {
  const editor = createPdf();
  const page = editor.pages()[0];
  if (page === undefined) {
    throw new Error("createPdf() always seeds one page");
  }
  page.appendText({
    xPt: 10,
    yPt: 20,
    text: "Hello",
    font: { family: "Helvetica", weight: "normal", style: "normal" },
    sizePt: 12,
    color: { r: 0, g: 0, b: 0 },
  });
  return editor.toBytes();
}

describe("appReducer PDF item and page mutations", () => {
  it("edits a text item field by field, and the change round-trips through toBytes() -> a fresh openPdf() re-parse", () => {
    const opened = openPdfDocument(pdfTestBytes());

    const withText = appReducer(opened, {
      type: "SET_PDF_TEXT_TEXT",
      pageIndex: 0,
      itemIndex: 0,
      text: "Goodbye",
    });
    const withColor = appReducer(withText, {
      type: "SET_PDF_TEXT_COLOR",
      pageIndex: 0,
      itemIndex: 0,
      color: { r: 1, g: 0, b: 0 },
    });
    const withPosition = appReducer(withColor, {
      type: "SET_PDF_TEXT_POSITION",
      pageIndex: 0,
      itemIndex: 0,
      xPt: 50,
      yPt: 60,
    });
    expect(withPosition.hasUnsavedChanges).toBe(true);

    // The live view means the item captured before each action already reflects the mutation.
    const liveItem = pdfDocument(withPosition).editor.page(0)?.items()[0];
    if (liveItem?.kind !== "text") {
      throw new Error("expected a live text item");
    }
    expect(liveItem.text).toBe("Goodbye");
    expect(liveItem.color).toStrictEqual({ r: 1, g: 0, b: 0 });
    expect(liveItem.xPt).toBe(50);
    expect(liveItem.yPt).toBe(60);

    // Re-decoding the saved bytes as a completely fresh PDF proves every field was written into the real PDF content stream, not just held on the live in-memory object.
    const reopened = openPdf(pdfDocument(withPosition).editor.toBytes());
    const reopenedItem = reopened.page(0)?.items()[0];
    if (reopenedItem?.kind !== "text") {
      throw new Error("expected a real text item after re-parsing");
    }
    expect(reopenedItem.text).toBe("Goodbye");
    expect(reopenedItem.color.r).toBeCloseTo(1, 1);
    expect(reopenedItem.color.g).toBeCloseTo(0, 1);
    expect(reopenedItem.xPt).toBeCloseTo(50, 0);
    expect(reopenedItem.yPt).toBeCloseTo(60, 0);
  });

  it("adds a rect via ADD_PDF_RECT, present after a toBytes()/openPdf() round trip", () => {
    const opened = openPdfDocument(pdfTestBytes());

    const withRect = appReducer(opened, {
      type: "ADD_PDF_RECT",
      pageIndex: 0,
      init: {
        xPt: 5,
        yPt: 5,
        widthPt: 40,
        heightPt: 30,
        fill: { r: 0, g: 1, b: 0 },
      },
    });
    expect(pdfDocument(withRect).editor.page(0)?.items()).toHaveLength(2);

    const reopened = openPdf(pdfDocument(withRect).editor.toBytes());
    const items = reopened.page(0)?.items() ?? [];
    expect(items).toHaveLength(2);
    const rect = items.find((item) => item.kind === "rect");
    expect(rect).toBeDefined();
    if (rect?.kind !== "rect") {
      throw new Error("expected a real rect item after re-parsing");
    }
    expect(rect.widthPt).toBeCloseTo(40, 0);
    expect(rect.heightPt).toBeCloseTo(30, 0);
  });

  it("removes an item via REMOVE_PDF_ITEM, gone after save/reopen", () => {
    const opened = openPdfDocument(pdfTestBytes());
    const withRect = appReducer(opened, {
      type: "ADD_PDF_RECT",
      pageIndex: 0,
      init: { xPt: 5, yPt: 5, widthPt: 40, heightPt: 30 },
    });
    expect(pdfDocument(withRect).editor.page(0)?.items()).toHaveLength(2);

    const withRemoval = appReducer(withRect, {
      type: "REMOVE_PDF_ITEM",
      pageIndex: 0,
      itemIndex: 1,
    });
    expect(pdfDocument(withRemoval).editor.page(0)?.items()).toHaveLength(1);

    const reopened = openPdf(pdfDocument(withRemoval).editor.toBytes());
    const items = reopened.page(0)?.items() ?? [];
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe("text");
  });

  it("undoes a PDF text edit, restoring the snapshot taken before the mutation", () => {
    const opened = openPdfDocument(pdfTestBytes());
    const edited = appReducer(opened, {
      type: "SET_PDF_TEXT_TEXT",
      pageIndex: 0,
      itemIndex: 0,
      text: "Changed",
    });
    expect(edited.undoStack).toHaveLength(1);
    const liveEdited = pdfDocument(edited).editor.page(0)?.items()[0];
    expect(liveEdited?.kind === "text" ? liveEdited.text : undefined).toBe(
      "Changed",
    );

    const undone = appReducer(edited, { type: "UNDO" });
    expect(undone.undoStack).toHaveLength(0);
    expect(undone.hasUnsavedChanges).toBe(true);
    const restoredItem = pdfDocument(undone).editor.page(0)?.items()[0];
    expect(restoredItem?.kind === "text" ? restoredItem.text : undefined).toBe(
      "Hello",
    );
    // Undo replaces the editor wholesale by re-opening the snapshot bytes, matching every other editable format's own UNDO behaviour.
    expect(pdfDocument(undone).editor).not.toBe(pdfDocument(edited).editor);
  });

  it("edits a text item's font, size, rotation, width, and toggles underline on then off", () => {
    const opened = openPdfDocument(pdfTestBytes());
    const withFont = appReducer(opened, {
      type: "SET_PDF_TEXT_FONT",
      pageIndex: 0,
      itemIndex: 0,
      font: { family: "Courier", weight: "bold", style: "italic" },
    });
    const withSize = appReducer(withFont, {
      type: "SET_PDF_TEXT_SIZE",
      pageIndex: 0,
      itemIndex: 0,
      sizePt: 24,
    });
    const withRotation = appReducer(withSize, {
      type: "SET_PDF_TEXT_ROTATION",
      pageIndex: 0,
      itemIndex: 0,
      rotationDeg: 45,
    });
    const withWidth = appReducer(withRotation, {
      type: "SET_PDF_TEXT_WIDTH",
      pageIndex: 0,
      itemIndex: 0,
      widthPt: 99,
    });
    const underlineOn = appReducer(withWidth, {
      type: "TOGGLE_PDF_TEXT_UNDERLINE",
      pageIndex: 0,
      itemIndex: 0,
    });
    const onItem = pdfDocument(underlineOn).editor.page(0)?.items()[0];
    if (onItem?.kind !== "text") {
      throw new Error("expected a live text item");
    }
    expect(onItem.font).toStrictEqual({
      family: "Courier",
      weight: "bold",
      style: "italic",
    });
    expect(onItem.sizePt).toBe(24);
    expect(onItem.rotationDeg).toBe(45);
    expect(onItem.widthPt).toBe(99);
    expect(onItem.underline).toBe(true);

    const underlineOff = appReducer(underlineOn, {
      type: "TOGGLE_PDF_TEXT_UNDERLINE",
      pageIndex: 0,
      itemIndex: 0,
    });
    const offItem = pdfDocument(underlineOff).editor.page(0)?.items()[0];
    expect(offItem?.kind === "text" ? offItem.underline : undefined).toBe(
      false,
    );
  });

  it("warns rather than crashing when SET_PDF_TEXT_FONT, SET_PDF_TEXT_SIZE, and SET_PDF_TEXT_ROTATION target an item of the wrong kind", () => {
    const opened = openPdfDocument(pdfTestBytes());
    const withRect = appReducer(opened, {
      type: "ADD_PDF_RECT",
      pageIndex: 0,
      init: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
    });
    const fontResult = appReducer(withRect, {
      type: "SET_PDF_TEXT_FONT",
      pageIndex: 0,
      itemIndex: 1,
      font: { family: "Helvetica", weight: "normal", style: "normal" },
    });
    expect(fontResult.status?.text).toContain("not text");
    const sizeResult = appReducer(withRect, {
      type: "SET_PDF_TEXT_SIZE",
      pageIndex: 0,
      itemIndex: 1,
      sizePt: 10,
    });
    expect(sizeResult.status?.text).toContain("not text");
    const rotationResult = appReducer(withRect, {
      type: "SET_PDF_TEXT_ROTATION",
      pageIndex: 0,
      itemIndex: 1,
      rotationDeg: 0,
    });
    expect(rotationResult.status?.text).toContain("not text");
  });

  it("warns rather than crashing for a page index that does not exist", () => {
    const opened = openPdfDocument(pdfTestBytes());
    const result = appReducer(opened, {
      type: "ADD_PDF_RECT",
      pageIndex: 5,
      init: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toBe("There is no page at index 5");
    expect(result.hasUnsavedChanges).toBe(false);
  });

  it("warns rather than crashing when a field-edit action targets an item of the wrong kind", () => {
    const opened = openPdfDocument(pdfTestBytes());
    // Item 0 is the fixture's own text item, not a rect.
    const result = appReducer(opened, {
      type: "SET_PDF_RECT_FILL",
      pageIndex: 0,
      itemIndex: 0,
      fill: { r: 1, g: 0, b: 0 },
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toContain("not rect");
    expect(result.hasUnsavedChanges).toBe(false);
  });

  it("adds an ellipse via ADD_PDF_ELLIPSE, present after a toBytes()/openPdf() round trip", () => {
    const opened = openPdfDocument(pdfTestBytes());
    const withEllipse = appReducer(opened, {
      type: "ADD_PDF_ELLIPSE",
      pageIndex: 0,
      init: {
        xPt: 5,
        yPt: 5,
        widthPt: 20,
        heightPt: 10,
        fill: { r: 1, g: 0, b: 0 },
      },
    });
    const reopened = openPdf(pdfDocument(withEllipse).editor.toBytes());
    const ellipse = (reopened.page(0)?.items() ?? []).find(
      (item) => item.kind === "ellipse",
    );
    expect(ellipse).toBeDefined();
    if (ellipse?.kind !== "ellipse") {
      throw new Error("expected a real ellipse item after re-parsing");
    }
    expect(ellipse.widthPt).toBeCloseTo(20, 0);
    expect(ellipse.heightPt).toBeCloseTo(10, 0);
  });

  it("adds a line via ADD_PDF_LINE, present after a toBytes()/openPdf() round trip", () => {
    const opened = openPdfDocument(pdfTestBytes());
    const withLine = appReducer(opened, {
      type: "ADD_PDF_LINE",
      pageIndex: 0,
      init: {
        x1Pt: 1,
        y1Pt: 2,
        x2Pt: 30,
        y2Pt: 40,
        color: { r: 0, g: 0, b: 1 },
        widthPt: 2,
      },
    });
    const reopened = openPdf(pdfDocument(withLine).editor.toBytes());
    const line = (reopened.page(0)?.items() ?? []).find(
      (item) => item.kind === "line",
    );
    expect(line).toBeDefined();
    if (line?.kind !== "line") {
      throw new Error("expected a real line item after re-parsing");
    }
    expect(line.x2Pt).toBeCloseTo(30, 0);
    expect(line.y2Pt).toBeCloseTo(40, 0);
  });

  it("adds a path via ADD_PDF_PATH, present after a toBytes()/openPdf() round trip", () => {
    const opened = openPdfDocument(pdfTestBytes());
    const withPath = appReducer(opened, {
      type: "ADD_PDF_PATH",
      pageIndex: 0,
      init: {
        subpaths: [
          {
            startXPt: 0,
            startYPt: 0,
            closed: true,
            segments: [
              { kind: "line", xPt: 10, yPt: 0 },
              { kind: "line", xPt: 10, yPt: 10 },
            ],
          },
        ],
        fill: { r: 0, g: 1, b: 1 },
      },
    });
    const reopened = openPdf(pdfDocument(withPath).editor.toBytes());
    const path = (reopened.page(0)?.items() ?? []).find(
      (item) => item.kind === "path",
    );
    expect(path).toBeDefined();
  });

  it("adds an image via ADD_PDF_IMAGE, present after a toBytes()/openPdf() round trip", () => {
    const opened = openPdfDocument(pdfTestBytes());
    const withImage = appReducer(opened, {
      type: "ADD_PDF_IMAGE",
      pageIndex: 0,
      init: {
        xPt: 5,
        yPt: 5,
        widthPt: 30,
        heightPt: 20,
        bytes: REAL_PNG_BYTES,
        format: "png",
      },
    });
    const reopened = openPdf(pdfDocument(withImage).editor.toBytes());
    const image = (reopened.page(0)?.items() ?? []).find(
      (item) => item.kind === "image",
    );
    expect(image).toBeDefined();
    if (image?.kind !== "image") {
      throw new Error("expected a real image item after re-parsing");
    }
    expect(image.widthPt).toBeCloseTo(30, 0);
    expect(image.heightPt).toBeCloseTo(20, 0);
  });

  it("adds a link via ADD_PDF_LINK, present after a toBytes()/openPdf() round trip", () => {
    const opened = openPdfDocument(pdfTestBytes());
    const withLink = appReducer(opened, {
      type: "ADD_PDF_LINK",
      pageIndex: 0,
      init: {
        uri: "https://example.com",
        xPt: 5,
        yPt: 5,
        widthPt: 40,
        heightPt: 15,
      },
    });
    const reopened = openPdf(pdfDocument(withLink).editor.toBytes());
    const link = (reopened.page(0)?.items() ?? []).find(
      (item) => item.kind === "link",
    );
    expect(link).toBeDefined();
    if (link?.kind !== "link") {
      throw new Error("expected a real link item after re-parsing");
    }
    expect(link.uri).toBe("https://example.com");
  });

  describe("field edits on non-text pdf item kinds", () => {
    // One page carrying one of every editable non-text item kind, each added through the reducer's own ADD_PDF_* actions so tests below index into a document built the same way a real session would build one.
    function pdfMultiItemState(): AppState {
      const opened = openPdfDocument(pdfTestBytes());
      const withRect = appReducer(opened, {
        type: "ADD_PDF_RECT",
        pageIndex: 0,
        init: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      });
      const withEllipse = appReducer(withRect, {
        type: "ADD_PDF_ELLIPSE",
        pageIndex: 0,
        init: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      });
      const withLine = appReducer(withEllipse, {
        type: "ADD_PDF_LINE",
        pageIndex: 0,
        init: {
          x1Pt: 0,
          y1Pt: 0,
          x2Pt: 10,
          y2Pt: 10,
          color: { r: 0, g: 0, b: 0 },
          widthPt: 1,
        },
      });
      const withPath = appReducer(withLine, {
        type: "ADD_PDF_PATH",
        pageIndex: 0,
        init: {
          subpaths: [
            {
              startXPt: 0,
              startYPt: 0,
              closed: false,
              segments: [{ kind: "line", xPt: 5, yPt: 5 }],
            },
          ],
        },
      });
      const withImage = appReducer(withPath, {
        type: "ADD_PDF_IMAGE",
        pageIndex: 0,
        init: {
          xPt: 0,
          yPt: 0,
          widthPt: 10,
          heightPt: 10,
          bytes: REAL_PNG_BYTES,
          format: "png",
        },
      });
      return appReducer(withImage, {
        type: "ADD_PDF_LINK",
        pageIndex: 0,
        init: {
          uri: "https://before.example",
          xPt: 0,
          yPt: 0,
          widthPt: 10,
          heightPt: 10,
        },
      });
    }

    // Item order matches pdfMultiItemState()'s own build sequence: 0 text, 1 rect, 2 ellipse, 3 line, 4 path, 5 image, 6 link.
    const TEXT_INDEX = 0;
    const RECT_INDEX = 1;
    const ELLIPSE_INDEX = 2;
    const LINE_INDEX = 3;
    const PATH_INDEX = 4;
    const IMAGE_INDEX = 5;
    const LINK_INDEX = 6;

    it("edits a rect's frame, fill, and stroke in place", () => {
      const state = pdfMultiItemState();
      const withFrame = appReducer(state, {
        type: "SET_PDF_RECT_FRAME",
        pageIndex: 0,
        itemIndex: RECT_INDEX,
        xPt: 1,
        yPt: 2,
        widthPt: 33,
        heightPt: 44,
      });
      const withFill = appReducer(withFrame, {
        type: "SET_PDF_RECT_FILL",
        pageIndex: 0,
        itemIndex: RECT_INDEX,
        fill: { r: 1, g: 0.5, b: 0 },
      });
      const withStroke = appReducer(withFill, {
        type: "SET_PDF_RECT_STROKE",
        pageIndex: 0,
        itemIndex: RECT_INDEX,
        stroke: { color: { r: 0, g: 0, b: 1 }, widthPt: 3 },
      });
      const item = pdfDocument(withStroke).editor.page(0)?.items()[RECT_INDEX];
      if (item?.kind !== "rect") {
        throw new Error("expected a live rect item");
      }
      expect(item.xPt).toBe(1);
      expect(item.yPt).toBe(2);
      expect(item.widthPt).toBe(33);
      expect(item.heightPt).toBe(44);
      expect(item.fill).toStrictEqual({ r: 1, g: 0.5, b: 0 });
      expect(item.stroke).toStrictEqual({
        color: { r: 0, g: 0, b: 1 },
        widthPt: 3,
      });
    });

    it("warns rather than crashing when a rect field-edit targets an item of the wrong kind", () => {
      const state = pdfMultiItemState();
      const result = appReducer(state, {
        type: "SET_PDF_RECT_FRAME",
        pageIndex: 0,
        itemIndex: ELLIPSE_INDEX,
        xPt: 0,
        yPt: 0,
        widthPt: 1,
        heightPt: 1,
      });
      expect(result.status?.severity).toBe("warning");
      expect(result.status?.text).toContain("not rect");
    });

    it("edits an ellipse's frame, fill, and stroke in place", () => {
      const state = pdfMultiItemState();
      const withFrame = appReducer(state, {
        type: "SET_PDF_ELLIPSE_FRAME",
        pageIndex: 0,
        itemIndex: ELLIPSE_INDEX,
        xPt: 3,
        yPt: 4,
        widthPt: 22,
        heightPt: 11,
      });
      const withFill = appReducer(withFrame, {
        type: "SET_PDF_ELLIPSE_FILL",
        pageIndex: 0,
        itemIndex: ELLIPSE_INDEX,
        fill: { r: 0, g: 1, b: 0 },
      });
      const withStroke = appReducer(withFill, {
        type: "SET_PDF_ELLIPSE_STROKE",
        pageIndex: 0,
        itemIndex: ELLIPSE_INDEX,
        stroke: { color: { r: 1, g: 1, b: 0 }, widthPt: 2 },
      });
      const item = pdfDocument(withStroke).editor.page(0)?.items()[
        ELLIPSE_INDEX
      ];
      if (item?.kind !== "ellipse") {
        throw new Error("expected a live ellipse item");
      }
      expect(item.widthPt).toBe(22);
      expect(item.heightPt).toBe(11);
      expect(item.fill).toStrictEqual({ r: 0, g: 1, b: 0 });
      expect(item.stroke).toStrictEqual({
        color: { r: 1, g: 1, b: 0 },
        widthPt: 2,
      });
    });

    it("warns rather than crashing when an ellipse field-edit targets an item of the wrong kind", () => {
      const state = pdfMultiItemState();
      const result = appReducer(state, {
        type: "SET_PDF_ELLIPSE_FILL",
        pageIndex: 0,
        itemIndex: LINE_INDEX,
        fill: { r: 0, g: 0, b: 0 },
      });
      expect(result.status?.severity).toBe("warning");
      expect(result.status?.text).toContain("not ellipse");
    });

    it("edits a line's endpoints, color, and width in place", () => {
      const state = pdfMultiItemState();
      const withFrom = appReducer(state, {
        type: "SET_PDF_LINE_FROM",
        pageIndex: 0,
        itemIndex: LINE_INDEX,
        x1Pt: 7,
        y1Pt: 8,
      });
      const withTo = appReducer(withFrom, {
        type: "SET_PDF_LINE_TO",
        pageIndex: 0,
        itemIndex: LINE_INDEX,
        x2Pt: 70,
        y2Pt: 80,
      });
      const withColor = appReducer(withTo, {
        type: "SET_PDF_LINE_COLOR",
        pageIndex: 0,
        itemIndex: LINE_INDEX,
        color: { r: 0.2, g: 0.3, b: 0.4 },
      });
      const withWidth = appReducer(withColor, {
        type: "SET_PDF_LINE_WIDTH",
        pageIndex: 0,
        itemIndex: LINE_INDEX,
        widthPt: 5,
      });
      const item = pdfDocument(withWidth).editor.page(0)?.items()[LINE_INDEX];
      if (item?.kind !== "line") {
        throw new Error("expected a live line item");
      }
      expect(item.x1Pt).toBe(7);
      expect(item.y1Pt).toBe(8);
      expect(item.x2Pt).toBe(70);
      expect(item.y2Pt).toBe(80);
      expect(item.color).toStrictEqual({ r: 0.2, g: 0.3, b: 0.4 });
      expect(item.widthPt).toBe(5);
    });

    it("warns rather than crashing when a line field-edit targets an item of the wrong kind", () => {
      const state = pdfMultiItemState();
      const result = appReducer(state, {
        type: "SET_PDF_LINE_WIDTH",
        pageIndex: 0,
        itemIndex: PATH_INDEX,
        widthPt: 1,
      });
      expect(result.status?.severity).toBe("warning");
      expect(result.status?.text).toContain("not line");
    });

    it("edits a path's fill, fill rule, and stroke in place", () => {
      const state = pdfMultiItemState();
      const withFill = appReducer(state, {
        type: "SET_PDF_PATH_FILL",
        pageIndex: 0,
        itemIndex: PATH_INDEX,
        fill: { r: 1, g: 0, b: 1 },
      });
      const withRule = appReducer(withFill, {
        type: "SET_PDF_PATH_FILL_RULE",
        pageIndex: 0,
        itemIndex: PATH_INDEX,
        fillRule: "evenodd",
      });
      const withStroke = appReducer(withRule, {
        type: "SET_PDF_PATH_STROKE",
        pageIndex: 0,
        itemIndex: PATH_INDEX,
        stroke: { color: { r: 0, g: 0, b: 0 }, widthPt: 1.5 },
      });
      const item = pdfDocument(withStroke).editor.page(0)?.items()[PATH_INDEX];
      if (item?.kind !== "path") {
        throw new Error("expected a live path item");
      }
      expect(item.fill).toStrictEqual({ r: 1, g: 0, b: 1 });
      expect(item.fillRule).toBe("evenodd");
      expect(item.stroke).toStrictEqual({
        color: { r: 0, g: 0, b: 0 },
        widthPt: 1.5,
      });
    });

    it("warns rather than crashing when a path field-edit targets an item of the wrong kind", () => {
      const state = pdfMultiItemState();
      const result = appReducer(state, {
        type: "SET_PDF_PATH_FILL_RULE",
        pageIndex: 0,
        itemIndex: IMAGE_INDEX,
        fillRule: "nonzero",
      });
      expect(result.status?.severity).toBe("warning");
      expect(result.status?.text).toContain("not path");
    });

    it("edits an image's frame, rotation, and source in place", () => {
      const state = pdfMultiItemState();
      const withFrame = appReducer(state, {
        type: "SET_PDF_IMAGE_FRAME",
        pageIndex: 0,
        itemIndex: IMAGE_INDEX,
        xPt: 9,
        yPt: 10,
        widthPt: 15,
        heightPt: 25,
      });
      const withRotation = appReducer(withFrame, {
        type: "SET_PDF_IMAGE_ROTATION",
        pageIndex: 0,
        itemIndex: IMAGE_INDEX,
        rotationDeg: 90,
      });
      const beforeItem = pdfDocument(withRotation).editor.page(0)?.items()[
        IMAGE_INDEX
      ];
      if (beforeItem?.kind !== "image") {
        throw new Error("expected a live image item");
      }
      // Read the string value now, before the mutation below: beforeItem is a live view over the same underlying node, so its own .imageId getter would report the POST-mutation value if read only after withSource exists.
      const beforeImageIdValue = beforeItem.imageId;
      const withSource = appReducer(withRotation, {
        type: "SET_PDF_IMAGE_SOURCE",
        pageIndex: 0,
        itemIndex: IMAGE_INDEX,
        // A different real, decodable PNG (1x1 blue rather than REAL_PNG_BYTES' red) -- distinct content, so registerImageBytes' own dedup-by-content assigns it a genuinely different imageId, proving setImage repointed the item rather than leaving it unchanged.
        bytes: new Uint8Array([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00,
          0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00,
          0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde,
          0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x78, 0xda, 0x63,
          0x60, 0x60, 0xf8, 0x0f, 0x00, 0x01, 0x03, 0x01, 0x00, 0x36, 0x74,
          0x11, 0x40, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
          0x42, 0x60, 0x82,
        ]),
        format: "png",
      });
      const item = pdfDocument(withSource).editor.page(0)?.items()[IMAGE_INDEX];
      if (item?.kind !== "image") {
        throw new Error("expected a live image item");
      }
      expect(item.widthPt).toBe(15);
      expect(item.heightPt).toBe(25);
      expect(item.rotationDeg).toBe(90);
      expect(item.imageId).not.toBe(beforeImageIdValue);
    });

    it("warns rather than crashing when an image field-edit targets an item of the wrong kind", () => {
      const state = pdfMultiItemState();
      const result = appReducer(state, {
        type: "SET_PDF_IMAGE_ROTATION",
        pageIndex: 0,
        itemIndex: LINK_INDEX,
        rotationDeg: 0,
      });
      expect(result.status?.severity).toBe("warning");
      expect(result.status?.text).toContain("not image");
    });

    it("edits a link's uri and frame in place", () => {
      const state = pdfMultiItemState();
      const withUri = appReducer(state, {
        type: "SET_PDF_LINK_URI",
        pageIndex: 0,
        itemIndex: LINK_INDEX,
        uri: "https://after.example",
      });
      const withFrame = appReducer(withUri, {
        type: "SET_PDF_LINK_FRAME",
        pageIndex: 0,
        itemIndex: LINK_INDEX,
        xPt: 11,
        yPt: 12,
        widthPt: 50,
        heightPt: 20,
      });
      const item = pdfDocument(withFrame).editor.page(0)?.items()[LINK_INDEX];
      if (item?.kind !== "link") {
        throw new Error("expected a live link item");
      }
      expect(item.uri).toBe("https://after.example");
      expect(item.xPt).toBe(11);
      expect(item.yPt).toBe(12);
      expect(item.widthPt).toBe(50);
      expect(item.heightPt).toBe(20);
    });

    it("warns rather than crashing when a link field-edit targets an item of the wrong kind", () => {
      const state = pdfMultiItemState();
      const result = appReducer(state, {
        type: "SET_PDF_LINK_URI",
        pageIndex: 0,
        itemIndex: TEXT_INDEX,
        uri: "https://wrong.example",
      });
      expect(result.status?.severity).toBe("warning");
      expect(result.status?.text).toContain("not link");
    });

    // internalLink items arise only from reading a real PDF's own GoTo/Dest annotations (PdfPage has no appendInternalLink -- unlike every other item kind, there is no way to add one fresh through the editor), so only the wrong-kind guard is reachable here; the success path is exercised at the pdf-codec layer instead (see its own navigation.test.ts).
    it("warns rather than crashing when an internal-link destination edit targets an item of the wrong kind", () => {
      const state = pdfMultiItemState();
      const result = appReducer(state, {
        type: "SET_PDF_INTERNAL_LINK_DESTINATION",
        pageIndex: 0,
        itemIndex: TEXT_INDEX,
        destination: "dest1",
      });
      expect(result.status?.severity).toBe("warning");
      expect(result.status?.text).toContain("not internalLink");
    });

    it("warns rather than crashing when an internal-link frame edit targets an item of the wrong kind", () => {
      const state = pdfMultiItemState();
      const result = appReducer(state, {
        type: "SET_PDF_INTERNAL_LINK_FRAME",
        pageIndex: 0,
        itemIndex: TEXT_INDEX,
        xPt: 1,
        yPt: 2,
        widthPt: 3,
        heightPt: 4,
      });
      expect(result.status?.severity).toBe("warning");
      expect(result.status?.text).toContain("not internalLink");
    });

    // Every other SET_PDF_*_* field-edit action routes through the identical withPdfItemMatching guard, but each call site carries its OWN copy of the kindLabel string literal -- exercising the wrong-kind path through the FRAME/FILL/one representative action per kind above does not cover the same literal at a sibling action's own call site (e.g. SET_PDF_RECT_FRAME's "rect" and SET_PDF_RECT_STROKE's "rect" are two distinct AST nodes). This table drives every remaining action through the wrong-kind branch once each.
    const wrongKindCases: [string, Action, string][] = [
      [
        "SET_PDF_TEXT_TEXT",
        {
          type: "SET_PDF_TEXT_TEXT",
          pageIndex: 0,
          itemIndex: RECT_INDEX,
          text: "x",
        },
        "not text",
      ],
      [
        "SET_PDF_TEXT_POSITION",
        {
          type: "SET_PDF_TEXT_POSITION",
          pageIndex: 0,
          itemIndex: RECT_INDEX,
          xPt: 0,
          yPt: 0,
        },
        "not text",
      ],
      [
        "SET_PDF_TEXT_COLOR",
        {
          type: "SET_PDF_TEXT_COLOR",
          pageIndex: 0,
          itemIndex: RECT_INDEX,
          color: { r: 0, g: 0, b: 0 },
        },
        "not text",
      ],
      [
        "SET_PDF_TEXT_WIDTH",
        {
          type: "SET_PDF_TEXT_WIDTH",
          pageIndex: 0,
          itemIndex: RECT_INDEX,
          widthPt: 1,
        },
        "not text",
      ],
      [
        "TOGGLE_PDF_TEXT_UNDERLINE",
        {
          type: "TOGGLE_PDF_TEXT_UNDERLINE",
          pageIndex: 0,
          itemIndex: RECT_INDEX,
        },
        "not text",
      ],
      [
        "SET_PDF_RECT_STROKE",
        {
          type: "SET_PDF_RECT_STROKE",
          pageIndex: 0,
          itemIndex: TEXT_INDEX,
          stroke: { color: { r: 0, g: 0, b: 0 }, widthPt: 1 },
        },
        "not rect",
      ],
      [
        "SET_PDF_ELLIPSE_FRAME",
        {
          type: "SET_PDF_ELLIPSE_FRAME",
          pageIndex: 0,
          itemIndex: TEXT_INDEX,
          xPt: 0,
          yPt: 0,
          widthPt: 1,
          heightPt: 1,
        },
        "not ellipse",
      ],
      [
        "SET_PDF_ELLIPSE_STROKE",
        {
          type: "SET_PDF_ELLIPSE_STROKE",
          pageIndex: 0,
          itemIndex: TEXT_INDEX,
          stroke: { color: { r: 0, g: 0, b: 0 }, widthPt: 1 },
        },
        "not ellipse",
      ],
      [
        "SET_PDF_LINE_FROM",
        {
          type: "SET_PDF_LINE_FROM",
          pageIndex: 0,
          itemIndex: TEXT_INDEX,
          x1Pt: 0,
          y1Pt: 0,
        },
        "not line",
      ],
      [
        "SET_PDF_LINE_TO",
        {
          type: "SET_PDF_LINE_TO",
          pageIndex: 0,
          itemIndex: TEXT_INDEX,
          x2Pt: 0,
          y2Pt: 0,
        },
        "not line",
      ],
      [
        "SET_PDF_LINE_COLOR",
        {
          type: "SET_PDF_LINE_COLOR",
          pageIndex: 0,
          itemIndex: TEXT_INDEX,
          color: { r: 0, g: 0, b: 0 },
        },
        "not line",
      ],
      [
        "SET_PDF_PATH_FILL",
        {
          type: "SET_PDF_PATH_FILL",
          pageIndex: 0,
          itemIndex: TEXT_INDEX,
          fill: { r: 0, g: 0, b: 0 },
        },
        "not path",
      ],
      [
        "SET_PDF_PATH_STROKE",
        {
          type: "SET_PDF_PATH_STROKE",
          pageIndex: 0,
          itemIndex: TEXT_INDEX,
          stroke: { color: { r: 0, g: 0, b: 0 }, widthPt: 1 },
        },
        "not path",
      ],
      [
        "SET_PDF_IMAGE_FRAME",
        {
          type: "SET_PDF_IMAGE_FRAME",
          pageIndex: 0,
          itemIndex: TEXT_INDEX,
          xPt: 0,
          yPt: 0,
          widthPt: 1,
          heightPt: 1,
        },
        "not image",
      ],
      [
        "SET_PDF_IMAGE_SOURCE",
        {
          type: "SET_PDF_IMAGE_SOURCE",
          pageIndex: 0,
          itemIndex: TEXT_INDEX,
          format: "png",
          bytes: REAL_PNG_BYTES,
        },
        "not image",
      ],
      [
        "SET_PDF_LINK_FRAME",
        {
          type: "SET_PDF_LINK_FRAME",
          pageIndex: 0,
          itemIndex: TEXT_INDEX,
          xPt: 0,
          yPt: 0,
          widthPt: 1,
          heightPt: 1,
        },
        "not link",
      ],
    ];

    it.each(wrongKindCases)(
      "warns rather than crashing when %s targets an item of the wrong kind",
      (_name, action, expectedFragment) => {
        const state = pdfMultiItemState();
        const result = appReducer(state, action);
        expect(result.status?.severity).toBe("warning");
        expect(result.status?.text).toContain(expectedFragment);
      },
    );
  });
});

describe("appReducer INSERT_ODT_FORMULA", () => {
  it("rebuilds an element/text tree as fresh mutable objects, and collapses cdata/comment/declaration/pi nodes to their documented empty stand-ins", () => {
    const opened = openOdtDocument(createOdt().toBytes());
    const mathml: MathMlNode[] = [
      {
        type: "element",
        tag: "mrow",
        attributes: [{ name: "class", value: "unit" }],
        children: [
          { type: "text", value: "a" },
          { type: "cdata" },
          { type: "comment" },
          { type: "declaration" },
          { type: "pi" },
        ],
      },
    ];
    const withFormula = appReducer(opened, {
      type: "INSERT_ODT_FORMULA",
      mathml,
      frame: { xPt: 0, yPt: 0, widthPt: 20, heightPt: 10 },
    });
    expect(withFormula.hasUnsavedChanges).toBe(true);

    const content = readOdtContent(odtDocument(withFormula).editor.toPackage());
    if (content.kind !== "wordprocessing") {
      throw new Error(
        `expected a wordprocessing ContentDocument, got ${content.kind}`,
      );
    }
    const block = content.sections
      .flatMap((section) => section.blocks)
      .find((candidate) => candidate.kind === "embeddedObject");
    if (block?.kind !== "embeddedObject") {
      throw new Error("expected an embedded formula block");
    }
    const formula = formulaOfBlock(block);
    if (formula === undefined) {
      throw new Error("expected the embedded object to carry a formula");
    }
    const root = formula.mathml[0];
    if (root?.type !== "element") {
      throw new Error("expected the root node to survive as a real element");
    }
    expect(root.tag).toBe("mrow");
    expect(root.attributes).toStrictEqual([{ name: "class", value: "unit" }]);
    expect(root.children).toStrictEqual([
      { type: "text", value: "a" },
      { type: "cdata", value: "" },
      { type: "comment", value: "" },
      { type: "declaration", attributes: [] },
      { type: "pi", target: "", content: "" },
    ]);
  });

  it("warns rather than crashing when the open document is not odt", () => {
    const created = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "docx",
    });
    const result = appReducer(created, {
      type: "INSERT_ODT_FORMULA",
      mathml: [{ type: "element", tag: "mi", attributes: [], children: [] }],
      frame: { xPt: 0, yPt: 0, widthPt: 20, heightPt: 10 },
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toContain("an odt document");
  });
});

describe("appReducer ADD_RECT / ADD_ELLIPSE / ADD_LINE / ADD_PATH on odp", () => {
  it("adds each real vector kind to an odp slide, reachable through OdpSlide.addVector -- recovered by readOdpContent as a synthetic embedded drawing block, since ContentSlide itself has no vectors array", () => {
    const editor = createOdp();
    editor.addSlide();
    const opened = openOdpDocument(editor.toBytes());

    const withRect = appReducer(opened, {
      type: "ADD_RECT",
      containerIndex: 0,
      init: {
        frame: { xPt: 10, yPt: 10, widthPt: 40, heightPt: 30 },
        fill: { r: 1, g: 0, b: 0 },
      },
    });
    const withEllipse = appReducer(withRect, {
      type: "ADD_ELLIPSE",
      containerIndex: 0,
      init: { frame: { xPt: 60, yPt: 10, widthPt: 40, heightPt: 30 } },
    });
    const withLine = appReducer(withEllipse, {
      type: "ADD_LINE",
      containerIndex: 0,
      init: {
        from: { xPt: 0, yPt: 100 },
        to: { xPt: 100, yPt: 100 },
        stroke: { color: { r: 0, g: 0, b: 0 }, widthPt: 1 },
      },
    });
    const withPath = appReducer(withLine, {
      type: "ADD_PATH",
      containerIndex: 0,
      init: {
        frame: { xPt: 0, yPt: 150, widthPt: 50, heightPt: 50 },
        subpaths: [
          {
            start: { xPt: 0, yPt: 50 },
            segments: [
              { kind: "line", to: { xPt: 25, yPt: 0 } },
              { kind: "line", to: { xPt: 50, yPt: 50 } },
            ],
            closed: true,
          },
        ],
      },
    });
    expect(withPath.hasUnsavedChanges).toBe(true);

    const content = readOdpContent(odpDocument(withPath).editor.toPackage());
    if (content.kind !== "presentation") {
      throw new Error(
        `expected a presentation ContentDocument, got ${content.kind}`,
      );
    }
    const drawingShape = content.slides[0]?.shapes.find(
      (shape) => shape.blocks[0]?.kind === "embeddedObject",
    );
    const drawingBlock = drawingShape?.blocks[0];
    if (drawingBlock?.kind !== "embeddedObject") {
      throw new Error(
        "expected a synthetic embeddedObject shape carrying the four recovered vectors",
      );
    }
    const drawing = drawingOfBlock(drawingBlock);
    if (drawing === undefined) {
      throw new Error("expected the embedded object to be a drawing document");
    }
    expect(drawing.pages[0]?.vectors.map((vector) => vector.kind)).toEqual([
      "rect",
      "ellipse",
      "line",
      "path",
    ]);
  });

  it("warns rather than crashing for a slide index that does not exist", () => {
    const editor = createOdp();
    editor.addSlide();
    const opened = openOdpDocument(editor.toBytes());

    const result = appReducer(opened, {
      type: "ADD_RECT",
      containerIndex: 5,
      init: { frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 } },
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.hasUnsavedChanges).toBe(false);
  });

  it("warns rather than crashing when the open document is neither odg nor odp", () => {
    const created = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "docx",
    });
    const result = appReducer(created, {
      type: "ADD_RECT",
      containerIndex: 0,
      init: { frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 } },
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toContain("odg or odp");
  });

  // The rename of this action family's own addressing field from `pageIndex` to `containerIndex` (see actions.ts's own top-of-file note) must not have disturbed odg's own pre-existing behaviour.
  it("still adds a real vector to an odg page, unchanged from before the containerIndex rename", () => {
    const editor = createOdg();
    editor.addPage();
    const opened = openOdgDocument(editor.toBytes());

    const withRect = appReducer(opened, {
      type: "ADD_RECT",
      containerIndex: 0,
      init: { frame: { xPt: 10, yPt: 10, widthPt: 40, heightPt: 30 } },
    });
    expect(withRect.hasUnsavedChanges).toBe(true);
    expect(odgDocument(withRect).editor.pages()[0]?.vectors()).toHaveLength(1);
  });

  // The odg branch dispatches through its own inner switch (addRect/addEllipse/addLine/addPath), one case per real OdgPage method -- distinct from the ADD_RECT/ADD_ELLIPSE/ADD_LINE/ADD_PATH coverage above, which only ever reaches odg via ADD_RECT. Each case is its own switch-statement mutant, so proving the rect case works says nothing about whether removing the ellipse/line/path cases would still pass.
  it("adds each real vector kind to an odg page via the page's own addEllipse/addLine/addPath", () => {
    const editor = createOdg();
    editor.addPage();
    const opened = openOdgDocument(editor.toBytes());

    const withEllipse = appReducer(opened, {
      type: "ADD_ELLIPSE",
      containerIndex: 0,
      init: { frame: { xPt: 60, yPt: 10, widthPt: 40, heightPt: 30 } },
    });
    const withLine = appReducer(withEllipse, {
      type: "ADD_LINE",
      containerIndex: 0,
      init: {
        from: { xPt: 0, yPt: 100 },
        to: { xPt: 100, yPt: 100 },
        stroke: { color: { r: 0, g: 0, b: 0 }, widthPt: 1 },
      },
    });
    const withPath = appReducer(withLine, {
      type: "ADD_PATH",
      containerIndex: 0,
      init: {
        frame: { xPt: 0, yPt: 150, widthPt: 50, heightPt: 50 },
        subpaths: [
          {
            start: { xPt: 0, yPt: 50 },
            segments: [{ kind: "line", to: { xPt: 25, yPt: 0 } }],
            closed: false,
          },
        ],
      },
    });
    expect(withPath.hasUnsavedChanges).toBe(true);
    const vectors = odgDocument(withPath).editor.pages()[0]?.vectors();
    expect(vectors?.map((vector) => vector.kind)).toEqual([
      "ellipse",
      "line",
      "path",
    ]);
  });
});

describe("appReducer SET_VECTOR_FILL / SET_VECTOR_STROKE on odg", () => {
  it("edits a real rect vector's fill and stroke, and the change round-trips through re-decoding the package", () => {
    const editor = createOdg();
    const page = editor.addPage();
    page.addRect({
      frame: { xPt: 10, yPt: 10, widthPt: 40, heightPt: 30 },
      fill: { r: 1, g: 0, b: 0 },
    });
    const opened = openOdgDocument(editor.toBytes());

    const liveVector = odgDocument(opened).editor.pages()[0]?.vectors()[0];
    if (liveVector === undefined || liveVector.kind === "line") {
      throw new Error("expected a rect vector");
    }

    const filled = appReducer(opened, {
      type: "SET_VECTOR_FILL",
      vector: liveVector,
      fill: { r: 0, g: 1, b: 0 },
    });
    expect(filled.hasUnsavedChanges).toBe(true);
    // The live view means the vector object captured before the action already reflects the mutation.
    expect(liveVector.fill).toEqual({ r: 0, g: 1, b: 0 });

    const stroked = appReducer(filled, {
      type: "SET_VECTOR_STROKE",
      vector: liveVector,
      stroke: { color: { r: 0, g: 0, b: 1 }, widthPt: 2 },
    });
    expect(stroked.hasUnsavedChanges).toBe(true);
    expect(liveVector.stroke).toEqual({
      color: { r: 0, g: 0, b: 1 },
      widthPt: 2,
    });

    // Re-decoding the saved bytes as a completely fresh package proves both edits were written into the real draw:rect element, not just held on the live in-memory object.
    const reopened = openOdg(odgDocument(stroked).editor.toBytes());
    const reopenedVector = reopened.pages()[0]?.vectors()[0];
    if (reopenedVector === undefined || reopenedVector.kind === "line") {
      throw new Error("expected a rect vector after re-decoding");
    }
    expect(reopenedVector.fill).toEqual({ r: 0, g: 1, b: 0 });
    expect(reopenedVector.stroke).toEqual({
      color: { r: 0, g: 0, b: 1 },
      widthPt: 2,
    });
  });

  it("warns instead of mutating when the open document is the wrong format", () => {
    const editor = createOdg();
    const page = editor.addPage();
    const rect = page.addRect({
      frame: { xPt: 10, yPt: 10, widthPt: 40, heightPt: 30 },
    });
    const state = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "docx",
    });

    const result = appReducer(state, {
      type: "SET_VECTOR_FILL",
      vector: rect,
      fill: { r: 1, g: 1, b: 1 },
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.hasUnsavedChanges).toBe(false);
  });
});

describe("appReducer diagnostics and selection", () => {
  it("appends, dismisses and clears diagnostics", () => {
    const withTwo = applyAll([
      {
        type: "APPEND_DIAGNOSTIC",
        diagnostic: { severity: "info", message: "first" },
      },
      {
        type: "APPEND_DIAGNOSTIC",
        diagnostic: { severity: "warning", message: "second", pageIndex: 1 },
      },
    ]);
    expect(withTwo.diagnostics).toHaveLength(2);

    const dismissed = appReducer(withTwo, {
      type: "DISMISS_DIAGNOSTIC",
      index: 0,
    });
    expect(
      dismissed.diagnostics.map((diagnostic) => diagnostic.message),
    ).toEqual(["second"]);
    expect(
      appReducer(dismissed, { type: "CLEAR_DIAGNOSTICS" }).diagnostics,
    ).toEqual([]);
  });

  it("records a selection index per key", () => {
    const state = applyAll([
      { type: "SET_SELECTION", key: "bodyList", index: 4 },
      { type: "SET_SELECTION", key: "slideDetail:2", index: 1 },
    ]);
    expect(state.selection).toEqual({ bodyList: 4, "slideDetail:2": 1 });
  });
});
