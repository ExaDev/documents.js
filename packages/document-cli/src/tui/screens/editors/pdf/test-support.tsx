import type { LayoutDocument } from 'documents.js';
import { Text } from 'ink';
import { useEffect, type ReactElement } from 'react';
import { AppStateProvider, useAppDispatch, useAppState } from '../../../state/context.js';
import { currentScreen } from '../../../state/types.js';
import { PdfItemDetailScreen } from './item-detail.js';
import { PdfPageItemsScreen } from './page-items.js';
import { PdfPageListScreen } from './page-list.js';

// `AppStateProvider` exposes no way to seed its initial state from outside, so a test harness opens a synthetic PDF the same way the real app does: by dispatching `OPEN_FILE_SUCCESS` from an effect after mount. Until that effect has run, `state.openDocument` is still undefined, so this renders a placeholder rather than the real screen, which would otherwise throw immediately (every screen's own `requirePdfDocument` treats a missing document as a router bug, not a recoverable condition).
function PdfHarnessBody({ layout }: { readonly layout: LayoutDocument }): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();

  useEffect(() => {
    dispatch({ type: 'OPEN_FILE_SUCCESS', path: 'sample.pdf', doc: { format: 'pdf', layout, path: 'sample.pdf' } });
  }, [dispatch, layout]);

  if (state.openDocument === undefined) {
    return <Text>loading</Text>;
  }

  const screen = currentScreen(state);
  switch (screen.kind) {
    case 'pdfPageList':
      return <PdfPageListScreen />;
    case 'pdfPageItems':
      return <PdfPageItemsScreen />;
    case 'pdfItemDetail':
      return <PdfItemDetailScreen />;
    default:
      return <Text>unexpected screen: {screen.kind}</Text>;
  }
}

export function PdfHarness({ layout }: { readonly layout: LayoutDocument }): ReactElement {
  return (
    <AppStateProvider>
      <PdfHarnessBody layout={layout} />
    </AppStateProvider>
  );
}
