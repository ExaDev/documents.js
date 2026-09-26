// The pdf-editor action family of the TUI reducer, split from reducer.ts: adding, removing and repositioning pdf items (text, rect, ellipse, line, path, image, links) through the pdfItemAt/withPdfPage/withPdfItemMatching helpers. Returns undefined for any other action so the main reducer switch stays authoritative for everything else.
import type { Action } from "./actions";
import type { AppState } from "./types.js";
import {
  isPdfEllipseItem,
  isPdfImageItem,
  isPdfInternalLinkItem,
  isPdfLineItem,
  isPdfLinkItem,
  isPdfPathItem,
  isPdfRectItem,
  isPdfTextItem,
  pdfDocument,
  pdfItemAt,
  withPdfItemMatching,
  withPdfPage,
} from "./open-documents";
import { mutate, withStatus, wrongDocument } from "./reducer";

export function applyPdfAction(
  state: AppState,
  action: Action,
): AppState | undefined {
  switch (action.type) {
    case "ADD_PDF_TEXT":
      return withPdfPage(state, action.pageIndex, (page) => {
        page.appendText(action.init);
      });

    case "ADD_PDF_RECT":
      return withPdfPage(state, action.pageIndex, (page) => {
        page.appendRect(action.init);
      });

    case "ADD_PDF_ELLIPSE":
      return withPdfPage(state, action.pageIndex, (page) => {
        page.appendEllipse(action.init);
      });

    case "ADD_PDF_LINE":
      return withPdfPage(state, action.pageIndex, (page) => {
        page.appendLine(action.init);
      });

    case "ADD_PDF_PATH":
      return withPdfPage(state, action.pageIndex, (page) => {
        page.appendPath(action.init);
      });

    case "ADD_PDF_IMAGE":
      return withPdfPage(state, action.pageIndex, (page) => {
        page.appendImage(action.init);
      });

    case "ADD_PDF_LINK":
      return withPdfPage(state, action.pageIndex, (page) => {
        page.appendLink(action.init);
      });

    case "REMOVE_PDF_ITEM": {
      const doc = pdfDocument(state);
      if (doc === undefined) {
        return wrongDocument(state, "a pdf document");
      }
      const item = pdfItemAt(doc, action.pageIndex, action.itemIndex);
      if (item === undefined) {
        return withStatus(
          state,
          "warning",
          `Page ${action.pageIndex} has no item at index ${action.itemIndex}`,
        );
      }
      return mutate(state, doc, () => {
        item.remove();
      });
    }

    case "SET_PDF_TEXT_TEXT":
      return withPdfItemMatching(
        state,
        action.pageIndex,
        action.itemIndex,
        isPdfTextItem,
        "text",
        (item) => {
          item.text = action.text;
        },
      );

    case "SET_PDF_TEXT_POSITION":
      return withPdfItemMatching(
        state,
        action.pageIndex,
        action.itemIndex,
        isPdfTextItem,
        "text",
        (item) => {
          item.xPt = action.xPt;
          item.yPt = action.yPt;
        },
      );

    case "SET_PDF_TEXT_FONT":
      return withPdfItemMatching(
        state,
        action.pageIndex,
        action.itemIndex,
        isPdfTextItem,
        "text",
        (item) => {
          item.font = action.font;
        },
      );

    case "SET_PDF_TEXT_SIZE":
      return withPdfItemMatching(
        state,
        action.pageIndex,
        action.itemIndex,
        isPdfTextItem,
        "text",
        (item) => {
          item.sizePt = action.sizePt;
        },
      );

    case "SET_PDF_TEXT_COLOR":
      return withPdfItemMatching(
        state,
        action.pageIndex,
        action.itemIndex,
        isPdfTextItem,
        "text",
        (item) => {
          item.color = action.color;
        },
      );

    case "SET_PDF_TEXT_ROTATION":
      return withPdfItemMatching(
        state,
        action.pageIndex,
        action.itemIndex,
        isPdfTextItem,
        "text",
        (item) => {
          item.rotationDeg = action.rotationDeg;
        },
      );

    case "SET_PDF_TEXT_WIDTH":
      return withPdfItemMatching(
        state,
        action.pageIndex,
        action.itemIndex,
        isPdfTextItem,
        "text",
        (item) => {
          item.widthPt = action.widthPt;
        },
      );

    case "TOGGLE_PDF_TEXT_UNDERLINE":
      return withPdfItemMatching(
        state,
        action.pageIndex,
        action.itemIndex,
        isPdfTextItem,
        "text",
        (item) => {
          item.underline = !(item.underline ?? false);
        },
      );

    case "SET_PDF_RECT_FRAME":
      return withPdfItemMatching(
        state,
        action.pageIndex,
        action.itemIndex,
        isPdfRectItem,
        "rect",
        (item) => {
          item.xPt = action.xPt;
          item.yPt = action.yPt;
          item.widthPt = action.widthPt;
          item.heightPt = action.heightPt;
        },
      );

    case "SET_PDF_RECT_FILL":
      return withPdfItemMatching(
        state,
        action.pageIndex,
        action.itemIndex,
        isPdfRectItem,
        "rect",
        (item) => {
          item.fill = action.fill;
        },
      );

    case "SET_PDF_RECT_STROKE":
      return withPdfItemMatching(
        state,
        action.pageIndex,
        action.itemIndex,
        isPdfRectItem,
        "rect",
        (item) => {
          item.stroke = action.stroke;
        },
      );

    case "SET_PDF_ELLIPSE_FRAME":
      return withPdfItemMatching(
        state,
        action.pageIndex,
        action.itemIndex,
        isPdfEllipseItem,
        "ellipse",
        (item) => {
          item.xPt = action.xPt;
          item.yPt = action.yPt;
          item.widthPt = action.widthPt;
          item.heightPt = action.heightPt;
        },
      );

    case "SET_PDF_ELLIPSE_FILL":
      return withPdfItemMatching(
        state,
        action.pageIndex,
        action.itemIndex,
        isPdfEllipseItem,
        "ellipse",
        (item) => {
          item.fill = action.fill;
        },
      );

    case "SET_PDF_ELLIPSE_STROKE":
      return withPdfItemMatching(
        state,
        action.pageIndex,
        action.itemIndex,
        isPdfEllipseItem,
        "ellipse",
        (item) => {
          item.stroke = action.stroke;
        },
      );

    case "SET_PDF_LINE_FROM":
      return withPdfItemMatching(
        state,
        action.pageIndex,
        action.itemIndex,
        isPdfLineItem,
        "line",
        (item) => {
          item.x1Pt = action.x1Pt;
          item.y1Pt = action.y1Pt;
        },
      );

    case "SET_PDF_LINE_TO":
      return withPdfItemMatching(
        state,
        action.pageIndex,
        action.itemIndex,
        isPdfLineItem,
        "line",
        (item) => {
          item.x2Pt = action.x2Pt;
          item.y2Pt = action.y2Pt;
        },
      );

    case "SET_PDF_LINE_COLOR":
      return withPdfItemMatching(
        state,
        action.pageIndex,
        action.itemIndex,
        isPdfLineItem,
        "line",
        (item) => {
          item.color = action.color;
        },
      );

    case "SET_PDF_LINE_WIDTH":
      return withPdfItemMatching(
        state,
        action.pageIndex,
        action.itemIndex,
        isPdfLineItem,
        "line",
        (item) => {
          item.widthPt = action.widthPt;
        },
      );

    case "SET_PDF_PATH_FILL":
      return withPdfItemMatching(
        state,
        action.pageIndex,
        action.itemIndex,
        isPdfPathItem,
        "path",
        (item) => {
          item.fill = action.fill;
        },
      );

    case "SET_PDF_PATH_FILL_RULE":
      return withPdfItemMatching(
        state,
        action.pageIndex,
        action.itemIndex,
        isPdfPathItem,
        "path",
        (item) => {
          item.fillRule = action.fillRule;
        },
      );

    case "SET_PDF_PATH_STROKE":
      return withPdfItemMatching(
        state,
        action.pageIndex,
        action.itemIndex,
        isPdfPathItem,
        "path",
        (item) => {
          item.stroke = action.stroke;
        },
      );

    case "SET_PDF_IMAGE_FRAME":
      return withPdfItemMatching(
        state,
        action.pageIndex,
        action.itemIndex,
        isPdfImageItem,
        "image",
        (item) => {
          item.xPt = action.xPt;
          item.yPt = action.yPt;
          item.widthPt = action.widthPt;
          item.heightPt = action.heightPt;
        },
      );

    case "SET_PDF_IMAGE_ROTATION":
      return withPdfItemMatching(
        state,
        action.pageIndex,
        action.itemIndex,
        isPdfImageItem,
        "image",
        (item) => {
          item.rotationDeg = action.rotationDeg;
        },
      );

    case "SET_PDF_IMAGE_SOURCE":
      return withPdfItemMatching(
        state,
        action.pageIndex,
        action.itemIndex,
        isPdfImageItem,
        "image",
        (item) => {
          item.setImage(action.bytes, action.format);
        },
      );

    case "SET_PDF_LINK_URI":
      return withPdfItemMatching(
        state,
        action.pageIndex,
        action.itemIndex,
        isPdfLinkItem,
        "link",
        (item) => {
          item.uri = action.uri;
        },
      );

    case "SET_PDF_LINK_FRAME":
      return withPdfItemMatching(
        state,
        action.pageIndex,
        action.itemIndex,
        isPdfLinkItem,
        "link",
        (item) => {
          item.xPt = action.xPt;
          item.yPt = action.yPt;
          item.widthPt = action.widthPt;
          item.heightPt = action.heightPt;
        },
      );

    case "SET_PDF_INTERNAL_LINK_DESTINATION":
      return withPdfItemMatching(
        state,
        action.pageIndex,
        action.itemIndex,
        isPdfInternalLinkItem,
        "internalLink",
        (item) => {
          item.destination = action.destination;
        },
      );

    case "SET_PDF_INTERNAL_LINK_FRAME":
      return withPdfItemMatching(
        state,
        action.pageIndex,
        action.itemIndex,
        isPdfInternalLinkItem,
        "internalLink",
        (item) => {
          item.xPt = action.xPt;
          item.yPt = action.yPt;
          item.widthPt = action.widthPt;
          item.heightPt = action.heightPt;
        },
      );

    // Every EditableOpenDocument's own `editor.metadata` setter (docx/pptx/odt/odp/ods/odg/pdf) takes the identical MetadataOverrides shape and patches the live package in place — one action covers all seven, matching how mutate/mutateGuarded already take the format-agnostic WritableOpenDocument. Markdown is excluded: MarkdownEditor has no metadata setter (ExaDev/documents.js#933's own resolution never added one, since markdown carries no docProps/core.xml or meta.xml to patch), so it is not part of EditableOpenDocument's own metadata surface.
    default:
      return undefined;
  }
}
