import type {
  PresentationOpenDocument,
  ShapeHostOpenDocument,
  SpreadsheetOpenDocument,
  WordprocessingOpenDocument,
} from "./open-documents";
import {
  drawingDocument,
  presentationDocument,
  shapeHostDocument,
  spreadsheetDocument,
  styledWordprocessingDocument,
  wordprocessingDocument,
} from "./open-documents";
import { mutate, withStatus, wrongDocument } from "./reducer";
import type { AppState, OdsOpenDocument } from "./types.js";
import {
  type DocParagraph,
  type DocRun,
  type DocTable,
  type DocTableCell,
  type DocxParagraph,
  type DocxRun,
  type DocxTable,
  type DocxTableCell,
  type MarkdownParagraph,
  type MarkdownRun,
  type MarkdownTable,
  type MarkdownTableCell,
  type MathMlNode,
  type OdpShape,
  type OdsSheet,
  type OdtParagraph,
  type OdtRun,
  type OdtTable,
  type OdtTableCell,
  type PptShape,
  type PptxShape,
  type XlsSheet,
} from "documents.js";
// The deep mutation helpers of the TUI reducer, split from reducer.ts: paragraph/table/shape/sheet locators, the with* families that rewrite runs, shapes and sheets, text-cell writers and the mutable MathML node view. reducer.ts keeps the reducer switch.
export function paragraphAt(
  doc: WordprocessingOpenDocument,
  blockIndex: number,
): DocxParagraph | OdtParagraph | MarkdownParagraph | DocParagraph | undefined {
  return doc.editor.paragraphs()[blockIndex];
}

export function tableAt(
  doc: WordprocessingOpenDocument,
  tableIndex: number,
): DocxTable | OdtTable | MarkdownTable | DocTable | undefined {
  return doc.editor.tables()[tableIndex];
}

// The universal cell lookup every table kind supports, used in place of DocxTable/OdtTable's own `.cell(row, column)` shortcut — MarkdownTable has no such shortcut (only `rows()`/`appendRow()`/`remove()`), so SET_TABLE_CELL_TEXT resolves a cell through the one traversal all four genuinely share: the grid view. The column is a GRID column, the same one MERGE_TABLE_CELLS takes, so a position a merged region covers resolves to the region's anchor cell rather than to whichever physical cell happens to sit at that index.
export function tableCellAt(
  table: DocxTable | OdtTable | MarkdownTable | DocTable,
  row: number,
  column: number,
): DocxTableCell | OdtTableCell | MarkdownTableCell | DocTableCell | undefined {
  return table.gridRows()[row]?.[column]?.cell;
}

export function shapeAt(
  doc: ShapeHostOpenDocument,
  containerIndex: number,
  shapeIndex: number,
): PptxShape | OdpShape | undefined {
  if (doc.format === "odg") {
    return doc.editor.pages()[containerIndex]?.shapes()[shapeIndex];
  }
  return doc.editor.slides()[containerIndex]?.shapes()[shapeIndex];
}

export function sheetAt(
  doc: SpreadsheetOpenDocument,
  sheetIndex: number,
): OdsSheet | XlsSheet | undefined {
  return doc.editor.sheets()[sheetIndex];
}

// The ods-only sheet lookup, for the actions whose OdsSheet surface xls genuinely lacks (see odsDocument's own doc comment).
export function odsSheetAt(
  doc: OdsOpenDocument,
  sheetIndex: number,
): OdsSheet | undefined {
  return doc.editor.sheets()[sheetIndex];
}

export function withRun(
  state: AppState,
  blockIndex: number,
  runIndex: number,
  apply: (run: DocxRun | OdtRun | MarkdownRun | DocRun) => void,
): AppState {
  const doc = wordprocessingDocument(state);
  if (doc === undefined) {
    return wrongDocument(state, "a docx, odt or markdown document");
  }
  const paragraph = paragraphAt(doc, blockIndex);
  if (paragraph === undefined) {
    return withStatus(
      state,
      "warning",
      `There is no paragraph at index ${blockIndex}`,
    );
  }
  const run = paragraph.runs()[runIndex];
  if (run === undefined) {
    return withStatus(
      state,
      "warning",
      `Paragraph ${blockIndex} has no run at index ${runIndex}`,
    );
  }
  return mutate(state, doc, () => {
    apply(run);
  });
}

// withRun's narrow, docx/odt-only counterpart — for TOGGLE_RUN_UNDERLINE/SET_RUN_COLOR/SET_RUN_FONT_FAMILY/SET_RUN_FONT_SIZE, none of which MarkdownRun has a field for at all (it carries bold/italic/strike/hyperlink/code, not underline/colour/fontFamily/sizePt).
export function withStyledRun(
  state: AppState,
  blockIndex: number,
  runIndex: number,
  apply: (run: DocxRun | OdtRun | DocRun) => void,
): AppState {
  const doc = styledWordprocessingDocument(state);
  if (doc === undefined) {
    return wrongDocument(state, "a docx, odt or doc document");
  }
  const paragraph = doc.editor.paragraphs()[blockIndex];
  if (paragraph === undefined) {
    return withStatus(
      state,
      "warning",
      `There is no paragraph at index ${blockIndex}`,
    );
  }
  const run = paragraph.runs()[runIndex];
  if (run === undefined) {
    return withStatus(
      state,
      "warning",
      `Paragraph ${blockIndex} has no run at index ${runIndex}`,
    );
  }
  return mutate(state, doc, () => {
    apply(run);
  });
}

export function withShape(
  state: AppState,
  containerIndex: number,
  shapeIndex: number,
  apply: (shape: PptxShape | OdpShape) => void,
): AppState {
  const doc = shapeHostDocument(state);
  if (doc === undefined) {
    return wrongDocument(state, "a pptx, odp or odg document");
  }
  const shape = shapeAt(doc, containerIndex, shapeIndex);
  if (shape === undefined) {
    return withStatus(
      state,
      "warning",
      `There is no shape ${shapeIndex} on ${doc.format === "odg" ? "page" : "slide"} ${containerIndex}`,
    );
  }
  return mutate(state, doc, () => {
    apply(shape);
  });
}

// The widened shape counterpart for the two shape fields every presentation shape carries (text, frame) — PptShape included. Rotation and the other rich-shape actions stay on withShape above, since PptxShape/OdpShape alone carry them.
export function shapeWideAt(
  doc: ShapeHostOpenDocument | PresentationOpenDocument,
  containerIndex: number,
  shapeIndex: number,
): PptxShape | OdpShape | PptShape | undefined {
  if (doc.format === "odg") {
    return doc.editor.pages()[containerIndex]?.shapes()[shapeIndex];
  }
  return doc.editor.slides()[containerIndex]?.shapes()[shapeIndex];
}

export function withWideShape(
  state: AppState,
  containerIndex: number,
  shapeIndex: number,
  apply: (shape: PptxShape | OdpShape | PptShape) => void,
): AppState {
  const drawing = drawingDocument(state);
  const doc: ShapeHostOpenDocument | PresentationOpenDocument | undefined =
    drawing ?? presentationDocument(state);
  if (doc === undefined) {
    return wrongDocument(state, "a pptx, odp, ppt or odg document");
  }
  const shape = shapeWideAt(doc, containerIndex, shapeIndex);
  if (shape === undefined) {
    return withStatus(
      state,
      "warning",
      `There is no shape ${shapeIndex} on ${doc.format === "odg" ? "page" : "slide"} ${containerIndex}`,
    );
  }
  return mutate(state, doc, () => {
    apply(shape);
  });
}

export function withSheet(
  state: AppState,
  sheetIndex: number,
  apply: (sheet: OdsSheet | XlsSheet) => void,
): AppState {
  const doc = spreadsheetDocument(state);
  if (doc === undefined) {
    return wrongDocument(state, "an ods or xls document");
  }
  const sheet = sheetAt(doc, sheetIndex);
  if (sheet === undefined) {
    return withStatus(
      state,
      "warning",
      `There is no sheet at index ${sheetIndex}`,
    );
  }
  return mutate(state, doc, () => {
    apply(sheet);
  });
}

// The ods-only counterpart of withSheet, taking the already-narrowed document so the ods-only actions (SET_CELL_FORMULA, ADD_SHEET_IMAGE) share the same missing-sheet warning shape without re-narrowing.
export function withOdsSheet(
  state: AppState,
  doc: OdsOpenDocument,
  sheetIndex: number,
  apply: (sheet: OdsSheet) => void,
): AppState {
  const sheet = odsSheetAt(doc, sheetIndex);
  if (sheet === undefined) {
    return withStatus(
      state,
      "warning",
      `There is no sheet at index ${sheetIndex}`,
    );
  }
  return mutate(state, doc, () => {
    apply(sheet);
  });
}

// The small structural shape a "replace this container's whole text" write needs — satisfied by DocxTableCell/OdtTableCell (paragraphs()/appendParagraph()) and equally by OdtListItem (the identical paragraphs()/appendParagraph() pair, see documents.js's src/edit/odt/list.ts), even though a table cell and a list item share no common base class or interface of their own.
export interface TextRunLike {
  text: string;
  remove(): void;
}
export interface TextParagraphLike {
  runs(): readonly TextRunLike[];
  appendRun(init: { readonly text: string }): unknown;
}
export interface TextContainerLike {
  paragraphs(): readonly TextParagraphLike[];
  appendParagraph(): TextParagraphLike;
}

// A container's text is replaced rather than appended: documents.js gives a table cell or list item `paragraphs()`/`appendParagraph()` and a read-only `text`, so the first paragraph's first run carries the new value and any further runs in it are removed. Generalised from a docx/odt-table-cell-only helper so SET_LIST_ITEM_TEXT can reuse the identical template against an OdtListItem.
export function setTextContainerText(
  container: Readonly<TextContainerLike>,
  text: string,
): void {
  const existing = container.paragraphs();
  const first = existing[0];
  const paragraph = first ?? container.appendParagraph();
  const runs = paragraph.runs();
  const firstRun = runs[0];
  if (firstRun === undefined) {
    paragraph.appendRun({ text });
    return;
  }
  firstRun.text = text;
  for (const extra of runs.slice(1)) {
    extra.remove();
  }
}

export function setCellText(
  cell: DocxTableCell | OdtTableCell | MarkdownTableCell | DocTableCell,
  text: string,
): void {
  setTextContainerText(cell, text);
}

// documents.js's own MathMlNode (src/mathml/nodes.ts, what INSERT_ODT_FORMULA's own action field is typed with, matching appendOfficeMath's identical parameter type) declares every array field `readonly` — but ContentFormula.mathml (document-schema.js's own, separately hand-written MathMlNode, what OdtBody.appendFormula's own `formula` parameter actually requires) declares the identical fields as plain mutable arrays. The two describe the same JSON shape at runtime; TypeScript still refuses a `readonly T[]` value at a `T[]`-typed target, at every nesting level (attributes, children), so a shallow spread of the top-level array is not enough. This rebuilds the tree as fresh, genuinely mutable objects/arrays, structurally satisfying document-schema.js's MathMlNode with no cast. documents.js's own MathMlNode collapses the cdata/comment/declaration/pi variants down to a bare `{ type }` with none of their other fields (that module's own doc comment: "MathML content never meaningfully contains any of them"), so there is nothing to carry across for those four kinds — document-schema.js's schema still requires one, so an empty stand-in is supplied; neither a hand-authored preset (formula-presets.ts) nor a real parsed MathML formula ever produces one of these kinds in practice.
export interface MutableMathMlAttribute {
  readonly name: string;
  readonly value: string;
}
export type MutableMathMlNode =
  | { readonly type: "text"; readonly value: string }
  | { readonly type: "cdata"; readonly value: string }
  | { readonly type: "comment"; readonly value: string }
  | {
      readonly type: "declaration";
      readonly attributes: MutableMathMlAttribute[];
    }
  | { readonly type: "pi"; readonly target: string; readonly content: string }
  | {
      readonly type: "element";
      readonly tag: string;
      readonly attributes: MutableMathMlAttribute[];
      readonly children: MutableMathMlNode[];
    };

export function mutableMathMlNode(node: MathMlNode): MutableMathMlNode {
  if (node.type === "element") {
    return {
      type: "element",
      tag: node.tag,
      attributes: [...node.attributes],
      children: node.children.map(mutableMathMlNode),
    };
  }
  if (node.type === "text") {
    return { type: "text", value: node.value };
  }
  if (node.type === "cdata" || node.type === "comment") {
    return { type: node.type, value: "" };
  }
  if (node.type === "declaration") {
    return { type: "declaration", attributes: [] };
  }
  return { type: "pi", target: "", content: "" };
}
