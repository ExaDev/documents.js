import { createOds, odsToXlsx, readPdf, xlsxToPdf } from "documents.js";
import { describe, expect, it } from "vitest";
import type { Action } from "./actions.js";
import { appReducer, createInitialState } from "./reducer.js";
import type { AppState, MarkdownOpenDocument } from "./types.js";
function applyAll(
  actions: readonly Action[],
  from: AppState = createInitialState(),
): AppState {
  return actions.reduce<AppState>(appReducer, from);
}

function xlsxTestBytes(): Uint8Array<ArrayBuffer> {
  const editor = createOds();
  const sheet = editor.addSheet("Sheet1");
  sheet.cell(0, 0).value = { kind: "string", value: "Total" };
  return odsToXlsx(editor.toBytes());
}

// Mirrors format/open-document.ts's own xlsx branch exactly, so these reducer tests exercise OPEN_FILE_SUCCESS/UNDO against the identical XlsxOpenDocument shape the real TUI produces.
function markdownDocument(state: AppState): MarkdownOpenDocument {
  const doc = state.openDocument;
  if (doc?.format !== "markdown") {
    throw new Error("expected an open markdown document");
  }
  return doc;
}

// A MarkdownOpenDocument seeded from real source text (as opposed to CREATE_DOCUMENT's fresh, empty one — see the "creates a new markdown document" test below) via OPEN_FILE_SUCCESS, the same action openDocumentAtPath's own real caller dispatches, with a genuine live-view MarkdownEditor built via openMarkdown — the same one open-document.ts's own markdown branch builds.

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
    const confirmed = appReducer(asked, { type: "CONFIRM_QUIT" });
    expect(confirmed.isExiting).toBe(true);
    expect(confirmed.overlays.confirmQuit).toBe(false);

    const cancelled = appReducer(asked, { type: "CANCEL_QUIT" });
    expect(cancelled.isExiting).toBe(false);
    expect(cancelled.overlays.confirmQuit).toBe(false);
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
      expect(state.status?.text).toBe(`New ${action.format} document`);
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
    expect(result.status?.text).toBe(
      "Saved, but there is no open document to record the path against",
    );
    expect(result.hasUnsavedChanges).toBe(false);
  });

  // documentWithPath's own read-only-preview branches (xlsx/csv/svg/rtf) are otherwise never reached by any other action — SAVE_AS on one of these formats is the only path that dispatches SAVE_SUCCESS against them, so this proves the layout/bytes pair survives the rewrite untouched alongside the new path.
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

describe("appReducer SAVE_ERROR", () => {
  it("surfaces the failure message as an error status, without touching hasUnsavedChanges", () => {
    const dirty = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "docx",
    });
    const result = appReducer(dirty, {
      type: "SAVE_ERROR",
      message: "disk is full",
    });
    expect(result.status?.severity).toBe("error");
    expect(result.status?.text).toBe("disk is full");
    expect(result.hasUnsavedChanges).toBe(dirty.hasUnsavedChanges);
  });
});
