import { readFile } from 'node:fs/promises';
import type { ProvidedFont } from 'documents.js';
// A deliberate exception to this repo's usual "everything pdf-codec-sourced comes through documents.js" pattern: readFontFace is a standalone font-FILE inspector, not source-document font extraction, which is documents.js's own stated boundary (see its README -- extractSourceFonts/extractSourceFontsForFormat cover extracting fonts a document already embeds, not describing an arbitrary font file). Imported directly from pdf-codec, a genuine direct dependency of this package now, rather than forcing a re-export into documents.js that would work around that boundary.
import { readFontFace } from 'pdf-codec';

// Reads each font file and pairs its bytes with the family/bold/italic triple the file itself declares (pdf-codec's own readFontFace, parsed from the font's own sfnt tables), producing exactly the ProvidedFont shape documents.js's own conversion options and DocumentConverter port both take. Shared by the CLI's --font-file flag and the TUI's own font-file field so the two can never derive a face differently from the same file.
//
// Read sequentially rather than through Promise.all: a caller passing several fonts and mistyping one wants the error to name that file, and a sequential loop reports the first bad path with nothing else in flight. Font files are a handful of small local reads, so there is no throughput case for the parallel form here.
export async function loadProvidedFonts(paths: readonly string[], options?: { readonly signal?: AbortSignal }): Promise<ProvidedFont[]> {
  const fonts: ProvidedFont[] = [];
  for (const path of paths) {
    // Rewrapped through the constructor's ArrayLike overload for the same reason readInput does it (src/runtime/io.ts): ProvidedFont.bytes is Uint8Array<ArrayBuffer>, which a Buffer is not.
    const bytes = new Uint8Array(await readFile(path, { signal: options?.signal }));
    const face = readFontFace(bytes, path);
    fonts.push({ family: face.family, bold: face.bold, italic: face.italic, bytes });
  }
  return fonts;
}
