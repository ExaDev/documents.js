import type { Alignment, Box, ContentCellValue, ContentSheetPrintSettings, ContentStroke, LayoutColor, OdgBoxVector, OdgBoxVectorInit, OdgLineVector, OdgLineVectorInit, OdgPathVector, OdgPathVectorInit } from 'documents.js';
import type { Diagnostic, EditableFormat, OpenDocument, OverlayName, Screen, StatusMessage } from './types.js';

// HOW A MUTATING ACTION ADDRESSES ITS TARGET. The rule is: address by index wherever the editor exposes an enumeration accessor to resolve that index against, and carry the live object itself only where it does not.
//
// - `blockIndex` indexes `editor.paragraphs()` for the paragraph/run/list actions, and `editor.tables()` for the table actions -- two separate arrays, matching the two accessors documents.js gives a docx/odt editor.
// - `containerIndex` indexes `editor.slides()` for pptx/odp and `editor.pages()` for odg: a shape (`OdpShape`/`PptxShape`) lives on a slide or on a drawing page and is reached identically either way, so one action serves both.
// - `sheetIndex` indexes `editor.sheets()`; `row`/`column` are OdsSheet.cell's own zero-based coordinates.
// - The odg vector actions (SET_VECTOR_FILL/SET_VECTOR_STROKE) carry the LIVE vector object instead, because `OdgPage` has `shapes()` but no vector enumeration accessor at all -- the only handle on an existing `draw:rect`/`draw:ellipse`/`draw:line`/`draw:path` is the reference `addRect`/`addEllipse`/`addLine`/`addPath` returned. Passing a live object through an action is safe here for the same reason the reducer is impure: the object IS the document, so there is no stale copy to go out of sync.
//
// SET_VECTOR_STROKE's `stroke` is non-optional because `OdgLineVector.stroke`'s setter (unlike the box/path ones) does not accept `undefined`, and a write against the union of the three narrows to the intersection of their setter types.

export type Action =
  | { readonly type: 'PUSH_SCREEN'; readonly screen: Screen }
  | { readonly type: 'POP_SCREEN' }
  | { readonly type: 'RESET_STACK'; readonly screen: Screen }
  | { readonly type: 'OPEN_OVERLAY'; readonly overlay: OverlayName }
  | { readonly type: 'CLOSE_OVERLAY'; readonly overlay: OverlayName }
  | { readonly type: 'REQUEST_QUIT' }
  | { readonly type: 'CONFIRM_QUIT' }
  | { readonly type: 'CANCEL_QUIT' }
  | { readonly type: 'REQUEST_CLOSE' }
  | { readonly type: 'CONFIRM_CLOSE' }
  | { readonly type: 'CANCEL_CLOSE' }
  | { readonly type: 'OPEN_FILE_SUCCESS'; readonly path: string; readonly doc: OpenDocument }
  | { readonly type: 'OPEN_FILE_ERROR'; readonly message: string; readonly detail: string | undefined }
  | { readonly type: 'CREATE_DOCUMENT'; readonly format: EditableFormat }
  | { readonly type: 'SAVE_SUCCESS'; readonly path: string }
  | { readonly type: 'SAVE_ERROR'; readonly message: string }
  | { readonly type: 'SAVE_AS_REQUEST' }
  | { readonly type: 'CLOSE_DOCUMENT' }
  | { readonly type: 'SET_SELECTION'; readonly key: string; readonly index: number }
  | { readonly type: 'APPEND_PARAGRAPH'; readonly text: string | undefined; readonly styleId: string | undefined; readonly alignment: Alignment | undefined }
  | { readonly type: 'SET_PARAGRAPH_ALIGNMENT'; readonly blockIndex: number; readonly alignment: Alignment | undefined }
  | { readonly type: 'APPEND_RUN'; readonly blockIndex: number; readonly text: string }
  | { readonly type: 'SET_RUN_TEXT'; readonly blockIndex: number; readonly runIndex: number; readonly text: string }
  | { readonly type: 'TOGGLE_RUN_BOLD'; readonly blockIndex: number; readonly runIndex: number }
  | { readonly type: 'TOGGLE_RUN_ITALIC'; readonly blockIndex: number; readonly runIndex: number }
  | { readonly type: 'TOGGLE_RUN_UNDERLINE'; readonly blockIndex: number; readonly runIndex: number }
  | { readonly type: 'SET_RUN_COLOR'; readonly blockIndex: number; readonly runIndex: number; readonly color: LayoutColor }
  | { readonly type: 'APPEND_TABLE'; readonly rows: number; readonly columns: number }
  | { readonly type: 'SET_TABLE_CELL_TEXT'; readonly tableIndex: number; readonly row: number; readonly column: number; readonly text: string }
  | { readonly type: 'ADD_LIST_ITEM'; readonly blockIndex: number; readonly text: string }
  | { readonly type: 'ADD_SLIDE' }
  | { readonly type: 'ADD_SLIDE_TABLE'; readonly slideIndex: number; readonly frame: Box; readonly rows: number; readonly columns: number }
  | { readonly type: 'ADD_TEXTBOX'; readonly containerIndex: number; readonly frame: Box; readonly text: string }
  | { readonly type: 'ADD_IMAGE'; readonly containerIndex: number; readonly frame: Box; readonly format: 'png' | 'jpeg'; readonly bytes: Uint8Array<ArrayBuffer>; readonly altText: string | undefined }
  | { readonly type: 'SET_SHAPE_TEXT'; readonly containerIndex: number; readonly shapeIndex: number; readonly text: string }
  | { readonly type: 'SET_SHAPE_FRAME'; readonly containerIndex: number; readonly shapeIndex: number; readonly frame: Box }
  | { readonly type: 'SET_SHAPE_ROTATION'; readonly containerIndex: number; readonly shapeIndex: number; readonly rotationDeg: number | undefined }
  | { readonly type: 'SET_SLIDE_NOTES'; readonly slideIndex: number; readonly notes: string }
  | { readonly type: 'ADD_SHEET'; readonly name: string }
  | { readonly type: 'SET_CELL_VALUE'; readonly sheetIndex: number; readonly row: number; readonly column: number; readonly value: ContentCellValue }
  | { readonly type: 'SET_SHEET_PRINT_SETTINGS'; readonly sheetIndex: number; readonly printSettings: ContentSheetPrintSettings }
  | { readonly type: 'ADD_PAGE' }
  | { readonly type: 'ADD_RECT'; readonly pageIndex: number; readonly init: OdgBoxVectorInit }
  | { readonly type: 'ADD_ELLIPSE'; readonly pageIndex: number; readonly init: OdgBoxVectorInit }
  | { readonly type: 'ADD_LINE'; readonly pageIndex: number; readonly init: OdgLineVectorInit }
  | { readonly type: 'ADD_PATH'; readonly pageIndex: number; readonly init: OdgPathVectorInit }
  | { readonly type: 'SET_VECTOR_FILL'; readonly vector: OdgBoxVector | OdgPathVector; readonly fill: LayoutColor | undefined }
  | { readonly type: 'SET_VECTOR_STROKE'; readonly vector: OdgBoxVector | OdgLineVector | OdgPathVector; readonly stroke: ContentStroke }
  // Markdown has no live editor object to mutate in place (see MarkdownOpenDocument's own doc comment) -- the whole rejoined source is dispatched at once, rather than one action per line, so the reducer's own mutateMarkdown helper stays a single, genuinely pure "replace the string, push an undo snapshot" step.
  | { readonly type: 'SET_MARKDOWN_SOURCE'; readonly source: string }
  | { readonly type: 'APPEND_DIAGNOSTIC'; readonly diagnostic: Diagnostic }
  | { readonly type: 'DISMISS_DIAGNOSTIC'; readonly index: number }
  | { readonly type: 'CLEAR_DIAGNOSTICS' }
  | { readonly type: 'SET_STATUS'; readonly severity: StatusMessage['severity']; readonly text: string }
  | { readonly type: 'CLEAR_STATUS' }
  | { readonly type: 'SET_SEARCH_QUERY'; readonly query: string }
  | { readonly type: 'DISMISS_ERROR_DETAIL' }
  | { readonly type: 'UNDO' };

export type ActionType = Action['type'];
