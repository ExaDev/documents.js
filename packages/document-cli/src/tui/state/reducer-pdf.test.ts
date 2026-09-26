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
  openDoc,
  openMarkdown,
  openOdg,
  openOdp,
  openOds,
  openOdt,
  openPpt,
  openPptx,
  openXls,
  readOdpContent,
  readPptxContent,
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
  OdpOpenDocument,
  PptxOpenDocument,
  RtfOpenDocument,
  SvgOpenDocument,
  WpdOpenDocument,
  XlsxOpenDocument,
} from "./types.js";
import { isEditableDocument } from "./types.js";
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
]);

// A genuinely decodable 1x1 red PNG (real IHDR/IDAT/IEND chunks, truecolor, no filter). Unlike PNG_BYTES above, PdfPage.appendImage -> registerImageBytes DOES decode the pixel grid (to size the image asset it registers), so a fake signature-only PNG throws "PNG file does not begin with an IHDR chunk" here.
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

// A MarkdownOpenDocument seeded from real source text (as opposed to CREATE_DOCUMENT's fresh, empty one — see the "creates a new markdown document" test below) via OPEN_FILE_SUCCESS, the same action openDocumentAtPath's own real caller dispatches, with a genuine live-view MarkdownEditor built via openMarkdown — the same one open-document.ts's own markdown branch builds.
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

  // MarkdownRun/MarkdownParagraph genuinely have no underline/colour/font-family/font-size/alignment field at all — these four actions are narrowed to docx/odt only in the reducer (styledWordprocessingDocument/withStyledRun), so dispatching one against a markdown document reports why rather than throwing or silently doing nothing.
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
    expect(alignmentResult.status?.text).toBe(
      "That action needs a docx or odt document; the open document is markdown",
    );

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
    expect(imageResult.status?.text).toBe(
      "That action needs a docx or odt document; the open document is markdown",
    );
  });

  // GFM tables have no cell-merge concept at all — MarkdownTable has no mergeCells — so a merge requested alongside table creation still creates the (unmerged) table and reports why the merge didn't happen, rather than silently dropping the merge or refusing to create the table.
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
    expect(warned.status?.text).toBe(
      "That action needs a docx, odt or markdown document; the open document is ods",
    );
    expect(warned.hasUnsavedChanges).toBe(false);
  });
});

describe("appReducer doc (legacy Word) mutations", () => {
  // wordprocessingDocument's own format union admits doc alongside docx/odt/markdown — covered here specifically because every other member is already exercised elsewhere by name, and a mutant collapsing this one arm of the union would only ever be caught by a doc-format dispatch.
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

  // styledWordprocessingDocument's own format union admits doc alongside docx/odt (never markdown, which has no such fields at all — see the markdown describe block above) — covered here for the identical reason: doc is the one arm nothing else in this file dispatches through this specific function.
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
  // Proves undo generalises to markdown's own live-view MarkdownEditor with zero markdown-specific reducer code beyond toUndoSnapshot's own byte<->text branch — the same encodeMarkdownText/decodeMarkdownText round trip through the shared undo stack every other mutating action already uses.
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
    expect(undone.status?.text).toBe("Undone");
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
    expect(undone.status?.text).toBe("There is nothing to undo");
    expect(undone.openDocument).toBe(created.openDocument);
  });

  // A genuinely separate code path from the test above: that one has an open document with an empty undo stack (the `snapshot === undefined` branch); this one has no open document at all (the earlier `doc === undefined` branch), which produces the identical message through different code.
  it("says there is nothing to undo when no document is open at all", () => {
    const undone = appReducer(createInitialState(), { type: "UNDO" });
    expect(undone.status?.severity).toBe("info");
    expect(undone.status?.text).toBe("There is nothing to undo");
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

    // Undoing 20 times empties the capped stack exactly — proving the retained entries are the 20 MOST RECENT snapshots (the tail), not an arbitrary 20, since undoing keeps peeling paragraphs off the end down to a stable, non-empty prefix rather than running out early or restoring past the true starting point.
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

  // reopenEditable's own switch has one case per EditableOpenDocument format — docx and pdf are already exercised by the undo tests above, so this covers every remaining branch (pptx/odt/odp/ods/odg/doc/xls/ppt) the same way: mutate via SET_METADATA (the one action every editable format's own editor.metadata setter accepts identically), then undo, and prove the format survived the reopen and a genuinely fresh editor replaced the mutated one.
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

    // PptxSlide.shapes() never returns a table graphicFrame at all (documents.js's own shapes() walk only matches p:sp/p:pic), so the only way to observe the table this reducer just added is the same read-only pivot readPptxContent already uses — proving the mutation reached the real package, not just that the action was accepted.
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
    expect(result.status?.text).toBe("There is no slide at index 5");
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

// The grid rule (ContentTableCell in document-schema.js): a merged region reads back as one anchor plus a real, block-less covered entry at every other position it spans, and every row has one entry per grid column. Checks a 3x3 table whose top-left 2x2 region was merged, by classifying every position through walkTableGrid rather than by index arithmetic of its own.
