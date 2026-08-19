import type { OdbReport } from 'documents.js';
import { Box, Text } from 'ink';
import type { ReactElement } from 'react';
import { formatOdbReportLines } from '../../../../odb-structure.js';
import { ListView } from '../../../components/list-view.js';
import { useNavigationInput } from '../../../keybindings/use-navigation-input.js';
import { useAppDispatch, useAppState } from '../../../state/context.js';
import { anyOverlayOpen, currentScreen } from '../../../state/types.js';
import { requireOdbDocument } from './shared.js';

// Same chrome as form-detail.tsx: title, href, hint, status line.
const REPORT_DETAIL_RESERVED_ROWS = 5;

function requireReport(reports: readonly OdbReport[], reportName: string): OdbReport {
  const report = reports.find((candidate) => candidate.name === reportName);
  if (report === undefined) {
    throw new Error(`odbReportDetail was pushed for report "${reportName}", but the open .odb document has no report by that name.`);
  }
  return report;
}

// A report's own band/group structure and every `rpt:` formula it declares, rendered through the same `formatOdbReportLines` the `odb-reports` command prints. Search filters by line, which is the useful thing here: `/SUM` narrows a long report down to its aggregate expressions.
export function OdbReportDetailScreen(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const doc = requireOdbDocument(state.openDocument);
  const screen = currentScreen(state);
  if (screen.kind !== 'odbReportDetail') {
    throw new Error(`OdbReportDetailScreen rendered while the current screen is "${screen.kind}", not "odbReportDetail".`);
  }
  const report = requireReport(doc.reports, screen.reportName);

  const allLines = formatOdbReportLines(report);
  const query = state.searchQuery.trim().toLowerCase();
  const lines = query === '' ? allLines : allLines.filter((line) => line.toLowerCase().includes(query));

  const { selectedIndex } = useNavigationInput({
    itemCount: lines.length,
    onSelect: () => {
      // A band or element line already carries its own kind, name, formula, and field binding, so Enter here does not drill into the selected line -- it renders the report itself (readOdbReportContent's own query -> formula -> band pipeline, not the static structure this screen browses) to a file the user picks.
      dispatch({ type: 'PUSH_SCREEN', screen: { kind: 'odbReportRender', reportName: report.name } });
    },
    onBack: () => {
      dispatch({ type: 'POP_SCREEN' });
    },
    isActive: !anyOverlayOpen(state),
  });

  return (
    <Box flexDirection="column">
      <Text bold>
        {report.name} ({lines.length} of {allLines.length} lines)
      </Text>
      <Text dimColor>{report.href}</Text>
      <ListView
        items={lines}
        selectedIndex={selectedIndex}
        reservedRows={REPORT_DETAIL_RESERVED_ROWS}
        emptyMessage={query === '' ? 'This report declares no structure.' : `No lines match "${state.searchQuery}".`}
        renderItem={(line, isSelected) => (
          <Text color={isSelected ? 'cyan' : undefined} inverse={isSelected}>
            {line}
          </Text>
        )}
      />
      <Text dimColor>Enter to render this report, Esc to go back to the report list</Text>
    </Box>
  );
}
