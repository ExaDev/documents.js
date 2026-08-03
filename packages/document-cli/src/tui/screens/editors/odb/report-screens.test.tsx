import type { HsqldbTable } from 'documents.js';
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { loadFormAndReportOdbReports } from '../../../../test-support/odb-fixture.js';
import { settle, waitForFrame } from '../../../test-support.js';
import { OdbHarness } from './test-support.js';

// Same reasoning as form-screens.test.tsx: the real fixture rather than a hand-built OdbReport, because the two things worth proving here -- a group key that is an expression rather than a bare column name, and the detail band sitting at report level -- are exactly the shapes a synthetic value would have got wrong.
const REPORTS = loadFormAndReportOdbReports();

const SAMPLE_TABLES: readonly HsqldbTable[] = [{ tableName: 'SALES', columns: [{ name: 'CUSTOMER', type: 'VARCHAR' }], rows: [[{ kind: 'string', value: 'Ada Lovelace' }]] }];

describe('OdbReportListScreen and OdbReportDetailScreen', () => {
  it("reaches the report list from the table list with 'r', showing the report's own data source and counts", async () => {
    const { lastFrame, stdin } = render(<OdbHarness tables={SAMPLE_TABLES} reports={REPORTS} />);
    const tableFrame = await waitForFrame(lastFrame, (candidate) => candidate.includes('SALES'));
    expect(tableFrame).toContain('r for reports (1)');
    await settle();

    stdin.write('r');

    const frame = await waitForFrame(lastFrame, (candidate) => candidate.includes('Reports (1 of 1)'));
    expect(frame).toContain('SalesByRegion [reports/Obj11] -- on query "HighValueSales", 2 groups, 13 elements');
  });

  it("opens a report's own band structure on Enter, with its nested groups and rpt: formulas", async () => {
    const { lastFrame, stdin } = render(<OdbHarness tables={SAMPLE_TABLES} reports={REPORTS} />);
    await waitForFrame(lastFrame, (candidate) => candidate.includes('SALES'));
    await settle();
    stdin.write('r');
    await waitForFrame(lastFrame, (candidate) => candidate.includes('Reports (1 of 1)'));
    await settle();

    stdin.write('\r');

    const frame = await waitForFrame(lastFrame, (candidate) => candidate.includes('data source: query'));
    expect(frame).toContain('reports/Obj11');
    expect(frame).toContain('data source: query "HighValueSales"');
    expect(frame).toContain('report-header "Report Header"');
    expect(frame).toContain('group rpt:HASCHANGED("REGION")');
    expect(frame).toContain('rpt:SUM([AMOUNT])');
  });

  it('says so plainly when the database declares no reports at all', async () => {
    const { lastFrame, stdin } = render(<OdbHarness tables={SAMPLE_TABLES} />);
    await waitForFrame(lastFrame, (candidate) => candidate.includes('SALES'));
    await settle();

    stdin.write('r');

    const frame = await waitForFrame(lastFrame, (candidate) => candidate.includes('Reports (0 of 0)'));
    expect(frame).toContain('This database declares no reports.');
  });
});
