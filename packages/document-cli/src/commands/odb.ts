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
  readOdbTables,
} from 'documents.js';
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

// Shared by all three odb commands -- OdbNoEmbeddedDataSourceError (no embedded engine at all) and OdbUnsupportedFormatError (a recognised-but-unimplemented HSQLDB script serialisation) can surface from readOdbTables regardless of which command called it, since odb-to-xlsx and odb-tables both extract every table exactly the way odb-to-csv does before either selects or skips a single one.
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

export function registerOdbCommands(program: Command): void {
  registerOdbToXlsxCommand(program);
  registerOdbToCsvCommand(program);
  registerOdbTablesCommand(program);
}
