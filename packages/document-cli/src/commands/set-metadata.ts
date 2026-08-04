import { type Command } from 'commander';
import {
  type ContentDocument,
  type DocumentFormat,
  type LayoutDocument,
  type LayoutMetadata,
  buildDocxPackage,
  buildMarkdownText,
  buildOdgPackage,
  buildOdpPackage,
  buildOdsPackage,
  buildOdtPackage,
  buildPptxPackage,
  decodeMarkdownText,
  decodePackage,
  encodeMarkdownText,
  encodePackage,
  readDocxContent,
  readMarkdownContent,
  readOdgContent,
  readOdpContent,
  readOdsContent,
  readOdtContent,
  readPdf,
  readPptxContent,
  writePdf,
} from 'documents.js';
import { decodePackage as decodeOdfPackage, encodePackage as encodeOdfPackage } from 'odf.js';
import { inferFormatFromExtension } from '../format';
import { createRuntimeSignal } from '../runtime/abort';
import { createDiagnosticReporter } from '../runtime/diagnostics';
import { EXIT_SUCCESS, EXIT_USAGE_ERROR, mapErrorToExit } from '../runtime/exit-codes';
import { readInput, resolveDefaultOutputPath, writeOutput } from '../runtime/io';
import { KNOWN_DOCUMENT_FORMATS, formatError, resolveTargetFormat } from './shared';
import { addJsonOption, addOutOption, addQuietOption, addTimeoutOption, addVerboseOption, type ConversionCliFlags } from './options';

interface SetMetadataCliOptions extends ConversionCliFlags {
  readonly to?: string;
  readonly setTitle?: string;
  readonly setAuthor?: string;
  readonly setSubject?: string;
  readonly setKeywords?: string;
}

// Every format whose own ContentDocument this command can patch a metadata field on and rebuild from scratch through -- the seven formats sharing the readXContent -> buildXPackage round trip. Deliberately does NOT include 'pdf': a PDF's metadata is patched directly on its own LayoutDocument (see runSetMetadata below), never through this ContentDocument rebuild path at all.
const REBUILD_FORMATS: Readonly<Record<'docx' | 'pptx' | 'odt' | 'odp' | 'ods' | 'odg' | 'markdown', true>> = {
  docx: true,
  pptx: true,
  odt: true,
  odp: true,
  ods: true,
  odg: true,
  markdown: true,
};

type RebuildFormat = keyof typeof REBUILD_FORMATS;

function isRebuildFormat(format: DocumentFormat): format is RebuildFormat {
  return format in REBUILD_FORMATS;
}

function readContentForFormat(format: RebuildFormat, bytes: Uint8Array<ArrayBuffer>): ContentDocument {
  switch (format) {
    case 'docx':
      return readDocxContent(decodePackage(bytes));
    case 'pptx':
      return readPptxContent(decodePackage(bytes));
    case 'odt':
      return readOdtContent(decodeOdfPackage(bytes));
    case 'odp':
      return readOdpContent(decodeOdfPackage(bytes));
    case 'ods':
      return readOdsContent(decodeOdfPackage(bytes));
    case 'odg':
      return readOdgContent(decodeOdfPackage(bytes));
    case 'markdown':
      return readMarkdownContent(decodeMarkdownText(bytes));
  }
}

function buildBytesForRebuildFormat(format: RebuildFormat, content: ContentDocument): Uint8Array {
  switch (format) {
    case 'docx':
      return encodePackage(buildDocxPackage(content));
    case 'pptx':
      return encodePackage(buildPptxPackage(content));
    case 'odt':
      return encodeOdfPackage(buildOdtPackage(content));
    case 'odp':
      return encodeOdfPackage(buildOdpPackage(content));
    case 'ods':
      return encodeOdfPackage(buildOdsPackage(content));
    case 'odg':
      return encodeOdfPackage(buildOdgPackage(content));
    case 'markdown':
      return encodeMarkdownText(buildMarkdownText(content));
  }
}

interface MetadataOverrides {
  readonly title?: string;
  readonly author?: string;
  readonly subject?: string;
  // Mutable, matching LayoutMetadataSchema's own `keywords?: string[]` (document-schema.js) -- mergeMetadata's return must satisfy that shape exactly, and a `readonly string[]` here would not.
  readonly keywords?: string[];
}

// Object-spreads the current metadata with only the overrides the caller actually passed a flag for -- an absent flag leaves that one field exactly as the source document already had it, rather than clearing it. Each override is its own conditional spread (not a bare `title: overrides.title ?? current.title`) so a flag that was never given cannot be told apart from one explicitly given an empty string; commander only ever produces `undefined` for a flag not passed, never `''`, so this distinction is real, not theoretical.
function mergeMetadata(current: LayoutMetadata, overrides: MetadataOverrides): LayoutMetadata {
  return {
    ...current,
    ...(overrides.title !== undefined ? { title: overrides.title } : {}),
    ...(overrides.author !== undefined ? { author: overrides.author } : {}),
    ...(overrides.subject !== undefined ? { subject: overrides.subject } : {}),
    ...(overrides.keywords !== undefined ? { keywords: overrides.keywords } : {}),
  };
}

// --set-keywords is one comma-separated flag rather than a repeatable one (matching how a caller would naturally paste a keyword list on a command line), split, trimmed, and with empty entries (a trailing comma, doubled commas) dropped.
function parseKeywords(csv: string): string[] {
  return csv
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

type WritePath = { readonly kind: 'pdf' } | { readonly kind: 'rebuild'; readonly format: RebuildFormat } | { readonly errorMessage: string };

// set-metadata deliberately does not convert format: its own job is patching metadata in place, not choosing a target format, so source and target must resolve to the identical format -- 'pdf' direct-patches its own LayoutDocument (no ContentDocument, no layout engine, genuinely lossless for everything else on the page), every other REBUILD_FORMATS member rebuilds a fresh package from its own ContentDocument (lossy wherever that format's own build function is -- see buildDocxPackage's own docx-extras gotcha, restated in this command's --help text below). xlsx and odf are rejected outright in both directions: xlsx because documents.js does not re-export a ContentDocument-to-xlsx builder (mirroring from-package.ts's own rejection), odf (a standalone formula document) because it has no write path back out at all, matching from-package.ts's own reasoning for both. A caller wanting to change format and metadata together should run `convert`/`from-package` first, then set-metadata on the result.
function classifyWritePath(source: DocumentFormat, target: DocumentFormat): WritePath {
  if (source === 'pdf' && target === 'pdf') {
    return { kind: 'pdf' };
  }
  if (target === 'xlsx' || source === 'xlsx') {
    return { errorMessage: "'xlsx' is not a supported set-metadata source or target -- documents.js does not re-export a ContentDocument-to-xlsx builder or a readXlsxContent from its own public surface (see that package's own README, Architecture section); convert with 'xlsx-to-ods'/'ods-to-xlsx' first, then set metadata on the ods" };
  }
  if (target === 'odf' || source === 'odf') {
    return { errorMessage: "'odf' (a standalone formula document) is not a supported set-metadata source or target -- it has no write path back out at all" };
  }
  if (!isRebuildFormat(source) || !isRebuildFormat(target)) {
    return { errorMessage: `set-metadata only patches metadata in place; it does not convert format -- source ('${source}') and target ('${target}') must be the same format (or both 'pdf'). Run 'convert'/'from-package' first if you need a different target format.` };
  }
  if (source !== target) {
    return { errorMessage: `set-metadata only patches metadata in place; it does not convert format -- source ('${source}') and target ('${target}') must be the same format. Run 'convert'/'from-package' first if you need a different target format.` };
  }
  return { kind: 'rebuild', format: source };
}

async function runSetMetadata(input: string, output: string | undefined, options: SetMetadataCliOptions): Promise<number> {
  const command = 'set-metadata';

  if (output !== undefined && options.out !== undefined && output !== options.out) {
    process.stderr.write(`[${command}] conflicting output destinations: positional '${output}' and --out '${options.out}'\n`);
    return EXIT_USAGE_ERROR;
  }

  const target = resolveTargetFormat(output, options.out, options.to);
  if ('errorMessage' in target) {
    process.stderr.write(`[${command}] ${target.errorMessage}\n`);
    return EXIT_USAGE_ERROR;
  }

  const source = inferFormatFromExtension(input);
  if (source === undefined) {
    process.stderr.write(`[${command}] cannot infer a source format from '${input}'; rename the file with a recognised extension (${KNOWN_DOCUMENT_FORMATS})\n`);
    return EXIT_USAGE_ERROR;
  }

  const writePath = classifyWritePath(source, target.format);
  if ('errorMessage' in writePath) {
    process.stderr.write(`[${command}] ${writePath.errorMessage}\n`);
    return EXIT_USAGE_ERROR;
  }

  const overrides: MetadataOverrides = {
    title: options.setTitle,
    author: options.setAuthor,
    subject: options.setSubject,
    keywords: options.setKeywords === undefined ? undefined : parseKeywords(options.setKeywords),
  };

  const resolvedOutput = output ?? options.out ?? (input === '-' ? '-' : resolveDefaultOutputPath(input, target.format));
  const { signal, getAbortReason } = createRuntimeSignal({ timeoutMs: options.timeout });

  try {
    const inputBytes = await readInput(input, { signal });

    const bytes =
      writePath.kind === 'pdf'
        ? (() => {
            const layout = readPdf(new Uint8Array(inputBytes), { signal });
            const patched: LayoutDocument = { ...layout, metadata: mergeMetadata(layout.metadata, overrides) };
            return writePdf(patched, { signal });
          })()
        : (() => {
            const content = readContentForFormat(writePath.format, new Uint8Array(inputBytes));
            const nextContent: ContentDocument = { ...content, metadata: mergeMetadata(content.metadata, overrides) };
            return buildBytesForRebuildFormat(writePath.format, nextContent);
          })();

    await writeOutput(resolvedOutput, bytes);

    const reporter = createDiagnosticReporter({ json: options.json, quiet: options.quiet, command });
    reporter.summarize({ output: resolvedOutput, bytes: bytes.byteLength, diagnosticCount: 0 });
    return EXIT_SUCCESS;
  } catch (error) {
    process.stderr.write(`${formatError(error, options.verbose)}\n`);
    return mapErrorToExit(error, getAbortReason());
  }
}

export function registerSetMetadataCommand(program: Command): void {
  const command = program
    .command('set-metadata <input> [output]')
    .description("patch a document's own title/author/subject/keywords, leaving every other field and every other flag as-is")
    .addHelpText(
      'after',
      [
        '',
        'Two write paths: a pdf source/target patches the metadata directly on the parsed PDF (writePdf), with no layout engine',
        'involved at all -- genuinely lossless for everything else on the page. Every other supported format (docx, pptx, odt,',
        'odp, ods, odg, markdown) rebuilds a fresh package from that format\'s own ContentDocument -- for docx specifically,',
        'this is LOSSY: it drops anything docx-extras covers (comments, footnotes, headers/footers, numbering definitions),',
        'since buildDocxPackage builds a fresh package from the ContentDocument alone, with no way to carry that data through.',
        '',
        'set-metadata does not convert format -- source and target must match. Run convert/from-package first, then',
        'set-metadata on the result, if you need a different target format.',
      ].join('\n'),
    );
  addOutOption(command);
  addTimeoutOption(command);
  addJsonOption(command);
  addQuietOption(command);
  addVerboseOption(command);
  command.option('--to <format>', `target format when it cannot be inferred from the output path (${KNOWN_DOCUMENT_FORMATS})`);
  command.option('--set-title <text>', 'set the title field');
  command.option('--set-author <text>', 'set the author field');
  command.option('--set-subject <text>', 'set the subject field');
  command.option('--set-keywords <csv>', 'set the keywords field, comma-separated (trimmed, empty entries dropped)');
  command.action(async (input: string, output: string | undefined, options: SetMetadataCliOptions) => {
    process.exitCode = await runSetMetadata(input, output, options);
  });
}
