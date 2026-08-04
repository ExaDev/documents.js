import { Box, Text, useInput } from 'ink';
import { useState, type Dispatch, type ReactElement } from 'react';
import type { ContentVector, OdgVector, OdpShape } from 'documents.js';
import { ListView } from '../../../components/list-view.js';
import { TextField } from '../../../components/text-field.js';
import { useNavigationInput } from '../../../keybindings/use-navigation-input.js';
import type { Action } from '../../../state/actions.js';
import { useAppDispatch, useAppState } from '../../../state/context.js';
import { anyOverlayOpen } from '../../../state/types.js';
import { buildPageItems, describeFillStroke, describeVectorGeometry, formatColor, formatPt, parseColorField, parseNumberField, parseStrokeField, requireOdgDocument, requireShapeOrVectorDetailScreen, vectorKindLabel, type PageItem } from './shared.js';

// slide-family's own shape editor (pptx/odp) and this odg screen's `ShapeDetail` below both edit an `OdpShape` (odg shapes reuse that same class -- see documents.js's own README), but the two grew independently and still have not been deduplicated; `ShapeDetail` remains this file's own minimal implementation rather than a reuse of `screens/editors/pptx/shape-editor.tsx`.

interface EditableRow {
  readonly label: string;
  readonly currentValue: string;
  readonly commit: (raw: string) => void;
}

// The fill/stroke row set for a live vector -- a `line` vector has no fill at all (ContentVectorSchema's own 'line' variant carries none), so that row is simply omitted rather than shown disabled. Kept a plain function (not a component) because both branches of VectorDetail below need the identical row list, one to render it and one only to size the "read-only" fallback's own reserved space consistently with ShapeDetail's.
function buildVectorRows(vector: ContentVector, liveVector: OdgVector, dispatch: Dispatch<Action>): readonly EditableRow[] {
  const rows: EditableRow[] = [];
  // Parity guarantees vector.kind === liveVector.kind (buildPageItems only populates liveVector when they agree), but each side still needs narrowing on its OWN discriminant -- `vector.fill` needs `vector` narrowed, `fillTarget` needs `liveVector` narrowed -- for the reasons noted below.
  if (vector.kind !== 'line' && liveVector.kind !== 'line') {
    // Narrowed to OdgBoxVector | OdgPathVector -- SET_VECTOR_FILL's own `vector` field excludes OdgLineVector (a line has nothing to fill), matching ContentVectorSchema's own 'line' variant, which carries no `fill` field at all.
    const fillTarget = liveVector;
    rows.push({
      label: `Fill: ${vector.fill === undefined ? 'none' : formatColor(vector.fill)}`,
      currentValue: vector.fill === undefined ? '' : `${vector.fill.r} ${vector.fill.g} ${vector.fill.b}`,
      commit: (raw) => {
        dispatch({ type: 'SET_VECTOR_FILL', vector: fillTarget, fill: parseColorField(raw) });
      },
    });
  }
  rows.push({
    label: `Stroke: ${vector.stroke === undefined ? 'none' : `${formatColor(vector.stroke.color)} ${formatPt(vector.stroke.widthPt)}pt`}`,
    currentValue: vector.stroke === undefined ? '' : `${vector.stroke.color.r} ${vector.stroke.color.g} ${vector.stroke.color.b} ${vector.stroke.widthPt}`,
    commit: (raw) => {
      const stroke = parseStrokeField(raw);
      // SET_VECTOR_STROKE's own `stroke` field is non-optional for every vector kind, not only `line` -- see actions.ts's own comment: a write against the OdgBoxVector | OdgLineVector | OdgPathVector union narrows to the intersection of their setter types, and OdgLineVector.stroke never accepts undefined, so the action itself has nowhere to carry "clear the stroke" regardless of which kind this particular vector is.
      if (stroke === undefined) {
        dispatch({ type: 'SET_STATUS', severity: 'warning', text: 'A vector stroke cannot be cleared to none through this editor -- enter "r g b widthPt" (0-1 colour, pt width) instead' });
        return;
      }
      dispatch({ type: 'SET_VECTOR_STROKE', vector: liveVector, stroke });
    },
  });
  return rows;
}

function VectorDetail(props: { readonly vector: ContentVector; readonly liveVector: OdgVector | undefined; readonly isActive: boolean }): ReactElement {
  const dispatch = useAppDispatch();
  const [editingField, setEditingField] = useState<number | undefined>(undefined);
  const [draft, setDraft] = useState('');
  const { vector, liveVector, isActive } = props;

  const rows: readonly EditableRow[] = liveVector === undefined ? [] : buildVectorRows(vector, liveVector, dispatch);

  const { selectedIndex } = useNavigationInput({
    itemCount: rows.length,
    isActive: isActive && editingField === undefined,
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

  if (liveVector === undefined) {
    return (
      <Box flexDirection="column">
        <Text bold>{vectorKindLabel(vector.kind)} (view-only)</Text>
        <Text>Geometry: {describeVectorGeometry(vector)}</Text>
        <Text>{describeFillStroke(vector)}</Text>
        <Text color="yellow">
          This page's live vectors (documents.js's `OdgPage.vectors()`) don't line up one-to-one with what odf.js's own reader found here -- likely a `draw:circle`/`polygon`/`polyline`/`custom-shape` element the live accessor has no wrapper for, sitting alongside a plain rect/ellipse/line/path it does. Rather than risk pairing the wrong live handle to this row, every vector on this page is shown read-only until that mismatch is resolved outside this TUI. Open the file in a real ODF editor to change it.
        </Text>
        <Text dimColor>Esc to go back</Text>
      </Box>
    );
  }

  if (editingField !== undefined) {
    const row = rows[editingField];
    if (row === undefined) {
      throw new Error(`VectorDetail is editing field index ${editingField}, but there are only ${rows.length} rows -- selecting a row always sets editingField to a valid index from that same rows array, so this indicates a bug in that selection.`);
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
      <Text bold>{vectorKindLabel(vector.kind)}</Text>
      <Text>Geometry: {describeVectorGeometry(vector)}</Text>
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

  // Only handles Esc/back for the "not found" branch below -- once a real item is found, VectorDetail/ShapeDetail each own their own back navigation via useNavigationInput, and having both active at once would double-dispatch POP_SCREEN on a single Escape press.
  useInput(
    (input, key) => {
      if (key.escape || key.leftArrow || input === 'h') {
        dispatch({ type: 'POP_SCREEN' });
      }
    },
    { isActive: !overlayOpen && item === undefined },
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
    return <VectorDetail vector={item.vector} liveVector={item.liveVector} isActive={!overlayOpen} />;
  }

  // Vectors always sort before shapes in `buildPageItems`, so a shape's own position within `page.shapes()` (needed for the containerIndex/shapeIndex addressing SET_SHAPE_TEXT/FRAME/ROTATION use) is the combined index minus however many vector rows precede all the shape rows.
  const vectorCount = items.filter((entry) => entry.kind === 'vector').length;
  return <ShapeDetail pageIndex={pageIndex} shapeIndexInPage={itemIndex - vectorCount} shape={item.shape} isActive={!overlayOpen} />;
}
