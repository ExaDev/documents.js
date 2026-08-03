import { extname } from 'node:path';
import { type Command } from 'commander';
import { type DocumentFormat, createLocalDocumentConverter } from 'documents.js';
import { inferFormatFromExtension, isDocumentFormat } from '../format';
import { EXIT_USAGE_ERROR } from '../runtime/exit-codes';
import { type ConversionCommandOptions, buildConversionAction } from './shared';
import { addConversionFlags, addDumpPackageOption, addFontOptions, type ConversionCliFlags, type FontCliFlags } from './options';

interface ConvertCliOptions extends ConversionCliFlags, FontCliFlags {
  readonly dumpPackage?: string;
}

interface GenericConvertCliOptions extends ConvertCliOptions {
  readonly to?: string;
}

function toConversionCommandOptions(options: ConvertCliOptions): ConversionCommandOptions {
  return {
    out: options.out,
    timeoutMs: options.timeout,
    json: options.json,
    quiet: options.quiet,
    verbose: options.verbose,
    dumpPackage: options.dumpPackage,
    fontFiles: options.fontFile,
    reportFontSubstitutions: options.reportFontSubstitutions,
  };
}

const KNOWN_FORMATS = 'docx, pptx, xlsx, odt, odp, ods, odg, odf, markdown, pdf';

// Resolves the generic `convert` command's own target format: an explicit --to always wins over an inferred one (an explicit flag is the caller stating intent unambiguously), falling back to the output path's own extension, and finally failing with a usage error naming exactly what is missing.
function resolveGenericTarget(output: string | undefined, options: GenericConvertCliOptions): { readonly format: DocumentFormat } | { readonly errorMessage: string } {
  if (options.to !== undefined) {
    if (!isDocumentFormat(options.to)) {
      return { errorMessage: `unknown --to format '${options.to}'; expected one of ${KNOWN_FORMATS}` };
    }
    return { format: options.to };
  }
  const destination = output ?? options.out;
  if (destination === undefined) {
    return { errorMessage: 'cannot infer a target format -- pass an output path with a recognised extension, --out with one, or --to <format>' };
  }
  const inferred = inferFormatFromExtension(destination);
  if (inferred === undefined) {
    return { errorMessage: `cannot infer a target format from '${destination}'; pass --to <format> instead` };
  }
  return { format: inferred };
}

async function runGenericConvert(input: string, output: string | undefined, options: GenericConvertCliOptions): Promise<number> {
  // A .odm master document and a .odb embedded database are never reachable through the generic ContentDocument/LayoutDocument pivot the rest of this command delegates to -- odmToPdf needs a resolveSubDocument callback and odb's own extraction functions have no DocumentConverter port entry at all (see the documents.js README's own Architecture section), so redirecting here is the only correct response rather than attempting a generic conversion doomed to fail confusingly.
  const extension = extname(input).toLowerCase();
  if (extension === '.odm') {
    process.stderr.write("convert: '.odm' master documents are not supported by the generic convert command -- use 'odm-to-pdf' instead\n");
    return EXIT_USAGE_ERROR;
  }
  if (extension === '.odb') {
    process.stderr.write("convert: '.odb' embedded databases are not supported by the generic convert command -- use 'odb-to-csv', 'odb-to-xlsx', or 'odb-tables' instead\n");
    return EXIT_USAGE_ERROR;
  }

  const source = inferFormatFromExtension(input);
  if (source === undefined) {
    process.stderr.write(`convert: cannot infer a source format from '${input}'; rename the file with a recognised extension (${KNOWN_FORMATS}) or use one of the explicit '<source>-to-<target>' commands\n`);
    return EXIT_USAGE_ERROR;
  }

  const target = resolveGenericTarget(output, options);
  if ('errorMessage' in target) {
    process.stderr.write(`convert: ${target.errorMessage}\n`);
    return EXIT_USAGE_ERROR;
  }

  return buildConversionAction(source, target.format)(input, output, toConversionCommandOptions(options));
}

// Registers every explicit `<source>-to-<target>` command (all twenty-seven pairs createLocalDocumentConverter().conversions declares -- nine `<format>-to-pdf` conversions including the one-way odf-to-pdf, eight `pdf-to-<format>` reverse conversions, and ten PDF-bypassing bridges) plus the generic `convert` command, all delegating to the identical buildConversionAction(source, target) so the conversion logic itself is never duplicated.
export function registerConversionCommands(program: Command): void {
  const { conversions } = createLocalDocumentConverter();

  for (const { source, target } of conversions) {
    const commandName = `${source}-to-${target}`;
    const command = program.command(`${commandName} <input> [output]`).description(`convert a ${source} document to ${target}`);
    addConversionFlags(command);
    addDumpPackageOption(command);
    // Only the <format>-to-pdf half of the table runs a layout engine and resolves a typeface; see addFontOptions's own comment on why the reverse and bridge commands deliberately do not advertise these flags.
    if (target === 'pdf') {
      addFontOptions(command);
    }
    command.action(async (input: string, output: string | undefined, options: ConvertCliOptions) => {
      process.exitCode = await buildConversionAction(source, target)(input, output, toConversionCommandOptions(options));
    });
  }

  const generic = program
    .command('convert <input> [output]')
    .description('convert between any two supported document formats, inferring source/target from file extensions where possible');
  addConversionFlags(generic);
  addDumpPackageOption(generic);
  // Unconditionally here, unlike the explicit per-pair commands above: this command's target is only known once --to or the output path has been resolved at run time, and pdf is one of the targets it resolves to. A run that lands on some other target simply passes fonts the port has nothing to resolve them against, which local.ts already documents as a no-op for a non-layout edge.
  addFontOptions(generic);
  generic.option('--to <format>', `target format when it cannot be inferred from the output path (${KNOWN_FORMATS})`);
  generic.action(async (input: string, output: string | undefined, options: GenericConvertCliOptions) => {
    process.exitCode = await runGenericConvert(input, output, options);
  });
}
