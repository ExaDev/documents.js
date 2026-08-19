// ContentImageBlock -> a markdown image (`![alt](data:image/png;base64,...)`), the structural inverse of src/lower/image.ts's data: URI decoding. WriteMarkdownOptions.images (default true) controls whether the image's own bytes are re-embedded as a data: URI at all -- false omits them, emitting only the alt text with an empty destination, the write-side counterpart to ReadMarkdownOptions.images.

import type { ContentImageBlock } from 'document-schema.js';
import { escapeMarkdownText } from './inline';

export function emitImage(block: ContentImageBlock, embedData: boolean): string {
  const alt = escapeMarkdownText(block.altText ?? '');
  if (!embedData) {
    return `![${alt}]()`;
  }
  return `![${alt}](data:image/${block.format};base64,${block.base64})`;
}
