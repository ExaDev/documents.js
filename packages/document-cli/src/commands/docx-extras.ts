import { type Command } from 'commander';
import { decodePackage, readDocxExtras } from 'documents.js';
import { formatDocxExtrasLines } from '../docx-extras-format';
import { createRuntimeSignal } from '../runtime/abort';
import { EXIT_SUCCESS, mapErrorToExit } from '../runtime/exit-codes';
import { readInput } from '../runtime/io';
import { formatError } from './shared';

interface DocxExtrasCliOptions {
  readonly json: boolean;
}

async function runDocxExtras(input: string, options: DocxExtrasCliOptions): Promise<number> {
  const command = 'docx-extras';
  const { signal, getAbortReason } = createRuntimeSignal({});

  try {
    const inputBytes = await readInput(input, { signal });
    const pkg = decodePackage(new Uint8Array(inputBytes));
    const extras = readDocxExtras(pkg);

    if (options.json) {
      process.stdout.write(`${JSON.stringify(extras)}\n`);
      return EXIT_SUCCESS;
    }

    for (const line of formatDocxExtrasLines(extras)) {
      process.stdout.write(`${line}\n`);
    }
    return EXIT_SUCCESS;
  } catch (error) {
    process.stderr.write(`[${command}] ${formatError(error, false)}\n`);
    return mapErrorToExit(error, getAbortReason());
  }
}

export function registerDocxExtrasCommand(program: Command): void {
  program
    .command('docx-extras <input>')
    .description("print a docx's own comments, footnotes, headers, footers, and numbering definitions -- data readDocxContent's ContentDocument cannot carry")
    .option('--json', 'emit the raw DocxExtras object as JSON instead of a human-readable report', false)
    .action(async (input: string, options: DocxExtrasCliOptions) => {
      process.exitCode = await runDocxExtras(input, options);
    });
}
