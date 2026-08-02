import { writeFile } from 'node:fs/promises';
import { type DocumentFormat, createLocalDocumentConverter } from 'documents.js';
import { createRuntimeSignal } from '../runtime/abort';
import { createDiagnosticReporter } from '../runtime/diagnostics';
import { EXIT_SUCCESS, EXIT_USAGE_ERROR, mapErrorToExit } from '../runtime/exit-codes';
import { readInput, resolveDefaultOutputPath, writeOutput } from '../runtime/io';

export interface ConversionCommandOptions {
  readonly out?: string;
  readonly timeoutMs?: number;
  readonly json: boolean;
  readonly quiet: boolean;
  readonly verbose: boolean;
  readonly dumpPackage?: string;
}

// One clean line for a human, with a full stack trace appended only under --verbose -- a bare stack trace on every failure is noise for the common "wrong file" case, but indispensable when actually debugging this CLI itself.
export function formatError(error: unknown, verbose: boolean): string {
  if (!(error instanceof Error)) {
    return `error: ${String(error)}`;
  }
  const stackClause = verbose && error.stack !== undefined ? `\n${error.stack}` : '';
  return `error: ${error.message}${stackClause}`;
}

// The single implementation behind every explicit per-conversion command (docx-to-pdf, pdf-to-docx, ...) and the generic `convert` command -- each just partially applies (source, target) and gets back a ready action function for commander to wire up.
export function buildConversionAction(
  source: DocumentFormat,
  target: DocumentFormat,
): (input: string, output: string | undefined, options: ConversionCommandOptions) => Promise<number> {
  const command = `${source}-to-${target}`;

  return async (input, output, options) => {
    if (output !== undefined && options.out !== undefined && output !== options.out) {
      process.stderr.write(`[${command}] conflicting output destinations: positional '${output}' and --out '${options.out}'\n`);
      return EXIT_USAGE_ERROR;
    }

    const resolvedOutput = output ?? options.out ?? (input === '-' ? '-' : resolveDefaultOutputPath(input, target));
    const { signal, getAbortReason } = createRuntimeSignal({ timeoutMs: options.timeoutMs });

    try {
      const inputBytes = await readInput(input, { signal });
      const converter = createLocalDocumentConverter();
      const result = await converter.convert(
        { source: { format: source, bytes: new Uint8Array(inputBytes) }, targetFormat: target },
        { signal },
      );

      await writeOutput(resolvedOutput, result.document.bytes);

      const reporter = createDiagnosticReporter({ json: options.json, quiet: options.quiet, command });
      for (const diagnostic of result.diagnostics) {
        reporter.report(diagnostic);
      }

      if (options.dumpPackage !== undefined) {
        // Checked generically by presence, never by which (source, target) pair this action was built for -- the six PDF-bypassing bridges and odm/odb never populate `package` at all, and that is exactly the condition this branch already detects.
        if (result.package === undefined) {
          process.stderr.write(`[${command}] this conversion does not produce an intermediate DocumentPackage\n`);
        } else {
          await writeFile(options.dumpPackage, JSON.stringify(result.package, undefined, 2));
        }
      }

      reporter.summarize({ output: resolvedOutput, bytes: result.document.bytes.byteLength, diagnosticCount: result.diagnostics.length });
      return EXIT_SUCCESS;
    } catch (error) {
      // The one and only catch in this action: every failure from readInput, the converter itself, writeOutput, or the dump-package write lands here, gets one clean stderr line, and maps to an exit code that reflects whether it was interrupted, timed out, or a genuine error.
      process.stderr.write(`${formatError(error, options.verbose)}\n`);
      return mapErrorToExit(error, getAbortReason());
    }
  };
}
