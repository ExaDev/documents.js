import { basename, dirname, extname, join } from 'node:path';
import { type Command } from 'commander';
import { decodePackage } from 'odf.js';
import {
  OdbNoEmbeddedDataSourceError,
  OdbTableNotFoundError,
  OdbTableNotSpecifiedError,
  OdbUnsupportedFormatError,
  odbToCsv,
  odbToXlsx,
  readOdbForms,
  readOdbReports,
  readOdbTables,
} from 'documents.js';
import { describeOdbForm, describeOdbReport, formatOdbFormLines, formatOdbReportLines, odbFormSummary } from '../odb-structure';
import { createRuntimeSignal } from '../runtime/abort';
import { createDiagnosticReporter } from '../runtime/diagnostics';
import { EXIT_SUCCESS, EXIT_USAGE_ERROR, mapErrorToExit } from '../runtime/exit-codes';
import { readInput, resolveDefaultOutputPath, writeOutput } from '../runtime/io';
import { formatError } from './shared';
import { addJsonOption, addOutOption, addQuietOption, addTimeoutOption, addVerboseOption, type ConversionCliFlags } from './options';

type OdbCliOptions = ConversionCliFlags;

interface OdbToCsvCliOptions extends OdbCliOptions {
  readonly table?: string;
}

type AbortReason = 'interrupt' | 'timeout' | undefined;

// Shared by all five odb commands -- OdbNoEmbeddedDataSourceError (no embedded engine at all) and OdbUnsupportedFormatError (a recognised-but-unimplemented HSQLDB script serialisation) can surface from readOdbTables regardless of which command called it, since odb-to-xlsx and odb-tables both extract every table exactly the way odb-to-csv does before either selects or skips a single one. Neither error can arise from odb-forms/odb-reports at all (a form or report is a static ODF sub-document, resolved with no reference to the database's own storage engine), but they route through this same reporter anyway so an odf.js-level failure reads identically whichever odb command hit it.
function reportOdbError(command: string, error: unknown, verbose: boolean, abortReason: AbortReason): number {
  if (error instanceof OdbNoEmbeddedDataSourceError || error instanceof OdbUnsupportedFormatError) {
    process.stderr.write(`[${command}] ${error.message}\n`);
    return mapErrorToExit(error, abortReason);
  }
  process.stderr.write(`[${command}] ${formatError(error, verbose)}\n`);
  return mapErrorToExit(error, abortReason);
}

// odb-to-csv only: OdbTableNotSpecifiedError/OdbTableNotFoundError are thrown exclusively by odbToCsv's own table selection -- odb-to-xlsx exports every table and odb-tables never selects one, so neither command can ever hit this branch.
function reportOdbCsvError(command: string, error: unknown, verbose: boolean, abortReason: AbortReason): number {
  if (error instanceof OdbTableNotSpecifiedError || error instanceof OdbTableNotFoundError) {
    process.stderr.write(`[${command}] ${error.message}\nrun 'odb-tables' first to see the available tables\n`);
    return mapErrorToExit(error, abortReason);
  }
  return reportOdbError(command, error, verbose, abortReason);
}

// odb-to-csv's own output is genuinely CSV bytes, not one of DocumentFormat's nine members -- resolveDefaultOutputPath (src/runtime/io.ts) is typed against DocumentFormat specifically because every other command in this CLI writes one of those nine formats, so this command needs its own equivalent rather than forcing 'csv' through a type it was never meant to accept.
function resolveDefaultCsvOutputPath(inputPath: string): string {
  const directory = dirname(inputPath);
  const stem = basename(inputPath, extname(inputPath));
  return join(directory, `${stem}.csv`);
}

async function runOdbToXlsx(input: string, output: string | undefined, options: OdbCliOptions): Promise<number> {
  const command = 'odb-to-xlsx';
  if (output !== undefined && options.out !== undefined && output !== options.out) {
    process.stderr.write(`[${command}] conflicting output destinations: positional '${output}' and --out '${options.out}'\n`);
    return EXIT_USAGE_ERROR;
  }
  const resolvedOutput = output ?? options.out ?? (input === '-' ? '-' : resolveDefaultOutputPath(input, 'xlsx'));
  const { signal, getAbortReason } = createRuntimeSignal({ timeoutMs: options.timeout });

  try {
    const inputBytes = await readInput(input, { signal });
    const bytes = odbToXlsx(new Uint8Array(inputBytes), { signal });
    await writeOutput(resolvedOutput, bytes);
    const reporter = createDiagnosticReporter({ json: options.json, quiet: options.quiet, command });
    reporter.summarize({ output: resolvedOutput, bytes: bytes.byteLength, diagnosticCount: 0 });
    return EXIT_SUCCESS;
  } catch (error) {
    return reportOdbError(command, error, options.verbose, getAbortReason());
  }
}

async function runOdbToCsv(input: string, output: string | undefined, options: OdbToCsvCliOptions): Promise<number> {
  const command = 'odb-to-csv';
  if (output !== undefined && options.out !== undefined && output !== options.out) {
    process.stderr.write(`[${command}] conflicting output destinations: positional '${output}' and --out '${options.out}'\n`);
    return EXIT_USAGE_ERROR;
  }
  const resolvedOutput = output ?? options.out ?? (input === '-' ? '-' : resolveDefaultCsvOutputPath(input));
  const { signal, getAbortReason } = createRuntimeSignal({ timeoutMs: options.timeout });

  try {
    const inputBytes = await readInput(input, { signal });
    const bytes = odbToCsv(new Uint8Array(inputBytes), { signal, table: options.table });
    await writeOutput(resolvedOutput, bytes);
    const reporter = createDiagnosticReporter({ json: options.json, quiet: options.quiet, command });
    reporter.summarize({ output: resolvedOutput, bytes: bytes.byteLength, diagnosticCount: 0 });
    return EXIT_SUCCESS;
  } catch (error) {
    return reportOdbCsvError(command, error, options.verbose, getAbortReason());
  }
}

async function runOdbTables(input: string, options: { readonly json: boolean }): Promise<number> {
  const command = 'odb-tables';
  const { signal, getAbortReason } = createRuntimeSignal({});

  try {
    const inputBytes = await readInput(input, { signal });
    const pkg = decodePackage(new Uint8Array(inputBytes));
    const tables = readOdbTables(pkg);

    if (options.json) {
      const summary = tables.map((table) => ({ tableName: table.tableName, columns: table.columns, rowCount: table.rows.length }));
      process.stdout.write(`${JSON.stringify(summary)}\n`);
      return EXIT_SUCCESS;
    }

    for (const table of tables) {
      process.stdout.write(`${table.tableName} (${table.rows.length} row${table.rows.length === 1 ? '' : 's'})\n`);
      for (const column of table.columns) {
        process.stdout.write(`  ${column.name}: ${column.type}\n`);
      }
    }
    return EXIT_SUCCESS;
  } catch (error) {
    return reportOdbError(command, error, false, getAbortReason());
  }
}

// odb-forms and odb-reports both read STRUCTURE, not data: a form's own field-bound controls and a report's own band/group/formula layout live in static ODF sub-documents inside the package, resolved by odf.js without ever consulting the embedded database. That is why neither command needs (or offers) --table, an output path, or any of the conversion flags -- there is nothing to convert and nothing to write, only a structure to print.
async function runOdbForms(input: string, options: { readonly json: boolean }): Promise<number> {
  const command = 'odb-forms';
  const { signal, getAbortReason } = createRuntimeSignal({});

  try {
    const inputBytes = await readInput(input, { signal });
    const forms = readOdbForms(decodePackage(new Uint8Array(inputBytes)));

    if (options.json) {
      process.stdout.write(`${JSON.stringify(forms.map((form) => odbFormSummary(form)))}\n`);
      return EXIT_SUCCESS;
    }

    if (forms.length === 0) {
      process.stdout.write('This database declares no forms.\n');
      return EXIT_SUCCESS;
    }

    for (const form of forms) {
      process.stdout.write(`${describeOdbForm(form)}\n`);
      for (const line of formatOdbFormLines(form)) {
        process.stdout.write(`  ${line}\n`);
      }
    }
    return EXIT_SUCCESS;
  } catch (error) {
    return reportOdbError(command, error, false, getAbortReason());
  }
}

async function runOdbReports(input: string, options: { readonly json: boolean }): Promise<number> {
  const command = 'odb-reports';
  const { signal, getAbortReason } = createRuntimeSignal({});

  try {
    const inputBytes = await readInput(input, { signal });
    const reports = readOdbReports(decodePackage(new Uint8Array(inputBytes)));

    if (options.json) {
      // Unlike a form (whose own `document` field carries the entire parsed sub-document -- see odbFormSummary), an OdbReport carries nothing but its own structure, so it serialises verbatim with no reshaping.
      process.stdout.write(`${JSON.stringify(reports)}\n`);
      return EXIT_SUCCESS;
    }

    if (reports.length === 0) {
      process.stdout.write('This database declares no reports.\n');
      return EXIT_SUCCESS;
    }

    for (const report of reports) {
      process.stdout.write(`${describeOdbReport(report)}\n`);
      for (const line of formatOdbReportLines(report)) {
        process.stdout.write(`  ${line}\n`);
      }
    }
    return EXIT_SUCCESS;
  } catch (error) {
    return reportOdbError(command, error, false, getAbortReason());
  }
}

function registerOdbToXlsxCommand(program: Command): void {
  const command = program.command('odb-to-xlsx <input> [output]').description('extract every table an embedded .odb database declares into one xlsx workbook, one sheet per table');
  addOutOption(command);
  addTimeoutOption(command);
  addJsonOption(command);
  addQuietOption(command);
  addVerboseOption(command);
  command.action(async (input: string, output: string | undefined, options: OdbCliOptions) => {
    process.exitCode = await runOdbToXlsx(input, output, options);
  });
}

function registerOdbToCsvCommand(program: Command): void {
  const command = program.command('odb-to-csv <input> [output]').description('extract exactly one named table from an embedded .odb database as CSV');
  addOutOption(command);
  addTimeoutOption(command);
  addJsonOption(command);
  addQuietOption(command);
  addVerboseOption(command);
  command.option('--table <name>', 'the table to export -- required when the .odb declares more than one table');
  command.action(async (input: string, output: string | undefined, options: OdbToCsvCliOptions) => {
    process.exitCode = await runOdbToCsv(input, output, options);
  });
}

function registerOdbTablesCommand(program: Command): void {
  program
    .command('odb-tables <input>')
    .description('list every table an embedded .odb database declares, with column names/types and row counts')
    .option('--json', 'emit the table list as a JSON array instead of a human-readable report', false)
    .action(async (input: string, options: { readonly json: boolean }) => {
      process.exitCode = await runOdbTables(input, options);
    });
}

function registerOdbFormsCommand(program: Command): void {
  program
    .command('odb-forms <input>')
    .description("list every form an .odb declares, with each form's own data source and its field-bound controls")
    .option('--json', 'emit the form structure as a JSON array instead of a human-readable report', false)
    .action(async (input: string, options: { readonly json: boolean }) => {
      process.exitCode = await runOdbForms(input, options);
    });
}

function registerOdbReportsCommand(program: Command): void {
  program
    .command('odb-reports <input>')
    .description("list every report an .odb declares, with each report's own data-source command, band/group structure, and rpt: formula expressions")
    .option('--json', 'emit the report structure as a JSON array instead of a human-readable report', false)
    .action(async (input: string, options: { readonly json: boolean }) => {
      process.exitCode = await runOdbReports(input, options);
    });
}

export function registerOdbCommands(program: Command): void {
  registerOdbToXlsxCommand(program);
  registerOdbToCsvCommand(program);
  registerOdbTablesCommand(program);
  registerOdbFormsCommand(program);
  registerOdbReportsCommand(program);
}
