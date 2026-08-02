import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { type DocumentFormat } from 'documents.js';
import { formatToExtension } from '../format';

function isUint8Array(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array;
}

async function readStdin(signal: AbortSignal | undefined): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of process.stdin) {
    if (signal?.aborted === true) {
      throw new Error('Reading from stdin was aborted');
    }
    if (!isUint8Array(chunk)) {
      throw new Error('Unexpected non-buffer chunk read from stdin');
    }
    chunks.push(chunk);
  }
  // Buffer.concat's result is a Buffer, itself a Uint8Array<ArrayBufferLike> -- rewrapped through the constructor's ArrayLike overload so every caller of readInput gets a genuine, freshly-allocated Uint8Array<ArrayBuffer> regardless of whether the bytes came from stdin or a file (see readInput below).
  return new Uint8Array(Buffer.concat(chunks));
}

export async function readInput(pathOrDash: string, options?: { readonly signal?: AbortSignal }): Promise<Uint8Array> {
  if (pathOrDash === '-') {
    return readStdin(options?.signal);
  }
  // A missing file throws Node's own ENOENT Error unmodified -- already a clear, specific message; wrapping it would only obscure the real cause.
  const buffer = await readFile(pathOrDash, { signal: options?.signal });
  return new Uint8Array(buffer);
}

export async function writeOutput(pathOrDash: string, bytes: Uint8Array): Promise<void> {
  if (pathOrDash === '-') {
    await new Promise<void>((resolve, reject) => {
      process.stdout.write(bytes, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    return;
  }
  await writeFile(pathOrDash, bytes);
}

export function resolveDefaultOutputPath(inputPath: string, targetFormat: DocumentFormat): string {
  const directory = dirname(inputPath);
  const stem = basename(inputPath, extname(inputPath));
  return join(directory, `${stem}.${formatToExtension(targetFormat)}`);
}
