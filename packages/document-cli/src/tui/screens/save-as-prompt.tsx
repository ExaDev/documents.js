import { basename, join } from 'node:path';
import { Box, Text } from 'ink';
import { useState, type ReactElement } from 'react';
import { formatToExtension } from '../../format.js';
import { TextField } from '../components/text-field.js';
import { useAppDispatch, useAppState } from '../state/context.js';
import { saveOpenDocumentAction } from '../state/save-document.js';
import { anyOverlayOpen, isWritableDocument, type OpenDocument } from '../state/types.js';

// The suggested destination: the app's own current working directory (state.cwd, seeded from RunTuiOptions.cwd at startup) plus a sensible, extension-matched filename -- the document's own basename if it already has one (an `.odb`/`.pdf` document opened read-only always does; an editable one might not, if it was created fresh and never saved), otherwise "untitled" with the open document's own format extension.
function defaultDestinationFor(document: OpenDocument, cwd: string): string {
  const extension = isWritableDocument(document) ? formatToExtension(document.format) : 'bin';
  const suggestedName = document.path === undefined ? `untitled.${extension}` : basename(document.path);
  return join(cwd, suggestedName);
}

export function SaveAsPromptScreen(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const isActive = !anyOverlayOpen(state);
  const document = state.openDocument;

  // Computed once at mount as a starting suggestion, not recomputed on every keystroke -- the user must be free to edit it without it snapping back.
  const [destination, setDestination] = useState(() => (document === undefined ? '' : defaultDestinationFor(document, state.cwd)));

  // SAVE_AS_REQUEST is only ever dispatched while a document is open (see app.tsx's Ctrl+S handler and the command palette's :save), so this branch is unreached in practice -- it exists because `state.openDocument` is typed `OpenDocument | undefined` and there is no honest way to skip handling the type's own undefined case.
  if (document === undefined) {
    return (
      <Box flexDirection="column">
        <Text color="yellow">There is no open document to save.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>Save as</Text>
      <Box>
        <Text color="cyan">Path: </Text>
        <TextField
          value={destination}
          isFocused={isActive}
          placeholder="destination path"
          onChange={setDestination}
          onSubmit={(value) => {
            void (async () => {
              const action = await saveOpenDocumentAction(document, value);
              dispatch(action);
              if (action.type === 'SAVE_SUCCESS') {
                dispatch({ type: 'POP_SCREEN' });
              }
            })();
          }}
          onCancel={() => {
            dispatch({ type: 'POP_SCREEN' });
          }}
        />
      </Box>
      <Text dimColor>Enter to save, Esc to cancel</Text>
    </Box>
  );
}
