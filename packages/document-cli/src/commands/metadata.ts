import { type Command } from 'commander';
import {
  type DocumentFormat,
  type LayoutMetadata,
  decodeMarkdownText,
  decodePackage,
  readDocxContent,
  readMarkdownContent,
  readOdfFormulaContent,
  readOdgContent,
  readOdpContent,
  readOdsContent,
  readOdtContent,
  readPdf,
  readPptxContent,
  xlsxToPdf,
} from 'documents.js';
import { decodePackage as decodeOdfPackage } from 'odf.js';
import { inferFormatFromExtension } from '../format';
import { createRuntimeSignal } from '../runtime/abort';
import { EXIT_SUCCESS, EXIT_USAGE_ERROR, mapErrorToExit } from '../runtime/exit-codes';
import { readInput } from '../runtime/io';
import { formatMetadataLines } from '../runtime/metadata-format';
import { KNOWN_DOCUMENT_FORMATS, formatError } from './shared';

interface MetadataCliOptions {
  readonly json: boolean;
}

// Every DocumentFormat this command can pull a LayoutMetadata out of, dispatched by the same extension-inferred source format `convert`'s own generic command uses. docx/pptx read through ooxml.js's decodePackage (documents.js re-exports it under the same name); odt/odp/ods/odg/odf through odf.js's own decodePackage, aliased to keep the two apart at the one call site that needs both; markdown decodes its own UTF-8 byte<->text boundary first, since readMarkdownContent takes a string, not bytes; pdf reads its metadata directly, with no ContentDocument involved at all; xlsx has no readXlsxContent re-exported from documents.js's own public surface (see that package's own README, Architecture section), so it goes through the identical throwaway xlsxToPdf-then-readPdf preview this repo's own TUI already uses to open a .xlsx (src/tui/format/open-document.ts).
function readMetadataForFormat(format: DocumentFormat, bytes: Uint8Array<ArrayBuffer>, signal: AbortSignal | undefined): LayoutMetadata {
  switch (format) {
    case 'docx':
      return readDocxContent(decodePackage(bytes)).metadata;
    case 'pptx':
      return readPptxContent(decodePackage(bytes)).metadata;
    case 'odt':
      return readOdtContent(decodeOdfPackage(bytes)).metadata;
    case 'odp':
      return readOdpContent(decodeOdfPackage(bytes)).metadata;
    case 'ods':
      return readOdsContent(decodeOdfPackage(bytes)).metadata;
    case 'odg':
      return readOdgContent(decodeOdfPackage(bytes)).metadata;
    case 'odf':
      return readOdfFormulaContent(decodeOdfPackage(bytes)).metadata;
    case 'markdown':
      return readMarkdownContent(decodeMarkdownText(bytes)).metadata;
    case 'pdf':
      return readPdf(bytes, { signal }).metadata;
    case 'xlsx':
      return readPdf(xlsxToPdf(bytes, { signal }), { signal }).metadata;
  }
}

async function runMetadata(input: string, options: MetadataCliOptions): Promise<number> {
  const command = 'metadata';
  const source = inferFormatFromExtension(input);
  if (source === undefined) {
    process.stderr.write(`[${command}] cannot infer a source format from '${input}'; rename the file with a recognised extension (${KNOWN_DOCUMENT_FORMATS})\n`);
    return EXIT_USAGE_ERROR;
  }

  const { signal, getAbortReason } = createRuntimeSignal({});

  try {
    const inputBytes = await readInput(input, { signal });
    const metadata = readMetadataForFormat(source, new Uint8Array(inputBytes), signal);

    if (options.json) {
      process.stdout.write(`${JSON.stringify(metadata)}\n`);
      return EXIT_SUCCESS;
    }

    const lines = formatMetadataLines(metadata);
    if (lines.length === 0) {
      process.stdout.write('This document carries no metadata.\n');
      return EXIT_SUCCESS;
    }
    for (const line of lines) {
      process.stdout.write(`${line}\n`);
    }
    return EXIT_SUCCESS;
  } catch (error) {
    process.stderr.write(`[${command}] ${formatError(error, false)}\n`);
    return mapErrorToExit(error, getAbortReason());
  }
}

export function registerMetadataCommand(program: Command): void {
  program
    .command('metadata <input>')
    .description(`print a document's own title/author/subject/keywords/creator/producer/created/modified metadata (${KNOWN_DOCUMENT_FORMATS})`)
    .option('--json', 'emit the metadata as a JSON object instead of a human-readable report', false)
    .action(async (input: string, options: MetadataCliOptions) => {
      process.exitCode = await runMetadata(input, options);
    });
}
