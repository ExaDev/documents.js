import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { InvalidArgumentError, type Command } from "commander";
import { OdmUnresolvedSectionError, odmToPdf } from "documents.js";
import { createRuntimeSignal } from "../runtime/abort";
import {
  createDiagnosticReporter,
  createFontSubstitutionReporter,
  fontSubstitutionToDiagnostic,
  substitutionToDiagnostic,
} from "../runtime/diagnostics";
import {
  EXIT_SUCCESS,
  EXIT_USAGE_ERROR,
  mapErrorToExit,
} from "../runtime/exit-codes";
import { loadProvidedFonts } from "../runtime/fonts";
import {
  readInput,
  resolveDefaultOutputPath,
  writeOutput,
} from "../runtime/io";
import { formatError } from "./shared";
import {
  addFontOptions,
  addJsonOption,
  addOutOption,
  addQuietOption,
  addTimeoutOption,
  addVerboseOption,
  type ConversionCliFlags,
  type FontCliFlags,
} from "./options";

interface OdmCliOptions extends ConversionCliFlags, FontCliFlags {
  readonly chaptersDir?: string;
  readonly chapter: ReadonlyMap<string, string>;
}

// Accumulates repeated --chapter <href>=<file> flags into an href -> local-file-path map -- odmToPdf's own resolveSubDocument callback is synchronous (see OdmToPdfOptions in documents.js's .d.ts), so only the mapping is built here; the actual file read happens lazily inside createResolveSubDocument, once per href odmToPdf actually asks for.
function collectChapterOverride(
  value: string,
  previous: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> {
  const separatorIndex = value.indexOf("=");
  if (separatorIndex === -1) {
    throw new InvalidArgumentError(
      `--chapter must be formatted as <href>=<file>, got '${value}'`,
    );
  }
  const next = new Map(previous);
  next.set(value.slice(0, separatorIndex), value.slice(separatorIndex + 1));
  return next;
}

// odmToPdf's resolveSubDocument is deliberately synchronous (it is called from within a synchronous read pass, not awaited) -- checked first against the exact --chapter <href>=<file> overrides, then against --chapters-dir joined with the href's own basename, in that order, returning undefined (letting odmToPdf's own OdmUnresolvedSectionError collection do its job) when neither resolves.
function createResolveSubDocument(
  overrides: ReadonlyMap<string, string>,
  chaptersDir: string | undefined,
): (href: string) => Uint8Array<ArrayBuffer> | undefined {
  return (href) => {
    const overridePath = overrides.get(href);
    if (overridePath !== undefined) {
      return new Uint8Array(readFileSync(overridePath));
    }
    if (chaptersDir === undefined) {
      return undefined;
    }
    const candidate = join(chaptersDir, basename(href));
    if (!existsSync(candidate)) {
      return undefined;
    }
    return new Uint8Array(readFileSync(candidate));
  };
}

async function runOdmToPdf(
  input: string,
  output: string | undefined,
  options: OdmCliOptions,
): Promise<number> {
  const command = "odm-to-pdf";

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
    (input === "-" ? "-" : resolveDefaultOutputPath(input, "pdf"));
  const { signal, getAbortReason } = createRuntimeSignal({
    timeoutMs: options.timeout,
  });
  const resolveSubDocument = createResolveSubDocument(
    options.chapter,
    options.chaptersDir,
  );
  const reporter = createDiagnosticReporter({
    json: options.json,
    quiet: options.quiet,
    command,
  });
  let diagnosticCount = 0;

  // Routed to the structured live reporter under --report-font-substitutions and to the ordinary diagnostic stream otherwise, which is exactly the pair of channels documents.js's own DocumentConverter port gives every other <format>-to-pdf command -- odm-to-pdf calls odmToPdf directly rather than through that port, so the split is made here instead.
  const reportFontSubstitution =
    options.reportFontSubstitutions === true
      ? createFontSubstitutionReporter({
          json: options.json,
          quiet: options.quiet,
          command,
        })
      : undefined;

  try {
    const inputBytes = await readInput(input, { signal });
    const fonts = await loadProvidedFonts(options.fontFile ?? [], { signal });
    const bytes = odmToPdf(new Uint8Array(inputBytes), {
      signal,
      resolveSubDocument,
      fonts,
      onFontSubstitution: (substitution) => {
        if (reportFontSubstitution !== undefined) {
          reportFontSubstitution(substitution);
          return;
        }
        diagnosticCount += 1;
        reporter.report(fontSubstitutionToDiagnostic(substitution));
      },
      onSubstitution: (substitution, context) => {
        diagnosticCount += 1;
        reporter.report(
          substitutionToDiagnostic(substitution, context.pageIndex),
        );
      },
    });

    await writeOutput(resolvedOutput, bytes);
    reporter.summarize({
      output: resolvedOutput,
      bytes: bytes.byteLength,
      diagnosticCount,
    });
    return EXIT_SUCCESS;
  } catch (error) {
    if (error instanceof OdmUnresolvedSectionError) {
      process.stderr.write(
        `${error.message}\npass --chapters-dir <dir> containing these files, or --chapter <href>=<file>\n`,
      );
      return mapErrorToExit(error, getAbortReason());
    }
    process.stderr.write(`${formatError(error, options.verbose)}\n`);
    return mapErrorToExit(error, getAbortReason());
  }
}

export function registerOdmCommand(program: Command): void {
  const command = program
    .command("odm-to-pdf <input> [output]")
    .description(
      "convert a .odm master document to pdf, resolving each chapter's external .odt reference via --chapters-dir and/or --chapter",
    );
  addOutOption(command);
  addTimeoutOption(command);
  addJsonOption(command);
  addQuietOption(command);
  addVerboseOption(command);
  addFontOptions(command);
  command.option(
    "--chapters-dir <dir>",
    "directory to search for each unresolved chapter href, matched by the href's own basename",
  );
  command.option(
    "--chapter <href>=<file>",
    "resolve one chapter href to a local file explicitly; repeatable",
    collectChapterOverride,
    new Map<string, string>(),
  );
  command.action(
    async (
      input: string,
      output: string | undefined,
      options: OdmCliOptions,
    ) => {
      process.exitCode = await runOdmToPdf(input, output, options);
    },
  );
}
