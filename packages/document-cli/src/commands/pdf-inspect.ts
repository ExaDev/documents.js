import { type Command } from 'commander';
import { type LayoutImageAsset, type LayoutItem, layoutDocumentWithSchema, readPdf } from 'documents.js';
import { createRuntimeSignal } from '../runtime/abort';
import { createDiagnosticReporter, pdfDiagnosticToDiagnostic } from '../runtime/diagnostics';
import { mapErrorToExit, EXIT_SUCCESS } from '../runtime/exit-codes';
import { readInput } from '../runtime/io';
import { formatError } from './shared';

interface PdfInspectCliOptions {
  readonly json: boolean;
  readonly full: boolean;
}

function buildItemKindHistogram(items: readonly LayoutItem[]): Map<LayoutItem['kind'], number> {
  const histogram = new Map<LayoutItem['kind'], number>();
  for (const item of items) {
    histogram.set(item.kind, (histogram.get(item.kind) ?? 0) + 1);
  }
  return histogram;
}

function countImagesByFormat(images: Readonly<Record<string, LayoutImageAsset>>): Map<LayoutImageAsset['format'], number> {
  const counts = new Map<LayoutImageAsset['format'], number>();
  for (const asset of Object.values(images)) {
    counts.set(asset.format, (counts.get(asset.format) ?? 0) + 1);
  }
  return counts;
}

function isPresent<T>(entry: readonly [string, T | undefined]): entry is readonly [string, T] {
  return entry[1] !== undefined;
}

// Checks typeof value === 'string', not Array.isArray(value) -- Array.isArray's own lib.es5.d.ts signature (`arg is any[]`) can't narrow a `readonly string[]` out of the else branch (a readonly array isn't assignable to the mutable `any[]` the predicate names, so TypeScript can't exclude it), leaving `value` typed `string | readonly string[]` there regardless of how the check is written. Testing the `string` arm directly narrows correctly in both branches.
function formatMetadataValue(value: string | readonly string[]): string {
  return typeof value === 'string' ? value : value.join(', ');
}

async function runPdfInspect(input: string, options: PdfInspectCliOptions): Promise<number> {
  const command = 'pdf-inspect';
  const { signal, getAbortReason } = createRuntimeSignal({});
  const reporter = createDiagnosticReporter({ json: options.json, quiet: false, command });

  try {
    const inputBytes = await readInput(input, { signal });
    const layout = readPdf(new Uint8Array(inputBytes), {
      signal,
      sink: (diagnostic) => {
        reporter.report(pdfDiagnosticToDiagnostic(diagnostic));
      },
    });

    if (options.full) {
      // Tagged with its own $schema before serialising, not written raw -- documentFromJson (the read side a caller reading this dump back in would use) identifies a value's kind purely from that field, so an untagged dump could not be told apart from a bare, unrelated JSON object, let alone round-tripped back into a LayoutDocument. Matches buildConversionAction's own --dump-package convention (commands/shared.ts).
      process.stdout.write(`${JSON.stringify(layoutDocumentWithSchema(layout), undefined, 2)}\n`);
      return EXIT_SUCCESS;
    }

    const imagesByFormat = countImagesByFormat(layout.images);

    if (options.json) {
      const summary = {
        pageCount: layout.pages.length,
        pages: layout.pages.map((page) => ({
          widthPt: page.widthPt,
          heightPt: page.heightPt,
          itemKinds: Object.fromEntries(buildItemKindHistogram(page.items)),
        })),
        metadata: layout.metadata,
        imagesByFormat: Object.fromEntries(imagesByFormat),
      };
      process.stdout.write(`${JSON.stringify(summary)}\n`);
      return EXIT_SUCCESS;
    }

    process.stdout.write(`${layout.pages.length} page${layout.pages.length === 1 ? '' : 's'}\n`);
    layout.pages.forEach((page, index) => {
      const histogram = buildItemKindHistogram(page.items);
      const histogramText = Array.from(histogram.entries())
        .map(([kind, count]) => `${kind}=${count}`)
        .join(', ');
      process.stdout.write(`  page ${index + 1}: ${page.widthPt}pt x ${page.heightPt}pt${histogramText === '' ? '' : ` (${histogramText})`}\n`);
    });

    const metadataEntries: readonly (readonly [string, string | readonly string[] | undefined])[] = [
      ['title', layout.metadata.title],
      ['author', layout.metadata.author],
      ['subject', layout.metadata.subject],
      ['keywords', layout.metadata.keywords],
      ['creator', layout.metadata.creator],
      ['producer', layout.metadata.producer],
      ['createdIso', layout.metadata.createdIso],
      ['modifiedIso', layout.metadata.modifiedIso],
    ];
    const presentMetadata = metadataEntries.filter(isPresent);
    if (presentMetadata.length > 0) {
      process.stdout.write('metadata:\n');
      for (const [key, value] of presentMetadata) {
        process.stdout.write(`  ${key}: ${formatMetadataValue(value)}\n`);
      }
    }

    if (imagesByFormat.size > 0) {
      process.stdout.write('images:\n');
      for (const [format, count] of imagesByFormat) {
        process.stdout.write(`  ${format}: ${count}\n`);
      }
    }

    return EXIT_SUCCESS;
  } catch (error) {
    process.stderr.write(`${formatError(error, false)}\n`);
    return mapErrorToExit(error, getAbortReason());
  }
}

export function registerPdfInspectCommand(program: Command): void {
  program
    .command('pdf-inspect <input>')
    .description('inspect a PDF: page count, per-page size and item-kind histogram, document metadata, and embedded image formats')
    .option('--json', 'emit the summary as JSON instead of a human-readable report', false)
    .option('--full', 'dump the entire parsed LayoutDocument as JSON instead of a summary', false)
    .action(async (input: string, options: PdfInspectCliOptions) => {
      process.exitCode = await runPdfInspect(input, options);
    });
}
