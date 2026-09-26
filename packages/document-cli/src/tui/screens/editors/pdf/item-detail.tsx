import type { LayoutItem, PdfPathItem } from "documents.js";
import { Box, Text, useInput } from "ink";
import { useState, type Dispatch, type ReactElement } from "react";
import { readInput } from "../../../../runtime/io.js";
import { ListView, selectedColor } from "../../../components/list-view.js";
import { TextField } from "../../../components/text-field.js";
import { describeError } from "../../../errors.js";
import { useNavigationInput } from "../../../keybindings/use-navigation-input.js";
import type { Action } from "../../../state/actions.js";
import { useAppDispatch, useAppState } from "../../../state/context.js";
import {
  anyOverlayOpen,
  currentScreen,
  type PdfOpenDocument,
} from "../../../state/types.js";
import { FieldWizard, requireFieldValue } from "../../shared/field-wizard.js";
import {
  formatSize,
  formatStroke,
  inferImageFormat,
  isEditablePdfDocument,
  requirePdfDocument,
} from "./shared.js";
import { layoutColorToHex } from "../../shared/color";
import { buildRowsFor } from "./item-detail-rows";

// --- read-only field dump, for an xlsx-sourced item (no live PdfEditor to edit through — see shared.ts's own isEditablePdfDocument doc comment) -------------------------------------------------------------------------------------------------

type Field = readonly [label: string, value: string];

function formatPoint(xPt: number, yPt: number): string {
  return `(${xPt.toFixed(1)}, ${yPt.toFixed(1)})pt`;
}

// A full field dump of one `LayoutItem`, kind by kind — every field the item's own schema variant carries, formatted for reading rather than parsed or interpreted further. `sourcePath` is common to every variant, so it is appended once after the kind-specific fields rather than repeated in each branch.
function fieldsFor(item: LayoutItem): readonly Field[] {
  const fields: Field[] = [["Kind", item.kind]];
  switch (item.kind) {
    case "text":
      fields.push(["Text", item.text]);
      fields.push(["Position", formatPoint(item.xPt, item.yPt)]);
      fields.push(["Font family", item.font.family]);
      fields.push(["Font weight", item.font.weight]);
      fields.push(["Font style", item.font.style]);
      fields.push(["Size", `${item.sizePt}pt`]);
      fields.push(["Colour", layoutColorToHex(item.color)]);
      if (item.widthPt !== undefined) {
        fields.push(["Width", `${item.widthPt}pt`]);
      }
      if (item.rotationDeg !== undefined) {
        fields.push(["Rotation", `${item.rotationDeg}°`]);
      }
      if (item.underline !== undefined) {
        fields.push(["Underline", item.underline ? "yes" : "no"]);
      }
      break;
    case "image":
      fields.push(["Image ID", item.imageId]);
      fields.push(["Position", formatPoint(item.xPt, item.yPt)]);
      fields.push(["Size", formatSize(item.widthPt, item.heightPt)]);
      if (item.rotationDeg !== undefined) {
        fields.push(["Rotation", `${item.rotationDeg}°`]);
      }
      break;
    case "rect":
    case "ellipse":
      fields.push(["Position", formatPoint(item.xPt, item.yPt)]);
      fields.push(["Size", formatSize(item.widthPt, item.heightPt)]);
      if (item.fill !== undefined) {
        fields.push(["Fill", layoutColorToHex(item.fill)]);
      }
      if (item.stroke !== undefined) {
        fields.push(["Stroke", formatStroke(item.stroke)]);
      }
      break;
    case "line":
      fields.push(["From", formatPoint(item.x1Pt, item.y1Pt)]);
      fields.push(["To", formatPoint(item.x2Pt, item.y2Pt)]);
      fields.push(["Colour", layoutColorToHex(item.color)]);
      fields.push(["Width", `${item.widthPt}pt`]);
      break;
    case "path":
      fields.push(["Subpaths", `${item.subpaths.length}`]);
      fields.push([
        "Segments",
        `${item.subpaths.reduce((total, subpath) => total + subpath.segments.length, 0)}`,
      ]);
      if (item.fill !== undefined) {
        fields.push(["Fill", layoutColorToHex(item.fill)]);
      }
      if (item.fillRule !== undefined) {
        fields.push(["Fill rule", item.fillRule]);
      }
      if (item.stroke !== undefined) {
        fields.push(["Stroke", formatStroke(item.stroke)]);
      }
      break;
    case "link":
      fields.push(["URI", item.uri]);
      fields.push(["Position", formatPoint(item.xPt, item.yPt)]);
      fields.push(["Size", formatSize(item.widthPt, item.heightPt)]);
      break;
    case "internalLink":
      fields.push(["Destination", item.destination]);
      if (item.title !== undefined) {
        fields.push(["Title", item.title]);
      }
      fields.push(["Position", formatPoint(item.xPt, item.yPt)]);
      fields.push(["Size", formatSize(item.widthPt, item.heightPt)]);
      break;
    default: {
      // Exhaustiveness check, not a runtime fallback: if `LayoutItem` ever grows a kind this switch does not handle, `item` stops narrowing to `never` here and `satisfies never` fails to compile. Written as `satisfies` rather than an annotated `const` because the check is about the type alone — there is no binding anyone reads, and introducing one only to return it reads as an alias.
      return item satisfies never;
    }
  }
  // internalLink carries no sourcePath (an annotation rectangle is never laid out from a ContentDocument item), so the trailing rows read it only for the kinds that have one.
  if (item.kind !== "internalLink" && item.sourcePath !== undefined) {
    fields.push(["Source path", item.sourcePath]);
  }
  return fields;
}

function ReadOnlyItemDetail(props: {
  readonly item: LayoutItem;
  readonly pageIndex: number;
  readonly itemIndex: number;
  readonly isActive: boolean;
  readonly onBack: () => void;
}): ReactElement {
  useInput(
    (input, key) => {
      if (key.escape || key.leftArrow || input === "h") {
        props.onBack();
      }
    },
    { isActive: props.isActive },
  );

  return (
    <Box flexDirection="column">
      <Text bold>
        Page {props.pageIndex + 1}, item {props.itemIndex + 1}
      </Text>
      {fieldsFor(props.item).map(([label, value]) => (
        <Text key={label}>
          {label}: {value}
        </Text>
      ))}
      <Text dimColor>Esc / ← / h to go back</Text>
    </Box>
  );
}

// --- real field editor, for a genuine 'pdf'-format document ----------------------------------------------------------------------------------------------------------------------------------------------------------------------

// A field is either commit-based (Enter opens a TextField seeded with `currentValue`, submitting dispatches through `commit`) or activate-based (Enter fires `activate` immediately, no TextField at all: used for a toggle whose entire state fits in its own label, and for "Replace image..."'s nested file-path wizard). The two forms are mutually exclusive rather than merely "usually": an activate-based row never seeds a TextField, so it has no `currentValue` to seed one with, hence the XOR shape below rather than an optional `currentValue` every activate row would otherwise carry as dead, unread state.
interface CommitRow {
  readonly label: string;
  readonly currentValue: string;
  readonly commit: (raw: string) => void;
  readonly activate?: never;
}
interface ActivateRow {
  readonly label: string;
  readonly currentValue?: never;
  readonly commit?: never;
  readonly activate: () => void;
}
export type EditableRow = CommitRow | ActivateRow;

export interface FrameFields {
  readonly xPt: number;
  readonly yPt: number;
  readonly widthPt: number;
  readonly heightPt: number;
}

// Every PdfRectItem/PdfEllipseItem/PdfImageItem/PdfLinkItem/PdfInternalLinkItem exposes xPt/yPt/widthPt/heightPt as prototype getters (see edit/pdf/item.ts), not the live item's own enumerable properties — object-spreading a live item directly (`{...item, widthPt: ...}`) silently omits every frame field the caller did not explicitly name, since a getter defined on the prototype chain is never copied by a spread. buildFrameRows's callers pass the live item itself as `frame` for convenience, so this snapshot is what actually makes `{...frame, ...}` in its own commit callback below spread real values rather than dropping three of the four fields to `undefined` on every edit.
export function frameOf(item: FrameFields): FrameFields {
  return {
    xPt: item.xPt,
    yPt: item.yPt,
    widthPt: item.widthPt,
    heightPt: item.heightPt,
  };
}

function pathSummary(item: PdfPathItem): string {
  const segmentCount = item.subpaths.reduce(
    (total, subpath) => total + subpath.segments.length,
    0,
  );
  return `${item.subpaths.length} subpath${item.subpaths.length === 1 ? "" : "s"}, ${segmentCount} segment${segmentCount === 1 ? "" : "s"} (not editable here — see documents.js's own PdfPathItem doc comment)`;
}

async function applyImageReplace(
  pageIndex: number,
  itemIndex: number,
  path: string,
  dispatch: Dispatch<Action>,
): Promise<void> {
  const format = inferImageFormat(path);
  if (format === undefined) {
    dispatch({
      type: "SET_STATUS",
      severity: "warning",
      text: `${path} is not a .png or .jpg/.jpeg file — image not replaced`,
    });
    return;
  }
  try {
    const bytes = new Uint8Array(await readInput(path));
    dispatch({
      type: "SET_PDF_IMAGE_SOURCE",
      pageIndex,
      itemIndex,
      format,
      bytes,
    });
  } catch (error) {
    dispatch({
      type: "SET_STATUS",
      severity: "error",
      text: `Could not read ${path}: ${describeError(error)}`,
    });
  }
}

function EditableItemDetail(props: {
  readonly doc: PdfOpenDocument;
  readonly pageIndex: number;
  readonly itemIndex: number;
  readonly isActive: boolean;
}): ReactElement {
  const dispatch = useAppDispatch();
  const { doc, pageIndex, itemIndex } = props;
  const [editingField, setEditingField] = useState<number | undefined>(
    undefined,
  );
  const [draft, setDraft] = useState("");
  const [replacingImage, setReplacingImage] = useState(false);

  // Fresh every render, never cached: PdfPage.items() is a live view over the mutable LayoutDocument, exactly the "call editor accessors fresh on every render" rule this state layer requires of every screen.
  const item = doc.editor.page(pageIndex)?.items()[itemIndex];
  const rows: readonly EditableRow[] =
    item === undefined
      ? []
      : buildRowsFor(item, pageIndex, itemIndex, dispatch, () => {
          setReplacingImage(true);
        });

  const { selectedIndex } = useNavigationInput({
    itemCount: rows.length,
    isActive: props.isActive && editingField === undefined && !replacingImage,
    onBack: () => {
      dispatch({ type: "POP_SCREEN" });
    },
    onSelect: (index) => {
      const row = rows[index];
      if (row === undefined) {
        return;
      }
      if (row.activate !== undefined) {
        row.activate();
        return;
      }
      setDraft(row.currentValue);
      setEditingField(index);
    },
  });

  if (item === undefined) {
    return (
      <Box flexDirection="column">
        <Text color="yellow">
          There is no item {itemIndex + 1} on page {pageIndex + 1} any more.
        </Text>
        <Text dimColor>Esc to go back</Text>
      </Box>
    );
  }

  if (replacingImage) {
    return (
      <FieldWizard
        fields={[
          {
            key: "path",
            label: "Image file path (.png/.jpg/.jpeg)",
            defaultValue: "",
          },
        ]}
        onCancel={() => {
          setReplacingImage(false);
        }}
        onComplete={(values) => {
          void applyImageReplace(
            pageIndex,
            itemIndex,
            requireFieldValue(values, "path"),
            dispatch,
          ).then(() => {
            setReplacingImage(false);
          });
        }}
      />
    );
  }

  if (editingField !== undefined) {
    const row = rows[editingField];
    if (row === undefined) {
      throw new Error(
        `EditableItemDetail is editing field index ${editingField}, but there are only ${rows.length} rows — selecting a row always sets editingField to a valid index from that same rows array, so this indicates a bug in that selection.`,
      );
    }
    return (
      <Box flexDirection="column" borderStyle="round" paddingX={1}>
        <Text bold>{row.label}</Text>
        <TextField
          value={draft}
          isFocused
          onChange={setDraft}
          onCancel={() => {
            setEditingField(undefined);
          }}
          onSubmit={(value) => {
            row.commit?.(value);
            setEditingField(undefined);
          }}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>
        Page {pageIndex + 1}, item {itemIndex + 1} — {item.kind}
      </Text>
      {item.kind === "path" && <Text dimColor>{pathSummary(item)}</Text>}
      {item.kind === "image" && <Text dimColor>Image ID: {item.imageId}</Text>}
      <ListView
        items={rows}
        selectedIndex={selectedIndex}
        reservedRows={5}
        renderItem={(row, isSelected) => (
          <Text color={selectedColor(isSelected)} inverse={isSelected}>
            {row.label}
          </Text>
        )}
      />
      <Text dimColor>Enter to edit a field, Esc to go back</Text>
    </Box>
  );
}

// --- routing -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

export function PdfItemDetailScreen(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const doc = requirePdfDocument(state.openDocument);
  const screen = currentScreen(state);
  if (screen.kind !== "pdfItemDetail") {
    throw new Error(
      `PdfItemDetailScreen rendered while the current screen is "${screen.kind}", not "pdfItemDetail".`,
    );
  }
  const isActive = !anyOverlayOpen(state);

  if (!isEditablePdfDocument(doc)) {
    const page = doc.layout.pages[screen.pageIndex];
    if (page === undefined) {
      throw new Error(
        `pdfItemDetail was pushed for page ${screen.pageIndex}, but the open PDF has no page at that index.`,
      );
    }
    const item = page.items[screen.itemIndex];
    if (item === undefined) {
      throw new Error(
        `pdfItemDetail was pushed for item ${screen.itemIndex} on page ${screen.pageIndex}, but that page has no item at that index.`,
      );
    }
    return (
      <ReadOnlyItemDetail
        item={item}
        pageIndex={screen.pageIndex}
        itemIndex={screen.itemIndex}
        isActive={isActive}
        onBack={() => {
          dispatch({ type: "POP_SCREEN" });
        }}
      />
    );
  }

  return (
    <EditableItemDetail
      doc={doc}
      pageIndex={screen.pageIndex}
      itemIndex={screen.itemIndex}
      isActive={isActive}
    />
  );
}
