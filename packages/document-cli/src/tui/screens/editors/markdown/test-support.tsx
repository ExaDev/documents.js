import { Box, Text } from 'ink';
import { useEffect, type ReactElement } from 'react';
import { AppStateProvider, useAppDispatch, useAppState } from '../../../state/context.js';
import { currentScreen } from '../../../state/types.js';
import { MarkdownLineEditorScreen } from './line-editor.js';
import { MarkdownLineListScreen } from './line-list.js';

// `AppStateProvider` exposes no way to seed its initial state from outside, and there is no CREATE_DOCUMENT path for markdown (documents.js has no createMarkdown() the way it does createDocx()/createOdt()/etc.) -- so a test harness opens a synthetic markdown document the same way the real app does when a .md file is opened: by dispatching OPEN_FILE_SUCCESS from an effect after mount. Until that effect has run, `state.openDocument` is still undefined, so this renders a placeholder rather than the real screen, which would otherwise throw immediately (both screens' own `requireMarkdownDocument` treats a missing document as a router bug, not a recoverable condition).
function MarkdownHarnessBody({ source }: { readonly source: string }): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();

  useEffect(() => {
    dispatch({ type: 'OPEN_FILE_SUCCESS', path: 'notes.md', doc: { format: 'markdown', source, path: 'notes.md' } });
  }, [dispatch, source]);

  if (state.openDocument === undefined) {
    return <Text>loading</Text>;
  }

  const screen = currentScreen(state);
  const body = ((): ReactElement => {
    switch (screen.kind) {
      case 'markdownLineList':
        return <MarkdownLineListScreen />;
      case 'markdownLineEditor':
        return <MarkdownLineEditorScreen />;
      default:
        return <Text>unexpected screen: {screen.kind}</Text>;
    }
  })();

  return (
    <Box flexDirection="column">
      {body}
      <Text>top:{screen.kind}</Text>
    </Box>
  );
}

export function MarkdownHarness({ source }: { readonly source: string }): ReactElement {
  return (
    <AppStateProvider>
      <MarkdownHarnessBody source={source} />
    </AppStateProvider>
  );
}
