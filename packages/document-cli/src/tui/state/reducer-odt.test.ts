import { openDocx, readDocxContent, readOdtContent } from "documents.js";
import { describe, expect, it } from "vitest";
import type { Action } from "./actions.js";
import { appReducer, createInitialState } from "./reducer.js";
import type { AppState, DocxOpenDocument, OdtOpenDocument } from "./types.js";
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

function odtDocument(state: AppState): OdtOpenDocument {
  const doc = state.openDocument;
  if (doc?.format !== "odt") {
    throw new Error("expected an open odt document");
  }
  return doc;
}

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
    expect(result.status?.text).toBe(
      "That action needs an editable document; the open document is no document",
    );
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
    // The live view means the run object captured before the action already reflects the mutation — there is no new object to re-read.
    expect(run.bold).toBe(true);

    const unbolded = appReducer(bolded, {
      type: "TOGGLE_RUN_BOLD",
      blockIndex: 0,
      runIndex: 0,
    });
    expect(run.bold).toBe(false);
    expect(unbolded.hasUnsavedChanges).toBe(true);
  });

  it("replaces a run's text via SET_RUN_TEXT", () => {
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
    const retyped = appReducer(state, {
      type: "SET_RUN_TEXT",
      blockIndex: 0,
      runIndex: 0,
      text: "Goodbye",
    });
    expect(retyped.hasUnsavedChanges).toBe(true);
    expect(docxDocument(retyped).editor.paragraphs()[0]?.runs()[0]?.text).toBe(
      "Goodbye",
    );
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

  // withRun's own wrongDocument path — distinct from withStyledRun's (exercised elsewhere against markdown), since SET_RUN_TEXT/TOGGLE_RUN_BOLD/TOGGLE_RUN_ITALIC resolve through the wider wordprocessingDocument union, not styledWordprocessingDocument.
  it("warns rather than mutating when SET_RUN_TEXT targets a non-wordprocessing document", () => {
    const state = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "ods",
    });
    const result = appReducer(state, {
      type: "SET_RUN_TEXT",
      blockIndex: 0,
      runIndex: 0,
      text: "x",
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toBe(
      "That action needs a docx, odt or markdown document; the open document is ods",
    );
  });

  // withRun's own "no run at index" path: the paragraph exists (created via APPEND_PARAGRAPH) but has no runs at all, unlike the "no paragraph" case already covered above.
  it("reports a missing run, not a missing paragraph, when the paragraph exists but has no runs", () => {
    const state = applyAll([
      { type: "CREATE_DOCUMENT", format: "docx" },
      {
        type: "APPEND_PARAGRAPH",
        text: undefined,
        styleId: undefined,
        alignment: undefined,
      },
    ]);
    const result = appReducer(state, {
      type: "TOGGLE_RUN_ITALIC",
      blockIndex: 0,
      runIndex: 0,
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toBe("Paragraph 0 has no run at index 0");
    // The warning path returns the state unchanged rather than a new mutated copy.
    expect(result.openDocument).toBe(state.openDocument);
  });

  // withStyledRun's own "no run at index" path (TOGGLE_RUN_UNDERLINE/SET_RUN_COLOR/etc resolve through styledWordprocessingDocument, not wordprocessingDocument, so this is a genuinely separate code path from the withRun test above).
  it("reports a missing run for TOGGLE_RUN_UNDERLINE when the paragraph has no runs", () => {
    const state = applyAll([
      { type: "CREATE_DOCUMENT", format: "docx" },
      {
        type: "APPEND_PARAGRAPH",
        text: undefined,
        styleId: undefined,
        alignment: undefined,
      },
    ]);
    const result = appReducer(state, {
      type: "TOGGLE_RUN_UNDERLINE",
      blockIndex: 0,
      runIndex: 0,
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toBe("Paragraph 0 has no run at index 0");
    expect(result.openDocument).toBe(state.openDocument);
  });

  // TOGGLE_RUN_UNDERLINE and SET_RUN_COLOR have no real, positive test anywhere else — the markdown describe below only exercises their wrongDocument branch.
  it("toggles a real run's underline and sets its colour through the live editor", () => {
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
    const run = docxDocument(state).editor.paragraphs()[0]?.runs()[0];
    if (run === undefined) {
      throw new Error("expected an appended run");
    }
    expect(run.underline).toBe(false);

    const underlined = appReducer(state, {
      type: "TOGGLE_RUN_UNDERLINE",
      blockIndex: 0,
      runIndex: 0,
    });
    expect(underlined.hasUnsavedChanges).toBe(true);
    expect(run.underline).toBe(true);

    const coloured = appReducer(underlined, {
      type: "SET_RUN_COLOR",
      blockIndex: 0,
      runIndex: 0,
      color: { r: 1, g: 0, b: 0 },
    });
    expect(coloured.hasUnsavedChanges).toBe(true);
    expect(run.color).toStrictEqual({ r: 1, g: 0, b: 0 });
  });

  // SET_PARAGRAPH_ALIGNMENT has no positive test anywhere else — the markdown describe block only ever exercises its wrongDocument branch (MarkdownParagraph has no alignment field at all).
  it("sets a real paragraph's alignment through the live editor", () => {
    const state = applyAll([
      { type: "CREATE_DOCUMENT", format: "docx" },
      {
        type: "APPEND_PARAGRAPH",
        text: "Hello",
        styleId: undefined,
        alignment: undefined,
      },
    ]);
    const paragraph = docxDocument(state).editor.paragraphs()[0];
    if (paragraph === undefined) {
      throw new Error("expected an appended paragraph");
    }
    expect(paragraph.alignment).toBeUndefined();

    const aligned = appReducer(state, {
      type: "SET_PARAGRAPH_ALIGNMENT",
      blockIndex: 0,
      alignment: "center",
    });
    expect(aligned.hasUnsavedChanges).toBe(true);
    expect(paragraph.alignment).toBe("center");
  });

  it("reports a missing paragraph for SET_PARAGRAPH_ALIGNMENT rather than throwing", () => {
    const state = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "docx",
    });
    const result = appReducer(state, {
      type: "SET_PARAGRAPH_ALIGNMENT",
      blockIndex: 7,
      alignment: "center",
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toBe("There is no paragraph at index 7");
    expect(result.openDocument).toBe(state.openDocument);
  });

  // APPEND_RUN's own wrongDocument/no-paragraph paths — every other use of APPEND_RUN in this file is setup for a further action, never a direct assertion on its own warning paths.
  it("warns rather than mutating when APPEND_RUN targets a non-wordprocessing document", () => {
    const state = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "ods",
    });
    const result = appReducer(state, {
      type: "APPEND_RUN",
      blockIndex: 0,
      text: "x",
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toBe(
      "That action needs a docx, odt or markdown document; the open document is ods",
    );
  });

  it("reports a missing paragraph for APPEND_RUN rather than throwing", () => {
    const state = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "docx",
    });
    const result = appReducer(state, {
      type: "APPEND_RUN",
      blockIndex: 7,
      text: "x",
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toBe("There is no paragraph at index 7");
    expect(result.openDocument).toBe(state.openDocument);
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
    // A docx table genuinely supports merging, unlike markdown's own — this must not carry the "unsupported" warning markdown's APPEND_TABLE+merge gets below.
    expect(withTable.status?.severity).not.toBe("warning");

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
    // docx stores a horizontal merge as one real w:tc, but the ContentTable it reads into is dense: row 0 still has one entry per grid column, with a covered, block-less entry where the merge swallowed a column.
    expect(tableBlock.rows[0]?.cells).toHaveLength(3);
    expect(tableBlock.rows[0]?.cells[1]?.blocks).toEqual([]);
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
    // ODF always writes one real (possibly covered) cell per grid position, unlike docx — row 0 still has all 3 columns.
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
    expect(result.status?.text).toBe("There is no table at index 3");
    expect(result.hasUnsavedChanges).toBe(false);
  });
});

describe("appReducer SET_TABLE_CELL_TEXT", () => {
  it("replaces a real docx table cell's text in place", () => {
    const state = applyAll([
      { type: "CREATE_DOCUMENT", format: "docx" },
      { type: "APPEND_TABLE", rows: 2, columns: 2 },
    ]);
    const edited = appReducer(state, {
      type: "SET_TABLE_CELL_TEXT",
      tableIndex: 0,
      row: 1,
      column: 1,
      text: "Total",
    });
    expect(edited.hasUnsavedChanges).toBe(true);
    const content = readDocxContent(docxDocument(edited).editor.toPackage());
    if (content.kind !== "wordprocessing") {
      throw new Error(
        `expected a wordprocessing ContentDocument, got ${content.kind}`,
      );
    }
    const tableBlock = content.sections[0]?.blocks[0];
    if (tableBlock?.kind !== "table") {
      throw new Error(`expected a table block, got ${tableBlock?.kind}`);
    }
    const cellText = tableBlock.rows[1]?.cells[1]?.blocks
      .flatMap((block) => (block.kind === "paragraph" ? block.runs : []))
      .map((run) => run.text)
      .join("");
    expect(cellText).toBe("Total");
  });

  it("warns rather than crashing for a table index that does not exist", () => {
    const created = appReducer(createInitialState(), {
      type: "CREATE_DOCUMENT",
      format: "docx",
    });
    const result = appReducer(created, {
      type: "SET_TABLE_CELL_TEXT",
      tableIndex: 0,
      row: 0,
      column: 0,
      text: "x",
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toBe("There is no table at index 0");
  });

  it("warns rather than crashing for a row/column that does not exist", () => {
    const state = applyAll([
      { type: "CREATE_DOCUMENT", format: "docx" },
      { type: "APPEND_TABLE", rows: 2, columns: 2 },
    ]);
    const result = appReducer(state, {
      type: "SET_TABLE_CELL_TEXT",
      tableIndex: 0,
      row: 5,
      column: 0,
      text: "x",
    });
    expect(result.status?.severity).toBe("warning");
    expect(result.status?.text).toBe(
      "There is no cell at row 5, column 0 of table 0",
    );
  });

  // setTextContainerText's "already has a first run" branch: a freshly-appended table cell has zero runs, so the tests above only ever exercise the "no first run yet" branch (paragraph.appendRun). Giving the cell two runs up front proves the write path replaces the first run's text AND removes every extra run, rather than just setting the first and leaving the rest stale.
  it("replaces the first run's text and removes every extra run when a cell already has more than one", () => {
    const state = applyAll([
      { type: "CREATE_DOCUMENT", format: "docx" },
      { type: "APPEND_TABLE", rows: 1, columns: 1 },
    ]);
    const table = docxDocument(state).editor.tables()[0];
    const cell = table?.rows()[0]?.cells()[0];
    if (cell === undefined) {
      throw new Error("expected the appended cell");
    }
    const paragraph = cell.paragraphs()[0] ?? cell.appendParagraph();
    paragraph.appendRun({ text: "one" });
    paragraph.appendRun({ text: "two" });
    paragraph.appendRun({ text: "three" });
    expect(paragraph.runs()).toHaveLength(3);

    const edited = appReducer(state, {
      type: "SET_TABLE_CELL_TEXT",
      tableIndex: 0,
      row: 0,
      column: 0,
      text: "Replaced",
    });
    expect(edited.hasUnsavedChanges).toBe(true);
    expect(paragraph.runs()).toHaveLength(1);
    expect(paragraph.runs()[0]?.text).toBe("Replaced");
  });
});

// The plain text of every cell of the first table, read back through the content pivot, so a write can be traced to the grid column it landed in.
