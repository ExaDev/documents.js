import { describe, expect, it } from "vitest";
import type { Action } from "./actions.js";
import { appReducer, createInitialState } from "./reducer.js";
import type { AppState } from "./types.js";
function applyAll(
  actions: readonly Action[],
  from: AppState = createInitialState(),
): AppState {
  return actions.reduce<AppState>(appReducer, from);
}

describe("appReducer OPEN_FILE_ERROR", () => {
  it("records the failure as an error status and populates errorDetail", () => {
    const result = appReducer(createInitialState(), {
      type: "OPEN_FILE_ERROR",
      message: "not a valid docx",
      detail: "unexpected end of zip central directory",
    });
    expect(result.status?.severity).toBe("error");
    expect(result.status?.text).toBe("not a valid docx");
    expect(result.errorDetail).toStrictEqual({
      message: "not a valid docx",
      detail: "unexpected end of zip central directory",
    });
  });
});

describe("appReducer SAVE_AS_REQUEST / SET_SEARCH_QUERY / CLEAR_STATUS / DISMISS_ERROR_DETAIL", () => {
  it("pushes the saveAsPrompt screen onto the stack", () => {
    const result = appReducer(createInitialState(), {
      type: "SAVE_AS_REQUEST",
    });
    expect(result.stack.map((screen) => screen.kind)).toEqual([
      "launcher",
      "saveAsPrompt",
    ]);
  });

  it("replaces the search query verbatim", () => {
    const result = appReducer(createInitialState(), {
      type: "SET_SEARCH_QUERY",
      query: "invoice",
    });
    expect(result.searchQuery).toBe("invoice");
  });

  it("clears an existing status message", () => {
    const withStatus = appReducer(createInitialState(), {
      type: "OPEN_FILE_ERROR",
      message: "boom",
      detail: undefined,
    });
    expect(withStatus.status).toBeDefined();
    const cleared = appReducer(withStatus, { type: "CLEAR_STATUS" });
    expect(cleared.status).toBeUndefined();
  });

  it("dismisses errorDetail without touching the status message", () => {
    const withError = appReducer(createInitialState(), {
      type: "OPEN_FILE_ERROR",
      message: "boom",
      detail: "trace",
    });
    const dismissed = appReducer(withError, { type: "DISMISS_ERROR_DETAIL" });
    expect(dismissed.errorDetail).toBeUndefined();
    expect(dismissed.status).toStrictEqual(withError.status);
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
    expect(result.status?.text).toBe("There is no open document to close");
  });

  it("closes immediately, with no confirmation overlay, when there are no unsaved changes", () => {
    const created = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "docx",
    });
    const withQuery = appReducer(created, {
      type: "SET_SEARCH_QUERY",
      query: "leftover search",
    });
    const requested = appReducer(withQuery, { type: "REQUEST_CLOSE" });
    expect(requested.openDocument).toBeUndefined();
    expect(requested.overlays.confirmClose).toBe(false);
    // closeDocument resets searchQuery back to empty rather than carrying a stale search over into whatever gets opened next.
    expect(requested.searchQuery).toBe("");
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
