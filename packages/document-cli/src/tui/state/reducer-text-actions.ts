// The wordprocessing text-editing action family of the TUI reducer, split from reducer.ts: selection, paragraphs, runs (text and formatting), tables, lists and embedded images/formulas across the docx, odt and markdown editors. Returns undefined for any other action so the main reducer switch stays authoritative.
import type { Action } from "./actions";
import type { AppState } from "./types.js";
import { mutate, mutateGuarded, withStatus, wrongDocument } from "./reducer";
import {
  docxOdtDocument,
  styledWordprocessingDocument,
  wordprocessingDocument,
} from "./open-documents";
import {
  mutableMathMlNode,
  paragraphAt,
  setCellText,
  setTextContainerText,
  tableAt,
  tableCellAt,
  withRun,
  withStyledRun,
} from "./mutations";

export function applyTextAction(
  state: AppState,
  action: Action,
): AppState | undefined {
  switch (action.type) {
    case "SET_SELECTION":
      return {
        ...state,
        selection: { ...state.selection, [action.key]: action.index },
      };

    // MarkdownParagraphInit has no alignment field at all (CommonMark/GFM has no per-paragraph alignment construct), but MarkdownEditor.body.appendParagraph accepts the identical wordprocessing ParagraphInit shape as docx/odt and simply ignores the field it does not model — so one call, with `alignment` always present, covers every wordprocessingDocument format with no format-specific branch.
    case "APPEND_PARAGRAPH": {
      const doc = wordprocessingDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, "a docx, odt or markdown document");
      }
      return mutate(state, doc, () => {
        doc.editor.body.appendParagraph({
          text: action.text,
          styleId: action.styleId,
          alignment: action.alignment,
        });
      });
    }

    // Narrowed to docx/odt specifically (not the wider wordprocessingDocument union): MarkdownParagraph has no `.alignment` at all.
    case "SET_PARAGRAPH_ALIGNMENT": {
      const doc = styledWordprocessingDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, "a docx or odt document");
      }
      const paragraph = doc.editor.paragraphs()[action.blockIndex];
      if (paragraph === undefined) {
        return withStatus(
          state,
          "warning",
          `There is no paragraph at index ${action.blockIndex}`,
        );
      }
      return mutate(state, doc, () => {
        paragraph.alignment = action.alignment;
      });
    }

    case "APPEND_RUN": {
      const doc = wordprocessingDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, "a docx, odt or markdown document");
      }
      const paragraph = paragraphAt(doc, action.blockIndex);
      if (paragraph === undefined) {
        return withStatus(
          state,
          "warning",
          `There is no paragraph at index ${action.blockIndex}`,
        );
      }
      return mutate(state, doc, () => {
        paragraph.appendRun({ text: action.text });
      });
    }

    case "SET_RUN_TEXT":
      return withRun(state, action.blockIndex, action.runIndex, (run) => {
        run.text = action.text;
      });

    case "TOGGLE_RUN_BOLD":
      return withRun(state, action.blockIndex, action.runIndex, (run) => {
        run.bold = !run.bold;
      });

    case "TOGGLE_RUN_ITALIC":
      return withRun(state, action.blockIndex, action.runIndex, (run) => {
        run.italic = !run.italic;
      });

    // Narrowed to docx/odt (withStyledRun, not withRun): MarkdownRun has no underline field at all.
    case "TOGGLE_RUN_UNDERLINE":
      return withStyledRun(state, action.blockIndex, action.runIndex, (run) => {
        run.underline = !run.underline;
      });

    // Narrowed to docx/odt: MarkdownRun has no colour field at all.
    case "SET_RUN_COLOR":
      return withStyledRun(state, action.blockIndex, action.runIndex, (run) => {
        run.color = action.color;
      });

    // Narrowed to docx/odt: MarkdownRun has no font-family field at all.
    case "SET_RUN_FONT_FAMILY":
      return withStyledRun(state, action.blockIndex, action.runIndex, (run) => {
        run.fontFamily = action.fontFamily;
      });

    // Narrowed to docx/odt: MarkdownRun has no font-size field at all.
    case "SET_RUN_FONT_SIZE":
      return withStyledRun(state, action.blockIndex, action.runIndex, (run) => {
        run.sizePt = action.sizePt;
      });

    // MarkdownTable has no mergeCells at all — GFM tables have no cell-merge concept — so a merge requested against a freshly-created markdown table still creates the (unmerged) table and reports why the merge itself didn't happen, rather than either silently dropping the merge or refusing to create the table at all.
    case "APPEND_TABLE": {
      const doc = wordprocessingDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, "a docx, odt or markdown document");
      }
      // A property on a const holder, not a bare `let`: the only write is inside the mutateGuarded callback below, and TypeScript ignores assignments made in a nested function when narrowing the enclosing scope — so a `let` would read as `false` at the check and the warning branch would look statically dead while genuinely firing.
      const merge = { unsupported: false };
      const nextState = mutateGuarded(state, doc, () => {
        const table = doc.editor.body.appendTable({
          rows: action.rows,
          columns: action.columns,
        });
        if (action.merge === undefined) {
          return;
        }
        if (!("mergeCells" in table)) {
          merge.unsupported = true;
          return;
        }
        table.mergeCells(
          action.merge.startRow,
          action.merge.startColumn,
          action.merge.rowSpan,
          action.merge.colSpan,
        );
      });
      return merge.unsupported
        ? withStatus(
            nextState,
            "warning",
            "Markdown tables do not support merged cells — the table was created without merging",
          )
        : nextState;
    }

    // MarkdownTable has no mergeCells at all (see APPEND_TABLE above) — resolved through the wide wordprocessingDocument union so the table lookup itself stays generic, with the same in-narrowing decline for a markdown table specifically.
    case "MERGE_TABLE_CELLS": {
      const doc = wordprocessingDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, "a docx, odt or markdown document");
      }
      const table = tableAt(doc, action.tableIndex);
      if (table === undefined) {
        return withStatus(
          state,
          "warning",
          `There is no table at index ${action.tableIndex}`,
        );
      }
      if (!("mergeCells" in table)) {
        return withStatus(
          state,
          "warning",
          "Markdown tables do not support merged cells",
        );
      }
      return mutateGuarded(state, doc, () => {
        table.mergeCells(
          action.startRow,
          action.startColumn,
          action.rowSpan,
          action.colSpan,
        );
      });
    }

    case "SET_TABLE_CELL_TEXT": {
      const doc = wordprocessingDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, "a docx, odt or markdown document");
      }
      const table = tableAt(doc, action.tableIndex);
      if (table === undefined) {
        return withStatus(
          state,
          "warning",
          `There is no table at index ${action.tableIndex}`,
        );
      }
      const cell = tableCellAt(table, action.row, action.column);
      if (cell === undefined) {
        return withStatus(
          state,
          "warning",
          `There is no cell at row ${action.row}, column ${action.column} of table ${action.tableIndex}`,
        );
      }
      return mutate(state, doc, () => {
        setCellText(cell, action.text);
      });
    }

    // ODF models a list as a real `text:list`/`text:list-item` tree, OOXML and markdown both as a flat per-paragraph numId/level membership — so odt's own write path genuinely differs from docx/markdown's shared one. For odt the anchor block index selects which `text:list` to extend; for docx/markdown it selects the paragraph whose list membership a newly appended paragraph should copy.
    case "ADD_LIST_ITEM": {
      const doc = wordprocessingDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, "a docx, odt or markdown document");
      }
      if (doc.format === "odt") {
        const list = doc.editor.lists()[action.blockIndex];
        if (list === undefined) {
          return withStatus(
            state,
            "warning",
            `There is no list at index ${action.blockIndex}`,
          );
        }
        return mutate(state, doc, () => {
          list.addItem().appendParagraph({ text: action.text });
        });
      }
      const anchor = doc.editor.paragraphs()[action.blockIndex];
      if (anchor === undefined) {
        return withStatus(
          state,
          "warning",
          `There is no paragraph at index ${action.blockIndex}`,
        );
      }
      const membership = anchor.list;
      if (membership === undefined) {
        return withStatus(
          state,
          "warning",
          `Paragraph ${action.blockIndex} is not part of a list`,
        );
      }
      return mutate(state, doc, () => {
        const appended = doc.editor.body.appendParagraph({ text: action.text });
        appended.list = membership;
      });
    }

    // odt-only, unlike ADD_LIST_ITEM: a list is a genuinely separate ODF concept (text:list/text:list-item) with no docx analogue — OOXML's own list membership is flat paragraph metadata with no equivalent "list item" object to address by (blockIndex, itemIndex) at all.
    case "SET_LIST_ITEM_TEXT": {
      const doc = wordprocessingDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, "a docx, odt or markdown document");
      }
      if (doc.format !== "odt") {
        return wrongDocument(
          state,
          "an odt document (lists are an odt-only concept)",
        );
      }
      const list = doc.editor.lists()[action.blockIndex];
      if (list === undefined) {
        return withStatus(
          state,
          "warning",
          `There is no list at index ${action.blockIndex}`,
        );
      }
      const item = list.items()[action.itemIndex];
      if (item === undefined) {
        return withStatus(
          state,
          "warning",
          `List ${action.blockIndex} has no item at index ${action.itemIndex}`,
        );
      }
      return mutate(state, doc, () => {
        setTextContainerText(item, action.text);
      });
    }

    // odt-only, matching SET_LIST_ITEM_TEXT's own narrowing: nests the item one level deeper via OdtList.indentItem, which throws for the first item (no preceding sibling to nest under) — reported through the status line via mutateGuarded, the same way mergeCells' own out-of-range throw already is, rather than an unhandled exception reaching the UI.
    case "INDENT_LIST_ITEM": {
      const doc = wordprocessingDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, "a docx, odt or markdown document");
      }
      if (doc.format !== "odt") {
        return wrongDocument(
          state,
          "an odt document (lists are an odt-only concept)",
        );
      }
      const list = doc.editor.lists()[action.blockIndex];
      if (list === undefined) {
        return withStatus(
          state,
          "warning",
          `There is no list at index ${action.blockIndex}`,
        );
      }
      return mutateGuarded(state, doc, () => {
        list.indentItem(action.itemIndex);
      });
    }

    // odt-only, matching SET_LIST_ITEM_TEXT's own narrowing: creates a real, brand-new, empty text:list via OdtBody.appendList() — docx has no ADD_LIST_ITEM-shaped anchor to create a fresh list against (a docx paragraph gains list membership by copying an EXISTING paragraph's own numId/level, see ADD_LIST_ITEM above), so there is no equivalent "create a list from nothing" action to share.
    case "ADD_LIST": {
      const doc = wordprocessingDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, "a docx, odt or markdown document");
      }
      if (doc.format !== "odt") {
        return wrongDocument(
          state,
          "an odt document (lists are an odt-only concept)",
        );
      }
      return mutate(state, doc, () => {
        doc.editor.body.appendList();
      });
    }

    // Both DocxParagraph.insertImageAfter and OdtParagraph.insertImageAfter accept the identical ImageInit shape (documents.js's own edit/{docx,odt}/image.ts), so this resolves through a docx/odt-only narrowing — deliberately excluding markdown (MarkdownParagraph has no insertImageAfter at all) and doc (a ContentDocument paragraph has no image insertion point; doc-codec's writer reads images from the block flow itself, not a paragraph-level insert).
    case "INSERT_PARAGRAPH_IMAGE": {
      const doc = docxOdtDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, "a docx or odt document");
      }
      const paragraph = doc.editor.paragraphs()[action.blockIndex];
      if (paragraph === undefined) {
        return withStatus(
          state,
          "warning",
          `There is no paragraph at index ${action.blockIndex}`,
        );
      }
      return mutate(state, doc, () => {
        paragraph.insertImageAfter({
          format: action.format,
          bytes: action.bytes,
          widthPt: action.widthPt,
          heightPt: action.heightPt,
          altText: action.altText,
        });
      });
    }

    // Deliberately narrowed to docx specifically, not through the shared wordprocessingDocument helper: odt's own formula insertion (INSERT_ODT_FORMULA below) is body-scoped, not paragraph-scoped, so there is no single paragraph-level action both formats can share the way image insertion above does.
    case "INSERT_DOCX_FORMULA": {
      const doc = state.openDocument;
      if (doc?.format !== "docx") {
        return wrongDocument(state, "a docx document");
      }
      const paragraph = doc.editor.paragraphs()[action.blockIndex];
      if (paragraph === undefined) {
        return withStatus(
          state,
          "warning",
          `There is no paragraph at index ${action.blockIndex}`,
        );
      }
      // Unlike `merge` above, this assignment is unconditional — mutate()'s own `apply` always runs synchronously before it returns, so `written` is always set by the time it is read below. A definite-assignment declaration (no initial value at all) says so directly, rather than giving it a placeholder literal that can never actually be observed.
      let written!: boolean;
      const nextState = mutate(state, doc, () => {
        written = paragraph.appendOfficeMath(action.mathml).written;
      });
      return written
        ? nextState
        : withStatus(
            nextState,
            "warning",
            "The formula produced no OMML content and was not written",
          );
    }

    // odt's OdtBody.appendFormula has no docx counterpart at all (see the action's own doc comment) — narrowed to odt specifically rather than through wordprocessingDocument.
    case "INSERT_ODT_FORMULA": {
      const doc = state.openDocument;
      if (doc?.format !== "odt") {
        return wrongDocument(state, "an odt document");
      }
      return mutate(state, doc, () => {
        doc.editor.body.appendFormula(
          { mathml: action.mathml.map(mutableMathMlNode) },
          action.frame,
        );
      });
    }
    default:
      return undefined;
  }
}
