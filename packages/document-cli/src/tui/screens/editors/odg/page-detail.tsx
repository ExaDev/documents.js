import { Box, Text } from 'ink';
import { useState, type Dispatch, type ReactElement } from 'react';
import type { Box as GeometryBox, ContentStroke } from 'documents.js';
import { ListView } from '../../../components/list-view.js';
import { useNavigationInput } from '../../../keybindings/use-navigation-input.js';
import { describeError } from '../../../errors.js';
import { readInput } from '../../../../runtime/io.js';
import type { Action } from '../../../state/actions.js';
import { useAppDispatch, useAppState } from '../../../state/context.js';
import { anyOverlayOpen, type OdgOpenDocument } from '../../../state/types.js';
import { FieldWizard, requireFieldValue, type FieldSpec } from '../../shared/field-wizard.js';
import {
  buildPageItems,
  defaultTriangleSubpaths,
  describeFillStroke,
  describeVectorGeometry,
  formatFrame,
  parseColorField,
  parseNumberField,
  parseStrokeField,
  requireOdgDocument,
  requirePageDetailScreen,
  vectorKindLabel,
  type PageItem,
} from './shared.js';

type AddKind = 'rect' | 'ellipse' | 'line' | 'path' | 'textbox' | 'image';

const ADD_KIND_OPTIONS: readonly { readonly kind: AddKind; readonly label: string }[] = [
  { kind: 'rect', label: 'Rectangle' },
  { kind: 'ellipse', label: 'Ellipse' },
  { kind: 'line', label: 'Line' },
  { kind: 'path', label: 'Path (fixed triangle shape)' },
  { kind: 'textbox', label: 'Text box' },
  { kind: 'image', label: 'Image' },
];

const GEOMETRY_FIELDS: readonly FieldSpec[] = [
  { key: 'xPt', label: 'X (pt)', defaultValue: '40' },
  { key: 'yPt', label: 'Y (pt)', defaultValue: '40' },
  { key: 'widthPt', label: 'Width (pt)', defaultValue: '160' },
  { key: 'heightPt', label: 'Height (pt)', defaultValue: '100' },
];

const FILL_FIELD: FieldSpec = { key: 'fill', label: 'Fill "r g b" (0-1 each), blank for none', defaultValue: '0.8 0.8 0.8' };
const STROKE_FIELD: FieldSpec = { key: 'stroke', label: 'Stroke "r g b widthPt" (0-1 colour, pt width), blank for none', defaultValue: '0 0 0 1' };

function fieldsForAddKind(kind: AddKind): readonly FieldSpec[] {
  switch (kind) {
    case 'rect':
    case 'ellipse':
    case 'path':
      return [...GEOMETRY_FIELDS, FILL_FIELD, STROKE_FIELD];
    case 'line':
      return [
        { key: 'fromXPt', label: 'From X (pt)', defaultValue: '40' },
        { key: 'fromYPt', label: 'From Y (pt)', defaultValue: '40' },
        { key: 'toXPt', label: 'To X (pt)', defaultValue: '200' },
        { key: 'toYPt', label: 'To Y (pt)', defaultValue: '40' },
        STROKE_FIELD,
      ];
    case 'textbox':
      return [...GEOMETRY_FIELDS, { key: 'text', label: 'Text', defaultValue: 'Text' }];
    case 'image':
      return [...GEOMETRY_FIELDS, { key: 'path', label: 'Image file path (.png/.jpg/.jpeg)', defaultValue: '' }, { key: 'altText', label: 'Alt text, blank for none', defaultValue: '' }];
  }
}

function readFrame(values: Readonly<Record<string, string>>): GeometryBox {
  return {
    xPt: parseNumberField(requireFieldValue(values, 'xPt'), 0),
    yPt: parseNumberField(requireFieldValue(values, 'yPt'), 0),
    widthPt: parseNumberField(requireFieldValue(values, 'widthPt'), 100),
    heightPt: parseNumberField(requireFieldValue(values, 'heightPt'), 60),
  };
}

// Only fired when the parity check (shared.ts's `vectorsParityMatch`, via `buildPageItems`) actually fails for this page -- the common case, a page whose vectors are all plain rect/ellipse/line/path, needs no warning at all any more, since editing a freshly-added vector genuinely works. This only fires when the page ALSO carries an element `OdgPage.vectors()` cannot wrap (a `draw:circle`/`polygon`/`polyline`/`custom-shape`), which pulls every vector on the page -- including the one just added -- back into read-only mode.
function warnVectorIsViewOnly(dispatch: Dispatch<Action>, label: string): void {
  dispatch({
    type: 'SET_STATUS',
    severity: 'info',
    text: `${label} added -- but this page also has a vector element documents.js's OdgPage.vectors() cannot wrap, so every vector on it (including this one) shows read-only in this list rather than risk pairing the wrong live handle to the wrong row.`,
  });
}

// Re-derives the page's own items right after a vector-adding dispatch and reports the view-only warning only when that vector's own item genuinely came back without a live handle -- `doc.editor` is a live view over the mutable package, and the reducer's mutation already ran synchronously by the time `dispatch` returns, so this reads the real, post-mutation state rather than a stale one.
function warnIfVectorAddedReadOnly(doc: OdgOpenDocument, pageIndex: number, dispatch: Dispatch<Action>, label: string): void {
  const vectorItems = buildPageItems(doc, pageIndex).filter((item) => item.kind === 'vector');
  const added = vectorItems.at(-1);
  if (added !== undefined && added.liveVector === undefined) {
    warnVectorIsViewOnly(dispatch, label);
  }
}

function inferImageFormat(path: string): 'png' | 'jpeg' | undefined {
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  if (extension === 'png') {
    return 'png';
  }
  if (extension === 'jpg' || extension === 'jpeg') {
    return 'jpeg';
  }
  return undefined;
}

// The one async branch (reading an image file off disk) is why this whole function is async -- every other kind dispatches synchronously and resolves immediately. `doc` is only needed to re-check vector parity after a vector-adding dispatch (warnIfVectorAddedReadOnly); textbox/image never touch it.
async function applyAddKind(kind: AddKind, pageIndex: number, doc: OdgOpenDocument, values: Readonly<Record<string, string>>, dispatch: Dispatch<Action>): Promise<void> {
  switch (kind) {
    case 'rect': {
      const init = { frame: readFrame(values), fill: parseColorField(requireFieldValue(values, 'fill')), stroke: parseStrokeField(requireFieldValue(values, 'stroke')) };
      dispatch({ type: 'ADD_RECT', containerIndex: pageIndex, init });
      warnIfVectorAddedReadOnly(doc, pageIndex, dispatch, 'Rectangle');
      return;
    }
    case 'ellipse': {
      const init = { frame: readFrame(values), fill: parseColorField(requireFieldValue(values, 'fill')), stroke: parseStrokeField(requireFieldValue(values, 'stroke')) };
      dispatch({ type: 'ADD_ELLIPSE', containerIndex: pageIndex, init });
      warnIfVectorAddedReadOnly(doc, pageIndex, dispatch, 'Ellipse');
      return;
    }
    case 'line': {
      const from = { xPt: parseNumberField(requireFieldValue(values, 'fromXPt'), 0), yPt: parseNumberField(requireFieldValue(values, 'fromYPt'), 0) };
      const to = { xPt: parseNumberField(requireFieldValue(values, 'toXPt'), 100), yPt: parseNumberField(requireFieldValue(values, 'toYPt'), 0) };
      const stroke: ContentStroke = parseStrokeField(requireFieldValue(values, 'stroke')) ?? { color: { r: 0, g: 0, b: 0 }, widthPt: 1 };
      dispatch({ type: 'ADD_LINE', containerIndex: pageIndex, init: { from, to, stroke } });
      warnIfVectorAddedReadOnly(doc, pageIndex, dispatch, 'Line');
      return;
    }
    case 'path': {
      const frame = readFrame(values);
      const init = {
        frame,
        subpaths: defaultTriangleSubpaths(frame.widthPt, frame.heightPt),
        fill: parseColorField(requireFieldValue(values, 'fill')),
        stroke: parseStrokeField(requireFieldValue(values, 'stroke')),
      };
      dispatch({ type: 'ADD_PATH', containerIndex: pageIndex, init });
      warnIfVectorAddedReadOnly(doc, pageIndex, dispatch, 'Path');
      return;
    }
    case 'textbox': {
      dispatch({ type: 'ADD_TEXTBOX', containerIndex: pageIndex, frame: readFrame(values), text: requireFieldValue(values, 'text') });
      return;
    }
    case 'image': {
      const frame = readFrame(values);
      const path = requireFieldValue(values, 'path');
      const format = inferImageFormat(path);
      if (format === undefined) {
        dispatch({ type: 'SET_STATUS', severity: 'warning', text: `${path} is not a .png or .jpg/.jpeg file -- image not added` });
        return;
      }
      try {
        const bytes = new Uint8Array(await readInput(path));
        const altTextRaw = requireFieldValue(values, 'altText').trim();
        dispatch({ type: 'ADD_IMAGE', containerIndex: pageIndex, frame, format, bytes, altText: altTextRaw.length === 0 ? undefined : altTextRaw });
      } catch (error) {
        dispatch({ type: 'SET_STATUS', severity: 'error', text: `Could not read ${path}: ${describeError(error)}` });
      }
      return;
    }
  }
}

function AddItemFlow(props: { readonly pageIndex: number; readonly doc: OdgOpenDocument; readonly isActive: boolean; readonly onCancel: () => void; readonly onCreated: () => void }): ReactElement {
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
        {/* A 6-item fixed list inside a 2-row border, so it needs 2 more reserved rows than list-view.tsx's own default (title + status line + blank + slack) already assumes. */}
        <ListView
          items={ADD_KIND_OPTIONS}
          selectedIndex={selectedIndex}
          reservedRows={6}
          renderItem={(option, isSelected) => (
            <Text color={isSelected ? 'cyan' : undefined}>
              {isSelected ? '> ' : '  '}
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
        void applyAddKind(kind, props.pageIndex, props.doc, values, dispatch).then(props.onCreated);
      }}
    />
  );
}

const MAX_TEXT_PREVIEW_LENGTH = 40;

function previewText(text: string): string {
  const singleLine = text.replace(/\s+/g, ' ').trim();
  return singleLine.length > MAX_TEXT_PREVIEW_LENGTH ? `${singleLine.slice(0, MAX_TEXT_PREVIEW_LENGTH)}…` : singleLine;
}

function describeItem(item: PageItem): string {
  if (item.kind === 'vector') {
    return `${vectorKindLabel(item.vector.kind)}  ${describeVectorGeometry(item.vector)}  (${describeFillStroke(item.vector)})`;
  }
  const label = item.shapeKind === 'image' ? 'Image' : 'Text';
  const frame = item.shape.frame;
  const frameText = frame === undefined ? 'no frame' : formatFrame(frame);
  const preview = item.shapeKind === 'text' ? previewText(item.shape.text) : '';
  return `${label}  ${frameText}${preview.length === 0 ? '' : `  "${preview}"`}`;
}

export function OdgPageDetailScreen(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const doc = requireOdgDocument(state);
  const { pageIndex } = requirePageDetailScreen(state);
  const [isAdding, setIsAdding] = useState(false);
  const overlayOpen = anyOverlayOpen(state);

  // Fresh every render, never cached: `buildPageItems` reads the live `page.shapes()` accessor plus a fresh `readOdgContent` of the live package, exactly the "call editor accessors fresh on every render" rule this state layer requires of every screen.
  const items = buildPageItems(doc, pageIndex);
  const query = state.searchQuery.trim().toLowerCase();
  const rows = items.map((item, index) => ({ item, index })).filter((row) => query.length === 0 || describeItem(row.item).toLowerCase().includes(query));

  const { selectedIndex } = useNavigationInput({
    itemCount: rows.length,
    isActive: !overlayOpen && !isAdding,
    onBack: () => {
      dispatch({ type: 'POP_SCREEN' });
    },
    onSelect: (index) => {
      const row = rows[index];
      if (row === undefined) {
        return;
      }
      dispatch({ type: 'PUSH_SCREEN', screen: { kind: 'shapeOrVectorDetail', pageIndex, itemIndex: row.index } });
    },
    onAppend: () => {
      setIsAdding(true);
    },
  });

  if (isAdding) {
    return (
      <AddItemFlow
        pageIndex={pageIndex}
        doc={doc}
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
        Page {pageIndex + 1} -- {items.length} item{items.length === 1 ? '' : 's'}
      </Text>
      <ListView
        items={rows}
        selectedIndex={selectedIndex}
        emptyMessage="No items yet -- press 'a' to add one"
        renderItem={(row, isSelected) => (
          <Text color={isSelected ? 'cyan' : undefined}>
            {isSelected ? '> ' : '  '}
            {describeItem(row.item)}
          </Text>
        )}
      />
    </Box>
  );
}
