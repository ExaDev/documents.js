import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgram } from '../program';
import { EXIT_SUCCESS } from '../runtime/exit-codes';
import { FORM_AND_REPORT_ODB_PATH } from '../test-support/odb-fixture';

// Drives the real assembled commander program against the real `.odb` fixture (see test-support/odb-fixture.ts), not the formatting functions in isolation -- that half is covered by src/odb-structure.test.ts. What this file proves is the wiring: that `odb-forms`/`odb-reports` are registered under those names, that each reads and decodes a genuine .odb through odf.js's decodePackage rather than documents.js's OOXML same-named function, that the structure reaches stdout, and that `--json` emits parseable JSON of the same structure. `createProgram()` never parses argv or exits by itself (see program.ts), so calling `parseAsync` here is the whole command path minus the bin's own process wiring.

// Commander's action sets `process.exitCode` on the real process; a command that failed would otherwise leave a non-zero code behind and fail the whole vitest run for reasons unrelated to any assertion here.
let savedExitCode: typeof process.exitCode;

interface CapturedRun {
  readonly exitCode: typeof process.exitCode;
  readonly stdout: string;
  readonly stderr: string;
}

async function runCli(args: readonly string[]): Promise<CapturedRun> {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdoutChunks.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk));
    return true;
  });
  const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderrChunks.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk));
    return true;
  });
  try {
    await createProgram().parseAsync(['node', 'document-cli', ...args]);
  } finally {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  }
  return { exitCode: process.exitCode, stdout: stdoutChunks.join(''), stderr: stderrChunks.join('') };
}

beforeEach(() => {
  savedExitCode = process.exitCode;
});

afterEach(() => {
  process.exitCode = savedExitCode;
});

describe('odb-forms', () => {
  it("prints the fixture's own form, its table command, and every bound control", async () => {
    const { exitCode, stdout, stderr } = await runCli(['odb-forms', FORM_AND_REPORT_ODB_PATH]);

    expect(stderr).toBe('');
    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(stdout).toContain('SalesForm [forms/Obj11] -- 1 form, 6 controls (5 bound)');
    expect(stdout).toContain('form SalesForm on table "SALES"');
    expect(stdout).toContain('form:text txtCustomer -> CUSTOMER');
    expect(stdout).toContain('form:listbox lstQuarter -> QUARTER');
    // The sub-form sits on a saved query rather than on its parent's table -- the one structural fact a form reader is most likely to flatten away.
    expect(stdout).toContain('subform HighValueSubForm on query "HighValueSales"');
    expect(stdout).toContain('form:text txtSubCustomer -> CUSTOMER');
  });

  it('emits the same structure as parseable JSON under --json', async () => {
    const { exitCode, stdout } = await runCli(['odb-forms', FORM_AND_REPORT_ODB_PATH, '--json']);

    expect(exitCode).toBe(EXIT_SUCCESS);
    const parsed: unknown = JSON.parse(stdout);
    expect(Array.isArray(parsed)).toBe(true);
    // Asserted against the serialised text rather than by narrowing the parsed `unknown` field by field: this test's subject is the command's stdout, and JSON.parse succeeding above already proves the payload is well-formed JSON.
    expect(stdout).toContain('"name":"SalesForm"');
    expect(stdout).toContain('"href":"forms/Obj11"');
    expect(stdout).toContain('"dataField":"AMOUNT"');
    expect(stdout).toContain('"command":"HighValueSales"');
  });
});

describe('odb-reports', () => {
  it("prints the fixture's own report, its data-source command, band structure, and rpt: formulas", async () => {
    const { exitCode, stdout, stderr } = await runCli(['odb-reports', FORM_AND_REPORT_ODB_PATH]);

    expect(stderr).toBe('');
    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(stdout).toContain('SalesByRegion [reports/Obj11] -- on query "HighValueSales", 2 groups, 13 elements');
    expect(stdout).toContain('data source: query "HighValueSales"');
    expect(stdout).toContain('report-header "Report Header"');
    expect(stdout).toContain('page-header "Page Header"');
    expect(stdout).toContain('detail "Detail"');
    expect(stdout).toContain('report-footer "Report Footer"');
    // A group key is an expression, not a bare column name, and the inner group is keyed on the report's own user-defined function.
    expect(stdout).toContain('group rpt:HASCHANGED("REGION") (sort REGION ascending)');
    expect(stdout).toContain('group rpt:HASCHANGED("LEFT_QUARTER")');
    expect(stdout).toContain('rpt:formatted-text "Formatted field" = rpt:SUM([AMOUNT])');
    expect(stdout).toContain('LEFT_QUARTER = rpt:LEFT([QUARTER];2)');
  });

  it('emits the report verbatim as parseable JSON under --json', async () => {
    const { exitCode, stdout } = await runCli(['odb-reports', FORM_AND_REPORT_ODB_PATH, '--json']);

    expect(exitCode).toBe(EXIT_SUCCESS);
    const parsed: unknown = JSON.parse(stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(stdout).toContain('"name":"SalesByRegion"');
    expect(stdout).toContain('"commandType":"query"');
    expect(stdout).toContain('"formula":"rpt:SUM([AMOUNT])"');
    expect(stdout).toContain('"kind":"detail"');
  });
});
