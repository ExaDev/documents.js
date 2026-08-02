import { Box, Text, useInput } from 'ink';
import { useState, type ReactElement } from 'react';
import { TextField } from '../../../components/text-field.js';
import { useAppDispatch, useAppState } from '../../../state/context.js';
import { anyOverlayOpen, type OdpOpenDocument, type OpenDocument, type Screen } from '../../../state/types.js';

export interface NotesEditorScreenProps {
  readonly screen: Extract<Screen, { kind: 'notesEditor' }>;
}

// Reached only via slide-detail's own 'n' key, which is gated to an odp document there -- SET_SLIDE_NOTES itself works against a pptx document too (PptxSlide also carries a real `.notes` getter/setter), but this screen keeps notes editing an odp-only affordance as a deliberate, bounded scope choice, not a technical constraint. Throws rather than returning undefined for the same reason `assertPresentationDocument` does in shared/slide-family.tsx: reaching this screen with anything other than an open odp document is a screen-router wiring bug.
function assertOdpDocument(doc: OpenDocument | undefined): OdpOpenDocument {
  if (doc?.format !== 'odp') {
    throw new Error('NotesEditorScreen rendered without an open odp document; check the screen router in app.tsx.');
  }
  return doc;
}

export function NotesEditorScreen(props: NotesEditorScreenProps): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const overlayOpen = anyOverlayOpen(state);
  const doc = assertOdpDocument(state.openDocument);
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
