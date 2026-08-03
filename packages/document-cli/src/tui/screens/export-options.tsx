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

// Comma-separated rather than space-separated: a font path on macOS routinely contains spaces ("/System/Library/Fonts/Supplemental/Arial Bold.ttf") and almost never a comma, so splitting on spaces would break the common case to support one that does not occur. Each entry is trimmed, and an empty field yields no fonts at all -- the export then behaves exactly as it did before this field existed.
function parseFontFileField(value: string): readonly string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

// Which of the two fields currently owns the keyboard. Enter advances from the destination to the fonts field and exports from the fonts field, so the plain "type a path, press Enter twice" path stays the whole interaction for a user who wants no fonts.
type Field = 'destination' | 'fonts';

// Reached with 'e' from any open editor screen (wired globally in app.tsx once every format screen exists). This screen owns only the destination-path and font-file prompts; the conversion itself, the fonts it loads, and the diagnostics it reports are exactly what src/tui/format/export-pdf.ts's exportToPdf already does for the Ctrl+S/`:export pdf` paths.
export function ExportOptionsScreen(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const isActive = !anyOverlayOpen(state);
  const document = state.openDocument;

  const [destination, setDestination] = useState(() => (document === undefined ? '' : defaultExportDestinationFor(document, state.cwd)));
  const [fontFiles, setFontFiles] = useState('');
  const [field, setField] = useState<Field>('destination');

  // 'e' is only ever wired to editor screens that have an open document, so this branch is unreached in practice -- it exists because `state.openDocument` is typed `OpenDocument | undefined`.
  if (document === undefined) {
    return (
      <Box flexDirection="column">
        <Text color="yellow">There is no open document to export.</Text>
      </Box>
    );
  }

  const cancel = (): void => {
    dispatch({ type: 'POP_SCREEN' });
  };

  const submit = (): void => {
    void (async () => {
      let diagnosticCount = 0;
      try {
        await exportToPdf(document, destination, {
          fontFiles: parseFontFileField(fontFiles),
          onDiagnostic: (diagnostic) => {
            diagnosticCount += 1;
            dispatch({ type: 'APPEND_DIAGNOSTIC', diagnostic });
          },
        });
        dispatch({ type: 'SET_STATUS', severity: 'info', text: `Exported ${destination}` });
        // Diagnostics are first-class, not a badge the user might miss entirely: any produced by a successful export open the diagnostics panel immediately, rather than leaving it to the status-line badge alone.
        if (diagnosticCount > 0) {
          dispatch({ type: 'OPEN_OVERLAY', overlay: 'diagnosticsPanel' });
        }
        dispatch({ type: 'POP_SCREEN' });
      } catch (error) {
        dispatch({ type: 'OPEN_FILE_ERROR', message: `Could not export to ${destination}`, detail: describeError(error) });
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
          isFocused={isActive && field === 'destination'}
          placeholder="destination path"
          onChange={setDestination}
          onSubmit={() => {
            setField('fonts');
          }}
          onCancel={cancel}
        />
      </Box>
      <Box>
        <Text color="cyan">Fonts: </Text>
        <TextField
          value={fontFiles}
          isFocused={isActive && field === 'fonts'}
          placeholder="optional .ttf/.otf paths, comma-separated"
          onChange={setFontFiles}
          onSubmit={submit}
          onCancel={cancel}
        />
      </Box>
      <Text dimColor>{field === 'destination' ? 'Enter for fonts, Esc to cancel' : "Enter to export, Esc to cancel. Each font's family is read from the file itself"}</Text>
    </Box>
  );
}
