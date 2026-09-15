import { basename, join } from "node:path";
import { Box, Text } from "ink";
import { useState, type ReactElement } from "react";
import { formatToExtension } from "../../format.js";
import { TextField } from "../components/text-field.js";
import { useAppDispatch, useAppState } from "../state/context.js";
import { saveOpenDocumentAction } from "../state/save-document.js";
import {
  anyOverlayOpen,
  isWritableDocument,
  type OpenDocument,
} from "../state/types.js";

// The suggested destination: the app's own current working directory (state.cwd, seeded from RunTuiOptions.cwd at startup) plus a sensible, extension-matched filename -- the document's own basename if it already has one (an `.odb`/`.pdf` document opened read-only always does; an editable one might not, if it was created fresh and never saved), otherwise "untitled" with the open document's own format extension.
function defaultDestinationFor(document: OpenDocument, cwd: string): string {
  if (document.path !== undefined) {
    return join(cwd, basename(document.path));
  }
  // Every OpenDocument variant whose path can be undefined is a WritableOpenDocument -- every non-writable variant (OdbOpenDocument, XlsxOpenDocument, CsvOpenDocument, SvgOpenDocument, RtfOpenDocument, WpdOpenDocument, EpubOpenDocument) requires path: string, per each one's own doc comment in types.ts. TypeScript's structural union can't express that cross-field invariant on its own, so isWritableDocument narrows document here purely so formatToExtension gets a format its own DocumentFormat parameter actually accepts (it has no "odb" entry) -- this guard is not reachable as false in practice, mirroring the identical situation this file already accepts for SaveAsPromptScreen's own `document === undefined` branch below.
  if (!isWritableDocument(document)) {
    throw new Error(
      "A document with no path is always a WritableOpenDocument, per OpenDocument's own type structure -- this should be unreachable.",
    );
  }
  return join(cwd, `untitled.${formatToExtension(document.format)}`);
}

export function SaveAsPromptScreen(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const isActive = !anyOverlayOpen(state);
  const document = state.openDocument;

  // Computed once at mount as a starting suggestion, not recomputed on every keystroke -- the user must be free to edit it without it snapping back.
  const [destination, setDestination] = useState(() =>
    document === undefined ? "" : defaultDestinationFor(document, state.cwd),
  );

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
              if (action.type === "SAVE_SUCCESS") {
                dispatch({ type: "POP_SCREEN" });
              }
            })();
          }}
          onCancel={() => {
            dispatch({ type: "POP_SCREEN" });
          }}
        />
      </Box>
      <Text dimColor>Enter to save, Esc to cancel</Text>
    </Box>
  );
}
