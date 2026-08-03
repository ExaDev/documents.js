import type { LayoutDocument } from 'documents.js';
import { Text } from 'ink';
import { useEffect, type ReactElement } from 'react';
import { AppStateProvider, useAppDispatch, useAppState } from '../../../state/context.js';
import { currentScreen } from '../../../state/types.js';
import { PdfItemDetailScreen } from './item-detail.js';
import { PdfPageItemsScreen } from './page-items.js';
import { PdfPageListScreen } from './page-list.js';

// `AppStateProvider` exposes no way to seed its initial state from outside, so a test harness opens a synthetic PDF (or, with `format: 'xlsx'`, a synthetic read-only xlsx-preview document carrying the identical `LayoutDocument`) the same way the real app does: by dispatching `OPEN_FILE_SUCCESS` from an effect after mount. Until that effect has run, `state.openDocument` is still undefined, so this renders a placeholder rather than the real screen, which would otherwise throw immediately (every screen's own `requirePdfDocument` treats a missing document as a router bug, not a recoverable condition). The `format` prop defaults to 'pdf' so every existing caller keeps behaving exactly as before; passing 'xlsx' is what proves this whole screen family renders identically for both formats, with zero xlsx-specific branching in page-list.tsx/page-items.tsx/item-detail.tsx themselves.
function PdfHarnessBody({ layout, format = 'pdf' }: { readonly layout: LayoutDocument; readonly format?: 'pdf' | 'xlsx' }): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();

  useEffect(() => {
    if (format === 'pdf') {
      dispatch({ type: 'OPEN_FILE_SUCCESS', path: 'sample.pdf', doc: { format: 'pdf', layout, path: 'sample.pdf' } });
      return;
    }
    dispatch({ type: 'OPEN_FILE_SUCCESS', path: 'sample.xlsx', doc: { format: 'xlsx', layout, bytes: new Uint8Array(0), path: 'sample.xlsx' } });
  }, [dispatch, layout, format]);

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

export function PdfHarness({ layout, format }: { readonly layout: LayoutDocument; readonly format?: 'pdf' | 'xlsx' }): ReactElement {
  return (
    <AppStateProvider>
      <PdfHarnessBody layout={layout} format={format} />
    </AppStateProvider>
  );
}
