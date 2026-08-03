import { Box, Text, useInput } from 'ink';
import { useState, type ReactElement } from 'react';
import { TextField } from '../../../components/text-field.js';
import { useAppDispatch, useAppState } from '../../../state/context.js';
import { anyOverlayOpen, type Screen } from '../../../state/types.js';
import { assertPresentationDocument } from '../../shared/slide-family.js';

export interface NotesEditorScreenProps {
  readonly screen: Extract<Screen, { kind: 'notesEditor' }>;
}

// Reached via slide-detail's own 'n' key for either an open pptx or odp document -- PptxSlide and OdpSlide both carry a real `.notes` getter/setter (documents.js's own README confirms pptx speaker notes round-trip through pptxToPdf/pdfToPptx via a hidden annotation, the same as odp's own presentation:notes element), so this screen is shared between the two formats rather than being odp-only.
export function NotesEditorScreen(props: NotesEditorScreenProps): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const overlayOpen = anyOverlayOpen(state);
  const doc = assertPresentationDocument(state.openDocument);
  const { slideIndex } = props.screen;
  const slide = doc.editor.slides()[slideIndex];
  const [draft, setDraft] = useState(() => slide?.notes ?? '');

  const back = (): void => {
    dispatch({ type: 'POP_SCREEN' });
  };

  // TextField already claims Escape while it is focused (see components/text-field.tsx); this covers the one case where no TextField renders at all -- the slide the screen was pushed for has since gone missing.
  useInput(
    (_input, key) => {
      if (key.escape) {
        back();
      }
    },
    { isActive: !overlayOpen && slide === undefined },
  );

  if (slide === undefined) {
    return (
      <Box flexDirection="column">
        <Text bold>Slide {slideIndex + 1} notes</Text>
        <Text color="yellow">This slide no longer exists -- press Esc to go back</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>Slide {slideIndex + 1} notes</Text>
      <TextField
        value={draft}
        isFocused={!overlayOpen}
        placeholder="speaker notes"
        onChange={setDraft}
        onSubmit={(value) => {
          dispatch({ type: 'SET_SLIDE_NOTES', slideIndex, notes: value });
          back();
        }}
        onCancel={back}
      />
      <Text dimColor>Enter: save Esc: cancel</Text>
    </Box>
  );
}
