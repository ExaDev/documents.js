import { dirname, resolve } from 'node:path';
import { type Command } from 'commander';
import { buildOutline, isOutlineNode, outlineLeafText, type OutlineChild, type OutlineLeaf } from 'document-outline.js';
import { type DocumentFormat, createLocalDocumentConverter } from 'documents.js';
import { inferFormatFromExtension } from '../format';
import { createRuntimeSignal } from '../runtime/abort';
import { createDiagnosticReporter } from '../runtime/diagnostics';
import { EXIT_SUCCESS, EXIT_USAGE_ERROR, mapErrorToExit } from '../runtime/exit-codes';
import { readInput } from '../runtime/io';
import { createFilesystemMarkdownImageResolver } from '../runtime/markdown-images';
import { addDelimiterOption, addQuietOption, addTimeoutOption, addVerboseOption } from './options';
import { KNOWN_DOCUMENT_FORMATS, formatError } from './shared';

// The conversion this command runs exists only for ConversionResult.package -- its output bytes are discarded, since the outline projects over the tree-form DocumentPackage, not over any rendered target. A PDF-bypassing bridge is the cheapest conversion that still populates a package (no layout engine runs), so each of the ten content formats bridges to a sibling it shares a registry entry with; the two formats outside that set each take the one conversion they actually have -- pdf reconstructs through pdf-to-docx (a PDF carries no content tree of its own to read), and odf renders through odf-to-pdf (its only conversion; the outline reads the formula package that conversion builds, not the rendered pages). The target is otherwise incidental: the package a bridge leaves behind is built from the source document's own content, so the outline it feeds is the source document's outline.
const OUTLINE_CONVERSION_TARGET: Readonly<Record<DocumentFormat, DocumentFormat>> = {
  docx: 'odt',
  odt: 'docx',
  markdown: 'docx',
  pptx: 'odp',
  odp: 'pptx',
  xlsx: 'ods',
  ods: 'xlsx',
  csv: 'xlsx',
  odg: 'odp',
  svg: 'odg',
  pdf: 'docx',
  odf: 'pdf',
};

// Two spaces per nesting depth -- the indentation is this command's level rendering. An OutlineNode's own `level` field is the SOURCE's level signal (a heading's headingLevel, a list item's list level, 1 for the synthetic slide/sheet/page groups), deliberately not used for indentation: those scales differ per construct and legitimately coexist (a level-0 list item inside a level-1 slide group), while tree depth is unambiguous and recoverable from the nesting itself.
const INDENT = '  ';

// A leaf's text can carry newlines (a table's own text joins its rows with '\n', a paragraph's runs can span source line breaks), which would break the indentation of every line after the first -- so the text rendering collapses runs of whitespace to single spaces. The --json view keeps the raw text.
function singleLineText(text: string): string {
  return text.replaceAll(/\s+/g, ' ').trim();
}

// The label for a textless leaf's bracket placeholder, discriminated structurally the same way outlineLeafText itself discriminates ('runs' in leaf, 'rows' in leaf, ...): every PackageLeaf arm carries a `kind` literal except the two that do not -- a sheet-anchored embedded object names its discriminator `objectKind`, and a ContentFormula carries no discriminator at all (its mathml payload is its identifying field), so the fall-through arm is exactly the formula leaf and labels itself as such.
function leafKindLabel(leaf: OutlineLeaf): string {
  if ('kind' in leaf) return leaf.kind;
  if ('objectKind' in leaf) return leaf.objectKind;
  return 'formula';
}

// One line per outline entry, groups and leaves alike: a group renders its own label (the heading's text, the list item's text, the "Slide N"/sheet-name/"Page N" label) and recurses into its children one depth deeper; a leaf renders its own text (a paragraph's runs, a table's cell text, an image's alt text, a formula's LaTeX), or its kind in brackets when it carries none (a page break, a vector, an embedded object) -- so the text view never silently drops an entry the JSON view carries. A group whose label is empty (an empty heading, a formula with no LaTeX linearisation) renders as a bare indented line, the honest transcript of an empty label rather than an invented placeholder.
function appendOutlineLines(children: readonly OutlineChild[], depth: number, lines: string[]): void {
  for (const child of children) {
    if (isOutlineNode(child)) {
      lines.push(`${INDENT.repeat(depth)}${singleLineText(child.text)}`);
      appendOutlineLines(child.children, depth + 1, lines);
    } else {
      const text = singleLineText(outlineLeafText(child));
      lines.push(text === '' ? `${INDENT.repeat(depth)}[${leafKindLabel(child)}]` : `${INDENT.repeat(depth)}${text}`);
    }
  }
}

interface OutlineCliOptions {
  readonly timeout?: number;
  readonly json: boolean;
  readonly quiet: boolean;
  readonly verbose: boolean;
  readonly delimiter?: string;
}

async function runOutline(input: string, options: OutlineCliOptions): Promise<number> {
  const command = 'outline';
  const source = inferFormatFromExtension(input);
  if (source === undefined) {
    process.stderr.write(`[${command}] cannot infer a source format from '${input}'; rename the file with a recognised extension (${KNOWN_DOCUMENT_FORMATS})\n`);
    return EXIT_USAGE_ERROR;
  }
  const target = OUTLINE_CONVERSION_TARGET[source];

  const { signal, getAbortReason } = createRuntimeSignal({ timeoutMs: options.timeout });
  const reporter = createDiagnosticReporter({ json: options.json, quiet: options.quiet, command });

  try {
    const inputBytes = await readInput(input, { signal });
    const converter = createLocalDocumentConverter();
    const result = await converter.convert(
      { source: { format: source, bytes: new Uint8Array(inputBytes) }, targetFormat: target },
      {
        signal,
        // Resolved exactly as buildConversionAction resolves the same two options for a live conversion: a markdown source's own non-data: images resolve against the input file's directory rather than degrading to alt text with an unresolved-image diagnostic, and a csv source reads with the caller's --delimiter. Both are threaded only to the edges that read them, so wiring them unconditionally is a no-op for every other source format.
        images: createFilesystemMarkdownImageResolver(input === '-' ? '.' : dirname(resolve(input))),
        delimiter: options.delimiter,
      },
    );

    // The internal conversion's own diagnostics are not swallowed: a pdf reconstruction can report parse warnings and character substitutions, and those belong on stderr exactly as they would on the matching pdf-to-docx command.
    for (const diagnostic of result.diagnostics) {
      reporter.report(diagnostic);
    }

    // The port declares `package` optional (a remote adapter is free to report none), while the local converter this command uses populates one on every conversion -- so an absent package is a broken contract, not a document with an empty outline, and fails loudly instead of printing nothing.
    if (result.package === undefined) {
      throw new Error(`the ${source}-to-${target} conversion produced no intermediate DocumentPackage`);
    }

    const outline = buildOutline(result.package);

    if (options.json) {
      // The tree document-outline.js itself returns, verbatim -- groups as { text, level, children }, leaves as the package leaves they are -- so a consumer can walk it with that package's own isOutlineNode/isOutlineChild guards rather than a CLI-private shape.
      process.stdout.write(`${JSON.stringify(outline, undefined, 2)}\n`);
      return EXIT_SUCCESS;
    }

    const lines: string[] = [];
    appendOutlineLines(outline, 0, lines);
    process.stdout.write(`${lines.join('\n')}\n`);
    return EXIT_SUCCESS;
  } catch (error) {
    process.stderr.write(`[${command}] ${formatError(error, options.verbose)}\n`);
    return mapErrorToExit(error, getAbortReason());
  }
}

// Prints the table-of-contents projection over any readable document -- the first CLI surface over document-outline.js's buildOutline, reached by running the cheapest conversion that leaves a package behind (see OUTLINE_CONVERSION_TARGET) and projecting that package.
export function registerOutlineCommand(program: Command): void {
  const command = program
    .command('outline <input>')
    .description(`print a document's outline -- headings, list items, and slide/sheet/page groups as indented text (${KNOWN_DOCUMENT_FORMATS})`);
  addTimeoutOption(command);
  command.option('--json', 'emit the outline tree as JSON instead of indented text (diagnostics as NDJSON on stderr)', false);
  addQuietOption(command);
  addVerboseOption(command);
  addDelimiterOption(command);
  command.action(async (input: string, options: OutlineCliOptions) => {
    process.exitCode = await runOutline(input, options);
  });
}
