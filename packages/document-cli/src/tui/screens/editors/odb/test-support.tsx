import type { HsqldbTable } from 'documents.js';
import { Text } from 'ink';
import { useEffect, type ReactElement } from 'react';
import { AppStateProvider, useAppDispatch, useAppState } from '../../../state/context.js';
import { currentScreen } from '../../../state/types.js';
import { OdbTableListScreen } from './table-list.js';
import { OdbTableRowsScreen } from './table-rows.js';

// `AppStateProvider` exposes no way to seed its initial state from outside, so a test harness opens a synthetic `.odb` document the same way the real app does: by dispatching `OPEN_FILE_SUCCESS` from an effect after mount. Until that effect has run, `state.openDocument` is still undefined, so this renders a placeholder rather than the real screen, which would otherwise throw immediately (both screens' own `requireOdbDocument` treats a missing document as a router bug, not a recoverable condition).
function OdbHarnessBody({ tables }: { readonly tables: readonly HsqldbTable[] }): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();

  useEffect(() => {
    dispatch({ type: 'OPEN_FILE_SUCCESS', path: 'sample.odb', doc: { format: 'odb', tables, path: 'sample.odb' } });
  }, [dispatch, tables]);

  if (state.openDocument === undefined) {
    return <Text>loading</Text>;
  }

  const screen = currentScreen(state);
  switch (screen.kind) {
    case 'odbTableList':
      return <OdbTableListScreen />;
    case 'odbTableRows':
      return <OdbTableRowsScreen />;
    default:
      return <Text>unexpected screen: {screen.kind}</Text>;
  }
}

export function OdbHarness({ tables }: { readonly tables: readonly HsqldbTable[] }): ReactElement {
  return (
    <AppStateProvider>
      <OdbHarnessBody tables={tables} />
    </AppStateProvider>
  );
}
