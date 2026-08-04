import { type Command } from 'commander';
import { decodePackage, extractSourceFonts, type DocumentFormat, type FontSourcePackage } from 'documents.js';
import { decodePackage as decodeOdfPackage } from 'odf.js';
import { inferFormatFromExtension } from '../format';
import { createRuntimeSignal } from '../runtime/abort';
import { EXIT_SUCCESS, EXIT_USAGE_ERROR, mapErrorToExit } from '../runtime/exit-codes';
import { readInput } from '../runtime/io';
import { formatError } from './shared';

interface FontsCliOptions {
  readonly json: boolean;
}

// The only formats `extractSourceFonts` (documents.js's `src/fonts/registry.ts`) knows how to read a source-embedded face from at all: docx/pptx via OOXML's own fontTable.xml/embeddedFontLst, odt/odp/ods/odg via ODF's own office:font-face-decls. xlsx has no OOXML font-embedding vocabulary of its own; pdf/markdown carry no source-package concept to embed a font declaration in; a standalone .odf formula document embeds only the STIX Two Math font pdf-codec itself carries, never a caller-resolvable face; .odb has no font concept at all.
const FONT_SOURCE_FORMATS: Readonly<Record<'docx' | 'pptx' | 'odt' | 'odp' | 'ods' | 'odg', true>> = {
  docx: true,
  pptx: true,
  odt: true,
  odp: true,
  ods: true,
  odg: true,
};

function isFontSourceFormat(format: DocumentFormat): format is keyof typeof FONT_SOURCE_FORMATS {
  return format in FONT_SOURCE_FORMATS;
}

// docx/pptx dispatch through ooxml.js's own decodePackage (re-exported from documents.js under its own name); odt/odp/ods/odg dispatch through odf.js's decodePackage instead, aliased on import exactly as commands/odb.ts already does to avoid the naming collision between the two same-named functions.
function resolveFontSourcePackage(format: keyof typeof FONT_SOURCE_FORMATS, bytes: Uint8Array<ArrayBuffer>): FontSourcePackage {
  if (format === 'docx' || format === 'pptx') {
    return { kind: format, package: decodePackage(bytes) };
  }
  return { kind: 'odf', package: decodeOdfPackage(bytes) };
}

// ProvidedFont (pdf-codec, re-exported by documents.js) carries `bytes` directly, with no `byteLength` field of its own -- computed here rather than exposing the raw font bytes themselves, which no caller of this command's summary output has asked for and which would bloat --json output by however large the embedded face is.
interface FontFaceSummary {
  readonly family: string;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly byteLength: number;
}

async function runFonts(input: string, options: FontsCliOptions): Promise<number> {
  const command = 'fonts';
  const { signal, getAbortReason } = createRuntimeSignal({});

  try {
    const format = inferFormatFromExtension(input);
    if (format === undefined) {
      process.stderr.write(`[${command}] cannot infer a document format from '${input}'; expected one of docx, pptx, odt, odp, ods, odg\n`);
      return EXIT_USAGE_ERROR;
    }
    if (!isFontSourceFormat(format)) {
      process.stderr.write(`[${command}] '${format}' documents carry no source-embedded font faces this command can extract; expected one of docx, pptx, odt, odp, ods, odg\n`);
      return EXIT_USAGE_ERROR;
    }

    const inputBytes = await readInput(input, { signal });
    const source = resolveFontSourcePackage(format, new Uint8Array(inputBytes));
    const faces = extractSourceFonts(source);
    const summaries: readonly FontFaceSummary[] = faces.map((face) => ({ family: face.family, bold: face.bold, italic: face.italic, byteLength: face.bytes.length }));

    if (options.json) {
      process.stdout.write(`${JSON.stringify(summaries)}\n`);
      return EXIT_SUCCESS;
    }

    if (summaries.length === 0) {
      process.stdout.write('This document embeds no source fonts.\n');
      return EXIT_SUCCESS;
    }
    for (const face of summaries) {
      const style = [face.bold ? 'bold' : undefined, face.italic ? 'italic' : undefined].filter((value) => value !== undefined).join(' ');
      process.stdout.write(`${face.family}${style === '' ? '' : ` (${style})`} -- ${face.byteLength} bytes\n`);
    }
    return EXIT_SUCCESS;
  } catch (error) {
    process.stderr.write(`${formatError(error, false)}\n`);
    return mapErrorToExit(error, getAbortReason());
  }
}

export function registerFontsCommand(program: Command): void {
  program
    .command('fonts <input>')
    .description('list every source-embedded font face a docx/pptx/odt/odp/ods/odg document carries (family, weight/style, byte length)')
    .option('--json', 'emit the face list as a JSON array instead of a human-readable report', false)
    .action(async (input: string, options: FontsCliOptions) => {
      process.exitCode = await runFonts(input, options);
    });
}
