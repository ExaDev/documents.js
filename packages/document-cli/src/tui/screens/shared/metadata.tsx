import { Box, Text, useInput } from 'ink';
import type { ReactElement } from 'react';
import { formatMetadataLines } from '../../../runtime/metadata-format.js';
import { metadataFor } from '../../format/read-metadata.js';
import { useAppDispatch, useAppState } from '../../state/context.js';
import { anyOverlayOpen } from '../../state/types.js';

// A deliberately read-only screen, reachable for any open document ('m' from app.tsx's own shell-level global useInput): DocxEditor/OdtEditor/PptxEditor/OdpEditor/OdsEditor/OdgEditor expose no metadata setter on an already-open live editor today -- there is no `editor.metadata = {...}` the way there is `run.bold = true`. That is a genuine documents.js-level gap (see this repo's own set-metadata CLI command, which patches metadata by rebuilding the whole package from a freshly-read ContentDocument rather than mutating a live editor in place), not something this screen could work around without reimplementing that rebuild inside the TUI's own edit loop. Reviewed and left out of scope deliberately: this screen shows what a document's own metadata currently is, nothing more, until documents.js grows a live setter to edit through.
export function MetadataScreen(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const doc = state.openDocument;

  useInput(
    (input, key) => {
      if (key.escape || key.leftArrow || input === 'h') {
        dispatch({ type: 'POP_SCREEN' });
      }
    },
    { isActive: doc !== undefined && !anyOverlayOpen(state) },
  );

  if (doc === undefined) {
    return <Text color="red">MetadataScreen requires an open document.</Text>;
  }

  let lines: readonly string[] | undefined;
  let errorMessage: string | undefined;
  try {
    lines = formatMetadataLines(metadataFor(doc));
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
  }

  return (
    <Box flexDirection="column">
      <Text bold>Document metadata ({doc.format})</Text>
      {errorMessage !== undefined ? (
        <Text color="yellow">{errorMessage}</Text>
      ) : lines !== undefined && lines.length > 0 ? (
        lines.map((line) => <Text key={line}>{line}</Text>)
      ) : (
        <Text dimColor>This document carries no metadata.</Text>
      )}
      <Text dimColor>Esc / ← / h to go back</Text>
    </Box>
  );
}
