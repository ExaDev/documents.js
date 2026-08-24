import { readFile } from "node:fs/promises";
import { Box, Text, useInput } from "ink";
import { useState, type ReactElement } from "react";
import type { Box as GeometryBox, ContentStroke } from "documents.js";
import { describeError } from "../../../errors.js";
import { ListView } from "../../../components/list-view.js";
import { TextField } from "../../../components/text-field.js";
import { useNavigationInput } from "../../../keybindings/use-navigation-input.js";
import type { Action } from "../../../state/actions.js";
import { useAppDispatch, useAppState } from "../../../state/context.js";
import {
  anyOverlayOpen,
  selectionKeyFor,
  type Screen,
} from "../../../state/types.js";
import {
  FieldWizard,
  requireFieldValue,
  type FieldSpec,
} from "../../shared/field-wizard.js";
import {
  assertPresentationDocument,
  defaultShapeFrame,
  describeSlideFamilyShape,
} from "../../shared/slide-family.js";
import { summarizeSlideTables } from "../../shared/slide-table.js";
import { parseNumberField, parsePositiveIntField } from "../../shared/text.js";
import {
  defaultTriangleSubpaths,
  parseColorField,
  parseStrokeField,
} from "../../shared/vector-fields.js";

export interface SlideDetailScreenProps {
  readonly screen: Extract<Screen, { kind: "slideDetail" }>;
}

// 'tableRows'/'tableColumns' are a two-step wizard rather than one combined field: this screen has no multi-field FieldWizard the way odg's page-detail.tsx does (see that file's own FieldWizard), and a table only ever needs these two small integers, so two sequential single-value TextField steps -- the same shape every other add-item flow in this screen already uses -- covers it without importing a heavier component for one caller. 'vector' is the fifth mode, odp-only (see the chooseKind handler below): it walks a real FieldWizard rather than its own bespoke sequence, since a vector's own field count/shape varies by kind (rect/ellipse/path share geometry+fill+stroke, line needs two endpoints instead) the same way odg's own page-detail.tsx add-item flow already does.
type AddItemMode =
  | "closed"
  | "chooseKind"
  | "textbox"
  | "image"
  | "tableRows"
  | "tableColumns"
  | "vector";

// odg's own vector vocabulary (OdgBoxVectorInit/OdgLineVectorInit/OdgPathVectorInit -- see actions.ts) reused verbatim for odp: OdpSlide.addVector takes the identical ContentVector shape OdgPage.addRect/etc build internally, so there is no odp-specific vector-kind vocabulary to define separately.
type VectorKind = "rect" | "ellipse" | "line" | "path";

const IMAGE_EXTENSION_TO_FORMAT: Readonly<Record<string, "png" | "jpeg">> = {
  png: "png",
  jpg: "jpeg",
  jpeg: "jpeg",
};

const DEFAULT_TABLE_ROWS = 2;
const DEFAULT_TABLE_COLUMNS = 2;

// Mirrors odg/page-detail.tsx's own GEOMETRY_FIELDS/FILL_FIELD/STROKE_FIELD exactly -- the same field shape a rect/ellipse/path vector needs regardless of which container (a drawing page, a slide) ends up hosting it.
const VECTOR_GEOMETRY_FIELDS: readonly FieldSpec[] = [
  { key: "xPt", label: "X (pt)", defaultValue: "40" },
  { key: "yPt", label: "Y (pt)", defaultValue: "40" },
  { key: "widthPt", label: "Width (pt)", defaultValue: "160" },
  { key: "heightPt", label: "Height (pt)", defaultValue: "100" },
];
const VECTOR_FILL_FIELD: FieldSpec = {
  key: "fill",
  label: 'Fill "r g b" (0-1 each), blank for none',
  defaultValue: "0.8 0.8 0.8",
};
const VECTOR_STROKE_FIELD: FieldSpec = {
  key: "stroke",
  label: 'Stroke "r g b widthPt" (0-1 colour, pt width), blank for none',
  defaultValue: "0 0 0 1",
};
const VECTOR_LINE_FIELDS: readonly FieldSpec[] = [
  { key: "fromXPt", label: "From X (pt)", defaultValue: "40" },
  { key: "fromYPt", label: "From Y (pt)", defaultValue: "40" },
  { key: "toXPt", label: "To X (pt)", defaultValue: "200" },
  { key: "toYPt", label: "To Y (pt)", defaultValue: "40" },
  VECTOR_STROKE_FIELD,
];

function fieldsForVectorKind(kind: VectorKind): readonly FieldSpec[] {
  switch (kind) {
    case "rect":
    case "ellipse":
    case "path":
      return [
        ...VECTOR_GEOMETRY_FIELDS,
        VECTOR_FILL_FIELD,
        VECTOR_STROKE_FIELD,
      ];
    case "line":
      return VECTOR_LINE_FIELDS;
  }
}

function readVectorFrame(
  values: Readonly<Record<string, string>>,
): GeometryBox {
  return {
    xPt: parseNumberField(requireFieldValue(values, "xPt"), 0),
    yPt: parseNumberField(requireFieldValue(values, "yPt"), 0),
    widthPt: parseNumberField(requireFieldValue(values, "widthPt"), 160),
    heightPt: parseNumberField(requireFieldValue(values, "heightPt"), 100),
  };
}

// Builds the real ADD_RECT/ADD_ELLIPSE/ADD_LINE/ADD_PATH action from the wizard's own collected field values -- the odp-slide counterpart of odg/page-detail.tsx's own applyAddKind, sharing the identical OdgBoxVectorInit/OdgLineVectorInit/OdgPathVectorInit shape (see this file's own VectorKind comment).
function buildVectorAction(
  kind: VectorKind,
  slideIndex: number,
  values: Readonly<Record<string, string>>,
): Action {
  switch (kind) {
    case "rect":
      return {
        type: "ADD_RECT",
        containerIndex: slideIndex,
        init: {
          frame: readVectorFrame(values),
          fill: parseColorField(requireFieldValue(values, "fill")),
          stroke: parseStrokeField(requireFieldValue(values, "stroke")),
        },
      };
    case "ellipse":
      return {
        type: "ADD_ELLIPSE",
        containerIndex: slideIndex,
        init: {
          frame: readVectorFrame(values),
          fill: parseColorField(requireFieldValue(values, "fill")),
          stroke: parseStrokeField(requireFieldValue(values, "stroke")),
        },
      };
    case "line": {
      const from = {
        xPt: parseNumberField(requireFieldValue(values, "fromXPt"), 0),
        yPt: parseNumberField(requireFieldValue(values, "fromYPt"), 0),
      };
      const to = {
        xPt: parseNumberField(requireFieldValue(values, "toXPt"), 100),
        yPt: parseNumberField(requireFieldValue(values, "toYPt"), 0),
      };
      const stroke: ContentStroke = parseStrokeField(
        requireFieldValue(values, "stroke"),
      ) ?? { color: { r: 0, g: 0, b: 0 }, widthPt: 1 };
      return {
        type: "ADD_LINE",
        containerIndex: slideIndex,
        init: { from, to, stroke },
      };
    }
    case "path": {
      const frame = readVectorFrame(values);
      return {
        type: "ADD_PATH",
        containerIndex: slideIndex,
        init: {
          frame,
          subpaths: defaultTriangleSubpaths(frame.widthPt, frame.heightPt),
          fill: parseColorField(requireFieldValue(values, "fill")),
          stroke: parseStrokeField(requireFieldValue(values, "stroke")),
        },
      };
    }
  }
}

function imageFormatFromPath(path: string): "png" | "jpeg" | undefined {
  const dotIndex = path.lastIndexOf(".");
  if (dotIndex < 0) {
    return undefined;
  }
  return IMAGE_EXTENSION_TO_FORMAT[path.slice(dotIndex + 1).toLowerCase()];
}

async function readImageForShape(path: string): Promise<{
  readonly format: "png" | "jpeg";
  readonly bytes: Uint8Array<ArrayBuffer>;
}> {
  const format = imageFormatFromPath(path);
  if (format === undefined) {
    throw new Error(
      `${path} does not look like a .png or .jpg/.jpeg file -- ADD_IMAGE only accepts those two formats`,
    );
  }
  return { format, bytes: new Uint8Array(await readFile(path)) };
}

// PptxSlide.shapes()/OdpSlide.shapes() never report a table graphicFrame/draw:frame at all -- it is invisible to that accessor by design (see documents.js's own doc comments) -- so a slide's own tables() need their own section in this screen's body list, separate from `shapes`, rather than being folded into the same array. `header` is skipped by the selectable-row-indices machinery below, mirroring paragraph-family.tsx's own ParagraphFamilyBodyList (which faces the identical "two separate enumeration accessors, no shared document-order index" problem for paragraphs/tables/lists).
interface ShapeRow {
  readonly kind: "shape";
  readonly index: number;
  readonly text: string;
  readonly frame: GeometryBox | undefined;
}
interface TablesHeaderRow {
  readonly kind: "tablesHeader";
  readonly count: number;
}
interface TableRow {
  readonly kind: "table";
  readonly index: number;
  readonly rowCount: number;
  readonly columnCount: number;
}
type SlideBodyRow = ShapeRow | TablesHeaderRow | TableRow;

export function SlideDetailScreen(props: SlideDetailScreenProps): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const overlayOpen = anyOverlayOpen(state);
  const doc = assertPresentationDocument(state.openDocument);
  const { slideIndex } = props.screen;
  const slide = doc.editor.slides()[slideIndex];
  const shapes = slide === undefined ? [] : slide.shapes();
  const tableSummaries =
    slide === undefined ? [] : summarizeSlideTables(doc, slideIndex);

  const shapeRows: readonly SlideBodyRow[] = shapes.map((shape, index) => ({
    kind: "shape",
    index,
    text: shape.text,
    frame: shape.frame,
  }));
  const rows: readonly SlideBodyRow[] = [
    ...shapeRows,
    ...(tableSummaries.length > 0
      ? [
          { kind: "tablesHeader", count: tableSummaries.length } as const,
          ...tableSummaries.map((summary): SlideBodyRow => ({
            kind: "table",
            index: summary.index,
            rowCount: summary.rowCount,
            columnCount: summary.columnCount,
          })),
        ]
      : []),
  ];
  const selectableRowIndices: readonly number[] = rows.reduce<number[]>(
    (acc, row, index) => {
      if (row.kind !== "tablesHeader") {
        acc.push(index);
      }
      return acc;
    },
    [],
  );

  const [addMode, setAddMode] = useState<AddItemMode>("closed");
  const [draft, setDraft] = useState("");
  const [imageError, setImageError] = useState<string | undefined>(undefined);
  const [tableRows, setTableRows] = useState(DEFAULT_TABLE_ROWS);
  const [vectorKind, setVectorKind] = useState<VectorKind | undefined>(
    undefined,
  );
  const formIsOpen = addMode !== "closed";

  const { selectedIndex } = useNavigationInput({
    itemCount: selectableRowIndices.length,
    isActive: !overlayOpen && !formIsOpen,
    onBack: () => {
      dispatch({ type: "POP_SCREEN" });
    },
    onSelect: (index) => {
      const rowIndex = selectableRowIndices[index];
      const row = rowIndex === undefined ? undefined : rows[rowIndex];
      if (row === undefined) {
        return;
      }
      if (row.kind === "shape") {
        dispatch({
          type: "SET_SELECTION",
          key: selectionKeyFor(props.screen),
          index,
        });
        dispatch({
          type: "PUSH_SCREEN",
          screen: { kind: "shapeEditor", slideIndex, shapeIndex: row.index },
        });
        return;
      }
      if (row.kind === "table") {
        dispatch({
          type: "PUSH_SCREEN",
          screen: {
            kind: "slideTableDetail",
            slideIndex,
            tableIndex: row.index,
          },
        });
      }
    },
    onAppend: () => {
      setAddMode("chooseKind");
    },
  });

  // Only meaningful when `rows` is non-empty; ListView renders its own empty message before reading this prop when `rows` is empty, so -1 (a value no real row index can equal) is a safe "nothing to highlight" -- matching paragraph-family.tsx's own ParagraphFamilyBodyList convention exactly.
  const resolvedRowIndex = selectableRowIndices[selectedIndex];
  const listSelectedIndex = resolvedRowIndex ?? -1;

  // 't'/'i'/'b' choose the new item's kind; anything else (bar Esc) is ignored rather than falling through to the list navigation below, since useNavigationInput is already inactive for the whole add-item flow (see `formIsOpen` above). 'r'/'e'/'n'/'p' (rect/ellipse/line/path) are odp-only: pptx has no vector-primitive model in documents.js at all (PptxSlide has no addVector counterpart), so those four keys are silently ignored on a pptx document rather than exposed and then failing at dispatch time.
  useInput(
    (input, key) => {
      if (key.escape) {
        setAddMode("closed");
        return;
      }
      if (input === "t") {
        setDraft("");
        setAddMode("textbox");
        return;
      }
      if (input === "i") {
        setDraft("");
        setImageError(undefined);
        setAddMode("image");
        return;
      }
      if (input === "b") {
        setDraft(String(DEFAULT_TABLE_ROWS));
        setAddMode("tableRows");
        return;
      }
      if (doc.format !== "odp") {
        return;
      }
      if (input === "r") {
        setVectorKind("rect");
        setAddMode("vector");
        return;
      }
      if (input === "e") {
        setVectorKind("ellipse");
        setAddMode("vector");
        return;
      }
      if (input === "n") {
        setVectorKind("line");
        setAddMode("vector");
        return;
      }
      if (input === "p") {
        setVectorKind("path");
        setAddMode("vector");
      }
    },
    { isActive: !overlayOpen && addMode === "chooseKind" },
  );

  // Notes editing dispatches SET_SLIDE_NOTES, which documents.js supports identically for pptx and odp (both PptxSlide and OdpSlide carry a real `.notes` getter/setter) -- so this key is available for either format, not gated to odp.
  useInput(
    (input) => {
      if (input === "n") {
        dispatch({
          type: "PUSH_SCREEN",
          screen: { kind: "notesEditor", slideIndex },
        });
      }
    },
    { isActive: !overlayOpen && !formIsOpen },
  );

  const commitTextbox = (text: string): void => {
    dispatch({
      type: "ADD_TEXTBOX",
      containerIndex: slideIndex,
      frame: defaultShapeFrame(doc.editor.slideSize),
      text,
    });
    setAddMode("closed");
  };

  const commitImage = (path: string): void => {
    void (async () => {
      try {
        const { format, bytes } = await readImageForShape(path);
        dispatch({
          type: "ADD_IMAGE",
          containerIndex: slideIndex,
          frame: defaultShapeFrame(doc.editor.slideSize),
          format,
          bytes,
          altText: undefined,
        });
        setAddMode("closed");
      } catch (error) {
        setImageError(describeError(error));
      }
    })();
  };

  const commitTableRows = (raw: string): void => {
    setTableRows(parsePositiveIntField(raw, DEFAULT_TABLE_ROWS));
    setDraft(String(DEFAULT_TABLE_COLUMNS));
    setAddMode("tableColumns");
  };

  const commitTableColumns = (raw: string): void => {
    const columns = parsePositiveIntField(raw, DEFAULT_TABLE_COLUMNS);
    dispatch({
      type: "ADD_SLIDE_TABLE",
      slideIndex,
      frame: defaultShapeFrame(doc.editor.slideSize),
      rows: tableRows,
      columns,
    });
    setAddMode("closed");
  };

  return (
    <Box flexDirection="column">
      <Text bold>
        Slide {slideIndex + 1} -- {shapes.length} shape
        {shapes.length === 1 ? "" : "s"}
      </Text>
      {slide === undefined ? (
        <Text color="yellow">
          This slide no longer exists -- press Esc to go back
        </Text>
      ) : (
        <ListView
          items={rows}
          selectedIndex={listSelectedIndex}
          emptyMessage="No shapes yet -- press 'a' to add one"
          renderItem={(row, isSelected) => {
            if (row.kind === "tablesHeader") {
              return (
                <Text bold dimColor>
                  Tables ({row.count})
                </Text>
              );
            }
            if (row.kind === "table") {
              return (
                <Text
                  color={isSelected ? "cyan" : undefined}
                  inverse={isSelected}
                >
                  {"  "}Table {row.index + 1} ({row.rowCount}x{row.columnCount})
                </Text>
              );
            }
            return (
              <Text
                color={isSelected ? "cyan" : undefined}
                inverse={isSelected}
              >
                {row.index + 1}.{" "}
                {describeSlideFamilyShape({ text: row.text, frame: row.frame })}
              </Text>
            );
          }}
        />
      )}
      {addMode === "chooseKind" ? (
        <Text color="cyan">
          Add shape: t textbox, i image, b table
          {doc.format === "odp" ? ", r rect, e ellipse, n line, p path" : ""},
          Esc cancel
        </Text>
      ) : undefined}
      {addMode === "vector" && vectorKind !== undefined ? (
        <FieldWizard
          fields={fieldsForVectorKind(vectorKind)}
          onCancel={() => {
            setAddMode("closed");
            setVectorKind(undefined);
          }}
          onComplete={(values) => {
            dispatch(buildVectorAction(vectorKind, slideIndex, values));
            setAddMode("closed");
            setVectorKind(undefined);
          }}
        />
      ) : undefined}
      {addMode === "textbox" ? (
        <Box>
          <Text color="cyan">Textbox content: </Text>
          <TextField
            value={draft}
            isFocused
            onChange={setDraft}
            onSubmit={commitTextbox}
            onCancel={() => {
              setAddMode("closed");
            }}
          />
        </Box>
      ) : undefined}
      {addMode === "image" ? (
        <Box flexDirection="column">
          <Box>
            <Text color="cyan">Image file path: </Text>
            <TextField
              value={draft}
              isFocused
              onChange={setDraft}
              onSubmit={commitImage}
              onCancel={() => {
                setAddMode("closed");
              }}
            />
          </Box>
          {imageError === undefined ? undefined : (
            <Text color="red">{imageError}</Text>
          )}
        </Box>
      ) : undefined}
      {addMode === "tableRows" ? (
        <Box>
          <Text color="cyan">Rows: </Text>
          <TextField
            value={draft}
            isFocused
            onChange={setDraft}
            onSubmit={commitTableRows}
            onCancel={() => {
              setAddMode("closed");
            }}
          />
        </Box>
      ) : undefined}
      {addMode === "tableColumns" ? (
        <Box>
          <Text color="cyan">Columns: </Text>
          <TextField
            value={draft}
            isFocused
            onChange={setDraft}
            onSubmit={commitTableColumns}
            onCancel={() => {
              setAddMode("closed");
            }}
          />
        </Box>
      ) : undefined}
      <Text dimColor>Enter: edit shape a: add shape n: notes Esc: back</Text>
    </Box>
  );
}
