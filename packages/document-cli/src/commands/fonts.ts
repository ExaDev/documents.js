import { type Command } from "commander";
import { extractSourceFontsForFormat } from "documents.js";
import { inferFormatFromExtension } from "../format";
import { createRuntimeSignal } from "../runtime/abort";
import {
  EXIT_SUCCESS,
  EXIT_USAGE_ERROR,
  mapErrorToExit,
} from "../runtime/exit-codes";
import { readInput } from "../runtime/io";
import { formatError } from "./shared";

interface FontsCliOptions {
  readonly json: boolean;
}

// ProvidedFont (pdf-codec, re-exported by documents.js) carries `bytes` directly, with no `byteLength` field of its own -- computed here rather than exposing the raw font bytes themselves, which no caller of this command's summary output has asked for and which would bloat --json output by however large the embedded face is.
interface FontFaceSummary {
  readonly family: string;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly byteLength: number;
}

async function runFonts(
  input: string,
  options: FontsCliOptions,
): Promise<number> {
  const command = "fonts";
  const { signal, getAbortReason } = createRuntimeSignal({});

  try {
    const format = inferFormatFromExtension(input);
    if (format === undefined) {
      process.stderr.write(
        `[${command}] cannot infer a document format from '${input}'; expected one of docx, pptx, odt, odp, ods, odg\n`,
      );
      return EXIT_USAGE_ERROR;
    }

    const inputBytes = await readInput(input, { signal });
    // extractSourceFontsForFormat itself rejects a format with no source-embedded font concept (xlsx, pdf, markdown, odf), naming the six it supports -- no separate isFontSourceFormat guard needed here any more.
    const faces = extractSourceFontsForFormat(
      format,
      new Uint8Array(inputBytes),
    );
    const summaries: readonly FontFaceSummary[] = faces.map((face) => ({
      family: face.family,
      bold: face.bold,
      italic: face.italic,
      byteLength: face.bytes.length,
    }));

    if (options.json) {
      process.stdout.write(`${JSON.stringify(summaries)}\n`);
      return EXIT_SUCCESS;
    }

    if (summaries.length === 0) {
      process.stdout.write("This document embeds no source fonts.\n");
      return EXIT_SUCCESS;
    }
    for (const face of summaries) {
      const style = [
        face.bold ? "bold" : undefined,
        face.italic ? "italic" : undefined,
      ]
        .filter((value) => value !== undefined)
        .join(" ");
      process.stdout.write(
        `${face.family}${style === "" ? "" : ` (${style})`} -- ${face.byteLength} bytes\n`,
      );
    }
    return EXIT_SUCCESS;
  } catch (error) {
    process.stderr.write(`${formatError(error, false)}\n`);
    return mapErrorToExit(error, getAbortReason());
  }
}

export function registerFontsCommand(program: Command): void {
  program
    .command("fonts <input>")
    .description(
      "list every source-embedded font face a docx/pptx/odt/odp/ods/odg document carries (family, weight/style, byte length)",
    )
    .option(
      "--json",
      "emit the face list as a JSON array instead of a human-readable report",
      false,
    )
    .action(async (input: string, options: FontsCliOptions) => {
      process.exitCode = await runFonts(input, options);
    });
}
