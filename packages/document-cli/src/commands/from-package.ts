import { type Command } from 'commander';
import { UnrecognizedDocumentSchemaError, buildCsvText, buildDocumentBytes, buildSvgText, documentFromJson, documentSchemaKindOf, encodeCsvText, encodeSvgText } from 'documents.js';
import { createRuntimeSignal } from '../runtime/abort';
import { createDiagnosticReporter } from '../runtime/diagnostics';
import { EXIT_INPUT_ERROR, EXIT_SUCCESS, EXIT_USAGE_ERROR, mapErrorToExit } from '../runtime/exit-codes';
import { readInput, resolveDefaultOutputPath, writeOutput } from '../runtime/io';
import { KNOWN_DOCUMENT_FORMATS, formatError, resolveTargetFormat } from './shared';
import { addDelimiterOption, addJsonOption, addOutOption, addPageOption, addQuietOption, addSheetOption, addTimeoutOption, addVerboseOption, type ConversionCliFlags, type SelectionCliFlags } from './options';

interface FromPackageCliOptions extends ConversionCliFlags, SelectionCliFlags {
  readonly to?: string;
}

// Narrowing guard for the old-dump check below, built on `in` rather than an index-signature cast -- formatVersion 1 is the only package version that ever carried a separate layout half, so it alone identifies a pre-documents.js-2.0 dump regardless of whatever the current version constant is.
function isFormatVersionOneRecord(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  if (!('formatVersion' in value)) return false;
  return value.formatVersion === 1;
}

async function runFromPackage(input: string, output: string | undefined, options: FromPackageCliOptions): Promise<number> {
  const command = 'from-package';

  if (output !== undefined && options.out !== undefined && output !== options.out) {
    process.stderr.write(`[${command}] conflicting output destinations: positional '${output}' and --out '${options.out}'\n`);
    return EXIT_USAGE_ERROR;
  }

  const target = resolveTargetFormat(output, options.out, options.to);
  if ('errorMessage' in target) {
    process.stderr.write(`[${command}] ${target.errorMessage}\n`);
    return EXIT_USAGE_ERROR;
  }

  const resolvedOutput = output ?? options.out ?? (input === '-' ? '-' : resolveDefaultOutputPath(input, target.format));
  const { signal, getAbortReason } = createRuntimeSignal({ timeoutMs: options.timeout });

  try {
    const inputBytes = await readInput(input, { signal });
    const text = new TextDecoder('utf-8', { fatal: true }).decode(inputBytes);

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      process.stderr.write(`[${command}] '${input}' is not valid JSON: ${error instanceof Error ? error.message : String(error)}\n`);
      return EXIT_INPUT_ERROR;
    }

    // A dump from formatVersion 1 (documents.js 1.x's package shape: content plus a separate layout half) identifies as a DocumentPackage by its $schema but then fails DocumentPackageSchema.parse with a raw ZodError -- a wall of JSON issues naming neither the version change nor the remedy. Intercepted here for the one wrong-version case a real user hits after upgrading, so the error names the shape change and how to get a current dump; every other structurally invalid tagged package keeps documentFromJson's own ZodError.
    if (documentSchemaKindOf(parsed) === 'DocumentPackage' && isFormatVersionOneRecord(parsed)) {
      process.stderr.write(`[${command}] '${input}' is a DocumentPackage dump at formatVersion 1 (the documents.js 1.x shape: content plus a separate layout half) -- documents.js 2.0.0 replaced it with formatVersion 2 (content carrying its own rendered frames, plus page sizes); re-run the source conversion with --dump-package to write a current dump\n`);
      return EXIT_INPUT_ERROR;
    }

    const result = documentFromJson(parsed);
    if (result.kind !== 'DocumentPackage') {
      process.stderr.write(`[${command}] '${input}' is a ${result.kind}, not a DocumentPackage -- only a file written by --dump-package can be read back by this command\n`);
      return EXIT_USAGE_ERROR;
    }

    // csv and svg are the two targets whose codecs take selection options buildDocumentBytes cannot pass (its content.write contract is options-free, so a multi-sheet package would fail CsvSheetNotSpecifiedError with no flag to answer it), so they are built through the identical buildCsvText/buildSvgText functions the codec registry's own write wrappers call, carrying this command's --delimiter/--sheet/--page straight through.
    const bytes =
      target.format === 'csv'
        ? encodeCsvText(buildCsvText(result.value.content, { delimiter: options.delimiter, sheet: options.sheet }))
        : target.format === 'svg'
          ? encodeSvgText(buildSvgText(result.value.content, { page: options.page }))
          : buildDocumentBytes(result.value, target.format);
    await writeOutput(resolvedOutput, bytes);

    const reporter = createDiagnosticReporter({ json: options.json, quiet: options.quiet, command });
    reporter.summarize({ output: resolvedOutput, bytes: bytes.byteLength, diagnosticCount: 0 });
    return EXIT_SUCCESS;
  } catch (error) {
    if (error instanceof UnrecognizedDocumentSchemaError) {
      process.stderr.write(`[${command}] '${input}' has no recognised $schema -- only a file written by --dump-package can be read back by this command\n`);
      return EXIT_INPUT_ERROR;
    }
    process.stderr.write(`${formatError(error, options.verbose)}\n`);
    return mapErrorToExit(error, getAbortReason());
  }
}

// Closes the round trip --dump-package otherwise has no return path for: reads a DocumentPackage JSON file back in via documentFromJson, then exports it to a real target format exactly like an ordinary source-file conversion command would -- --to or the output path's own extension picks the target, matching the generic `convert` command's own resolution order.
export function registerFromPackageCommand(program: Command): void {
  const command = program
    .command('from-package <input> [output]')
    .description('read a DocumentPackage previously written by --dump-package and export it to a real target format');
  addOutOption(command);
  addTimeoutOption(command);
  addJsonOption(command);
  addQuietOption(command);
  addVerboseOption(command);
  // Unconditionally, like the generic `convert` command's own font flags: the target is only known once --to or the output path resolves at run time, and csv/svg are two of the targets it can resolve to.
  addDelimiterOption(command);
  addSheetOption(command);
  addPageOption(command);
  command.option('--to <format>', `target format when it cannot be inferred from the output path (${KNOWN_DOCUMENT_FORMATS})`);
  command.action(async (input: string, output: string | undefined, options: FromPackageCliOptions) => {
    process.exitCode = await runFromPackage(input, output, options);
  });
}
