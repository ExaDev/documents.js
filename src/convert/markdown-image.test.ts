import type { DocumentPackage } from 'document-schema.js';
import { describe, expect, it } from 'vitest';
import { markdownToDocx, markdownToOdt, markdownToPdf } from './convert';
import { flattenPackage } from './flatten';

// A real 1x1 PNG (the same one markdown-codec's own lower.test.ts resolves through its MarkdownImageResolver port), decoded from base64 via atob so detectImageFormat/readImageDimensions accept it and a genuine ContentImageBlock is produced rather than the alt-text degradation an unresolvable image becomes.
const ONE_PIXEL_PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='), (char) => char.codePointAt(0)!);
const LOCAL_IMAGE_MD = new TextEncoder().encode('![a local image](./local.png)');

function firstImageBlockKind(captured: DocumentPackage | undefined): string | undefined {
  if (captured === undefined) {
    return undefined;
  }
  const pkg = flattenPackage(captured);
  if (pkg.kind !== 'wordprocessing') {
    return undefined;
  }
  for (const section of pkg.sections) {
    for (const block of section.blocks) {
      if (block.kind === 'image') {
        return block.kind;
      }
    }
  }
  return undefined;
}

describe('markdown image resolution through options.images', () => {
  it('markdownToPdf resolves a relative-path image into a real ContentImageBlock, not alt-text', () => {
    let captured: DocumentPackage | undefined;
    markdownToPdf(LOCAL_IMAGE_MD, {
      onDocument: (pkg) => {
        captured = pkg;
      },
      images: (destination) => (destination === './local.png' ? { bytes: ONE_PIXEL_PNG } : undefined),
    });
    expect(firstImageBlockKind(captured)).toBe('image');
  });

  it('markdownToDocx resolves a relative-path image into a real ContentImageBlock, not alt-text', () => {
    let captured: DocumentPackage | undefined;
    markdownToDocx(LOCAL_IMAGE_MD, {
      onDocument: (pkg) => {
        captured = pkg;
      },
      images: (destination) => (destination === './local.png' ? { bytes: ONE_PIXEL_PNG } : undefined),
    });
    expect(firstImageBlockKind(captured)).toBe('image');
  });

  it('markdownToOdt resolves a relative-path image into a real ContentImageBlock, not alt-text', () => {
    let captured: DocumentPackage | undefined;
    markdownToOdt(LOCAL_IMAGE_MD, {
      onDocument: (pkg) => {
        captured = pkg;
      },
      images: (destination) => (destination === './local.png' ? { bytes: ONE_PIXEL_PNG } : undefined),
    });
    expect(firstImageBlockKind(captured)).toBe('image');
  });

  it('without a resolver the image still degrades to alt-text (no ContentImageBlock) -- the resolver is opt-in', () => {
    let captured: DocumentPackage | undefined;
    markdownToPdf(LOCAL_IMAGE_MD, {
      onDocument: (pkg) => {
        captured = pkg;
      },
    });
    expect(firstImageBlockKind(captured)).toBeUndefined();
  });
});
