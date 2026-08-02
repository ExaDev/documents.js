import { Box, Text, useInput } from 'ink';
import { useState, type ReactElement } from 'react';
import type { ContentVector, OdpShape } from 'documents.js';
import { ListView } from '../../../components/list-view.js';
import { TextField } from '../../../components/text-field.js';
import { useNavigationInput } from '../../../keybindings/use-navigation-input.js';
import { useAppDispatch, useAppState } from '../../../state/context.js';
import { anyOverlayOpen } from '../../../state/types.js';
import { buildPageItems, describeFillStroke, describeVectorGeometry, formatPt, parseNumberField, requireOdgDocument, requireShapeOrVectorDetailScreen, vectorKindLabel, type PageItem } from './shared.js';

// No sibling pptx/odp shape-editor screen exists in this tree yet (there is no `screens/` directory beyond this one at the time this file was written), so the text/rotation/frame editing form below is this file's own minimal implementation, not a reuse of one. It should be deduplicated with the slide-family group's shape editor during integration -- `OdpShape` is the exact same class an odp/pptx shape editor would edit, and there is nothing odg-specific about the fields or the row-based edit UI here.

function VectorDetail(props: { readonly vector: ContentVector }): ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold>{vectorKindLabel(props.vector.kind)} (view-only)</Text>
      <Text>Geometry: {describeVectorGeometry(props.vector)}</Text>
      <Text>{describeFillStroke(props.vector)}</Text>
      <Text color="yellow">documents.js's OdgPage has no accessor for an existing rect/ellipse/line/path vector, so there is no live handle to edit or remove this one from the TUI -- open the file in a real ODF editor to change it.</Text>
      <Text dimColor>Esc to go back</Text>
    </Box>
  );
}

interface EditableRow {
  readonly label: string;
  readonly currentValue: string;
  readonly commit: (raw: string) => void;
}

function ShapeDetail(props: { readonly pageIndex: number; readonly shapeIndexInPage: number; readonly shape: OdpShape; readonly isActive: boolean }): ReactElement {
  const dispatch = useAppDispatch();
  const [editingField, setEditingField] = useState<number | undefined>(undefined);
  const [draft, setDraft] = useState('');

  const { pageIndex, shapeIndexInPage, shape } = props;
  const frame = shape.frame ?? { xPt: 0, yPt: 0, widthPt: 0, heightPt: 0 };

  const rows: readonly EditableRow[] = [
    {
      label: `Text: ${shape.text}`,
      currentValue: shape.text,
      commit: (raw) => {
        dispatch({ type: 'SET_SHAPE_TEXT', containerIndex: pageIndex, shapeIndex: shapeIndexInPage, text: raw });
      },
    },
    {
      label: `X: ${formatPt(frame.xPt)}pt`,
      currentValue: String(frame.xPt),
      commit: (raw) => {
        dispatch({ type: 'SET_SHAPE_FRAME', containerIndex: pageIndex, shapeIndex: shapeIndexInPage, frame: { ...frame, xPt: parseNumberField(raw, frame.xPt) } });
      },
    },
    {
      label: `Y: ${formatPt(frame.yPt)}pt`,
      currentValue: String(frame.yPt),
      commit: (raw) => {
        dispatch({ type: 'SET_SHAPE_FRAME', containerIndex: pageIndex, shapeIndex: shapeIndexInPage, frame: { ...frame, yPt: parseNumberField(raw, frame.yPt) } });
      },
    },
    {
      label: `Width: ${formatPt(frame.widthPt)}pt`,
      currentValue: String(frame.widthPt),
      commit: (raw) => {
        dispatch({ type: 'SET_SHAPE_FRAME', containerIndex: pageIndex, shapeIndex: shapeIndexInPage, frame: { ...frame, widthPt: parseNumberField(raw, frame.widthPt) } });
      },
    },
    {
      label: `Height: ${formatPt(frame.heightPt)}pt`,
      currentValue: String(frame.heightPt),
      commit: (raw) => {
        dispatch({ type: 'SET_SHAPE_FRAME', containerIndex: pageIndex, shapeIndex: shapeIndexInPage, frame: { ...frame, heightPt: parseNumberField(raw, frame.heightPt) } });
      },
    },
    {
      label: `Rotation: ${shape.rotationDeg === undefined ? 'none' : `${formatPt(shape.rotationDeg)} deg`}`,
      currentValue: shape.rotationDeg === undefined ? '' : String(shape.rotationDeg),
      commit: (raw) => {
        const trimmed = raw.trim();
        dispatch({ type: 'SET_SHAPE_ROTATION', containerIndex: pageIndex, shapeIndex: shapeIndexInPage, rotationDeg: trimmed.length === 0 ? undefined : parseNumberField(trimmed, 0) });
      },
    },
  ];

  const { selectedIndex } = useNavigationInput({
    itemCount: rows.length,
    isActive: props.isActive && editingField === undefined,
    onBack: () => {
      dispatch({ type: 'POP_SCREEN' });
    },
    onSelect: (index) => {
      const row = rows[index];
      if (row === undefined) {
        return;
      }
      setDraft(row.currentValue);
      setEditingField(index);
    },
  });

  if (editingField !== undefined) {
    const row = rows[editingField];
    if (row === undefined) {
      throw new Error(`ShapeDetail is editing field index ${editingField}, but there are only ${rows.length} rows -- selecting a row always sets editingField to a valid index from that same rows array, so this indicates a bug in that selection.`);
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
            row.commit(value);
            setEditingField(undefined);
          }}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>Shape</Text>
      {/* One extra hint line below the list beyond list-view.tsx's own default reserved-row assumption. */}
      <ListView
        items={rows}
        selectedIndex={selectedIndex}
        reservedRows={5}
        renderItem={(row, isSelected) => (
          <Text color={isSelected ? 'cyan' : undefined}>
            {isSelected ? '> ' : '  '}
            {row.label}
          </Text>
        )}
      />
      <Text dimColor>Enter to edit a field, Esc to go back</Text>
    </Box>
  );
}

export function OdgShapeOrVectorDetailScreen(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const doc = requireOdgDocument(state);
  const { pageIndex, itemIndex } = requireShapeOrVectorDetailScreen(state);
  const overlayOpen = anyOverlayOpen(state);

  // Fresh every render, matching page-detail.tsx's own `buildPageItems` call -- there is no cached, stable identity for these items to hold onto across mutations.
  const items = buildPageItems(doc, pageIndex);
  const item: PageItem | undefined = items[itemIndex];

  // Only handles Esc/back for the "not found" and "vector" branches below -- once `item.kind === 'shape'`, ShapeDetail owns its own back navigation via useNavigationInput, and having both active at once would double-dispatch POP_SCREEN on a single Escape press.
  useInput(
    (input, key) => {
      if (key.escape || key.leftArrow || input === 'h') {
        dispatch({ type: 'POP_SCREEN' });
      }
    },
    { isActive: !overlayOpen && item?.kind !== 'shape' },
  );

  if (item === undefined) {
    return (
      <Box flexDirection="column">
        <Text color="yellow">
          There is no item {itemIndex} on page {pageIndex + 1} any more.
        </Text>
        <Text dimColor>Esc to go back</Text>
      </Box>
    );
  }

  if (item.kind === 'vector') {
    return <VectorDetail vector={item.vector} />;
  }

  // Vectors always sort before shapes in `buildPageItems`, so a shape's own position within `page.shapes()` (needed for the containerIndex/shapeIndex addressing SET_SHAPE_TEXT/FRAME/ROTATION use) is the combined index minus however many vector rows precede all the shape rows.
  const vectorCount = items.filter((entry) => entry.kind === 'vector').length;
  return <ShapeDetail pageIndex={pageIndex} shapeIndexInPage={itemIndex - vectorCount} shape={item.shape} isActive={!overlayOpen} />;
}
