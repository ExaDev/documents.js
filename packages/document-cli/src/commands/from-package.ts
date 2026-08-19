import { type Command } from 'commander';
import { flattenPackage } from 'document-schema.js';
import { UnrecognizedDocumentSchemaError, buildCsvText, buildDocumentBytes, buildSvgText, documentFromJson, encodeCsvText, encodeSvgText } from 'documents.js';
import { createRuntimeSignal } from '../runtime/abort';
import { createDiagnosticReporter } from '../runtime/diagnostics';
import { EXIT_INPUT_ERROR, EXIT_SUCCESS, EXIT_USAGE_ERROR, mapErrorToExit } from '../runtime/exit-codes';
import { readInput, resolveDefaultOutputPath, writeOutput } from '../runtime/io';
import { KNOWN_DOCUMENT_FORMATS, formatError, resolveTargetFormat } from './shared';
import { addDelimiterOption, addJsonOption, addOutOption, addPageOption, addQuietOption, addSheetOption, addTimeoutOption, addVerboseOption, type ConversionCliFlags, type SelectionCliFlags } from './options';

interface FromPackageCliOptions extends ConversionCliFlags, SelectionCliFlags {
  readonly to?: string;
}

// The two version-refusals documentFromJson throws that documents.js does NOT re-export as classes (it re-exports only UnrecognizedDocumentSchemaError of the three), and this package's dependency surface deliberately reaches siblings through documents.js's own re-exports -- so these are recognised by error.name, each class's stable identity across that boundary, rather than by importing document-schema.js directly. Narrowed through `in` on the fields the message below reads, never an index-signature cast.
interface DumpVersionMismatch {
  readonly name: 'SchemaVersionMismatchError';
  readonly dumpVersion: string;
  readonly installedVersion: string;
}

function isSchemaVersionMismatchError(error: unknown): error is DumpVersionMismatch {
  if (!(error instanceof Error)) return false;
  if (error.name !== 'SchemaVersionMismatchError') return false;
  return 'dumpVersion' in error && 'installedVersion' in error;
}

function isLayoutSchemaDemotedError(error: unknown): boolean {
  return error instanceof Error && error.name === 'LayoutSchemaDemotedError';
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

    // No version intercept ahead of this call any more: documentFromJson's own version gate refuses every pre-4.0.0 dump (its $schema URI pins a document-schema.js release whose major is not the installed one) with SchemaVersionMismatchError, handled readably in the catch below -- the CLI-level formatVersion-1 intercept this command used to carry existed only because the old dispatch had no gate at all and died in DocumentPackageSchema.parse with a raw ZodError wall instead.
    const result = documentFromJson(parsed);
    if (result.kind !== 'DocumentPackage') {
      process.stderr.write(`[${command}] '${input}' is a ${result.kind}, not a DocumentPackage -- only a file written by --dump-package can be read back by this command\n`);
      return EXIT_USAGE_ERROR;
    }

    // csv and svg are the two targets whose codecs take selection options buildDocumentBytes cannot pass (its content.write contract is options-free, so a multi-sheet package would fail CsvSheetNotSpecifiedError with no flag to answer it), so they are built through the identical buildCsvText/buildSvgText functions the codec registry's own write wrappers call, carrying this command's --delimiter/--sheet/--page straight through. Both take the flat ContentDocument, so the tree is flattened once here -- flattenPackage also materialises any minted styles-table refs away, which is exactly what a text builder consuming fully-materialised content needs; every other target hands the tree itself to buildDocumentBytes, which runs the same flatten at its own boundary.
    const content = flattenPackage(result.value);
    const bytes =
      target.format === 'csv'
        ? encodeCsvText(buildCsvText(content, { delimiter: options.delimiter, sheet: options.sheet }))
        : target.format === 'svg'
          ? encodeSvgText(buildSvgText(content, { page: options.page }))
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
    // The version gate's refusal, readably: a pre-4.0.0 dump (any of them now, not just formatVersion 1 -- the flat formatVersion-2 { formatVersion, content, pages } envelope documents.js 2.x wrote is just as unreadable here) names the release it pins, the tree change, and the CLI's own remedy.
    if (isSchemaVersionMismatchError(error)) {
      process.stderr.write(
        `[${command}] '${input}' is a DocumentPackage dump from document-schema.js@${error.dumpVersion}, but this CLI's documents.js reads only @${error.installedVersion}-major dumps -- 4.0.0 replaced the flat { formatVersion, content, pages } shape with the tree-form DocumentPackage (ExaDev/document-schema.js#20); re-run the source conversion with --dump-package to write a current dump\n`,
      );
      return EXIT_INPUT_ERROR;
    }
    // The demotion tombstone: a layout-document dump (a document-schema.js 3.x layoutDocumentWithSchema artefact, e.g. an old pdf-inspect --full output) is not a package and never was -- its schema moved to pdf-codec, and this command's input is the package a conversion's --dump-package writes.
    if (isLayoutSchemaDemotedError(error)) {
      process.stderr.write(`[${command}] '${input}' is a LayoutDocument dump -- LayoutDocument moved to pdf-codec in document-schema.js 4.0.0 and is no longer a schema-stamped input; re-run the source conversion with --dump-package and read that package back instead\n`);
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
