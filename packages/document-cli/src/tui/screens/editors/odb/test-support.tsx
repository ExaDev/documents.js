import type { HsqldbTable, OdbForm, OdbReport } from 'documents.js';
import { Text } from 'ink';
import { useEffect, type ReactElement } from 'react';
import { AppStateProvider, useAppDispatch, useAppState } from '../../../state/context.js';
import { currentScreen } from '../../../state/types.js';
import { OdbFormDetailScreen } from './form-detail.js';
import { OdbFormListScreen } from './form-list.js';
import { OdbReportDetailScreen } from './report-detail.js';
import { OdbReportListScreen } from './report-list.js';
import { OdbReportRenderScreen } from './report-render.js';
import { OdbTableListScreen } from './table-list.js';
import { OdbTableRowsScreen } from './table-rows.js';

export interface OdbHarnessProps {
  readonly tables?: readonly HsqldbTable[];
  readonly forms?: readonly OdbForm[];
  readonly reports?: readonly OdbReport[];
  // A synthetic 'sample.odb' by default -- fine for every screen that only reads the tables/forms/reports this harness seeded directly. The report-render screen is the one exception: it re-reads and re-decodes `doc.path` from disk (see render-odb-report.ts's own doc comment on why an OdbOpenDocument carries no live Package of its own), so a test exercising it must pass a real, readable `.odb` path here.
  readonly path?: string;
}

// `AppStateProvider` exposes no way to seed its initial state from outside, so a test harness opens a synthetic `.odb` document the same way the real app does: by dispatching `OPEN_FILE_SUCCESS` from an effect after mount. Until that effect has run, `state.openDocument` is still undefined, so this renders a placeholder rather than the real screen, which would otherwise throw immediately (every screen's own `requireOdbDocument` treats a missing document as a router bug, not a recoverable condition).
function OdbHarnessBody({ tables, forms, reports, path }: Required<OdbHarnessProps>): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();

  useEffect(() => {
    dispatch({ type: 'OPEN_FILE_SUCCESS', path, doc: { format: 'odb', tables, forms, reports, path } });
  }, [dispatch, tables, forms, reports, path]);

  if (state.openDocument === undefined) {
    return <Text>loading</Text>;
  }

  const screen = currentScreen(state);
  switch (screen.kind) {
    case 'odbTableList':
      return <OdbTableListScreen />;
    case 'odbTableRows':
      return <OdbTableRowsScreen />;
    case 'odbFormList':
      return <OdbFormListScreen />;
    case 'odbFormDetail':
      return <OdbFormDetailScreen />;
    case 'odbReportList':
      return <OdbReportListScreen />;
    case 'odbReportDetail':
      return <OdbReportDetailScreen />;
    case 'odbReportRender':
      return <OdbReportRenderScreen />;
    default:
      return <Text>unexpected screen: {screen.kind}</Text>;
  }
}

// The three collections default to empty so a test that only cares about one of them names only that one -- a `.odb` genuinely can declare tables with no forms or reports (odf.js's own embedded-firebird fixture is exactly that), so an empty default is a real state, not a stub.
const NO_TABLES: readonly HsqldbTable[] = [];
const NO_FORMS: readonly OdbForm[] = [];
const NO_REPORTS: readonly OdbReport[] = [];
const SAMPLE_PATH = 'sample.odb';

export function OdbHarness({ tables = NO_TABLES, forms = NO_FORMS, reports = NO_REPORTS, path = SAMPLE_PATH }: OdbHarnessProps): ReactElement {
  return (
    <AppStateProvider>
      <OdbHarnessBody tables={tables} forms={forms} reports={reports} path={path} />
    </AppStateProvider>
  );
}
