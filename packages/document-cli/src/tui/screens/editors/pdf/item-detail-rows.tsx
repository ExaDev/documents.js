import type { Action } from "../../../state/actions.js";
import type {
  ContentStroke,
  LayoutColor,
  PdfEllipseItem,
  PdfImageItem,
  PdfInternalLinkItem,
  PdfItem,
  PdfLineItem,
  PdfLinkItem,
  PdfPathItem,
  PdfRectItem,
  PdfTextItem,
} from "documents.js";
import type { Dispatch } from "react";
import type { EditableRow, FrameFields } from "./item-detail";
import {
  formatPt,
  formatStroke,
  parseColorField,
  parseNumberField,
  parseOptionalNumberField,
  parseRequiredColorField,
  parseStrokeField,
} from "./shared.js";
import { frameOf } from "./item-detail";
import { layoutColorToHex } from "../../shared/color";
// The per-kind property-row builders of the pdf item detail screen, split from item-detail.tsx: frame, fill/stroke, text, rect, ellipse, line, path, image, link and internal-link rows over the shared Field/FrameFields model. item-detail.tsx keeps the read-only and editable renderers and the screen.
export function buildFrameRows(
  frame: FrameFields,
  onFrameChange: (frame: FrameFields) => void,
): EditableRow[] {
  return [
    {
      label: `X: ${formatPt(frame.xPt)}pt`,
      currentValue: String(frame.xPt),
      commit: (raw) => {
        onFrameChange({ ...frame, xPt: parseNumberField(raw, frame.xPt) });
      },
    },
    {
      label: `Y: ${formatPt(frame.yPt)}pt`,
      currentValue: String(frame.yPt),
      commit: (raw) => {
        onFrameChange({ ...frame, yPt: parseNumberField(raw, frame.yPt) });
      },
    },
    {
      label: `Width: ${formatPt(frame.widthPt)}pt`,
      currentValue: String(frame.widthPt),
      commit: (raw) => {
        onFrameChange({
          ...frame,
          widthPt: parseNumberField(raw, frame.widthPt),
        });
      },
    },
    {
      label: `Height: ${formatPt(frame.heightPt)}pt`,
      currentValue: String(frame.heightPt),
      commit: (raw) => {
        onFrameChange({
          ...frame,
          heightPt: parseNumberField(raw, frame.heightPt),
        });
      },
    },
  ];
}

export function buildFillStrokeRows(
  fill: LayoutColor | undefined,
  stroke: { readonly color: LayoutColor; readonly widthPt: number } | undefined,
  onFillChange: (fill: LayoutColor | undefined) => void,
  onStrokeChange: (stroke: ContentStroke | undefined) => void,
): EditableRow[] {
  return [
    {
      label: `Fill: ${fill === undefined ? "none" : layoutColorToHex(fill)}`,
      currentValue: fill === undefined ? "" : `${fill.r} ${fill.g} ${fill.b}`,
      commit: (raw) => {
        onFillChange(parseColorField(raw));
      },
    },
    {
      label: `Stroke: ${stroke === undefined ? "none" : formatStroke(stroke)}`,
      currentValue:
        stroke === undefined
          ? ""
          : `${stroke.color.r} ${stroke.color.g} ${stroke.color.b} ${stroke.widthPt}`,
      commit: (raw) => {
        onStrokeChange(parseStrokeField(raw));
      },
    },
  ];
}

export function buildTextRows(
  item: PdfTextItem,
  pageIndex: number,
  itemIndex: number,
  dispatch: Dispatch<Action>,
): EditableRow[] {
  return [
    {
      label: `Text: ${item.text}`,
      currentValue: item.text,
      commit: (raw) => {
        dispatch({
          type: "SET_PDF_TEXT_TEXT",
          pageIndex,
          itemIndex,
          text: raw,
        });
      },
    },
    {
      label: `X: ${formatPt(item.xPt)}pt`,
      currentValue: String(item.xPt),
      commit: (raw) => {
        dispatch({
          type: "SET_PDF_TEXT_POSITION",
          pageIndex,
          itemIndex,
          xPt: parseNumberField(raw, item.xPt),
          yPt: item.yPt,
        });
      },
    },
    {
      label: `Y: ${formatPt(item.yPt)}pt`,
      currentValue: String(item.yPt),
      commit: (raw) => {
        dispatch({
          type: "SET_PDF_TEXT_POSITION",
          pageIndex,
          itemIndex,
          xPt: item.xPt,
          yPt: parseNumberField(raw, item.yPt),
        });
      },
    },
    {
      label: `Font family: ${item.font.family}`,
      currentValue: item.font.family,
      commit: (raw) => {
        const family = raw.trim();
        dispatch({
          type: "SET_PDF_TEXT_FONT",
          pageIndex,
          itemIndex,
          font: {
            ...item.font,
            family: family.length === 0 ? item.font.family : family,
          },
        });
      },
    },
    {
      label: `Font weight: ${item.font.weight} (Enter to toggle)`,
      activate: () => {
        dispatch({
          type: "SET_PDF_TEXT_FONT",
          pageIndex,
          itemIndex,
          font: {
            ...item.font,
            weight: item.font.weight === "bold" ? "normal" : "bold",
          },
        });
      },
    },
    {
      label: `Font style: ${item.font.style} (Enter to toggle)`,
      activate: () => {
        dispatch({
          type: "SET_PDF_TEXT_FONT",
          pageIndex,
          itemIndex,
          font: {
            ...item.font,
            style: item.font.style === "italic" ? "normal" : "italic",
          },
        });
      },
    },
    {
      label: `Size: ${item.sizePt}pt`,
      currentValue: String(item.sizePt),
      commit: (raw) => {
        dispatch({
          type: "SET_PDF_TEXT_SIZE",
          pageIndex,
          itemIndex,
          sizePt: parseNumberField(raw, item.sizePt),
        });
      },
    },
    {
      label: `Colour: ${layoutColorToHex(item.color)}`,
      currentValue: `${item.color.r} ${item.color.g} ${item.color.b}`,
      commit: (raw) => {
        dispatch({
          type: "SET_PDF_TEXT_COLOR",
          pageIndex,
          itemIndex,
          color: parseRequiredColorField(raw, item.color),
        });
      },
    },
    {
      label: `Width: ${item.widthPt === undefined ? "unset" : `${item.widthPt}pt`}`,
      currentValue: item.widthPt === undefined ? "" : String(item.widthPt),
      commit: (raw) => {
        dispatch({
          type: "SET_PDF_TEXT_WIDTH",
          pageIndex,
          itemIndex,
          widthPt: parseOptionalNumberField(raw),
        });
      },
    },
    {
      label: `Rotation: ${item.rotationDeg === undefined ? "unset" : `${item.rotationDeg}°`}`,
      currentValue:
        item.rotationDeg === undefined ? "" : String(item.rotationDeg),
      commit: (raw) => {
        dispatch({
          type: "SET_PDF_TEXT_ROTATION",
          pageIndex,
          itemIndex,
          rotationDeg: parseOptionalNumberField(raw),
        });
      },
    },
    {
      label: `Underline: ${item.underline === true ? "yes" : "no"} (Enter to toggle)`,
      activate: () => {
        dispatch({ type: "TOGGLE_PDF_TEXT_UNDERLINE", pageIndex, itemIndex });
      },
    },
  ];
}

export function buildRectRows(
  item: PdfRectItem,
  pageIndex: number,
  itemIndex: number,
  dispatch: Dispatch<Action>,
): EditableRow[] {
  return [
    ...buildFrameRows(frameOf(item), (frame) => {
      dispatch({ type: "SET_PDF_RECT_FRAME", pageIndex, itemIndex, ...frame });
    }),
    ...buildFillStrokeRows(
      item.fill,
      item.stroke,
      (fill) => {
        dispatch({ type: "SET_PDF_RECT_FILL", pageIndex, itemIndex, fill });
      },
      (stroke) => {
        dispatch({ type: "SET_PDF_RECT_STROKE", pageIndex, itemIndex, stroke });
      },
    ),
  ];
}

export function buildEllipseRows(
  item: PdfEllipseItem,
  pageIndex: number,
  itemIndex: number,
  dispatch: Dispatch<Action>,
): EditableRow[] {
  return [
    ...buildFrameRows(frameOf(item), (frame) => {
      dispatch({
        type: "SET_PDF_ELLIPSE_FRAME",
        pageIndex,
        itemIndex,
        ...frame,
      });
    }),
    ...buildFillStrokeRows(
      item.fill,
      item.stroke,
      (fill) => {
        dispatch({ type: "SET_PDF_ELLIPSE_FILL", pageIndex, itemIndex, fill });
      },
      (stroke) => {
        dispatch({
          type: "SET_PDF_ELLIPSE_STROKE",
          pageIndex,
          itemIndex,
          stroke,
        });
      },
    ),
  ];
}

export function buildLineRows(
  item: PdfLineItem,
  pageIndex: number,
  itemIndex: number,
  dispatch: Dispatch<Action>,
): EditableRow[] {
  return [
    {
      label: `From X: ${formatPt(item.x1Pt)}pt`,
      currentValue: String(item.x1Pt),
      commit: (raw) => {
        dispatch({
          type: "SET_PDF_LINE_FROM",
          pageIndex,
          itemIndex,
          x1Pt: parseNumberField(raw, item.x1Pt),
          y1Pt: item.y1Pt,
        });
      },
    },
    {
      label: `From Y: ${formatPt(item.y1Pt)}pt`,
      currentValue: String(item.y1Pt),
      commit: (raw) => {
        dispatch({
          type: "SET_PDF_LINE_FROM",
          pageIndex,
          itemIndex,
          x1Pt: item.x1Pt,
          y1Pt: parseNumberField(raw, item.y1Pt),
        });
      },
    },
    {
      label: `To X: ${formatPt(item.x2Pt)}pt`,
      currentValue: String(item.x2Pt),
      commit: (raw) => {
        dispatch({
          type: "SET_PDF_LINE_TO",
          pageIndex,
          itemIndex,
          x2Pt: parseNumberField(raw, item.x2Pt),
          y2Pt: item.y2Pt,
        });
      },
    },
    {
      label: `To Y: ${formatPt(item.y2Pt)}pt`,
      currentValue: String(item.y2Pt),
      commit: (raw) => {
        dispatch({
          type: "SET_PDF_LINE_TO",
          pageIndex,
          itemIndex,
          x2Pt: item.x2Pt,
          y2Pt: parseNumberField(raw, item.y2Pt),
        });
      },
    },
    {
      label: `Colour: ${layoutColorToHex(item.color)}`,
      currentValue: `${item.color.r} ${item.color.g} ${item.color.b}`,
      commit: (raw) => {
        dispatch({
          type: "SET_PDF_LINE_COLOR",
          pageIndex,
          itemIndex,
          color: parseRequiredColorField(raw, item.color),
        });
      },
    },
    {
      label: `Width: ${item.widthPt}pt`,
      currentValue: String(item.widthPt),
      commit: (raw) => {
        dispatch({
          type: "SET_PDF_LINE_WIDTH",
          pageIndex,
          itemIndex,
          widthPt: Math.max(
            parseNumberField(raw, item.widthPt),
            Number.EPSILON,
          ),
        });
      },
    },
  ];
}

export function buildPathRows(
  item: PdfPathItem,
  pageIndex: number,
  itemIndex: number,
  dispatch: Dispatch<Action>,
): EditableRow[] {
  return [
    {
      label: `Fill rule: ${item.fillRule ?? "nonzero (default)"} (Enter to cycle)`,
      activate: () => {
        dispatch({
          type: "SET_PDF_PATH_FILL_RULE",
          pageIndex,
          itemIndex,
          fillRule:
            item.fillRule === "evenodd"
              ? undefined
              : item.fillRule === "nonzero"
                ? "evenodd"
                : "nonzero",
        });
      },
    },
    ...buildFillStrokeRows(
      item.fill,
      item.stroke,
      (fill) => {
        dispatch({ type: "SET_PDF_PATH_FILL", pageIndex, itemIndex, fill });
      },
      (stroke) => {
        dispatch({ type: "SET_PDF_PATH_STROKE", pageIndex, itemIndex, stroke });
      },
    ),
  ];
}

export function buildImageRows(
  item: PdfImageItem,
  pageIndex: number,
  itemIndex: number,
  dispatch: Dispatch<Action>,
  onReplaceImage: () => void,
): EditableRow[] {
  return [
    ...buildFrameRows(frameOf(item), (frame) => {
      dispatch({ type: "SET_PDF_IMAGE_FRAME", pageIndex, itemIndex, ...frame });
    }),
    {
      label: `Rotation: ${item.rotationDeg === undefined ? "unset" : `${item.rotationDeg}°`}`,
      currentValue:
        item.rotationDeg === undefined ? "" : String(item.rotationDeg),
      commit: (raw) => {
        dispatch({
          type: "SET_PDF_IMAGE_ROTATION",
          pageIndex,
          itemIndex,
          rotationDeg: parseOptionalNumberField(raw),
        });
      },
    },
    { label: "Replace image...", activate: onReplaceImage },
  ];
}

export function buildLinkRows(
  item: PdfLinkItem,
  pageIndex: number,
  itemIndex: number,
  dispatch: Dispatch<Action>,
): EditableRow[] {
  return [
    {
      label: `URI: ${item.uri}`,
      currentValue: item.uri,
      commit: (raw) => {
        dispatch({ type: "SET_PDF_LINK_URI", pageIndex, itemIndex, uri: raw });
      },
    },
    ...buildFrameRows(frameOf(item), (frame) => {
      dispatch({ type: "SET_PDF_LINK_FRAME", pageIndex, itemIndex, ...frame });
    }),
  ];
}

// An internal link's destination names a destinations-table entry, not a URI — editable as the plain name it is, with the same frame rows every placed item gets.
export function buildInternalLinkRows(
  item: PdfInternalLinkItem,
  pageIndex: number,
  itemIndex: number,
  dispatch: Dispatch<Action>,
): EditableRow[] {
  return [
    {
      label: `Destination: ${item.destination}`,
      currentValue: item.destination,
      commit: (raw) => {
        dispatch({
          type: "SET_PDF_INTERNAL_LINK_DESTINATION",
          pageIndex,
          itemIndex,
          destination: raw,
        });
      },
    },
    ...buildFrameRows(frameOf(item), (frame) => {
      dispatch({
        type: "SET_PDF_INTERNAL_LINK_FRAME",
        pageIndex,
        itemIndex,
        ...frame,
      });
    }),
  ];
}

export function buildRowsFor(
  item: PdfItem,
  pageIndex: number,
  itemIndex: number,
  dispatch: Dispatch<Action>,
  onReplaceImage: () => void,
): EditableRow[] {
  switch (item.kind) {
    case "text":
      return buildTextRows(item, pageIndex, itemIndex, dispatch);
    case "rect":
      return buildRectRows(item, pageIndex, itemIndex, dispatch);
    case "ellipse":
      return buildEllipseRows(item, pageIndex, itemIndex, dispatch);
    case "line":
      return buildLineRows(item, pageIndex, itemIndex, dispatch);
    case "path":
      return buildPathRows(item, pageIndex, itemIndex, dispatch);
    case "image":
      return buildImageRows(
        item,
        pageIndex,
        itemIndex,
        dispatch,
        onReplaceImage,
      );
    case "link":
      return buildLinkRows(item, pageIndex, itemIndex, dispatch);
    case "internalLink":
      return buildInternalLinkRows(item, pageIndex, itemIndex, dispatch);
  }
}
