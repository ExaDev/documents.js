import { describe, expect, it } from 'vitest';
import { COLOR_BLACK } from './color';
import type { ContentCodec, LayoutCodec } from './codec';
import { CONTENT_FORMAT_VERSION, type ContentDocument } from './content';
import { LAYOUT_FORMAT_VERSION, type LayoutDocument } from './layout';
import { DEFAULT_LAYOUT_FONT } from './style';

function wordprocessingDocument(): ContentDocument {
  return {
    kind: 'wordprocessing',
    formatVersion: CONTENT_FORMAT_VERSION,
    metadata: { title: 'Codec round trip', author: 'document-schema.js' },
    sections: [
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
        blocks: [
          {
            kind: 'paragraph',
            runs: [{ text: 'Hello, codec.', sourcePath: 'sections[0].blocks[0].runs[0]' }],
            sourcePath: 'sections[0].blocks[0]',
          },
        ],
      },
    ],
  };
}

function layoutDocument(): LayoutDocument {
  return {
    formatVersion: LAYOUT_FORMAT_VERSION,
    metadata: { title: 'Codec round trip', author: 'document-schema.js' },
    pages: [
      {
        widthPt: 612,
        heightPt: 792,
        items: [
          {
            kind: 'text',
            text: 'Hello, codec.',
            xPt: 72,
            yPt: 720,
            font: DEFAULT_LAYOUT_FONT,
            sizePt: 12,
            color: COLOR_BLACK,
            sourcePath: 'sections[0].blocks[0].runs[0]',
          },
        ],
      },
    ],
    images: {},
  };
}

describe('ContentCodec', () => {
  it('accepts a real implementation carrying both read and write', () => {
    const codec: ContentCodec = {
      read: (bytes) => {
        expect(bytes).toBeInstanceOf(Uint8Array);
        return wordprocessingDocument();
      },
      write: (content) => {
        expect(content.kind).toBe('wordprocessing');
        return new Uint8Array([1, 2, 3]);
      },
    };

    const content = codec.read(new Uint8Array([0]));
    expect(content).toEqual(wordprocessingDocument());
    expect(codec.write?.(content)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('accepts a real implementation that omits write entirely, proving it is genuinely optional', () => {
    const readOnlyCodec: ContentCodec = {
      read: () => wordprocessingDocument(),
    };

    expect('write' in readOnlyCodec).toBe(false);
    expect(readOnlyCodec.read(new Uint8Array([0]))).toEqual(wordprocessingDocument());
  });

  it('threads a format-specific TOptions type through both read and write', () => {
    interface OdtReadOptions {
      signal?: AbortSignal;
    }

    const codec: ContentCodec<OdtReadOptions> = {
      read: (_bytes, options) => {
        expect(options?.signal).toBeUndefined();
        return wordprocessingDocument();
      },
    };

    expect(codec.read(new Uint8Array([0]), {})).toEqual(wordprocessingDocument());
  });
});

describe('LayoutCodec', () => {
  it('accepts a real implementation carrying both read and write, since write is not optional', () => {
    const codec: LayoutCodec = {
      read: (bytes) => {
        expect(bytes).toBeInstanceOf(Uint8Array);
        return layoutDocument();
      },
      write: (layout) => {
        expect(layout.pages).toHaveLength(1);
        return new Uint8Array([4, 5, 6]);
      },
    };

    const layout = codec.read(new Uint8Array([0]));
    expect(layout).toEqual(layoutDocument());
    expect(codec.write(layout)).toEqual(new Uint8Array([4, 5, 6]));
  });

  it('threads a format-specific TOptions type through both read and write', () => {
    interface PdfWriteOptions {
      onFontSubstitution?: (family: string) => void;
    }

    const codec: LayoutCodec<PdfWriteOptions> = {
      read: () => layoutDocument(),
      write: (_layout, options) => {
        options?.onFontSubstitution?.('Carlito');
        return new Uint8Array([7]);
      },
    };

    let substituted: string | undefined;
    codec.write(layoutDocument(), { onFontSubstitution: (family) => (substituted = family) });
    expect(substituted).toBe('Carlito');
  });
});
