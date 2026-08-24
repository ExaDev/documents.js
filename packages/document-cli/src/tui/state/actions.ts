import type {
  Alignment,
  Box,
  ContentCellValue,
  ContentSheetPrintSettings,
  ContentStroke,
  LayoutColor,
  LayoutFont,
  MathMlNode,
  OdgBoxVector,
  OdgBoxVectorInit,
  OdgLineVector,
  OdgLineVectorInit,
  OdgPathVector,
  OdgPathVectorInit,
  PdfEllipseInit,
  PdfImageInit,
  PdfLineInit,
  PdfLinkInit,
  PdfPathInit,
  PdfRectInit,
  PdfTextInit,
} from "documents.js";
import type {
  Diagnostic,
  EditableFormat,
  OpenDocument,
  OverlayName,
  Screen,
  StatusMessage,
} from "./types.js";

// HOW A MUTATING ACTION ADDRESSES ITS TARGET. The rule is: address by index wherever the editor exposes an enumeration accessor to resolve that index against, and carry the live object itself only where it does not.
//
// - `blockIndex` indexes `editor.paragraphs()` for the paragraph/run/list actions, and `editor.tables()` for the table actions -- two separate arrays, matching the two accessors documents.js gives a docx/odt editor.
// - `containerIndex` indexes `editor.slides()` for pptx/odp and `editor.pages()` for odg: a shape (`OdpShape`/`PptxShape`) lives on a slide or on a drawing page and is reached identically either way, so one action serves both. ADD_RECT/ADD_ELLIPSE/ADD_LINE/ADD_PATH's own `containerIndex` follows the identical convention now that odp can host a vector primitive too (`OdpSlide.addVector`), not only odg (`OdgPage.addRect`/etc) -- it was `pageIndex` before odp gained a vector model of its own, renamed here for consistency with ADD_TEXTBOX/ADD_IMAGE rather than kept as an odg-only name.
// - `sheetIndex` indexes `editor.sheets()`; `row`/`column` are OdsSheet.cell's own zero-based coordinates.
// - The odg vector actions (SET_VECTOR_FILL/SET_VECTOR_STROKE) carry the LIVE vector object rather than an index: `OdgPage.vectors()` is a real, live accessor, but it recognises a narrower vector vocabulary than odf.js's own reader (see screens/editors/odg/shared.ts's own `vectorsParityMatch`), so an index into it does not reliably line up with the row a caller selected from the UI's own (wider-vocabulary) vector list. Passing the live object through directly sidesteps that mismatch entirely, and is safe for the same reason the reducer is impure: the object IS the document, so there is no stale copy to go out of sync.
//
// SET_VECTOR_STROKE's `stroke` is non-optional because `OdgLineVector.stroke`'s setter (unlike the box/path ones) does not accept `undefined`, and a write against the union of the three narrows to the intersection of their setter types.

export type Action =
  | { readonly type: "PUSH_SCREEN"; readonly screen: Screen }
  | { readonly type: "POP_SCREEN" }
  | { readonly type: "RESET_STACK"; readonly screen: Screen }
  | { readonly type: "OPEN_OVERLAY"; readonly overlay: OverlayName }
  | { readonly type: "CLOSE_OVERLAY"; readonly overlay: OverlayName }
  | { readonly type: "REQUEST_QUIT" }
  | { readonly type: "CONFIRM_QUIT" }
  | { readonly type: "CANCEL_QUIT" }
  | { readonly type: "REQUEST_CLOSE" }
  | { readonly type: "CONFIRM_CLOSE" }
  | { readonly type: "CANCEL_CLOSE" }
  | {
      readonly type: "OPEN_FILE_SUCCESS";
      readonly path: string;
      readonly doc: OpenDocument;
    }
  | {
      readonly type: "OPEN_FILE_ERROR";
      readonly message: string;
      readonly detail: string | undefined;
    }
  | { readonly type: "CREATE_DOCUMENT"; readonly format: EditableFormat }
  | { readonly type: "SAVE_SUCCESS"; readonly path: string }
  | { readonly type: "SAVE_ERROR"; readonly message: string }
  | { readonly type: "SAVE_AS_REQUEST" }
  | { readonly type: "CLOSE_DOCUMENT" }
  | {
      readonly type: "SET_SELECTION";
      readonly key: string;
      readonly index: number;
    }
  | {
      readonly type: "APPEND_PARAGRAPH";
      readonly text: string | undefined;
      readonly styleId: string | undefined;
      readonly alignment: Alignment | undefined;
    }
  | {
      readonly type: "SET_PARAGRAPH_ALIGNMENT";
      readonly blockIndex: number;
      readonly alignment: Alignment | undefined;
    }
  | {
      readonly type: "APPEND_RUN";
      readonly blockIndex: number;
      readonly text: string;
    }
  | {
      readonly type: "SET_RUN_TEXT";
      readonly blockIndex: number;
      readonly runIndex: number;
      readonly text: string;
    }
  | {
      readonly type: "TOGGLE_RUN_BOLD";
      readonly blockIndex: number;
      readonly runIndex: number;
    }
  | {
      readonly type: "TOGGLE_RUN_ITALIC";
      readonly blockIndex: number;
      readonly runIndex: number;
    }
  | {
      readonly type: "TOGGLE_RUN_UNDERLINE";
      readonly blockIndex: number;
      readonly runIndex: number;
    }
  | {
      readonly type: "SET_RUN_COLOR";
      readonly blockIndex: number;
      readonly runIndex: number;
      readonly color: LayoutColor;
    }
  // `merge`, when present, is applied to the freshly built table in the SAME mutate() pass as APPEND_TABLE itself -- see reducer.ts's own APPEND_TABLE case -- rather than requiring a separate MERGE_TABLE_CELLS dispatch immediately afterwards, which would need the caller to already know the new table's own index.
  | {
      readonly type: "APPEND_TABLE";
      readonly rows: number;
      readonly columns: number;
      readonly merge?: {
        readonly startRow: number;
        readonly startColumn: number;
        readonly rowSpan: number;
        readonly colSpan: number;
      };
    }
  | {
      readonly type: "SET_TABLE_CELL_TEXT";
      readonly tableIndex: number;
      readonly row: number;
      readonly column: number;
      readonly text: string;
    }
  // Merges an already-built docx/odt table's own rectangle after the fact (DocxTable.mergeCells / OdtTable.mergeCells), as opposed to APPEND_TABLE's `merge` field, which merges a table at creation time.
  | {
      readonly type: "MERGE_TABLE_CELLS";
      readonly tableIndex: number;
      readonly startRow: number;
      readonly startColumn: number;
      readonly rowSpan: number;
      readonly colSpan: number;
    }
  | {
      readonly type: "ADD_LIST_ITEM";
      readonly blockIndex: number;
      readonly text: string;
    }
  | {
      readonly type: "SET_LIST_ITEM_TEXT";
      readonly blockIndex: number;
      readonly itemIndex: number;
      readonly text: string;
    }
  // odt-only, matching ADD_LIST_ITEM/SET_LIST_ITEM_TEXT's own "lists are a genuinely separate ODF concept" framing: creates a brand-new, empty text:list via OdtBody.appendList() -- no payload, since there is nothing to seed a fresh list with beyond the empty list itself (the first item is added afterwards, via ADD_LIST_ITEM against the new list's own index).
  | { readonly type: "ADD_LIST" }
  // Free-form font styling for a single run, resolved through the same withRun helper TOGGLE_RUN_BOLD/SET_RUN_COLOR already use -- both DocxRun and OdtRun carry real fontFamily/sizePt getters and setters (documents.js's src/edit/{docx,odt}/run.ts), so one action pair covers both formats identically.
  | {
      readonly type: "SET_RUN_FONT_FAMILY";
      readonly blockIndex: number;
      readonly runIndex: number;
      readonly fontFamily: string;
    }
  | {
      readonly type: "SET_RUN_FONT_SIZE";
      readonly blockIndex: number;
      readonly runIndex: number;
      readonly sizePt: number;
    }
  // Both docx's and odt's own insertImageAfter accept the identical ImageInit shape (format/bytes/widthPt/heightPt/altText) -- see documents.js's edit/{docx,odt}/image.ts -- so one action covers both, resolved through paragraph-family.ts's shared wordprocessingDocument narrowing exactly as APPEND_PARAGRAPH already is.
  | {
      readonly type: "INSERT_PARAGRAPH_IMAGE";
      readonly blockIndex: number;
      readonly format: "png" | "jpeg";
      readonly bytes: Uint8Array<ArrayBuffer>;
      readonly widthPt: number;
      readonly heightPt: number;
      readonly altText: string | undefined;
    }
  // docx's DocxParagraph.appendOfficeMath is PARAGRAPH-scoped -- unlike odt's own formula insertion below, it needs no frame at all, since OMML is inline markup within the paragraph rather than a separately-positioned embedded object.
  | {
      readonly type: "INSERT_DOCX_FORMULA";
      readonly blockIndex: number;
      readonly mathml: readonly MathMlNode[];
    }
  // odt's OdtBody.appendFormula is BODY-scoped only -- there is no paragraph-scoped odt formula insertion at all, since an embedded ODF formula is a whole nested sub-document referenced from a fresh paragraph the body itself appends, not markup placed inside an existing one. `frame` positions that new paragraph's own draw:frame.
  | {
      readonly type: "INSERT_ODT_FORMULA";
      readonly mathml: readonly MathMlNode[];
      readonly frame: Box;
    }
  | { readonly type: "ADD_SLIDE" }
  | {
      readonly type: "ADD_SLIDE_TABLE";
      readonly slideIndex: number;
      readonly frame: Box;
      readonly rows: number;
      readonly columns: number;
    }
  // `tableIndex` indexes `slide.tables()` -- PptxSlide.tables() returns PptxTable[] directly, OdpSlide.tables() returns OdpTableShape[] wrapping { shape, table: OdtTable } -- the reducer branches on `doc.format` to reach the right live handle either way (see the OdpSlide/PptxSlide doc comments in documents.js's own edit/{odp,pptx}/slide.ts).
  | {
      readonly type: "MERGE_SLIDE_TABLE_CELLS";
      readonly slideIndex: number;
      readonly tableIndex: number;
      readonly startRow: number;
      readonly startColumn: number;
      readonly rowSpan: number;
      readonly colSpan: number;
    }
  | {
      readonly type: "ADD_TEXTBOX";
      readonly containerIndex: number;
      readonly frame: Box;
      readonly text: string;
    }
  | {
      readonly type: "ADD_IMAGE";
      readonly containerIndex: number;
      readonly frame: Box;
      readonly format: "png" | "jpeg";
      readonly bytes: Uint8Array<ArrayBuffer>;
      readonly altText: string | undefined;
    }
  | {
      readonly type: "SET_SHAPE_TEXT";
      readonly containerIndex: number;
      readonly shapeIndex: number;
      readonly text: string;
    }
  | {
      readonly type: "SET_SHAPE_FRAME";
      readonly containerIndex: number;
      readonly shapeIndex: number;
      readonly frame: Box;
    }
  | {
      readonly type: "SET_SHAPE_ROTATION";
      readonly containerIndex: number;
      readonly shapeIndex: number;
      readonly rotationDeg: number | undefined;
    }
  | {
      readonly type: "SET_SLIDE_NOTES";
      readonly slideIndex: number;
      readonly notes: string;
    }
  | { readonly type: "ADD_SHEET"; readonly name: string }
  | {
      readonly type: "SET_CELL_VALUE";
      readonly sheetIndex: number;
      readonly row: number;
      readonly column: number;
      readonly value: ContentCellValue;
    }
  // `table:formula`, verbatim -- a deliberately SEPARATE action/edit mode from SET_CELL_VALUE, since a real ODF cell carries a formula and a typed value as two independent, coexisting attributes (OdsCell.formula/`.value`), not alternative states of the same cell.
  | {
      readonly type: "SET_CELL_FORMULA";
      readonly sheetIndex: number;
      readonly row: number;
      readonly column: number;
      readonly formula: string | undefined;
    }
  | {
      readonly type: "MERGE_CELLS";
      readonly sheetIndex: number;
      readonly startRow: number;
      readonly startColumn: number;
      readonly rowSpan: number;
      readonly colSpan: number;
    }
  | {
      readonly type: "SET_SHEET_PRINT_SETTINGS";
      readonly sheetIndex: number;
      readonly printSettings: ContentSheetPrintSettings;
    }
  // A floating, cell-anchored raster image (OdsSheet.addImage) -- `bytes` mirrors ADD_IMAGE/INSERT_PARAGRAPH_IMAGE's own raw-bytes convention, converted to the base64 ContentSheetImage itself requires only inside the reducer (bytesToBase64), not carried as base64 across the action boundary. `widthPt`/`heightPt` are required for the same reason INSERT_PARAGRAPH_IMAGE's are: ContentImageBlockSchema (which ContentSheetImageSchema extends) has no way to derive a rendered size from the source bytes alone.
  | {
      readonly type: "ADD_SHEET_IMAGE";
      readonly sheetIndex: number;
      readonly anchorRow: number;
      readonly anchorColumn: number;
      readonly offsetXPt: number;
      readonly offsetYPt: number;
      readonly format: "png" | "jpeg";
      readonly bytes: Uint8Array<ArrayBuffer>;
      readonly widthPt: number;
      readonly heightPt: number;
      readonly altText: string | undefined;
    }
  | { readonly type: "ADD_PAGE" }
  // `containerIndex` indexes `editor.pages()` for odg and `editor.slides()` for odp -- see this file's own top-of-file note on the rename from `pageIndex`.
  | {
      readonly type: "ADD_RECT";
      readonly containerIndex: number;
      readonly init: OdgBoxVectorInit;
    }
  | {
      readonly type: "ADD_ELLIPSE";
      readonly containerIndex: number;
      readonly init: OdgBoxVectorInit;
    }
  | {
      readonly type: "ADD_LINE";
      readonly containerIndex: number;
      readonly init: OdgLineVectorInit;
    }
  | {
      readonly type: "ADD_PATH";
      readonly containerIndex: number;
      readonly init: OdgPathVectorInit;
    }
  | {
      readonly type: "SET_VECTOR_FILL";
      readonly vector: OdgBoxVector | OdgPathVector;
      readonly fill: LayoutColor | undefined;
    }
  | {
      readonly type: "SET_VECTOR_STROKE";
      readonly vector: OdgBoxVector | OdgLineVector | OdgPathVector;
      readonly stroke: ContentStroke;
    }
  // PDF add/remove: `pageIndex` indexes `editor.pages()`/`editor.page()`, matching every other index-addressed container in this file. Each ADD_PDF_* action dispatches the exact PdfXInit shape the matching PdfPage.append<Kind> method itself takes, so the reducer needs no bespoke object-building of its own -- see documents.js's own src/edit/pdf/item.ts for each Init interface's real required fields.
  | {
      readonly type: "ADD_PDF_TEXT";
      readonly pageIndex: number;
      readonly init: PdfTextInit;
    }
  | {
      readonly type: "ADD_PDF_RECT";
      readonly pageIndex: number;
      readonly init: PdfRectInit;
    }
  | {
      readonly type: "ADD_PDF_ELLIPSE";
      readonly pageIndex: number;
      readonly init: PdfEllipseInit;
    }
  | {
      readonly type: "ADD_PDF_LINE";
      readonly pageIndex: number;
      readonly init: PdfLineInit;
    }
  | {
      readonly type: "ADD_PDF_PATH";
      readonly pageIndex: number;
      readonly init: PdfPathInit;
    }
  | {
      readonly type: "ADD_PDF_IMAGE";
      readonly pageIndex: number;
      readonly init: PdfImageInit;
    }
  | {
      readonly type: "ADD_PDF_LINK";
      readonly pageIndex: number;
      readonly init: PdfLinkInit;
    }
  | {
      readonly type: "REMOVE_PDF_ITEM";
      readonly pageIndex: number;
      readonly itemIndex: number;
    }
  // PDF item field edits, one family per LayoutItem kind: addressed by (pageIndex, itemIndex) rather than a live object reference -- unlike the odg vector actions above, PdfPage.items() is an unambiguous, real enumeration accessor with no parity-mismatch risk (see reducer.ts's own withPdfItemMatching), so resolving the index fresh inside the reducer on every dispatch is safe.
  | {
      readonly type: "SET_PDF_TEXT_TEXT";
      readonly pageIndex: number;
      readonly itemIndex: number;
      readonly text: string;
    }
  | {
      readonly type: "SET_PDF_TEXT_POSITION";
      readonly pageIndex: number;
      readonly itemIndex: number;
      readonly xPt: number;
      readonly yPt: number;
    }
  | {
      readonly type: "SET_PDF_TEXT_FONT";
      readonly pageIndex: number;
      readonly itemIndex: number;
      readonly font: LayoutFont;
    }
  | {
      readonly type: "SET_PDF_TEXT_SIZE";
      readonly pageIndex: number;
      readonly itemIndex: number;
      readonly sizePt: number;
    }
  | {
      readonly type: "SET_PDF_TEXT_COLOR";
      readonly pageIndex: number;
      readonly itemIndex: number;
      readonly color: LayoutColor;
    }
  | {
      readonly type: "SET_PDF_TEXT_ROTATION";
      readonly pageIndex: number;
      readonly itemIndex: number;
      readonly rotationDeg: number | undefined;
    }
  | {
      readonly type: "SET_PDF_TEXT_WIDTH";
      readonly pageIndex: number;
      readonly itemIndex: number;
      readonly widthPt: number | undefined;
    }
  | {
      readonly type: "TOGGLE_PDF_TEXT_UNDERLINE";
      readonly pageIndex: number;
      readonly itemIndex: number;
    }
  | {
      readonly type: "SET_PDF_RECT_FRAME";
      readonly pageIndex: number;
      readonly itemIndex: number;
      readonly xPt: number;
      readonly yPt: number;
      readonly widthPt: number;
      readonly heightPt: number;
    }
  | {
      readonly type: "SET_PDF_RECT_FILL";
      readonly pageIndex: number;
      readonly itemIndex: number;
      readonly fill: LayoutColor | undefined;
    }
  | {
      readonly type: "SET_PDF_RECT_STROKE";
      readonly pageIndex: number;
      readonly itemIndex: number;
      readonly stroke: ContentStroke | undefined;
    }
  | {
      readonly type: "SET_PDF_ELLIPSE_FRAME";
      readonly pageIndex: number;
      readonly itemIndex: number;
      readonly xPt: number;
      readonly yPt: number;
      readonly widthPt: number;
      readonly heightPt: number;
    }
  | {
      readonly type: "SET_PDF_ELLIPSE_FILL";
      readonly pageIndex: number;
      readonly itemIndex: number;
      readonly fill: LayoutColor | undefined;
    }
  | {
      readonly type: "SET_PDF_ELLIPSE_STROKE";
      readonly pageIndex: number;
      readonly itemIndex: number;
      readonly stroke: ContentStroke | undefined;
    }
  | {
      readonly type: "SET_PDF_LINE_FROM";
      readonly pageIndex: number;
      readonly itemIndex: number;
      readonly x1Pt: number;
      readonly y1Pt: number;
    }
  | {
      readonly type: "SET_PDF_LINE_TO";
      readonly pageIndex: number;
      readonly itemIndex: number;
      readonly x2Pt: number;
      readonly y2Pt: number;
    }
  | {
      readonly type: "SET_PDF_LINE_COLOR";
      readonly pageIndex: number;
      readonly itemIndex: number;
      readonly color: LayoutColor;
    }
  | {
      readonly type: "SET_PDF_LINE_WIDTH";
      readonly pageIndex: number;
      readonly itemIndex: number;
      readonly widthPt: number;
    }
  | {
      readonly type: "SET_PDF_PATH_FILL";
      readonly pageIndex: number;
      readonly itemIndex: number;
      readonly fill: LayoutColor | undefined;
    }
  | {
      readonly type: "SET_PDF_PATH_FILL_RULE";
      readonly pageIndex: number;
      readonly itemIndex: number;
      readonly fillRule: "nonzero" | "evenodd" | undefined;
    }
  | {
      readonly type: "SET_PDF_PATH_STROKE";
      readonly pageIndex: number;
      readonly itemIndex: number;
      readonly stroke: ContentStroke | undefined;
    }
  | {
      readonly type: "SET_PDF_IMAGE_FRAME";
      readonly pageIndex: number;
      readonly itemIndex: number;
      readonly xPt: number;
      readonly yPt: number;
      readonly widthPt: number;
      readonly heightPt: number;
    }
  | {
      readonly type: "SET_PDF_IMAGE_ROTATION";
      readonly pageIndex: number;
      readonly itemIndex: number;
      readonly rotationDeg: number | undefined;
    }
  // Re-embeds a fresh image, exactly like ADD_IMAGE/INSERT_PARAGRAPH_IMAGE: raw bytes across the action boundary, resolved into the document's own image registry inside the reducer (PdfImageItem.setImage), never base64.
  | {
      readonly type: "SET_PDF_IMAGE_SOURCE";
      readonly pageIndex: number;
      readonly itemIndex: number;
      readonly format: "png" | "jpeg";
      readonly bytes: Uint8Array<ArrayBuffer>;
    }
  | {
      readonly type: "SET_PDF_LINK_URI";
      readonly pageIndex: number;
      readonly itemIndex: number;
      readonly uri: string;
    }
  | {
      readonly type: "SET_PDF_INTERNAL_LINK_DESTINATION";
      readonly pageIndex: number;
      readonly itemIndex: number;
      readonly destination: string;
    }
  | {
      readonly type: "SET_PDF_INTERNAL_LINK_FRAME";
      readonly pageIndex: number;
      readonly itemIndex: number;
      readonly xPt: number;
      readonly yPt: number;
      readonly widthPt: number;
      readonly heightPt: number;
    }
  | {
      readonly type: "SET_PDF_LINK_FRAME";
      readonly pageIndex: number;
      readonly itemIndex: number;
      readonly xPt: number;
      readonly yPt: number;
      readonly widthPt: number;
      readonly heightPt: number;
    }
  | { readonly type: "APPEND_DIAGNOSTIC"; readonly diagnostic: Diagnostic }
  | { readonly type: "DISMISS_DIAGNOSTIC"; readonly index: number }
  | { readonly type: "CLEAR_DIAGNOSTICS" }
  | {
      readonly type: "SET_STATUS";
      readonly severity: StatusMessage["severity"];
      readonly text: string;
    }
  | { readonly type: "CLEAR_STATUS" }
  | { readonly type: "SET_SEARCH_QUERY"; readonly query: string }
  | { readonly type: "DISMISS_ERROR_DETAIL" }
  | { readonly type: "UNDO" };

export type ActionType = Action["type"];
