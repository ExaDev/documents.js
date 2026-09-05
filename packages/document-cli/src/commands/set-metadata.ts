import { type Command } from "commander";
import { type MetadataOverrides, setDocumentMetadata } from "documents.js";
import { inferFormatFromExtension } from "../format";
import { createRuntimeSignal } from "../runtime/abort";
import { createDiagnosticReporter } from "../runtime/diagnostics";
import {
  EXIT_SUCCESS,
  EXIT_USAGE_ERROR,
  mapErrorToExit,
} from "../runtime/exit-codes";
import {
  readInput,
  resolveDefaultOutputPath,
  writeOutput,
} from "../runtime/io";
import {
  KNOWN_DOCUMENT_FORMATS,
  formatError,
  resolveTargetFormat,
} from "./shared";
import {
  addJsonOption,
  addOutOption,
  addQuietOption,
  addTimeoutOption,
  addVerboseOption,
  type ConversionCliFlags,
} from "./options";

interface SetMetadataCliOptions extends ConversionCliFlags {
  readonly to?: string;
  readonly setTitle?: string;
  readonly setAuthor?: string;
  readonly setSubject?: string;
  readonly setKeywords?: string;
}

// --set-keywords is one comma-separated flag rather than a repeatable one (matching how a caller would naturally paste a keyword list on a command line), split, trimmed, and with empty entries (a trailing comma, doubled commas) dropped.
function parseKeywords(csv: string): string[] {
  return csv
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

async function runSetMetadata(
  input: string,
  output: string | undefined,
  options: SetMetadataCliOptions,
): Promise<number> {
  const command = "set-metadata";

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

  const target = resolveTargetFormat(output, options.out, options.to);
  if ("errorMessage" in target) {
    process.stderr.write(`[${command}] ${target.errorMessage}\n`);
    return EXIT_USAGE_ERROR;
  }

  const source = inferFormatFromExtension(input);
  if (source === undefined) {
    process.stderr.write(
      `[${command}] cannot infer a source format from '${input}'; rename the file with a recognised extension (${KNOWN_DOCUMENT_FORMATS})\n`,
    );
    return EXIT_USAGE_ERROR;
  }

  const overrides: MetadataOverrides = {
    title: options.setTitle,
    author: options.setAuthor,
    subject: options.setSubject,
    keywords:
      options.setKeywords === undefined
        ? undefined
        : parseKeywords(options.setKeywords),
  };

  const resolvedOutput =
    output ??
    options.out ??
    (input === "-" ? "-" : resolveDefaultOutputPath(input, target.format));
  const { signal, getAbortReason } = createRuntimeSignal({
    timeoutMs: options.timeout,
  });

  try {
    const inputBytes = await readInput(input, { signal });
    // setDocumentMetadata itself routes a docx/docx pair to patching docProps/core.xml directly on the decoded Package rather than rebuilding a fresh package from the ContentDocument -- the fast path that keeps comments, footnotes, header/footer parts, section header/footer references, and numbering (everything readDocxExtras/docx-extras covers) byte-faithful (ExaDev/documents.js#966). This command no longer needs to special-case docx itself: every source/target pair goes through the one entry point, which resolves internally to the lossless docx patch, the pdf direct patch, or the generic rebuild as appropriate.
    const bytes = setDocumentMetadata(
      source,
      target.format,
      new Uint8Array(inputBytes),
      overrides,
      { signal },
    );

    await writeOutput(resolvedOutput, bytes);

    const reporter = createDiagnosticReporter({
      json: options.json,
      quiet: options.quiet,
      command,
    });
    reporter.summarize({
      output: resolvedOutput,
      bytes: bytes.byteLength,
      diagnosticCount: 0,
    });
    return EXIT_SUCCESS;
  } catch (error) {
    process.stderr.write(`${formatError(error, options.verbose)}\n`);
    return mapErrorToExit(error, getAbortReason());
  }
}

export function registerSetMetadataCommand(program: Command): void {
  const command = program
    .command("set-metadata <input> [output]")
    .description(
      "patch a document's own title/author/subject/keywords, leaving every other field and every other flag as-is",
    )
    .addHelpText(
      "after",
      [
        "",
        "Three write paths: a pdf source/target patches the metadata directly on the parsed PDF (writePdf), and a docx source/target",
        "patches docProps/core.xml directly on the decoded package -- both with no layout engine or ContentDocument rebuild involved",
        "at all, so everything else on the page (pdf) or in the package (docx -- comments, footnotes, headers/footers, numbering",
        "definitions included) survives byte-faithful. Every other supported format (pptx, xlsx, odt, odp, ods, odg, markdown, rtf)",
        "rebuilds a fresh package from that format's own ContentDocument instead.",
        "",
        "set-metadata does not convert format -- source and target must match. Run convert/from-package first, then",
        "set-metadata on the result, if you need a different target format.",
      ].join("\n"),
    );
  addOutOption(command);
  addTimeoutOption(command);
  addJsonOption(command);
  addQuietOption(command);
  addVerboseOption(command);
  command.option(
    "--to <format>",
    `target format when it cannot be inferred from the output path (${KNOWN_DOCUMENT_FORMATS})`,
  );
  command.option("--set-title <text>", "set the title field");
  command.option("--set-author <text>", "set the author field");
  command.option("--set-subject <text>", "set the subject field");
  command.option(
    "--set-keywords <csv>",
    "set the keywords field, comma-separated (trimmed, empty entries dropped)",
  );
  command.action(
    async (
      input: string,
      output: string | undefined,
      options: SetMetadataCliOptions,
    ) => {
      process.exitCode = await runSetMetadata(input, output, options);
    },
  );
}
