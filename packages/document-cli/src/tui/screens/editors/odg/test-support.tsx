import { Box, Text } from 'ink';
import { useEffect, type ReactElement } from 'react';
import { AppStateProvider, useAppDispatch, useAppState } from '../../../state/context.js';
import { currentScreen } from '../../../state/types.js';
import { OdgPageDetailScreen } from './page-detail.js';
import { OdgPageListScreen } from './page-list.js';
import { OdgShapeOrVectorDetailScreen } from './shape-or-vector-detail.js';

// `AppStateProvider` exposes no way to seed its initial state from outside, so a test harness creates a fresh odg drawing the same way the real app does: by dispatching `CREATE_DOCUMENT` from an effect after mount. Until that effect has run, `state.openDocument` is still undefined, so this renders a placeholder rather than the real screen, which would otherwise throw immediately (every screen's own `requireOdgDocument` treats a missing document as a router bug, not a recoverable condition). A trailing `top:{kind}` line reports the current screen so a test can assert navigation happened without reaching into React internals.
function OdgHarnessBody(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();

  useEffect(() => {
    if (state.openDocument === undefined) {
      dispatch({ type: 'CREATE_DOCUMENT', format: 'odg' });
    }
  }, [state.openDocument, dispatch]);

  if (state.openDocument?.format !== 'odg') {
    return <Text>loading</Text>;
  }

  const screen = currentScreen(state);
  const body = ((): ReactElement => {
    switch (screen.kind) {
      case 'pageList':
        return <OdgPageListScreen />;
      case 'pageDetail':
        return <OdgPageDetailScreen />;
      case 'shapeOrVectorDetail':
        return <OdgShapeOrVectorDetailScreen />;
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

export function OdgHarness(): ReactElement {
  return (
    <AppStateProvider>
      <OdgHarnessBody />
    </AppStateProvider>
  );
}
