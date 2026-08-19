import type { DocumentFormat } from 'documents.js';
import { inferFormatFromExtension } from '../../format.js';

// A named seam over the package's own extension inference, so the TUI has one import to change if it ever needs to sniff magic bytes rather than trust the extension. Deliberately not a second implementation.
export function detectFormat(path: string): DocumentFormat | undefined {
  return inferFormatFromExtension(path);
}
