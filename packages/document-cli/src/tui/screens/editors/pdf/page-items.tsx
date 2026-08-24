import type { LayoutItem, PdfTextInit } from "documents.js";
import { Box, Text, useInput } from "ink";
import { useState, type Dispatch, type ReactElement } from "react";
import { readInput } from "../../../../runtime/io.js";
import { ListView } from "../../../components/list-view.js";
import { describeError } from "../../../errors.js";
import { useNavigationInput } from "../../../keybindings/use-navigation-input.js";
import type { Action } from "../../../state/actions.js";
import { useAppDispatch, useAppState } from "../../../state/context.js";
import { anyOverlayOpen, currentScreen } from "../../../state/types.js";
import {
  FieldWizard,
  requireFieldValue,
  type FieldSpec,
} from "../../shared/field-wizard.js";
import {
  defaultTriangleLayoutSubpaths,
  formatSize,
  inferImageFormat,
  isEditablePdfDocument,
  parseColorField,
  parseFontStyle,
  parseFontWeight,
  parseNumberField,
  parseStrokeField,
  requirePdfDocument,
} from "./shared.js";

// Long enough to tell two similarly-worded paragraphs apart at a glance while still leaving room for the kind label and index prefix on one row.
const TEXT_PREVIEW_MAX_CHARS = 48;

function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

// `LayoutPath` has no widthPt/heightPt of its own -- unlike image/rect/ellipse, its geometry lives entirely in its subpaths' points -- so its "dimensions" preview is the tight bounding box of every point the path actually visits, cubic control points included (a cubic curve is guaranteed to lie within their convex hull, so this never clips the curve; it can only ever be as large as or larger than a tighter, curve-aware bound).
function pathDimensions(item: Extract<LayoutItem, { kind: "path" }>): string {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const consider = (xPt: number, yPt: number): void => {
    minX = Math.min(minX, xPt);
    minY = Math.min(minY, yPt);
    maxX = Math.max(maxX, xPt);
    maxY = Math.max(maxY, yPt);
  };
  for (const subpath of item.subpaths) {
    consider(subpath.startXPt, subpath.startYPt);
    for (const segment of subpath.segments) {
      if (segment.kind === "cubic") {
        consider(segment.c1xPt, segment.c1yPt);
        consider(segment.c2xPt, segment.c2yPt);
      }
      consider(segment.xPt, segment.yPt);
    }
  }
  if (minX > maxX) {
    return "empty path";
  }
  return formatSize(maxX - minX, maxY - minY);
}

function previewFor(item: LayoutItem): string {
  switch (item.kind) {
    case "text":
      return truncate(item.text, TEXT_PREVIEW_MAX_CHARS);
    case "link":
      return item.uri;
    case "internalLink":
      return `→ ${item.destination}`;
    case "image":
    case "rect":
    case "ellipse":
      return formatSize(item.widthPt, item.heightPt);
    case "line":
      return formatSize(
        Math.abs(item.x2Pt - item.x1Pt),
        Math.abs(item.y2Pt - item.y1Pt),
      );
    case "path":
      return pathDimensions(item);
  }
}

interface IndexedItem {
  readonly item: LayoutItem;
  readonly itemIndex: number;
}

// --- add-item flow, only ever reached for a genuine 'pdf'-format document (see isEditablePdfDocument's own doc comment) -----------------------------------------------------------------------------------------------------

type AddKind = "text" | "rect" | "ellipse" | "line" | "path" | "image" | "link";

const ADD_KIND_OPTIONS: readonly {
  readonly kind: AddKind;
  readonly label: string;
}[] = [
  { kind: "text", label: "Text" },
  { kind: "rect", label: "Rectangle" },
  { kind: "ellipse", label: "Ellipse" },
  { kind: "line", label: "Line" },
  { kind: "path", label: "Path (fixed triangle shape)" },
  { kind: "image", label: "Image" },
  { kind: "link", label: "Link" },
];

const GEOMETRY_FIELDS: readonly FieldSpec[] = [
  { key: "xPt", label: "X (pt)", defaultValue: "40" },
  { key: "yPt", label: "Y (pt)", defaultValue: "40" },
  { key: "widthPt", label: "Width (pt)", defaultValue: "160" },
  { key: "heightPt", label: "Height (pt)", defaultValue: "100" },
];

const FILL_FIELD: FieldSpec = {
  key: "fill",
  label: 'Fill "r g b" (0-1 each), blank for none',
  defaultValue: "0.8 0.8 0.8",
};
const STROKE_FIELD: FieldSpec = {
  key: "stroke",
  label: 'Stroke "r g b widthPt" (0-1 colour, pt width), blank for none',
  defaultValue: "0 0 0 1",
};
const REQUIRED_COLOR_FIELD: FieldSpec = {
  key: "color",
  label: 'Colour "r g b" (0-1 each)',
  defaultValue: "0 0 0",
};

function fieldsForAddKind(kind: AddKind): readonly FieldSpec[] {
  switch (kind) {
    case "text":
      return [
        { key: "xPt", label: "X (pt)", defaultValue: "40" },
        { key: "yPt", label: "Y (pt)", defaultValue: "40" },
        { key: "text", label: "Text", defaultValue: "Text" },
        { key: "fontFamily", label: "Font family", defaultValue: "Helvetica" },
        {
          key: "fontWeight",
          label: "Font weight (normal/bold)",
          defaultValue: "normal",
        },
        {
          key: "fontStyle",
          label: "Font style (normal/italic)",
          defaultValue: "normal",
        },
        { key: "sizePt", label: "Size (pt)", defaultValue: "12" },
        REQUIRED_COLOR_FIELD,
      ];
    case "rect":
    case "ellipse":
    case "path":
      return [...GEOMETRY_FIELDS, FILL_FIELD, STROKE_FIELD];
    case "line":
      return [
        { key: "fromXPt", label: "From X (pt)", defaultValue: "40" },
        { key: "fromYPt", label: "From Y (pt)", defaultValue: "40" },
        { key: "toXPt", label: "To X (pt)", defaultValue: "200" },
        { key: "toYPt", label: "To Y (pt)", defaultValue: "40" },
        REQUIRED_COLOR_FIELD,
        { key: "widthPt", label: "Width (pt)", defaultValue: "1" },
      ];
    case "image":
      return [
        ...GEOMETRY_FIELDS,
        {
          key: "path",
          label: "Image file path (.png/.jpg/.jpeg)",
          defaultValue: "",
        },
      ];
    case "link":
      return [
        { key: "uri", label: "URI", defaultValue: "https://example.com" },
        ...GEOMETRY_FIELDS,
      ];
  }
}

function readFrame(values: Readonly<Record<string, string>>): {
  readonly xPt: number;
  readonly yPt: number;
  readonly widthPt: number;
  readonly heightPt: number;
} {
  return {
    xPt: parseNumberField(requireFieldValue(values, "xPt"), 0),
    yPt: parseNumberField(requireFieldValue(values, "yPt"), 0),
    widthPt: parseNumberField(requireFieldValue(values, "widthPt"), 100),
    heightPt: parseNumberField(requireFieldValue(values, "heightPt"), 60),
  };
}

// The one async branch (reading an image file off disk) is why this whole function is async -- every other kind dispatches synchronously and resolves immediately, matching odg/page-detail.tsx's own AddItemFlow shape.
async function applyAddKind(
  kind: AddKind,
  pageIndex: number,
  values: Readonly<Record<string, string>>,
  dispatch: Dispatch<Action>,
): Promise<void> {
  switch (kind) {
    case "text": {
      const init: PdfTextInit = {
        xPt: parseNumberField(requireFieldValue(values, "xPt"), 0),
        yPt: parseNumberField(requireFieldValue(values, "yPt"), 0),
        text: requireFieldValue(values, "text"),
        font: {
          family: requireFieldValue(values, "fontFamily").trim() || "Helvetica",
          weight: parseFontWeight(requireFieldValue(values, "fontWeight")),
          style: parseFontStyle(requireFieldValue(values, "fontStyle")),
        },
        sizePt: Math.max(
          parseNumberField(requireFieldValue(values, "sizePt"), 12),
          Number.EPSILON,
        ),
        color: parseColorField(requireFieldValue(values, "color")) ?? {
          r: 0,
          g: 0,
          b: 0,
        },
      };
      dispatch({ type: "ADD_PDF_TEXT", pageIndex, init });
      return;
    }
    case "rect": {
      const frame = readFrame(values);
      dispatch({
        type: "ADD_PDF_RECT",
        pageIndex,
        init: {
          ...frame,
          fill: parseColorField(requireFieldValue(values, "fill")),
          stroke: parseStrokeField(requireFieldValue(values, "stroke")),
        },
      });
      return;
    }
    case "ellipse": {
      const frame = readFrame(values);
      dispatch({
        type: "ADD_PDF_ELLIPSE",
        pageIndex,
        init: {
          ...frame,
          fill: parseColorField(requireFieldValue(values, "fill")),
          stroke: parseStrokeField(requireFieldValue(values, "stroke")),
        },
      });
      return;
    }
    case "line": {
      dispatch({
        type: "ADD_PDF_LINE",
        pageIndex,
        init: {
          x1Pt: parseNumberField(requireFieldValue(values, "fromXPt"), 0),
          y1Pt: parseNumberField(requireFieldValue(values, "fromYPt"), 0),
          x2Pt: parseNumberField(requireFieldValue(values, "toXPt"), 100),
          y2Pt: parseNumberField(requireFieldValue(values, "toYPt"), 0),
          color: parseColorField(requireFieldValue(values, "color")) ?? {
            r: 0,
            g: 0,
            b: 0,
          },
          widthPt: Math.max(
            parseNumberField(requireFieldValue(values, "widthPt"), 1),
            Number.EPSILON,
          ),
        },
      });
      return;
    }
    case "path": {
      const frame = readFrame(values);
      dispatch({
        type: "ADD_PDF_PATH",
        pageIndex,
        init: {
          subpaths: defaultTriangleLayoutSubpaths(
            frame.widthPt,
            frame.heightPt,
          ),
          fill: parseColorField(requireFieldValue(values, "fill")),
          stroke: parseStrokeField(requireFieldValue(values, "stroke")),
        },
      });
      return;
    }
    case "image": {
      const frame = readFrame(values);
      const path = requireFieldValue(values, "path");
      const format = inferImageFormat(path);
      if (format === undefined) {
        dispatch({
          type: "SET_STATUS",
          severity: "warning",
          text: `${path} is not a .png or .jpg/.jpeg file -- image not added`,
        });
        return;
      }
      try {
        const bytes = new Uint8Array(await readInput(path));
        dispatch({
          type: "ADD_PDF_IMAGE",
          pageIndex,
          init: { ...frame, format, bytes },
        });
      } catch (error) {
        dispatch({
          type: "SET_STATUS",
          severity: "error",
          text: `Could not read ${path}: ${describeError(error)}`,
        });
      }
      return;
    }
    case "link": {
      const frame = readFrame(values);
      dispatch({
        type: "ADD_PDF_LINK",
        pageIndex,
        init: { uri: requireFieldValue(values, "uri"), ...frame },
      });
      return;
    }
  }
}

function AddItemFlow(props: {
  readonly pageIndex: number;
  readonly isActive: boolean;
  readonly onCancel: () => void;
  readonly onCreated: () => void;
}): ReactElement {
  const dispatch = useAppDispatch();
  const [kind, setKind] = useState<AddKind | undefined>(undefined);

  const { selectedIndex } = useNavigationInput({
    itemCount: ADD_KIND_OPTIONS.length,
    isActive: props.isActive && kind === undefined,
    onBack: props.onCancel,
    onSelect: (index) => {
      const option = ADD_KIND_OPTIONS[index];
      if (option === undefined) {
        return;
      }
      setKind(option.kind);
    },
  });

  if (kind === undefined) {
    return (
      <Box flexDirection="column" borderStyle="round" paddingX={1}>
        <Text bold>Add item -- choose a kind</Text>
        {/* A 7-item fixed list inside a 2-row border, so it needs 2 more reserved rows than list-view.tsx's own default (title + status line + blank + slack) already assumes. */}
        <ListView
          items={ADD_KIND_OPTIONS}
          selectedIndex={selectedIndex}
          reservedRows={6}
          renderItem={(option, isSelected) => (
            <Text color={isSelected ? "cyan" : undefined}>
              {isSelected ? "> " : "  "}
              {option.label}
            </Text>
          )}
        />
      </Box>
    );
  }

  return (
    <FieldWizard
      fields={fieldsForAddKind(kind)}
      onCancel={props.onCancel}
      onComplete={(values) => {
        void applyAddKind(kind, props.pageIndex, values, dispatch).then(
          props.onCreated,
        );
      }}
    />
  );
}

// A scrollable dump of one page's own positioned items, in the exact paint order `readPdf` recovered them -- text shows a truncated preview of its own string, a link shows its target URI, and every other kind (image/rect/ellipse/line/path) shows a short size summary since none of them carry meaningful inline text. For a genuine `'pdf'`-format document (not an xlsx preview -- see shared.ts's own isEditablePdfDocument), `a` opens the add-item flow and `d` deletes the currently selected item.
export function PdfPageItemsScreen(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const doc = requirePdfDocument(state.openDocument);
  const editable = isEditablePdfDocument(doc);
  const screen = currentScreen(state);
  if (screen.kind !== "pdfPageItems") {
    throw new Error(
      `PdfPageItemsScreen rendered while the current screen is "${screen.kind}", not "pdfPageItems".`,
    );
  }
  const page = doc.layout.pages[screen.pageIndex];
  if (page === undefined) {
    throw new Error(
      `pdfPageItems was pushed for page ${screen.pageIndex}, but the open PDF has no page at that index.`,
    );
  }
  const [isAdding, setIsAdding] = useState(false);
  const overlayOpen = anyOverlayOpen(state);

  const query = state.searchQuery.trim().toLowerCase();
  const indexed: IndexedItem[] = page.items.map((item, itemIndex) => ({
    item,
    itemIndex,
  }));
  const items =
    query === ""
      ? indexed
      : indexed.filter((entry) =>
          `${entry.item.kind} ${previewFor(entry.item)}`
            .toLowerCase()
            .includes(query),
        );

  const { selectedIndex } = useNavigationInput({
    itemCount: items.length,
    isActive: !overlayOpen && !isAdding,
    onSelect: (index) => {
      const entry = items[index];
      if (entry === undefined) {
        return;
      }
      dispatch({
        type: "PUSH_SCREEN",
        screen: {
          kind: "pdfItemDetail",
          pageIndex: screen.pageIndex,
          itemIndex: entry.itemIndex,
        },
      });
    },
    onBack: () => {
      dispatch({ type: "POP_SCREEN" });
    },
    onAppend: editable
      ? () => {
          setIsAdding(true);
        }
      : undefined,
  });

  // A second, independent listener alongside useNavigationInput's own -- Ink supports several simultaneous active `useInput` hooks, and `useNavigationInput` has no delete-key concept of its own (see keybindings/use-navigation-input.ts). Only wired up for a genuine editable pdf document; an xlsx preview has no REMOVE_PDF_ITEM to dispatch against in the first place.
  useInput(
    (input) => {
      if (input !== "d") {
        return;
      }
      const entry = items[selectedIndex];
      if (entry === undefined) {
        return;
      }
      dispatch({
        type: "REMOVE_PDF_ITEM",
        pageIndex: screen.pageIndex,
        itemIndex: entry.itemIndex,
      });
    },
    { isActive: editable && !overlayOpen && !isAdding && items.length > 0 },
  );

  if (isAdding) {
    return (
      <AddItemFlow
        pageIndex={screen.pageIndex}
        isActive={!overlayOpen}
        onCancel={() => {
          setIsAdding(false);
        }}
        onCreated={() => {
          setIsAdding(false);
        }}
      />
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>
        Page {screen.pageIndex + 1} items ({items.length} of {page.items.length}
        )
      </Text>
      <ListView
        items={items}
        selectedIndex={selectedIndex}
        emptyMessage={
          query === ""
            ? editable
              ? "This page has no items -- press 'a' to add one"
              : "This page has no items."
            : `No items match "${state.searchQuery}".`
        }
        renderItem={({ item, itemIndex }, isSelected) => (
          <Text color={isSelected ? "cyan" : undefined} inverse={isSelected}>
            {itemIndex + 1}. {item.kind} -- {previewFor(item)}
          </Text>
        )}
      />
      {editable && (
        <Text dimColor>a to add an item, d to delete the selected item</Text>
      )}
    </Box>
  );
}
