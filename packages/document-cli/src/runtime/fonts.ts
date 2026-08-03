import { readFile } from 'node:fs/promises';
import type { ProvidedFont } from 'documents.js';
import { describeFontFace } from './font-face';

// Reads each font file and pairs its bytes with the family/bold/italic triple the file itself declares (see font-face.ts), producing exactly the ProvidedFont shape documents.js's own conversion options and DocumentConverter port both take. Shared by the CLI's --font-file flag and the TUI's own font-file field so the two can never derive a face differently from the same file.
//
// Read sequentially rather than through Promise.all: a caller passing several fonts and mistyping one wants the error to name that file, and a sequential loop reports the first bad path with nothing else in flight. Font files are a handful of small local reads, so there is no throughput case for the parallel form here.
export async function loadProvidedFonts(paths: readonly string[], options?: { readonly signal?: AbortSignal }): Promise<ProvidedFont[]> {
  const fonts: ProvidedFont[] = [];
  for (const path of paths) {
    // Rewrapped through the constructor's ArrayLike overload for the same reason readInput does it (src/runtime/io.ts): ProvidedFont.bytes is Uint8Array<ArrayBuffer>, which a Buffer is not.
    const bytes = new Uint8Array(await readFile(path, { signal: options?.signal }));
    const face = describeFontFace(bytes, path);
    fonts.push({ family: face.family, bold: face.bold, italic: face.italic, bytes });
  }
  return fonts;
}
