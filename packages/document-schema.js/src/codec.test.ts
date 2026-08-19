import { describe, expect, it } from 'vitest';
import type { ContentCodec } from './codec';
import type { ContentDocument } from './content';

function wordprocessingDocument(): ContentDocument {
  return {
    kind: 'wordprocessing',
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
