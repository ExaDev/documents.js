import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// A MarkdownImageResolver (documents.js's ConversionOptions.images / DocumentToPdfOptions.images) that resolves a non-data: image destination against the input markdown file's own directory, reading the file synchronously -- so a CLI `convert notes.md` embeds `![](./image.png)` from the directory notes.md lives in rather than degrading it to alt text. markdown-codec resolves `data:image/...` URIs natively before this resolver is ever called, so those never reach here; any URL with a scheme (http(s)://, file://, ...) is left unresolved, since Node has no synchronous HTTP fetch and URL-scheme handling is a network/caller concern rather than a relative-path one. Any read failure (missing file, unreadable bytes) returns undefined, which markdown-codec degrades to the image's alt text -- never an invalid ContentImageBlock. Structurally typed to satisfy documents.js's MarkdownImageResolver port without this CLI taking a direct markdown-codec dependency.
export function createFilesystemMarkdownImageResolver(baseDir: string): (destination: string) => { readonly bytes: Uint8Array } | undefined {
  return (destination: string): { readonly bytes: Uint8Array } | undefined => {
    // An empty destination, a data: URI (handled natively upstream), or any scheme-prefixed URL is not a local relative/absolute path this resolver reads from disk.
    if (destination.length === 0 || /^data:/i.test(destination) || /^[a-z][a-z0-9+.-]*:\/\//i.test(destination)) {
      return undefined;
    }
    try {
      return { bytes: new Uint8Array(readFileSync(resolve(baseDir, destination))) };
    } catch {
      return undefined;
    }
  };
}
