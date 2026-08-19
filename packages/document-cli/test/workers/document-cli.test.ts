import { OdmUnresolvedSectionError, type SqlResultSet } from 'documents.js';
import { describe, expect, it } from 'vitest';
import { EXIT_INPUT_ERROR, EXIT_NEEDS_INFO, mapErrorToExit } from '../../src/runtime/exit-codes';
import { formatSqlResultSetTable } from '../../src/sql-result-format';

// Proves an isomorphic slice of document-cli executes inside a Cloudflare Workers isolate (workerd, via @cloudflare/vitest-pool-workers) with no Node-only API usage. document-cli is a Node application (an Ink/React terminal TUI plus a commander CLI whose entry src/cli.ts dispatches commander programs, lazy-loads React/Ink, and reads process.stdin/stdio/node:fs), so the workerd runtime cannot host its ENTRY at all. The functions exercised here are deliberately the thin wrapper slice that does NOT touch any of those Node-only surfaces: formatSqlResultSetTable (src/sql-result-format.ts, a pure formatter that calls documents.js's hsqldbCellDisplayText per cell over a SqlResultSet) and mapErrorToExit (src/runtime/exit-codes.ts, whose instanceof branches load documents.js's error classes). If either exercised path -- or its documents.js dependency -- touched commander/Ink/process.stdin/stdio/node:fs/Buffer at module top level, the workerd isolate would throw at import rather than these passing.
describe('document-cli isomorphic wrapper slice under the Cloudflare Workers runtime', () => {
  it('formatSqlResultSetTable renders a SqlResultSet through documents.js hsqldbCellDisplayText per cell', () => {
    // A real documents.js SqlResultSet (the shape evaluateSelect returns): two columns, two rows, exercising several ContentCellValue kinds hsqldbCellDisplayText maps to display text. No file, no package, no I/O -- a pure data value fed straight into document-cli's own display formatter, which in turn calls documents.js's hsqldbCellDisplayText once per cell.
    const result: SqlResultSet = {
      columns: ['REGION', 'AMOUNT'],
      rows: [
        [{ kind: 'string', value: 'North' }, { kind: 'currency', value: 1540.5, currency: 'USD' }],
        [{ kind: 'string', value: 'South' }, { kind: 'empty' }],
      ],
    };
    const lines = formatSqlResultSetTable(result);
    // Header line, a rule line of hyphens, one line per row, then a trailing "N row(s)" summary -- the fixed shape formatSqlResultSetTable always emits.
    expect(lines.length).toBe(2 /* header + rule */ + 2 /* rows */ + 1 /* summary */);
    expect(lines[0]).toContain('REGION');
    expect(lines[0]).toContain('AMOUNT');
    // hsqldbCellDisplayText rendered each non-empty cell value into the table rows; the currency cell's display text lands somewhere in the body, the empty cell renders as the empty-string stand-in.
    const body = lines.slice(2, 4).join('\n');
    expect(body).toContain('North');
    expect(body).toContain('South');
    expect(lines[lines.length - 1]).toBe('2 rows');
  });

  it('mapErrorToExit loads documents.js error classes and resolves an instanceof branch to EXIT_NEEDS_INFO', () => {
    // mapErrorToExit's body runs real instanceof checks against documents.js's own error classes (OdmUnresolvedSectionError, PdfParseError, ...) -- constructing one and passing it through exercises those class definitions under workerd without touching commander/Ink/stdio/node:fs. The CLI never spawns and never touches argv here; only the pure error-class -> exit-code mapping runs.
    expect(mapErrorToExit(new OdmUnresolvedSectionError(['../chapter1.odt']), undefined)).toBe(EXIT_NEEDS_INFO);
    // An ordinary error with no abort reason falls through every instanceof branch to the default.
    expect(mapErrorToExit(new Error('unusable input'), undefined)).toBe(EXIT_INPUT_ERROR);
  });
});
