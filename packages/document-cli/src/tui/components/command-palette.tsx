import { Box, Text } from 'ink';
import { useState, type Dispatch, type ReactElement } from 'react';
import { describeError } from '../errors.js';
import { defaultPdfPathFor, exportToPdf } from '../format/export-pdf.js';
import { openDocumentAtPath } from '../format/open-document.js';
import type { Action } from '../state/actions.js';
import { useAppDispatch, useAppState } from '../state/context.js';
import { saveOpenDocumentAction } from '../state/save-document.js';
import { isEditableFormat, type AppState } from '../state/types.js';
import { TextField } from './text-field.js';

interface CommandDefinition {
  readonly name: string;
  readonly usage: string;
  readonly description: string;
}

// Wide enough for the longest usage string above (`:new docx|pptx|odt|odp|ods|odg|pdf`) plus a space, so the description column lines up without measuring at render time.
const USAGE_COLUMN_WIDTH = 36;

const COMMANDS: readonly CommandDefinition[] = [
  { name: 'save', usage: ':save', description: 'Write the open document back to its own path' },
  { name: 'saveas', usage: ':saveas <path>', description: 'Write the open document to a new path' },
  { name: 'export', usage: ':export pdf [path]', description: 'Render the open document to PDF' },
  { name: 'new', usage: ':new docx|pptx|odt|odp|ods|odg|pdf', description: 'Create an empty document' },
  { name: 'open', usage: ':open <path>', description: 'Open a document from disk' },
  { name: 'close', usage: ':close', description: 'Close the open document' },
  { name: 'undo', usage: ':undo', description: 'Undo the last change' },
  { name: 'view-source', usage: ':view-source', description: 'Compare a markdown document as opened vs. as it will save now' },
  { name: 'help', usage: ':help', description: 'Show the key bindings' },
  { name: 'quit', usage: ':quit', description: 'Leave the application' },
];

function firstToken(line: string): string | undefined {
  return line.trim().split(/\s+/).find((token) => token.length > 0);
}

function matchingCommands(line: string): readonly CommandDefinition[] {
  const token = firstToken(line);
  if (token === undefined) {
    return COMMANDS;
  }
  const needle = token.toLowerCase();
  return COMMANDS.filter((command) => command.name.includes(needle) || command.description.toLowerCase().includes(needle));
}

// An exact name wins over a prefix so `:save` never resolves to `:saveas`; anything else falls back to the first command the palette is currently showing, which is the one highlighted on screen.
function resolveCommand(line: string): CommandDefinition | undefined {
  const token = firstToken(line);
  if (token === undefined) {
    return undefined;
  }
  const exact = COMMANDS.find((command) => command.name === token.toLowerCase());
  return exact ?? matchingCommands(line)[0];
}

function warn(dispatch: Dispatch<Action>, text: string): void {
  dispatch({ type: 'SET_STATUS', severity: 'warning', text });
}

async function runCommand(line: string, state: AppState, dispatch: Dispatch<Action>): Promise<void> {
  const command = resolveCommand(line);
  if (command === undefined) {
    warn(dispatch, `Unknown command: ${line}`);
    return;
  }
  const args = line.trim().split(/\s+/).filter((token) => token.length > 0).slice(1);
  const doc = state.openDocument;

  switch (command.name) {
    case 'save': {
      if (doc === undefined) {
        warn(dispatch, 'There is no open document to save');
        return;
      }
      if (doc.path === undefined) {
        dispatch({ type: 'SAVE_AS_REQUEST' });
        return;
      }
      await save(doc.path, state, dispatch);
      return;
    }

    case 'saveas': {
      const path = args[0];
      if (path === undefined) {
        warn(dispatch, 'Usage: :saveas <path>');
        return;
      }
      await save(path, state, dispatch);
      return;
    }

    case 'export': {
      if (doc === undefined) {
        warn(dispatch, 'There is no open document to export');
        return;
      }
      if (args[0] !== 'pdf') {
        warn(dispatch, 'Usage: :export pdf [path]');
        return;
      }
      const explicit = args[1];
      const destination = explicit ?? (doc.path === undefined ? undefined : defaultPdfPathFor(doc.path));
      if (destination === undefined) {
        warn(dispatch, 'This document has never been saved, so :export pdf needs an explicit path');
        return;
      }
      try {
        await exportToPdf(doc, destination, {
          onDiagnostic: (diagnostic) => {
            dispatch({ type: 'APPEND_DIAGNOSTIC', diagnostic });
          },
        });
        dispatch({ type: 'SET_STATUS', severity: 'info', text: `Exported ${destination}` });
      } catch (error) {
        dispatch({ type: 'OPEN_FILE_ERROR', message: `Could not export to ${destination}`, detail: describeError(error) });
      }
      return;
    }

    case 'new': {
      const format = args[0];
      if (format === undefined || !isEditableFormat(format)) {
        warn(dispatch, 'Usage: :new docx|pptx|odt|odp|ods|odg|pdf');
        return;
      }
      dispatch({ type: 'CREATE_DOCUMENT', format });
      return;
    }

    case 'open': {
      const path = args[0];
      if (path === undefined) {
        warn(dispatch, 'Usage: :open <path>');
        return;
      }
      try {
        const doc = await openDocumentAtPath(path, {
          onDiagnostic: (diagnostic) => {
            dispatch({ type: 'APPEND_DIAGNOSTIC', diagnostic });
          },
        });
        dispatch({ type: 'OPEN_FILE_SUCCESS', path, doc });
      } catch (error) {
        dispatch({ type: 'OPEN_FILE_ERROR', message: `Could not open ${path}`, detail: describeError(error) });
      }
      return;
    }

    case 'close':
      dispatch({ type: 'REQUEST_CLOSE' });
      return;

    case 'undo':
      dispatch({ type: 'UNDO' });
      return;

    case 'view-source':
      if (doc?.format !== 'markdown') {
        warn(dispatch, ':view-source only applies to an open markdown document');
        return;
      }
      dispatch({ type: 'PUSH_SCREEN', screen: { kind: 'viewSource' } });
      return;

    case 'help':
      dispatch({ type: 'OPEN_OVERLAY', overlay: 'help' });
      return;

    case 'quit':
      dispatch({ type: 'REQUEST_QUIT' });
      return;

    default:
      warn(dispatch, `Unknown command: ${command.name}`);
  }
}

async function save(path: string, state: AppState, dispatch: Dispatch<Action>): Promise<void> {
  const doc = state.openDocument;
  if (doc === undefined) {
    warn(dispatch, 'There is no open document to save');
    return;
  }
  dispatch(await saveOpenDocumentAction(doc, path));
}

export function CommandPalette(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const [line, setLine] = useState('');
  const matches = matchingCommands(line);

  const close = (): void => {
    dispatch({ type: 'CLOSE_OVERLAY', overlay: 'commandPalette' });
  };

  return (
    <Box borderStyle="round" flexDirection="column" paddingX={1}>
      <Box>
        <Text color="cyan">: </Text>
        <TextField
          value={line}
          isFocused
          placeholder="command"
          onChange={setLine}
          onSubmit={(value) => {
            close();
            void runCommand(value, state, dispatch);
          }}
          onCancel={close}
        />
      </Box>
      {matches.map((command, index) => (
        <Box key={command.name}>
          <Box width={USAGE_COLUMN_WIDTH}>
            <Text color={index === 0 ? 'cyan' : undefined}>{command.usage}</Text>
          </Box>
          <Text dimColor>{command.description}</Text>
        </Box>
      ))}
    </Box>
  );
}
