import { type Command } from "commander";
import { readDocumentMetadata } from "documents.js";
import { inferFormatFromExtension } from "../format";
import { createRuntimeSignal } from "../runtime/abort";
import {
  EXIT_SUCCESS,
  EXIT_USAGE_ERROR,
  mapErrorToExit,
} from "../runtime/exit-codes";
import { readInput } from "../runtime/io";
import { formatMetadataLines } from "../runtime/metadata-format";
import { KNOWN_DOCUMENT_FORMATS, formatError } from "./shared";

interface MetadataCliOptions {
  readonly json: boolean;
}

async function runMetadata(
  input: string,
  options: MetadataCliOptions,
): Promise<number> {
  const command = "metadata";
  const source = inferFormatFromExtension(input);
  if (source === undefined) {
    process.stderr.write(
      `[${command}] cannot infer a source format from '${input}'; rename the file with a recognised extension (${KNOWN_DOCUMENT_FORMATS})\n`,
    );
    return EXIT_USAGE_ERROR;
  }

  const { signal, getAbortReason } = createRuntimeSignal({});

  try {
    const inputBytes = await readInput(input, { signal });
    const metadata = readDocumentMetadata(source, new Uint8Array(inputBytes), {
      signal,
    });

    if (options.json) {
      process.stdout.write(`${JSON.stringify(metadata)}\n`);
      return EXIT_SUCCESS;
    }

    const lines = formatMetadataLines(metadata);
    if (lines.length === 0) {
      process.stdout.write("This document carries no metadata.\n");
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
    .command("metadata <input>")
    .description(
      `print a document's own title/author/subject/keywords/creator/producer/created/modified metadata (${KNOWN_DOCUMENT_FORMATS})`,
    )
    .option(
      "--json",
      "emit the metadata as a JSON object instead of a human-readable report",
      false,
    )
    .action(async (input: string, options: MetadataCliOptions) => {
      process.exitCode = await runMetadata(input, options);
    });
}
