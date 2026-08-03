import { type Command } from 'commander';
import {
  type DocumentFormat,
  type DocumentPackage,
  UnrecognizedDocumentSchemaError,
  buildDocxPackage,
  buildMarkdownText,
  buildOdgPackage,
  buildOdpPackage,
  buildOdsPackage,
  buildOdtPackage,
  buildPptxPackage,
  documentFromJson,
  encodeMarkdownText,
  encodePackage,
  writePdf,
} from 'documents.js';
import { encodePackage as encodeOdfPackage } from 'odf.js';
import { createRuntimeSignal } from '../runtime/abort';
import { createDiagnosticReporter } from '../runtime/diagnostics';
import { EXIT_INPUT_ERROR, EXIT_SUCCESS, EXIT_USAGE_ERROR, mapErrorToExit } from '../runtime/exit-codes';
import { readInput, resolveDefaultOutputPath, writeOutput } from '../runtime/io';
import { KNOWN_DOCUMENT_FORMATS, formatError, resolveTargetFormat } from './shared';
import { addJsonOption, addOutOption, addQuietOption, addTimeoutOption, addVerboseOption, type ConversionCliFlags } from './options';

interface FromPackageCliOptions extends ConversionCliFlags {
  readonly to?: string;
}

// Every target this command can build a DocumentPackage into, and how: 'pdf' writes the package's own LayoutDocument half directly (no font registry, no positioned formulas -- neither survives the JSON round trip, since both are side channels a DocumentPackage never carries, so a formula renders as nothing and an embedded font falls back to the standard 14 or a vendored substitute; see the documents.js README's own DocumentPackage gotcha), everything else builds a fresh package from the ContentDocument half through the identical buildXPackage function the matching pdf-to-X/bridge conversion already uses, then encodes it with that format's own codec (ooxml.js's for docx/pptx, odf.js's for odt/odp/ods/odg). 'xlsx' and 'odf' have no builder at all -- documents.js deliberately never re-exports ooxml.js's buildXlsxPackage (see the README's own Architecture note), and a formula document has no write path from ContentDocument to begin with -- so both are rejected outright rather than attempted.
function buildBytesForTarget(pkg: DocumentPackage, target: DocumentFormat): Uint8Array {
  if (target === 'pdf') {
    if (pkg.layout === undefined) {
      throw new Error("this DocumentPackage has no layout -- only a package dumped from a <format>-to-pdf or pdf-to-<format> conversion carries one; a bridge conversion's own dump (e.g. odt-to-docx) never does, so 'pdf' is not a reachable target from it");
    }
    return writePdf(pkg.layout);
  }
  switch (target) {
    case 'docx':
      return encodePackage(buildDocxPackage(pkg.content));
    case 'pptx':
      return encodePackage(buildPptxPackage(pkg.content));
    case 'odt':
      return encodeOdfPackage(buildOdtPackage(pkg.content));
    case 'odp':
      return encodeOdfPackage(buildOdpPackage(pkg.content));
    case 'ods':
      return encodeOdfPackage(buildOdsPackage(pkg.content));
    case 'odg':
      return encodeOdfPackage(buildOdgPackage(pkg.content));
    case 'markdown':
      return encodeMarkdownText(buildMarkdownText(pkg.content));
    case 'xlsx':
      throw new Error("'xlsx' cannot be built from a DocumentPackage directly -- documents.js does not re-export a ContentDocument-to-xlsx builder; convert to 'ods' here, then run 'ods-to-xlsx' on the result instead");
    case 'odf':
      throw new Error("'odf' (a standalone formula document) cannot be built from a DocumentPackage -- there is no ContentDocument-to-odf builder");
  }
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

    const result = documentFromJson(parsed);
    if (result.kind !== 'DocumentPackage') {
      process.stderr.write(`[${command}] '${input}' is a ${result.kind}, not a DocumentPackage -- only a file written by --dump-package can be read back by this command\n`);
      return EXIT_USAGE_ERROR;
    }

    const bytes = buildBytesForTarget(result.value, target.format);
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
  command.option('--to <format>', `target format when it cannot be inferred from the output path (${KNOWN_DOCUMENT_FORMATS})`);
  command.action(async (input: string, output: string | undefined, options: FromPackageCliOptions) => {
    process.exitCode = await runFromPackage(input, output, options);
  });
}
