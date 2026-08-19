import { Box, Text } from 'ink';
import type { ReactElement } from 'react';
import { describeOdbReport } from '../../../../odb-structure.js';
import { ListView } from '../../../components/list-view.js';
import { useNavigationInput } from '../../../keybindings/use-navigation-input.js';
import { useAppDispatch, useAppState } from '../../../state/context.js';
import { anyOverlayOpen } from '../../../state/types.js';
import { requireOdbDocument } from './shared.js';

// One row per report the database declares, reached from the table list with `r`. Like a form, a report is a static ODF sub-document -- this browses its declared band/group structure, never a rendered report, since rendering one would mean executing its own SQL against a live engine (categorically outside documents.js's scope).
export function OdbReportListScreen(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const doc = requireOdbDocument(state.openDocument);

  const query = state.searchQuery.trim().toLowerCase();
  const reports = query === '' ? doc.reports : doc.reports.filter((report) => report.name.toLowerCase().includes(query));

  const { selectedIndex } = useNavigationInput({
    itemCount: reports.length,
    onSelect: (index) => {
      const report = reports[index];
      if (report === undefined) {
        return;
      }
      dispatch({ type: 'PUSH_SCREEN', screen: { kind: 'odbReportDetail', reportName: report.name } });
    },
    onBack: () => {
      dispatch({ type: 'POP_SCREEN' });
    },
    isActive: !anyOverlayOpen(state),
  });

  return (
    <Box flexDirection="column">
      <Text bold>
        Reports ({reports.length} of {doc.reports.length})
      </Text>
      <ListView
        items={reports}
        selectedIndex={selectedIndex}
        emptyMessage={query === '' ? 'This database declares no reports.' : `No reports match "${state.searchQuery}".`}
        renderItem={(report, isSelected) => (
          <Text color={isSelected ? 'cyan' : undefined} inverse={isSelected}>
            {describeOdbReport(report)}
          </Text>
        )}
      />
      <Text dimColor>Enter to open a report, Esc to go back to the tables</Text>
    </Box>
  );
}
