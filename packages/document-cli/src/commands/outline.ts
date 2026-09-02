import { dirname, resolve } from "node:path";
import { type Command } from "commander";
import {
  buildOutline,
  isOutlineNode,
  outlineLeafText,
  type OutlineChild,
  type OutlineLeaf,
} from "document-outline.js";
import { type DocumentFormat, readNativeDocumentTree } from "documents.js";
import { inferFormatFromExtension, isDocumentFormat } from "../format";
import { createRuntimeSignal } from "../runtime/abort";
import { createDiagnosticReporter } from "../runtime/diagnostics";
import {
  EXIT_SUCCESS,
  EXIT_USAGE_ERROR,
  mapErrorToExit,
} from "../runtime/exit-codes";
import { readInput } from "../runtime/io";
import { createFilesystemMarkdownImageResolver } from "../runtime/markdown-images";
import { addQuietOption, addTimeoutOption, addVerboseOption } from "./options";
import { KNOWN_DOCUMENT_FORMATS, formatError } from "./shared";

// Two spaces per nesting depth -- the indentation is this command's level rendering. An OutlineNode's own `level` field is the SOURCE's level signal (a heading's headingLevel, a list item's list level, 1 for the synthetic slide/sheet/page groups), deliberately not used for indentation: those scales differ per construct and legitimately coexist (a level-0 list item inside a level-1 slide group), while tree depth is unambiguous and recoverable from the nesting itself.
const INDENT = "  ";

// A leaf's text can carry newlines (a table's own text joins its rows with '\n', a paragraph's runs can span source line breaks), which would break the indentation of every line after the first -- so the text rendering collapses runs of whitespace to single spaces. The --json view keeps the raw text.
function singleLineText(text: string): string {
  return text.replaceAll(/\s+/g, " ").trim();
}

// The label for a textless leaf's bracket placeholder, discriminated structurally the same way outlineLeafText itself discriminates ('runs' in leaf, 'rows' in leaf, ...): every TreeLeaf arm carries a `kind` literal except the two that do not -- a sheet-anchored embedded object names its discriminator `objectKind`, and a ContentFormula carries no discriminator at all (its mathml payload is its identifying field), so the fall-through arm is exactly the formula leaf and labels itself as such.
function leafKindLabel(leaf: OutlineLeaf): string {
  if ("kind" in leaf) return leaf.kind;
  if ("objectKind" in leaf) return leaf.objectKind;
  return "formula";
}

// One line per outline entry, groups and leaves alike: a group renders its own label (the heading's text, the list item's text, the "Slide N"/sheet-name/"Page N" label) and recurses into its children one depth deeper; a leaf renders its own text (a paragraph's runs, a table's cell text, an image's alt text, a formula's LaTeX), or its kind in brackets when it carries none (a page break, a vector, an embedded object) -- so the text view never silently drops an entry the JSON view carries. A group whose label is empty (an empty heading, a formula with no LaTeX linearisation) renders as a bare indented line, the honest transcript of an empty label rather than an invented placeholder.
function appendOutlineLines(
  children: readonly OutlineChild[],
  depth: number,
  lines: string[],
): void {
  for (const child of children) {
    if (isOutlineNode(child)) {
      lines.push(`${INDENT.repeat(depth)}${singleLineText(child.text)}`);
      appendOutlineLines(child.children, depth + 1, lines);
    } else {
      const text = singleLineText(outlineLeafText(child));
      lines.push(
        text === ""
          ? `${INDENT.repeat(depth)}[${leafKindLabel(child)}]`
          : `${INDENT.repeat(depth)}${text}`,
      );
    }
  }
}

interface OutlineCliOptions {
  readonly timeout?: number;
  readonly json: boolean;
  readonly quiet: boolean;
  readonly verbose: boolean;
  readonly from?: string;
}

// Mirrors resolveTargetFormat's own resolution order (commands/shared.ts), source-side: an explicit --from always wins, falling back to the input path's own extension, and finally a usage error. Extracted as its own function rather than inlined in runOutline because the three failure messages differ by cause (an unrecognised --from value, stdin with nothing to infer from, a real path with no recognised extension) and inlining them would bury that distinction in the try block below.
function resolveSourceFormat(
  input: string,
  from: string | undefined,
): { readonly format: DocumentFormat } | { readonly errorMessage: string } {
  if (from !== undefined) {
    if (!isDocumentFormat(from)) {
      return {
        errorMessage: `unknown --from format '${from}'; expected one of ${KNOWN_DOCUMENT_FORMATS}`,
      };
    }
    return { format: from };
  }
  if (input === "-") {
    return {
      errorMessage: `cannot infer a source format from stdin; pass --from <format> (${KNOWN_DOCUMENT_FORMATS})`,
    };
  }
  const inferred = inferFormatFromExtension(input);
  if (inferred === undefined) {
    return {
      errorMessage: `cannot infer a source format from '${input}'; rename the file with a recognised extension (${KNOWN_DOCUMENT_FORMATS}) or pass --from <format>`,
    };
  }
  return { format: inferred };
}

async function runOutline(
  input: string,
  options: OutlineCliOptions,
): Promise<number> {
  const command = "outline";
  const source = resolveSourceFormat(input, options.from);
  if ("errorMessage" in source) {
    process.stderr.write(`[${command}] ${source.errorMessage}\n`);
    return EXIT_USAGE_ERROR;
  }

  const { signal, getAbortReason } = createRuntimeSignal({
    timeoutMs: options.timeout,
  });
  const reporter = createDiagnosticReporter({
    json: options.json,
    quiet: options.quiet,
    command,
  });

  try {
    const inputBytes = await readInput(input, { signal });

    // Reads the source's own native tree directly -- no bridging conversion, no discarded output bytes. A pdf source's own readPdf parse diagnostics still reach stderr exactly as they would on the matching pdf-to-docx command: `sink` receives the identical PdfDiagnostic shape reporter.report already accepts, so no mapping is needed between the two.
    const tree = readNativeDocumentTree(
      source.format,
      new Uint8Array(inputBytes),
      {
        signal,
        // Resolved exactly as buildConversionAction resolves the same option for a live conversion: a markdown source's own non-data: images resolve against the input file's directory rather than degrading to alt text with an unresolved-image diagnostic. For stdin the base directory is the current working directory, matching buildConversionAction's own stdin handling -- '-' reaches this line now that resolveSourceFormat above requires --from for it rather than failing before this read ever runs.
        images: createFilesystemMarkdownImageResolver(
          input === "-" ? "." : dirname(resolve(input)),
        ),
        sink: (diagnostic) => {
          reporter.report(diagnostic);
        },
      },
    );

    const outline = buildOutline(tree);

    if (options.json) {
      // The tree document-outline.js itself returns, verbatim -- groups as { text, level, children }, leaves as the package leaves they are -- so a consumer can walk it with that package's own isOutlineNode/isOutlineChild guards rather than a CLI-private shape.
      process.stdout.write(`${JSON.stringify(outline, undefined, 2)}\n`);
      return EXIT_SUCCESS;
    }

    const lines: string[] = [];
    appendOutlineLines(outline, 0, lines);
    // An empty document (no groups, no leaves) has nothing to print -- joining an empty array still needs the trailing newline suppressed, or stdout would carry one blank line for a document with no outline at all.
    if (lines.length > 0) {
      process.stdout.write(`${lines.join("\n")}\n`);
    }
    return EXIT_SUCCESS;
  } catch (error) {
    process.stderr.write(
      `[${command}] ${formatError(error, options.verbose)}\n`,
    );
    return mapErrorToExit(error, getAbortReason());
  }
}

// Prints the table-of-contents projection over any readable document -- the first CLI surface over document-outline.js's buildOutline, reached by reading the source's own native DocumentTree (readNativeDocumentTree, documents.js) and projecting that tree, with no bridging conversion and no discarded output bytes.
export function registerOutlineCommand(program: Command): void {
  const command = program
    .command("outline <input>")
    .description(
      `print a document's outline -- headings, list items, and slide/sheet/page groups as indented text (${KNOWN_DOCUMENT_FORMATS})`,
    );
  addTimeoutOption(command);
  command.option(
    "--json",
    "emit the outline tree as JSON instead of indented text (diagnostics as NDJSON on stderr)",
    false,
  );
  addQuietOption(command);
  addVerboseOption(command);
  command.option(
    "--from <format>",
    `source format when it cannot be inferred from the input path, e.g. reading from stdin (${KNOWN_DOCUMENT_FORMATS})`,
  );
  command.action(async (input: string, options: OutlineCliOptions) => {
    process.exitCode = await runOutline(input, options);
  });
}
