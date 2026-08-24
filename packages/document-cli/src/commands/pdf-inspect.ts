import { type Command } from "commander";
import { type LayoutImageAsset, type LayoutItem, readPdf } from "documents.js";
import { createRuntimeSignal } from "../runtime/abort";
import {
  createDiagnosticReporter,
  pdfDiagnosticToDiagnostic,
} from "../runtime/diagnostics";
import { mapErrorToExit, EXIT_SUCCESS } from "../runtime/exit-codes";
import { readInput } from "../runtime/io";
import {
  formatMetadataLines,
  presentMetadataEntries,
} from "../runtime/metadata-format";
import { formatError } from "./shared";

interface PdfInspectCliOptions {
  readonly json: boolean;
  readonly full: boolean;
}

function buildItemKindHistogram(
  items: readonly LayoutItem[],
): Map<LayoutItem["kind"], number> {
  const histogram = new Map<LayoutItem["kind"], number>();
  for (const item of items) {
    histogram.set(item.kind, (histogram.get(item.kind) ?? 0) + 1);
  }
  return histogram;
}

function countImagesByFormat(
  images: Readonly<Record<string, LayoutImageAsset>>,
): Map<LayoutImageAsset["format"], number> {
  const counts = new Map<LayoutImageAsset["format"], number>();
  for (const asset of Object.values(images)) {
    counts.set(asset.format, (counts.get(asset.format) ?? 0) + 1);
  }
  return counts;
}

async function runPdfInspect(
  input: string,
  options: PdfInspectCliOptions,
): Promise<number> {
  const command = "pdf-inspect";
  const { signal, getAbortReason } = createRuntimeSignal({});
  const reporter = createDiagnosticReporter({
    json: options.json,
    quiet: false,
    command,
  });

  try {
    const inputBytes = await readInput(input, { signal });
    const layout = readPdf(new Uint8Array(inputBytes), {
      signal,
      sink: (diagnostic) => {
        reporter.report(pdfDiagnosticToDiagnostic(diagnostic));
      },
    });

    if (options.full) {
      // Serialised as the plain pdf-codec value, with no $schema stamp -- LayoutDocument lost its schema-stamped JSON envelope when the family moved to pdf-codec at document-schema.js 4.0.0 (the demotion), so there is no documentFromJson kind for it any more and nothing to tag it with. A reader that wants the value back parses this JSON as a LayoutDocument directly (it is plain data).
      process.stdout.write(`${JSON.stringify(layout, undefined, 2)}\n`);
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

    process.stdout.write(
      `${layout.pages.length} page${layout.pages.length === 1 ? "" : "s"}\n`,
    );
    layout.pages.forEach((page, index) => {
      const histogram = buildItemKindHistogram(page.items);
      const histogramText = Array.from(histogram.entries())
        .map(([kind, count]) => `${kind}=${count}`)
        .join(", ");
      process.stdout.write(
        `  page ${index + 1}: ${page.widthPt}pt x ${page.heightPt}pt${histogramText === "" ? "" : ` (${histogramText})`}\n`,
      );
    });

    if (presentMetadataEntries(layout.metadata).length > 0) {
      process.stdout.write("metadata:\n");
      for (const line of formatMetadataLines(layout.metadata)) {
        process.stdout.write(`  ${line}\n`);
      }
    }

    if (imagesByFormat.size > 0) {
      process.stdout.write("images:\n");
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
    .command("pdf-inspect <input>")
    .description(
      "inspect a PDF: page count, per-page size and item-kind histogram, document metadata, and embedded image formats",
    )
    .option(
      "--json",
      "emit the summary as JSON instead of a human-readable report",
      false,
    )
    .option(
      "--full",
      "dump the entire parsed LayoutDocument as JSON instead of a summary",
      false,
    )
    .action(async (input: string, options: PdfInspectCliOptions) => {
      process.exitCode = await runPdfInspect(input, options);
    });
}
