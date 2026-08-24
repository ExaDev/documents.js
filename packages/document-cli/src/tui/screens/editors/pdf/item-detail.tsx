import type { ContentStroke, LayoutColor, LayoutItem, PdfEllipseItem, PdfImageItem, PdfInternalLinkItem, PdfItem, PdfLineItem, PdfLinkItem, PdfPathItem, PdfRectItem, PdfTextItem } from 'documents.js';
import { Box, Text, useInput } from 'ink';
import { useState, type Dispatch, type ReactElement } from 'react';
import { readInput } from '../../../../runtime/io.js';
import { ListView } from '../../../components/list-view.js';
import { TextField } from '../../../components/text-field.js';
import { describeError } from '../../../errors.js';
import { useNavigationInput } from '../../../keybindings/use-navigation-input.js';
import type { Action } from '../../../state/actions.js';
import { useAppDispatch, useAppState } from '../../../state/context.js';
import { anyOverlayOpen, currentScreen, type PdfOpenDocument } from '../../../state/types.js';
import { FieldWizard, requireFieldValue } from '../../shared/field-wizard.js';
import {
  formatColor,
  formatPt,
  formatSize,
  formatStroke,
  inferImageFormat,
  isEditablePdfDocument,
  parseColorField,
  parseNumberField,
  parseOptionalNumberField,
  parseRequiredColorField,
  parseStrokeField,
  requirePdfDocument,
} from './shared.js';

// --- read-only field dump, for an xlsx-sourced item (no live PdfEditor to edit through -- see shared.ts's own isEditablePdfDocument doc comment) -------------------------------------------------------------------------------------------------

type Field = readonly [label: string, value: string];

function formatPoint(xPt: number, yPt: number): string {
  return `(${xPt.toFixed(1)}, ${yPt.toFixed(1)})pt`;
}

// A full field dump of one `LayoutItem`, kind by kind -- every field the item's own schema variant carries, formatted for reading rather than parsed or interpreted further. `sourcePath` is common to every variant, so it is appended once after the kind-specific fields rather than repeated in each branch.
function fieldsFor(item: LayoutItem): readonly Field[] {
  const fields: Field[] = [['Kind', item.kind]];
  switch (item.kind) {
    case 'text':
      fields.push(['Text', item.text]);
      fields.push(['Position', formatPoint(item.xPt, item.yPt)]);
      fields.push(['Font family', item.font.family]);
      fields.push(['Font weight', item.font.weight]);
      fields.push(['Font style', item.font.style]);
      fields.push(['Size', `${item.sizePt}pt`]);
      fields.push(['Colour', formatColor(item.color)]);
      if (item.widthPt !== undefined) {
        fields.push(['Width', `${item.widthPt}pt`]);
      }
      if (item.rotationDeg !== undefined) {
        fields.push(['Rotation', `${item.rotationDeg}°`]);
      }
      if (item.underline !== undefined) {
        fields.push(['Underline', item.underline ? 'yes' : 'no']);
      }
      break;
    case 'image':
      fields.push(['Image ID', item.imageId]);
      fields.push(['Position', formatPoint(item.xPt, item.yPt)]);
      fields.push(['Size', formatSize(item.widthPt, item.heightPt)]);
      if (item.rotationDeg !== undefined) {
        fields.push(['Rotation', `${item.rotationDeg}°`]);
      }
      break;
    case 'rect':
    case 'ellipse':
      fields.push(['Position', formatPoint(item.xPt, item.yPt)]);
      fields.push(['Size', formatSize(item.widthPt, item.heightPt)]);
      if (item.fill !== undefined) {
        fields.push(['Fill', formatColor(item.fill)]);
      }
      if (item.stroke !== undefined) {
        fields.push(['Stroke', formatStroke(item.stroke)]);
      }
      break;
    case 'line':
      fields.push(['From', formatPoint(item.x1Pt, item.y1Pt)]);
      fields.push(['To', formatPoint(item.x2Pt, item.y2Pt)]);
      fields.push(['Colour', formatColor(item.color)]);
      fields.push(['Width', `${item.widthPt}pt`]);
      break;
    case 'path':
      fields.push(['Subpaths', `${item.subpaths.length}`]);
      fields.push(['Segments', `${item.subpaths.reduce((total, subpath) => total + subpath.segments.length, 0)}`]);
      if (item.fill !== undefined) {
        fields.push(['Fill', formatColor(item.fill)]);
      }
      if (item.fillRule !== undefined) {
        fields.push(['Fill rule', item.fillRule]);
      }
      if (item.stroke !== undefined) {
        fields.push(['Stroke', formatStroke(item.stroke)]);
      }
      break;
    case 'link':
      fields.push(['URI', item.uri]);
      fields.push(['Position', formatPoint(item.xPt, item.yPt)]);
      fields.push(['Size', formatSize(item.widthPt, item.heightPt)]);
      break;
    case 'internalLink':
      fields.push(['Destination', item.destination]);
      if (item.title !== undefined) {
        fields.push(['Title', item.title]);
      }
      fields.push(['Position', formatPoint(item.xPt, item.yPt)]);
      fields.push(['Size', formatSize(item.widthPt, item.heightPt)]);
      break;
    default: {
      // Exhaustiveness check, not a runtime fallback: if `LayoutItem` ever grows a kind this switch does not handle, `item` stops narrowing to `never` here and the assignment below fails to compile.
      const exhaustive: never = item;
      return exhaustive;
    }
  }
  // internalLink carries no sourcePath (an annotation rectangle is never laid out from a ContentDocument item), so the trailing rows read it only for the kinds that have one.
  if (item.kind !== 'internalLink' && item.sourcePath !== undefined) {
    fields.push(['Source path', item.sourcePath]);
  }
  return fields;
}

function ReadOnlyItemDetail(props: { readonly item: LayoutItem; readonly pageIndex: number; readonly itemIndex: number; readonly isActive: boolean; readonly onBack: () => void }): ReactElement {
  useInput(
    (input, key) => {
      if (key.escape || key.leftArrow || input === 'h') {
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

// A field is either commit-based (Enter opens a TextField seeded with `currentValue`, submitting dispatches through `commit`) or activate-based (Enter fires `activate` immediately, no TextField at all -- used for a toggle whose entire state fits in its own label, and for "Replace image..."'s nested file-path wizard). Exactly one of the two is ever set on a given row.
interface EditableRow {
  readonly label: string;
  readonly currentValue: string;
  readonly commit?: (raw: string) => void;
  readonly activate?: () => void;
}

function buildFrameRows(
  frame: { readonly xPt: number; readonly yPt: number; readonly widthPt: number; readonly heightPt: number },
  onFrameChange: (frame: { readonly xPt: number; readonly yPt: number; readonly widthPt: number; readonly heightPt: number }) => void,
): EditableRow[] {
  return [
    { label: `X: ${formatPt(frame.xPt)}pt`, currentValue: String(frame.xPt), commit: (raw) => { onFrameChange({ ...frame, xPt: parseNumberField(raw, frame.xPt) }); } },
    { label: `Y: ${formatPt(frame.yPt)}pt`, currentValue: String(frame.yPt), commit: (raw) => { onFrameChange({ ...frame, yPt: parseNumberField(raw, frame.yPt) }); } },
    { label: `Width: ${formatPt(frame.widthPt)}pt`, currentValue: String(frame.widthPt), commit: (raw) => { onFrameChange({ ...frame, widthPt: parseNumberField(raw, frame.widthPt) }); } },
    { label: `Height: ${formatPt(frame.heightPt)}pt`, currentValue: String(frame.heightPt), commit: (raw) => { onFrameChange({ ...frame, heightPt: parseNumberField(raw, frame.heightPt) }); } },
  ];
}

function buildFillStrokeRows(
  fill: LayoutColor | undefined,
  stroke: { readonly color: LayoutColor; readonly widthPt: number } | undefined,
  onFillChange: (fill: LayoutColor | undefined) => void,
  onStrokeChange: (stroke: ContentStroke | undefined) => void,
): EditableRow[] {
  return [
    {
      label: `Fill: ${fill === undefined ? 'none' : formatColor(fill)}`,
      currentValue: fill === undefined ? '' : `${fill.r} ${fill.g} ${fill.b}`,
      commit: (raw) => { onFillChange(parseColorField(raw)); },
    },
    {
      label: `Stroke: ${stroke === undefined ? 'none' : formatStroke(stroke)}`,
      currentValue: stroke === undefined ? '' : `${stroke.color.r} ${stroke.color.g} ${stroke.color.b} ${stroke.widthPt}`,
      commit: (raw) => { onStrokeChange(parseStrokeField(raw)); },
    },
  ];
}

function buildTextRows(item: PdfTextItem, pageIndex: number, itemIndex: number, dispatch: Dispatch<Action>): EditableRow[] {
  return [
    { label: `Text: ${item.text}`, currentValue: item.text, commit: (raw) => { dispatch({ type: 'SET_PDF_TEXT_TEXT', pageIndex, itemIndex, text: raw }); } },
    {
      label: `X: ${formatPt(item.xPt)}pt`,
      currentValue: String(item.xPt),
      commit: (raw) => { dispatch({ type: 'SET_PDF_TEXT_POSITION', pageIndex, itemIndex, xPt: parseNumberField(raw, item.xPt), yPt: item.yPt }); },
    },
    {
      label: `Y: ${formatPt(item.yPt)}pt`,
      currentValue: String(item.yPt),
      commit: (raw) => { dispatch({ type: 'SET_PDF_TEXT_POSITION', pageIndex, itemIndex, xPt: item.xPt, yPt: parseNumberField(raw, item.yPt) }); },
    },
    {
      label: `Font family: ${item.font.family}`,
      currentValue: item.font.family,
      commit: (raw) => {
        const family = raw.trim();
        dispatch({ type: 'SET_PDF_TEXT_FONT', pageIndex, itemIndex, font: { ...item.font, family: family.length === 0 ? item.font.family : family } });
      },
    },
    {
      label: `Font weight: ${item.font.weight} (Enter to toggle)`,
      currentValue: '',
      activate: () => { dispatch({ type: 'SET_PDF_TEXT_FONT', pageIndex, itemIndex, font: { ...item.font, weight: item.font.weight === 'bold' ? 'normal' : 'bold' } }); },
    },
    {
      label: `Font style: ${item.font.style} (Enter to toggle)`,
      currentValue: '',
      activate: () => { dispatch({ type: 'SET_PDF_TEXT_FONT', pageIndex, itemIndex, font: { ...item.font, style: item.font.style === 'italic' ? 'normal' : 'italic' } }); },
    },
    {
      label: `Size: ${item.sizePt}pt`,
      currentValue: String(item.sizePt),
      commit: (raw) => { dispatch({ type: 'SET_PDF_TEXT_SIZE', pageIndex, itemIndex, sizePt: parseNumberField(raw, item.sizePt) }); },
    },
    {
      label: `Colour: ${formatColor(item.color)}`,
      currentValue: `${item.color.r} ${item.color.g} ${item.color.b}`,
      commit: (raw) => { dispatch({ type: 'SET_PDF_TEXT_COLOR', pageIndex, itemIndex, color: parseRequiredColorField(raw, item.color) }); },
    },
    {
      label: `Width: ${item.widthPt === undefined ? 'unset' : `${item.widthPt}pt`}`,
      currentValue: item.widthPt === undefined ? '' : String(item.widthPt),
      commit: (raw) => { dispatch({ type: 'SET_PDF_TEXT_WIDTH', pageIndex, itemIndex, widthPt: parseOptionalNumberField(raw) }); },
    },
    {
      label: `Rotation: ${item.rotationDeg === undefined ? 'unset' : `${item.rotationDeg}°`}`,
      currentValue: item.rotationDeg === undefined ? '' : String(item.rotationDeg),
      commit: (raw) => { dispatch({ type: 'SET_PDF_TEXT_ROTATION', pageIndex, itemIndex, rotationDeg: parseOptionalNumberField(raw) }); },
    },
    {
      label: `Underline: ${item.underline === true ? 'yes' : 'no'} (Enter to toggle)`,
      currentValue: '',
      activate: () => { dispatch({ type: 'TOGGLE_PDF_TEXT_UNDERLINE', pageIndex, itemIndex }); },
    },
  ];
}

function buildRectRows(item: PdfRectItem, pageIndex: number, itemIndex: number, dispatch: Dispatch<Action>): EditableRow[] {
  return [
    ...buildFrameRows(item, (frame) => { dispatch({ type: 'SET_PDF_RECT_FRAME', pageIndex, itemIndex, ...frame }); }),
    ...buildFillStrokeRows(
      item.fill,
      item.stroke,
      (fill) => { dispatch({ type: 'SET_PDF_RECT_FILL', pageIndex, itemIndex, fill }); },
      (stroke) => { dispatch({ type: 'SET_PDF_RECT_STROKE', pageIndex, itemIndex, stroke }); },
    ),
  ];
}

function buildEllipseRows(item: PdfEllipseItem, pageIndex: number, itemIndex: number, dispatch: Dispatch<Action>): EditableRow[] {
  return [
    ...buildFrameRows(item, (frame) => { dispatch({ type: 'SET_PDF_ELLIPSE_FRAME', pageIndex, itemIndex, ...frame }); }),
    ...buildFillStrokeRows(
      item.fill,
      item.stroke,
      (fill) => { dispatch({ type: 'SET_PDF_ELLIPSE_FILL', pageIndex, itemIndex, fill }); },
      (stroke) => { dispatch({ type: 'SET_PDF_ELLIPSE_STROKE', pageIndex, itemIndex, stroke }); },
    ),
  ];
}

function buildLineRows(item: PdfLineItem, pageIndex: number, itemIndex: number, dispatch: Dispatch<Action>): EditableRow[] {
  return [
    {
      label: `From X: ${formatPt(item.x1Pt)}pt`,
      currentValue: String(item.x1Pt),
      commit: (raw) => { dispatch({ type: 'SET_PDF_LINE_FROM', pageIndex, itemIndex, x1Pt: parseNumberField(raw, item.x1Pt), y1Pt: item.y1Pt }); },
    },
    {
      label: `From Y: ${formatPt(item.y1Pt)}pt`,
      currentValue: String(item.y1Pt),
      commit: (raw) => { dispatch({ type: 'SET_PDF_LINE_FROM', pageIndex, itemIndex, x1Pt: item.x1Pt, y1Pt: parseNumberField(raw, item.y1Pt) }); },
    },
    {
      label: `To X: ${formatPt(item.x2Pt)}pt`,
      currentValue: String(item.x2Pt),
      commit: (raw) => { dispatch({ type: 'SET_PDF_LINE_TO', pageIndex, itemIndex, x2Pt: parseNumberField(raw, item.x2Pt), y2Pt: item.y2Pt }); },
    },
    {
      label: `To Y: ${formatPt(item.y2Pt)}pt`,
      currentValue: String(item.y2Pt),
      commit: (raw) => { dispatch({ type: 'SET_PDF_LINE_TO', pageIndex, itemIndex, x2Pt: item.x2Pt, y2Pt: parseNumberField(raw, item.y2Pt) }); },
    },
    {
      label: `Colour: ${formatColor(item.color)}`,
      currentValue: `${item.color.r} ${item.color.g} ${item.color.b}`,
      commit: (raw) => { dispatch({ type: 'SET_PDF_LINE_COLOR', pageIndex, itemIndex, color: parseRequiredColorField(raw, item.color) }); },
    },
    {
      label: `Width: ${item.widthPt}pt`,
      currentValue: String(item.widthPt),
      commit: (raw) => { dispatch({ type: 'SET_PDF_LINE_WIDTH', pageIndex, itemIndex, widthPt: Math.max(parseNumberField(raw, item.widthPt), Number.EPSILON) }); },
    },
  ];
}

function buildPathRows(item: PdfPathItem, pageIndex: number, itemIndex: number, dispatch: Dispatch<Action>): EditableRow[] {
  return [
    {
      label: `Fill rule: ${item.fillRule ?? 'nonzero (default)'} (Enter to cycle)`,
      currentValue: '',
      activate: () => { dispatch({ type: 'SET_PDF_PATH_FILL_RULE', pageIndex, itemIndex, fillRule: item.fillRule === 'evenodd' ? undefined : item.fillRule === 'nonzero' ? 'evenodd' : 'nonzero' }); },
    },
    ...buildFillStrokeRows(
      item.fill,
      item.stroke,
      (fill) => { dispatch({ type: 'SET_PDF_PATH_FILL', pageIndex, itemIndex, fill }); },
      (stroke) => { dispatch({ type: 'SET_PDF_PATH_STROKE', pageIndex, itemIndex, stroke }); },
    ),
  ];
}

function buildImageRows(item: PdfImageItem, pageIndex: number, itemIndex: number, dispatch: Dispatch<Action>, onReplaceImage: () => void): EditableRow[] {
  return [
    ...buildFrameRows(item, (frame) => { dispatch({ type: 'SET_PDF_IMAGE_FRAME', pageIndex, itemIndex, ...frame }); }),
    {
      label: `Rotation: ${item.rotationDeg === undefined ? 'unset' : `${item.rotationDeg}°`}`,
      currentValue: item.rotationDeg === undefined ? '' : String(item.rotationDeg),
      commit: (raw) => { dispatch({ type: 'SET_PDF_IMAGE_ROTATION', pageIndex, itemIndex, rotationDeg: parseOptionalNumberField(raw) }); },
    },
    { label: 'Replace image...', currentValue: '', activate: onReplaceImage },
  ];
}

function buildLinkRows(item: PdfLinkItem, pageIndex: number, itemIndex: number, dispatch: Dispatch<Action>): EditableRow[] {
  return [
    { label: `URI: ${item.uri}`, currentValue: item.uri, commit: (raw) => { dispatch({ type: 'SET_PDF_LINK_URI', pageIndex, itemIndex, uri: raw }); } },
    ...buildFrameRows(item, (frame) => { dispatch({ type: 'SET_PDF_LINK_FRAME', pageIndex, itemIndex, ...frame }); }),
  ];
}

// An internal link's destination names a destinations-table entry, not a URI -- editable as the plain name it is, with the same frame rows every placed item gets.
function buildInternalLinkRows(item: PdfInternalLinkItem, pageIndex: number, itemIndex: number, dispatch: Dispatch<Action>): EditableRow[] {
  return [
    { label: `Destination: ${item.destination}`, currentValue: item.destination, commit: (raw) => { dispatch({ type: 'SET_PDF_INTERNAL_LINK_DESTINATION', pageIndex, itemIndex, destination: raw }); } },
    ...buildFrameRows(item, (frame) => { dispatch({ type: 'SET_PDF_INTERNAL_LINK_FRAME', pageIndex, itemIndex, ...frame }); }),
  ];
}

function buildRowsFor(item: PdfItem, pageIndex: number, itemIndex: number, dispatch: Dispatch<Action>, onReplaceImage: () => void): EditableRow[] {
  switch (item.kind) {
    case 'text':
      return buildTextRows(item, pageIndex, itemIndex, dispatch);
    case 'rect':
      return buildRectRows(item, pageIndex, itemIndex, dispatch);
    case 'ellipse':
      return buildEllipseRows(item, pageIndex, itemIndex, dispatch);
    case 'line':
      return buildLineRows(item, pageIndex, itemIndex, dispatch);
    case 'path':
      return buildPathRows(item, pageIndex, itemIndex, dispatch);
    case 'image':
      return buildImageRows(item, pageIndex, itemIndex, dispatch, onReplaceImage);
    case 'link':
      return buildLinkRows(item, pageIndex, itemIndex, dispatch);
    case 'internalLink':
      return buildInternalLinkRows(item, pageIndex, itemIndex, dispatch);
  }
}

function pathSummary(item: PdfPathItem): string {
  const segmentCount = item.subpaths.reduce((total, subpath) => total + subpath.segments.length, 0);
  return `${item.subpaths.length} subpath${item.subpaths.length === 1 ? '' : 's'}, ${segmentCount} segment${segmentCount === 1 ? '' : 's'} (not editable here -- see documents.js's own PdfPathItem doc comment)`;
}

async function applyImageReplace(pageIndex: number, itemIndex: number, path: string, dispatch: Dispatch<Action>): Promise<void> {
  const format = inferImageFormat(path);
  if (format === undefined) {
    dispatch({ type: 'SET_STATUS', severity: 'warning', text: `${path} is not a .png or .jpg/.jpeg file -- image not replaced` });
    return;
  }
  try {
    const bytes = new Uint8Array(await readInput(path));
    dispatch({ type: 'SET_PDF_IMAGE_SOURCE', pageIndex, itemIndex, format, bytes });
  } catch (error) {
    dispatch({ type: 'SET_STATUS', severity: 'error', text: `Could not read ${path}: ${describeError(error)}` });
  }
}

function EditableItemDetail(props: { readonly doc: PdfOpenDocument; readonly pageIndex: number; readonly itemIndex: number; readonly isActive: boolean }): ReactElement {
  const dispatch = useAppDispatch();
  const { doc, pageIndex, itemIndex } = props;
  const [editingField, setEditingField] = useState<number | undefined>(undefined);
  const [draft, setDraft] = useState('');
  const [replacingImage, setReplacingImage] = useState(false);

  // Fresh every render, never cached: PdfPage.items() is a live view over the mutable LayoutDocument, exactly the "call editor accessors fresh on every render" rule this state layer requires of every screen.
  const item = doc.editor.page(pageIndex)?.items()[itemIndex];
  const rows: readonly EditableRow[] = item === undefined ? [] : buildRowsFor(item, pageIndex, itemIndex, dispatch, () => { setReplacingImage(true); });

  const { selectedIndex } = useNavigationInput({
    itemCount: rows.length,
    isActive: props.isActive && editingField === undefined && !replacingImage,
    onBack: () => {
      dispatch({ type: 'POP_SCREEN' });
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
        fields={[{ key: 'path', label: 'Image file path (.png/.jpg/.jpeg)', defaultValue: '' }]}
        onCancel={() => {
          setReplacingImage(false);
        }}
        onComplete={(values) => {
          void applyImageReplace(pageIndex, itemIndex, requireFieldValue(values, 'path'), dispatch).then(() => {
            setReplacingImage(false);
          });
        }}
      />
    );
  }

  if (editingField !== undefined) {
    const row = rows[editingField];
    if (row === undefined) {
      throw new Error(`EditableItemDetail is editing field index ${editingField}, but there are only ${rows.length} rows -- selecting a row always sets editingField to a valid index from that same rows array, so this indicates a bug in that selection.`);
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
        Page {pageIndex + 1}, item {itemIndex + 1} -- {item.kind}
      </Text>
      {item.kind === 'path' && <Text dimColor>{pathSummary(item)}</Text>}
      {item.kind === 'image' && <Text dimColor>Image ID: {item.imageId}</Text>}
      <ListView
        items={rows}
        selectedIndex={selectedIndex}
        reservedRows={5}
        renderItem={(row, isSelected) => (
          <Text color={isSelected ? 'cyan' : undefined} inverse={isSelected}>
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
  if (screen.kind !== 'pdfItemDetail') {
    throw new Error(`PdfItemDetailScreen rendered while the current screen is "${screen.kind}", not "pdfItemDetail".`);
  }
  const isActive = !anyOverlayOpen(state);

  if (!isEditablePdfDocument(doc)) {
    const page = doc.layout.pages[screen.pageIndex];
    if (page === undefined) {
      throw new Error(`pdfItemDetail was pushed for page ${screen.pageIndex}, but the open PDF has no page at that index.`);
    }
    const item = page.items[screen.itemIndex];
    if (item === undefined) {
      throw new Error(`pdfItemDetail was pushed for item ${screen.itemIndex} on page ${screen.pageIndex}, but that page has no item at that index.`);
    }
    return (
      <ReadOnlyItemDetail
        item={item}
        pageIndex={screen.pageIndex}
        itemIndex={screen.itemIndex}
        isActive={isActive}
        onBack={() => {
          dispatch({ type: 'POP_SCREEN' });
        }}
      />
    );
  }

  return <EditableItemDetail doc={doc} pageIndex={screen.pageIndex} itemIndex={screen.itemIndex} isActive={isActive} />;
}
