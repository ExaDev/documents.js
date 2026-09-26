import { createOdt, openOdt } from "documents.js";
import { describe, expect, it } from "vitest";
import { appReducer, createInitialState } from "./reducer.js";
import type { AppState, DocxOpenDocument, OdtOpenDocument } from "./types.js";
function docxDocument(state: AppState): DocxOpenDocument {
  const doc = state.openDocument;
  if (doc?.format !== "docx") {
    throw new Error("expected an open docx document");
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
    expect(result.status?.text).toBe("There is no list at index 5");
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
    expect(result.status?.text).toBe(
      `List ${blockIndex} has no item at index 3`,
    );
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
    expect(warned.status?.text).toBe(
      "That action needs an odt document (lists are an odt-only concept); the open document is docx",
    );
    expect(warned.hasUnsavedChanges).toBe(false);
  });

  // The docx test above is wordprocessing but not odt, so it only ever reaches the SECOND, odt-only wrongDocument check. This one is not wordprocessing at all, reaching the FIRST, wider check instead.
  it("warns instead of mutating when the open document is not a wordprocessing document at all", () => {
    const state = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "ods",
    });
    const warned = appReducer(state, {
      type: "SET_LIST_ITEM_TEXT",
      blockIndex: 0,
      itemIndex: 0,
      text: "x",
    });
    expect(warned.status?.severity).toBe("warning");
    expect(warned.status?.text).toBe(
      "That action needs a docx, odt or markdown document; the open document is ods",
    );
  });
});

describe("appReducer ADD_LIST_ITEM on docx", () => {
  // docx (and markdown) have no separate "list" object the way odt does — list membership is flat per-paragraph metadata, so ADD_LIST_ITEM's own docx/markdown branch appends a brand-new paragraph and copies the anchor paragraph's own ContentListMembership onto it, rather than extending an OdtList (the odt branch this file's own "ADD_LIST on odt"/"INDENT_LIST_ITEM on odt" describe blocks already cover).
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

  it("warns instead of mutating when the open document is not a wordprocessing document at all", () => {
    const state = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "ods",
    });
    const result = appReducer(state, {
      type: "ADD_LIST_ITEM",
      blockIndex: 0,
      text: "x",
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toBe(
      "That action needs a docx, odt or markdown document; the open document is ods",
    );
  });

  // odt's own ADD_LIST_ITEM branch is genuinely separate code from the docx/markdown branch tested above (a real OdtList.addItem(), not a flat paragraph-copy) — despite the docx describe block's own comment claiming the sibling ADD_LIST/INDENT_LIST_ITEM tests already cover it, neither of those ever dispatches ADD_LIST_ITEM itself.
  it("appends a real item to an existing odt list", () => {
    const editor = createOdt();
    editor.body.appendList().addItem().appendParagraph({ text: "first" });
    const opened = openOdtDocument(editor.toBytes());
    const blockIndex = odtDocument(opened).editor.lists().length - 1;

    const added = appReducer(opened, {
      type: "ADD_LIST_ITEM",
      blockIndex,
      text: "second",
    });
    expect(added.hasUnsavedChanges).toBe(true);
    const items = odtDocument(added).editor.lists()[blockIndex]?.items();
    expect(items?.map((item) => item.text)).toEqual(["first", "second"]);
  });

  it("warns rather than crashing when ADD_LIST_ITEM targets an odt list index that does not exist", () => {
    const editor = createOdt();
    editor.body.appendList().addItem().appendParagraph({ text: "only" });
    const opened = openOdtDocument(editor.toBytes());

    const result = appReducer(opened, {
      type: "ADD_LIST_ITEM",
      blockIndex: 5,
      text: "x",
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toBe("There is no list at index 5");
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

    // Round-trips through re-decoding the package as a completely fresh document, not just the live in-memory object — proving OdtBody.appendList() wrote a real, empty text:list, exactly the shape the listEditor screen's own 'a' (ADD_LIST_ITEM) then extends.
    const reopened = openOdt(doc.editor.toBytes());
    expect(reopened.lists()).toHaveLength(1);
    expect(reopened.lists()[0]?.items()).toHaveLength(0);

    // A second ADD_LIST appends a second list rather than replacing the first — the new list's own index (adapter.lists().length computed before dispatch, per paragraph-family.tsx's own 'L' handler) is what a caller navigates the freshly pushed listEditor screen to.
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

  it("warns instead of mutating when the open document is not a wordprocessing document at all", () => {
    const state = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "ods",
    });
    const result = appReducer(state, { type: "ADD_LIST" });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toBe(
      "That action needs a docx, odt or markdown document; the open document is ods",
    );
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
    expect(result.status?.text).toBe("There is no list at index 5");
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
    expect(warned.status?.text).toBe(
      "That action needs an odt document (lists are an odt-only concept); the open document is docx",
    );
    expect(warned.hasUnsavedChanges).toBe(false);
  });

  it("warns instead of mutating when the open document is not a wordprocessing document at all", () => {
    const state = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "ods",
    });
    const result = appReducer(state, {
      type: "INDENT_LIST_ITEM",
      blockIndex: 0,
      itemIndex: 0,
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toBe(
      "That action needs a docx, odt or markdown document; the open document is ods",
    );
  });
});
