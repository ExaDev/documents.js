import { Box, Text } from 'ink';
import type { ReactElement } from 'react';
import type { Box as GeometryBox, OdpEditor, PageSize, PptxEditor } from 'documents.js';
import { ListView } from '../../components/list-view.js';
import { useNavigationInput } from '../../keybindings/use-navigation-input.js';
import { useAppDispatch, useAppState } from '../../state/context.js';
import { anyOverlayOpen, selectionKeyFor, type OdpOpenDocument, type OpenDocument, type PptxOpenDocument } from '../../state/types.js';

// PptxSlide/PptxShape and OdpSlide/OdpShape are near-identical for the one thing a terminal can show without rendering an actual slide image (shape position, size, and text content), so every pptx/odp screen in this family shares this one adapter and this one list component rather than each format reimplementing slide/shape enumeration and rendering separately.

export interface SlideFamilyShapeSummary {
  readonly text: string;
  readonly frame: GeometryBox | undefined;
}

export interface SlideFamilySlideSummary {
  readonly shapes: () => readonly SlideFamilyShapeSummary[];
  readonly notes: string;
}

export interface SlideFamilyAdapter {
  readonly formatLabel: 'pptx' | 'odp';
  readonly slides: () => readonly SlideFamilySlideSummary[];
}

function buildSlideFamilyAdapter(formatLabel: 'pptx' | 'odp', editor: PptxEditor | OdpEditor): SlideFamilyAdapter {
  return {
    formatLabel,
    slides: () =>
      editor.slides().map((slide) => ({
        shapes: () => slide.shapes().map((shape) => ({ text: shape.text, frame: shape.frame })),
        notes: slide.notes,
      })),
  };
}

export function buildPptxSlideFamilyAdapter(editor: PptxEditor): SlideFamilyAdapter {
  return buildSlideFamilyAdapter('pptx', editor);
}

export function buildOdpSlideFamilyAdapter(editor: OdpEditor): SlideFamilyAdapter {
  return buildSlideFamilyAdapter('odp', editor);
}

// The one narrowing every pptx/odp screen in this family needs: `state.openDocument` is a nine-member union, but a slide-family screen only ever exists on the stack while a pptx or odp document is open, since every screen in this family is only ever pushed by another screen in this family that already checked this. Throws rather than returning undefined because reaching this function with the wrong document open is a screen-router wiring bug, not a recoverable runtime state -- matching `currentScreen`'s own precedent in state/types.ts.
export type PresentationOpenDocument = PptxOpenDocument | OdpOpenDocument;

export function assertPresentationDocument(doc: OpenDocument | undefined): PresentationOpenDocument {
  if (doc === undefined || (doc.format !== 'pptx' && doc.format !== 'odp')) {
    throw new Error('Expected an open pptx or odp document here; the screen router in app.tsx should only reach a slide-family screen for one of those formats.');
  }
  return doc;
}

const DEFAULT_FRAME_MARGIN_FRACTION = 0.1;
const DEFAULT_FRAME_SIZE_FRACTION = 0.3;

// A newly inserted shape needs some starting position and size -- there is no drag-to-place gesture in a terminal, see the shape-editor's own point-value frame fields -- so this derives a modest default from the slide's own declared size (a computable truth) rather than a bare literal point value that would be wrong for a widescreen vs standard-size deck.
export function defaultShapeFrame(slideSize: PageSize): GeometryBox {
  return {
    xPt: slideSize.widthPt * DEFAULT_FRAME_MARGIN_FRACTION,
    yPt: slideSize.heightPt * DEFAULT_FRAME_MARGIN_FRACTION,
    widthPt: slideSize.widthPt * DEFAULT_FRAME_SIZE_FRACTION,
    heightPt: slideSize.heightPt * DEFAULT_FRAME_SIZE_FRACTION,
  };
}

const SHAPE_TEXT_PREVIEW_LENGTH = 40;

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

// PptxShape/OdpShape expose no shape-kind discriminant at all -- no "this is a picture" flag, just `.text` and `.frame` -- and this app only ever creates a shape via ADD_TEXTBOX or ADD_IMAGE, so an empty-text shape is labelled [Image] as an honest best guess rather than a certainty; a real shape read from arbitrary source pptx/odp content could just as easily be a blank text box.
export function describeSlideFamilyShape(shape: SlideFamilyShapeSummary): string {
  const flattened = shape.text.trim().replaceAll(/\s+/g, ' ');
  return flattened.length === 0 ? '[Image] (no text)' : `[Text] "${truncate(flattened, SHAPE_TEXT_PREVIEW_LENGTH)}"`;
}

interface SlideRow {
  readonly index: number;
  readonly shapes: readonly SlideFamilyShapeSummary[];
  readonly notes: string;
}

// ListView sizes its viewport from item COUNT alone (see list-view.tsx), and each row here renders one heading line plus one line per shape -- a slide with many shapes can therefore run past the computed viewport and scroll imperfectly. Accepted rather than worked around: ListView is a generic, format-agnostic primitive with no notion of variable-height rows, and teaching it that for this one caller would be scope creep into a shared component for a cosmetic edge case.
function SlideRowView({ row, isSelected }: { readonly row: SlideRow; readonly isSelected: boolean }): ReactElement {
  return (
    <Box flexDirection="column">
      <Text color={isSelected ? 'cyan' : undefined} inverse={isSelected} bold>
        Slide {row.index + 1} ({row.shapes.length} shape{row.shapes.length === 1 ? '' : 's'}
        {row.notes.trim().length > 0 ? ', has notes' : ''})
      </Text>
      {row.shapes.map((shape, shapeIndex) => (
        <Text key={shapeIndex} dimColor={!isSelected}>
          {'  '}
          {describeSlideFamilyShape(shape)}
        </Text>
      ))}
    </Box>
  );
}

export interface SlideFamilySlideListProps {
  readonly adapter: SlideFamilyAdapter;
}

export function SlideFamilySlideList(props: SlideFamilySlideListProps): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const overlayOpen = anyOverlayOpen(state);
  const rows: readonly SlideRow[] = props.adapter.slides().map((slide, index) => ({ index, shapes: slide.shapes(), notes: slide.notes }));

  const { selectedIndex } = useNavigationInput({
    itemCount: rows.length,
    isActive: !overlayOpen,
    onBack: () => {
      dispatch({ type: 'POP_SCREEN' });
    },
    onSelect: (index) => {
      dispatch({ type: 'SET_SELECTION', key: selectionKeyFor({ kind: 'slideList' }), index });
      dispatch({ type: 'PUSH_SCREEN', screen: { kind: 'slideDetail', slideIndex: index } });
    },
    onAppend: () => {
      dispatch({ type: 'ADD_SLIDE' });
    },
  });

  return (
    <Box flexDirection="column">
      <Text bold>
        {props.adapter.formatLabel === 'pptx' ? 'PowerPoint' : 'Impress'} slides ({rows.length})
      </Text>
      <ListView
        items={rows}
        selectedIndex={selectedIndex}
        emptyMessage="No slides yet -- press 'a' to add one"
        renderItem={(row, isSelected) => <SlideRowView row={row} isSelected={isSelected} />}
      />
      <Text dimColor>Enter: open slide a: add slide Esc: back</Text>
    </Box>
  );
}
