import { join } from 'node:path';
import { Box, Text } from 'ink';
import { useState, type ReactElement } from 'react';
import { TextField } from '../components/text-field.js';
import { describeError } from '../errors.js';
import { defaultPdfPathFor, exportToPdf } from '../format/export-pdf.js';
import { useAppDispatch, useAppState } from '../state/context.js';
import { anyOverlayOpen, type OpenDocument } from '../state/types.js';

function defaultExportDestinationFor(document: OpenDocument, cwd: string): string {
  return document.path === undefined ? join(cwd, 'untitled.pdf') : defaultPdfPathFor(document.path);
}

// Reached with 'e' from any open editor screen (wired globally in app.tsx once every format screen exists). This screen owns only the destination-path prompt; the conversion itself, and the diagnostics it reports, are exactly what src/tui/format/export-pdf.ts's exportToPdf already does for the Ctrl+S/`:export pdf` paths.
export function ExportOptionsScreen(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const isActive = !anyOverlayOpen(state);
  const document = state.openDocument;

  const [destination, setDestination] = useState(() => (document === undefined ? '' : defaultExportDestinationFor(document, state.cwd)));

  // 'e' is only ever wired to editor screens that have an open document, so this branch is unreached in practice -- it exists because `state.openDocument` is typed `OpenDocument | undefined`.
  if (document === undefined) {
    return (
      <Box flexDirection="column">
        <Text color="yellow">There is no open document to export.</Text>
      </Box>
    );
  }

  const submit = (value: string): void => {
    void (async () => {
      let diagnosticCount = 0;
      try {
        await exportToPdf(document, value, {
          onDiagnostic: (diagnostic) => {
            diagnosticCount += 1;
            dispatch({ type: 'APPEND_DIAGNOSTIC', diagnostic });
          },
        });
        dispatch({ type: 'SET_STATUS', severity: 'info', text: `Exported ${value}` });
        // Diagnostics are first-class, not a badge the user might miss entirely: any produced by a successful export open the diagnostics panel immediately, rather than leaving it to the status-line badge alone.
        if (diagnosticCount > 0) {
          dispatch({ type: 'OPEN_OVERLAY', overlay: 'diagnosticsPanel' });
        }
        dispatch({ type: 'POP_SCREEN' });
      } catch (error) {
        dispatch({ type: 'OPEN_FILE_ERROR', message: `Could not export to ${value}`, detail: describeError(error) });
      }
    })();
  };

  return (
    <Box flexDirection="column">
      <Text bold>Export to PDF</Text>
      <Box>
        <Text color="cyan">Path: </Text>
        <TextField
          value={destination}
          isFocused={isActive}
          placeholder="destination path"
          onChange={setDestination}
          onSubmit={submit}
          onCancel={() => {
            dispatch({ type: 'POP_SCREEN' });
          }}
        />
      </Box>
      <Text dimColor>Enter to export, Esc to cancel</Text>
    </Box>
  );
}
