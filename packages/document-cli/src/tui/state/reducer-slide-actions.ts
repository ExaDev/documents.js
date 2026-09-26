// The slide and sheet action family of the TUI reducer, split from reducer.ts: adding slides, textboxes, images and tables, shape text/frame/rotation, slide notes, and sheet cell values, formulas, images, merges and print settings. Returns undefined for any other action so the main reducer switch stays authoritative.
import { bytesToBase64 } from "documents.js";
import type { Action } from "./actions";
import type { AppState } from "./types.js";
import {
  drawingDocument,
  odsDocument,
  presentationDocument,
  richPresentationDocument,
  shapeHostDocument,
  spreadsheetDocument,
} from "./open-documents";
import {
  odsSheetAt,
  withOdsSheet,
  withShape,
  withSheet,
  withWideShape,
} from "./mutations";
import {
  mergePptxTableCells,
  mutate,
  mutateGuarded,
  withStatus,
  wrongDocument,
} from "./reducer";

export function applySlideAction(
  state: AppState,
  action: Action,
): AppState | undefined {
  switch (action.type) {
    case "ADD_SLIDE": {
      const doc = presentationDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, "a pptx or odp document");
      }
      return mutate(state, doc, () => {
        doc.editor.addSlide();
      });
    }

    case "ADD_SLIDE_TABLE": {
      const doc = richPresentationDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, "a pptx or odp document");
      }
      const slide = doc.editor.slides()[action.slideIndex];
      if (slide === undefined) {
        return withStatus(
          state,
          "warning",
          `There is no slide at index ${action.slideIndex}`,
        );
      }
      return mutate(state, doc, () => {
        slide.addTable({
          frame: action.frame,
          table: { rows: action.rows, columns: action.columns },
        });
      });
    }

    case "MERGE_SLIDE_TABLE_CELLS": {
      const doc = richPresentationDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, "a pptx or odp document");
      }
      if (doc.format === "odp") {
        const entry = doc.editor.slides()[action.slideIndex]?.tables()[
          action.tableIndex
        ];
        if (entry === undefined) {
          return withStatus(
            state,
            "warning",
            `There is no table at index ${action.tableIndex} on slide ${action.slideIndex}`,
          );
        }
        return mutateGuarded(state, doc, () => {
          entry.table.mergeCells(
            action.startRow,
            action.startColumn,
            action.rowSpan,
            action.colSpan,
          );
        });
      }
      const table = doc.editor.slides()[action.slideIndex]?.tables()[
        action.tableIndex
      ];
      if (table === undefined) {
        return withStatus(
          state,
          "warning",
          `There is no table at index ${action.tableIndex} on slide ${action.slideIndex}`,
        );
      }
      return mutateGuarded(state, doc, () => {
        mergePptxTableCells(
          table,
          action.startRow,
          action.startColumn,
          action.rowSpan,
          action.colSpan,
        );
      });
    }

    case "ADD_TEXTBOX": {
      // odg branches first through the drawing narrowing, then every presentation format takes the identical addTextBox({frame, text}) shape — pptx/odp through their rich slides, ppt through PptSlide's own same-shaped text-box API.
      const drawing = drawingDocument(state);
      if (drawing !== undefined) {
        const page = drawing.editor.pages()[action.containerIndex];
        if (page === undefined) {
          return withStatus(
            state,
            "warning",
            `There is no page at index ${action.containerIndex}`,
          );
        }
        return mutate(state, drawing, () => {
          page.addTextBox({ frame: action.frame, text: action.text });
        });
      }
      const doc = presentationDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, "a pptx, odp, ppt or odg document");
      }
      const slide = doc.editor.slides()[action.containerIndex];
      if (slide === undefined) {
        return withStatus(
          state,
          "warning",
          `There is no slide at index ${action.containerIndex}`,
        );
      }
      return mutate(state, doc, () => {
        slide.addTextBox({ frame: action.frame, text: action.text });
      });
    }

    case "ADD_IMAGE": {
      const doc = shapeHostDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, "a pptx, odp or odg document");
      }
      const image = {
        frame: action.frame,
        format: action.format,
        bytes: action.bytes,
        altText: action.altText,
      };
      if (doc.format === "odg") {
        const page = doc.editor.pages()[action.containerIndex];
        if (page === undefined) {
          return withStatus(
            state,
            "warning",
            `There is no page at index ${action.containerIndex}`,
          );
        }
        return mutate(state, doc, () => {
          page.addImage(image);
        });
      }
      const slide = doc.editor.slides()[action.containerIndex];
      if (slide === undefined) {
        return withStatus(
          state,
          "warning",
          `There is no slide at index ${action.containerIndex}`,
        );
      }
      return mutate(state, doc, () => {
        slide.addImage(image);
      });
    }

    case "SET_SHAPE_TEXT":
      return withWideShape(
        state,
        action.containerIndex,
        action.shapeIndex,
        (shape) => {
          shape.text = action.text;
        },
      );

    case "SET_SHAPE_FRAME":
      return withWideShape(
        state,
        action.containerIndex,
        action.shapeIndex,
        (shape) => {
          shape.frame = action.frame;
        },
      );

    // PptxShape gained a real `rotationDeg` getter/setter alongside OdpShape's — SET_SHAPE_ROTATION resolves through the same withShape helper SET_SHAPE_TEXT/SET_SHAPE_FRAME already use rather than a pptx-specific rejection.
    case "SET_SHAPE_ROTATION":
      return withShape(
        state,
        action.containerIndex,
        action.shapeIndex,
        (shape) => {
          shape.rotationDeg = action.rotationDeg;
        },
      );

    case "SET_SLIDE_NOTES": {
      const doc = presentationDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, "a pptx or odp document");
      }
      const slide = doc.editor.slides()[action.slideIndex];
      if (slide === undefined) {
        return withStatus(
          state,
          "warning",
          `There is no slide at index ${action.slideIndex}`,
        );
      }
      return mutate(state, doc, () => {
        slide.notes = action.notes;
      });
    }

    case "ADD_SHEET": {
      const doc = spreadsheetDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, "an ods or xls document");
      }
      return mutate(state, doc, () => {
        doc.editor.addSheet(action.name);
      });
    }

    case "SET_CELL_VALUE":
      return withSheet(state, action.sheetIndex, (sheet) => {
        sheet.cell(action.row, action.column).value = action.value;
      });

    // A separate action/edit mode from SET_CELL_VALUE, not a variant of it — see actions.ts's own doc comment: OdsCell.formula and .value are two independent attributes of the same real cell, both settable at once.
    case "SET_CELL_FORMULA": {
      // ods-only: XlsCell.formula is getter-only (xls-codec's writer has no formula write path), so a formula edit against an xls sheet is refused by name rather than silently dropped at save time.
      const doc = odsDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, "an ods document");
      }
      const sheet = odsSheetAt(doc, action.sheetIndex);
      if (sheet === undefined) {
        return withStatus(
          state,
          "warning",
          `There is no sheet at index ${action.sheetIndex}`,
        );
      }
      return mutate(state, doc, () => {
        sheet.cell(action.row, action.column).formula = action.formula;
      });
    }

    // OdsSheet.addImage takes a real ContentSheetImage, which — unlike ADD_IMAGE/INSERT_PARAGRAPH_IMAGE's own SlideImageInit/ImageInit — carries its bytes as `base64: string`, not a raw Uint8Array (document-schema.js's ContentImageBlockSchema, shared with every other embedded-image/object shape); the conversion happens here, once, rather than pushing bytesToBase64 out to every dispatch site.
    case "ADD_SHEET_IMAGE": {
      // ods-only: XlsSheet has no addImage (xls-codec's writer writes no floating images).
      const ods = odsDocument(state);
      if (ods === undefined) {
        return wrongDocument(state, "an ods document");
      }
      return withOdsSheet(state, ods, action.sheetIndex, (sheet) => {
        sheet.addImage({
          kind: "image",
          format: action.format,
          base64: bytesToBase64(action.bytes),
          widthPt: action.widthPt,
          heightPt: action.heightPt,
          altText: action.altText,
          anchorRow: action.anchorRow,
          anchorColumn: action.anchorColumn,
          offsetXPt: action.offsetXPt,
          offsetYPt: action.offsetYPt,
        });
      });
    }

    case "MERGE_CELLS": {
      // ods-only: an xls merge is colSpan/rowSpan set directly on the anchor cell (XlsCell's own setters), not a rectangle API.
      const doc = odsDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, "an ods document");
      }
      const sheet = odsSheetAt(doc, action.sheetIndex);
      if (sheet === undefined) {
        return withStatus(
          state,
          "warning",
          `There is no sheet at index ${action.sheetIndex}`,
        );
      }
      return mutateGuarded(state, doc, () => {
        sheet.mergeCells(
          action.startRow,
          action.startColumn,
          action.rowSpan,
          action.colSpan,
        );
      });
    }

    case "SET_SHEET_PRINT_SETTINGS":
      return withSheet(state, action.sheetIndex, (sheet) => {
        sheet.printSettings = action.printSettings;
      });
    default:
      return undefined;
  }
}
