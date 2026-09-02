import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  type DocumentFormat,
  createLocalDocumentConverter,
  documentTreeWithSchema,
  readNativeDocumentTree,
} from "documents.js";
import { inferFormatFromExtension, isDocumentFormat } from "../format";
import { createRuntimeSignal } from "../runtime/abort";
import {
  createDiagnosticReporter,
  createFontSubstitutionReporter,
} from "../runtime/diagnostics";
import {
  EXIT_SUCCESS,
  EXIT_USAGE_ERROR,
  mapErrorToExit,
} from "../runtime/exit-codes";
import { loadProvidedFonts } from "../runtime/fonts";
import { createFilesystemMarkdownImageResolver } from "../runtime/markdown-images";
import {
  readInput,
  resolveDefaultOutputPath,
  writeOutput,
} from "../runtime/io";

// Every DocumentFormat this CLI's commands know how to name in a usage error -- shared between the generic `convert` command (commands/convert.ts) and `from-package` (commands/from-package.ts), the two commands whose target format is not already fixed by their own name.
export const KNOWN_DOCUMENT_FORMATS =
  "docx, pptx, xlsx, odt, odp, ods, odg, svg, odf, csv, markdown, pdf";

// Resolves a target DocumentFormat the same way for both callers above: an explicit --to always wins (it is the caller stating intent unambiguously), falling back to the output path's own extension, and finally failing with a usage error naming exactly what is missing.
export function resolveTargetFormat(
  output: string | undefined,
  out: string | undefined,
  to: string | undefined,
): { readonly format: DocumentFormat } | { readonly errorMessage: string } {
  if (to !== undefined) {
    if (!isDocumentFormat(to)) {
      return {
        errorMessage: `unknown --to format '${to}'; expected one of ${KNOWN_DOCUMENT_FORMATS}`,
      };
    }
    return { format: to };
  }
  const destination = output ?? out;
  if (destination === undefined) {
    return {
      errorMessage:
        "cannot infer a target format -- pass an output path with a recognised extension, --out with one, or --to <format>",
    };
  }
  const inferred = inferFormatFromExtension(destination);
  if (inferred === undefined) {
    return {
      errorMessage: `cannot infer a target format from '${destination}'; pass --to <format> instead`,
    };
  }
  return { format: inferred };
}

export interface ConversionCommandOptions {
  readonly out?: string;
  readonly timeoutMs?: number;
  readonly json: boolean;
  readonly quiet: boolean;
  readonly verbose: boolean;
  readonly dumpPackage?: string;
  // Both absent on a command addFontOptions (commands/options.ts) was never applied to -- a pdf-to-<format> reconstruction or a format-to-format bridge, neither of which resolves a typeface at all.
  readonly fontFiles?: readonly string[];
  readonly reportFontSubstitutions?: boolean;
  // The csv/svg edge selections from commands/options.ts's own SelectionCliFlags -- threaded straight into the port's own ConversionOptions, which passes them only to the edges that read them (a csv read/write delimiter and sheet pick, an svg write page pick). Undefined on a pair with no csv or svg edge, where the port has nothing to hand them to.
  readonly delimiter?: string;
  readonly sheet?: string;
  readonly page?: number;
}

// One clean line for a human, with a full stack trace appended only under --verbose -- a bare stack trace on every failure is noise for the common "wrong file" case, but indispensable when actually debugging this CLI itself.
export function formatError(error: unknown, verbose: boolean): string {
  if (!(error instanceof Error)) {
    return `error: ${String(error)}`;
  }
  const stackClause =
    verbose && error.stack !== undefined ? `\n${error.stack}` : "";
  return `error: ${error.message}${stackClause}`;
}

// The single implementation behind every explicit per-conversion command (docx-to-pdf, pdf-to-docx, ...) and the generic `convert` command -- each just partially applies (source, target) and gets back a ready action function for commander to wire up.
export function buildConversionAction(
  source: DocumentFormat,
  target: DocumentFormat,
): (
  input: string,
  output: string | undefined,
  options: ConversionCommandOptions,
) => Promise<number> {
  const command = `${source}-to-${target}`;

  return async (input, output, options) => {
    if (
      output !== undefined &&
      options.out !== undefined &&
      output !== options.out
    ) {
      process.stderr.write(
        `[${command}] conflicting output destinations: positional '${output}' and --out '${options.out}'\n`,
      );
      return EXIT_USAGE_ERROR;
    }

    const resolvedOutput =
      output ??
      options.out ??
      (input === "-" ? "-" : resolveDefaultOutputPath(input, target));
    const { signal, getAbortReason } = createRuntimeSignal({
      timeoutMs: options.timeoutMs,
    });

    try {
      const inputBytes = await readInput(input, { signal });
      // Loaded before the conversion rather than lazily inside it: a mistyped --font-file path should fail before any work is done, and documents.js's own conversion functions are synchronous, so there is no point at which they could await a file read of their own.
      const fonts = await loadProvidedFonts(options.fontFiles ?? [], {
        signal,
      });
      // Resolve a markdown source's own non-data: image destinations against the input file's directory, so `convert notes.md` embeds `![](./image.png)` rather than degrading it to alt text. Ignored by every non-markdown conversion, so wiring it unconditionally is a no-op for docx/pptx/odt/... sources. For stdin (`-`) the base directory is the current working directory. Shared between the real conversion below and, when --dump-package is set, the separate native-tree read -- both read the identical source bytes, so a markdown source resolves its images identically either way.
      const images = createFilesystemMarkdownImageResolver(
        input === "-" ? "." : dirname(resolve(input)),
      );
      const converter = createLocalDocumentConverter();
      const result = await converter.convert(
        {
          source: { format: source, bytes: new Uint8Array(inputBytes) },
          targetFormat: target,
        },
        {
          signal,
          fonts,
          // Only wired under the flag: without it, every substitution is still reported through result.diagnostics below (the local converter records one whether or not a callback was supplied), so an unconditional callback here would print the same event twice.
          onFontSubstitution:
            options.reportFontSubstitutions === true
              ? createFontSubstitutionReporter({
                  json: options.json,
                  quiet: options.quiet,
                  command,
                })
              : undefined,
          images,
          delimiter: options.delimiter,
          sheet: options.sheet,
          page: options.page,
        },
      );

      await writeOutput(resolvedOutput, result.document.bytes);

      const reporter = createDiagnosticReporter({
        json: options.json,
        quiet: options.quiet,
        command,
      });
      for (const diagnostic of result.diagnostics) {
        reporter.report(diagnostic);
      }

      if (options.dumpPackage !== undefined) {
        // Reads the SOURCE's own native tree directly, rather than trusting result.package/onDocument's report -- the intermediate hop that actually produced `target`'s bytes, which can be a lossy cross-variant bridge's shape for a target sharing no ContentDocument variant with the source (xlsx -> markdown composing through a pdf pivot reports that pivot's wordprocessing-shaped tree, with no sheet/cell/formula/A1 data at all -- ExaDev/documents.js#823). --dump-package is about what the SOURCE document itself carries, regardless of --to, so it always reads that instead. No `sink` here: the real conversion above already reports every diagnostic (including a pdf source's own parse diagnostics) through result.diagnostics, and this second read must not report them a second time.
        const nativeTree = readNativeDocumentTree(
          source,
          new Uint8Array(inputBytes),
          { signal, images },
        );
        // Tagged with its own $schema before serialising, not written raw -- documentFromJson (the read side `from-package` uses to read this file back in) identifies a value's kind and version purely from that URI, so an untagged dump would be unreadable by its own round trip.
        await writeFile(
          options.dumpPackage,
          JSON.stringify(documentTreeWithSchema(nativeTree), undefined, 2),
        );
      }

      reporter.summarize({
        output: resolvedOutput,
        bytes: result.document.bytes.byteLength,
        diagnosticCount: result.diagnostics.length,
      });
      return EXIT_SUCCESS;
    } catch (error) {
      // The one and only catch in this action: every failure from readInput, the converter itself, writeOutput, or the dump-package write lands here, gets one clean stderr line, and maps to an exit code that reflects whether it was interrupted, timed out, or a genuine error.
      process.stderr.write(`${formatError(error, options.verbose)}\n`);
      return mapErrorToExit(error, getAbortReason());
    }
  };
}
