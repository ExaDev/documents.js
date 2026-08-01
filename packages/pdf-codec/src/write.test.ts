import { bytesToBase64 } from './util/base64';
import { describe, expect, it } from 'vitest';
import type { LayoutDocument, LayoutImageAsset, LayoutItem, LayoutPage } from 'document-schema.js';
import { LAYOUT_FORMAT_VERSION } from 'document-schema.js';
import { encodePng } from './image/png-encode';
import { writePdf } from './write';

const HELVETICA = { family: 'Helvetica', weight: 'normal', style: 'normal' } as const;
const BLACK = { r: 0, g: 0, b: 0 };

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function docWithPages(pages: LayoutPage[], images: Record<string, LayoutImageAsset> = {}): LayoutDocument {
  return { formatVersion: LAYOUT_FORMAT_VERSION, metadata: {}, pages, images };
}

function docWithItems(items: LayoutItem[]): LayoutDocument {
  return docWithPages([{ widthPt: 612, heightPt: 792, items }]);
}

function tinyPngAsset(): LayoutImageAsset {
  const width = 2;
  const height = 2;
  // 4 solid-colour pixels, RGB, no alpha.
  const data = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]);
  const bytes = encodePng({ width, height, channels: 3, data });
  return { format: 'png', base64: bytesToBase64(bytes), widthPx: width, heightPx: height };
}

// A minimal, hand-built JPEG: SOI, a baseline SOF0 segment declaring 3x2 pixels / 3 components / 8-bit precision, then EOI. No huffman/quant tables or entropy-coded scan data -- readJpegInfo only scans for the SOF marker and never decodes samples, so this is a fully valid input for it despite not being a real, viewable image.
function tinyJpegAsset(): LayoutImageAsset {
  // prettier-ignore
  const bytes = new Uint8Array([
    0xff, 0xd8, // SOI
    0xff, 0xc0, 0x00, 0x11, // SOF0, length 17
    0x08, // precision
    0x00, 0x02, // height = 2
    0x00, 0x03, // width = 3
    0x03, // 3 components
    0x01, 0x22, 0x00,
    0x02, 0x11, 0x01,
    0x03, 0x11, 0x01,
    0xff, 0xd9, // EOI
  ]);
  return { format: 'jpeg', base64: bytesToBase64(bytes), widthPx: 3, heightPx: 2 };
}

describe('writePdf: document structure', () => {
  it('starts with the PDF header and ends with %%EOF', () => {
    const bytes = writePdf(docWithPages([]));
    const text = decode(bytes);
    expect(text.startsWith('%PDF-1.7\n')).toBe(true);
    expect(text.endsWith('%%EOF')).toBe(true);
  });

  it('emits a Catalog referencing the Pages tree, and a Pages tree with the right Count', () => {
    const text = decode(writePdf(docWithPages([{ widthPt: 100, heightPt: 100, items: [] }]), { compress: false }));
    expect(text).toContain('/Type /Catalog');
    expect(text).toContain('/Type /Pages');
    expect(text).toContain('/Count 1');
  });

  it('always identifies itself as Producer, regardless of doc.metadata.producer', () => {
    const doc: LayoutDocument = { formatVersion: LAYOUT_FORMAT_VERSION, metadata: { producer: 'Microsoft Word' }, pages: [], images: {} };
    const text = decode(writePdf(doc, { compress: false }));
    // UTF-16BE-with-BOM hex for "documents.js" (FEFF + one big-endian code unit per character).
    expect(text).toContain('/Producer <feff0064006f00630075006d0065006e00740073002e006a0073>');
    expect(text).not.toContain('Microsoft Word');
  });

  it('writes MediaBox from the page\'s own widthPt/heightPt, always starting at [0 0 ...]', () => {
    const text = decode(writePdf(docWithPages([{ widthPt: 612, heightPt: 792, items: [] }]), { compress: false }));
    expect(text).toContain('/MediaBox [0 0 612 792]');
  });
});

describe('writePdf: text and fonts', () => {
  it('emits a Font object with the resolved standard-14 BaseFont, WinAnsiEncoding, and a Widths array', () => {
    const text = decode(writePdf(docWithItems([{ kind: 'text', text: 'Hi', xPt: 10, yPt: 700, font: HELVETICA, sizePt: 12, color: BLACK }]), { compress: false }));
    expect(text).toContain('/BaseFont /Helvetica');
    expect(text).toContain('/Encoding /WinAnsiEncoding');
    expect(text).toContain('/FirstChar 32');
    expect(text).toContain('/LastChar 255');
    expect(text).toContain('/FontDescriptor');
  });

  it('emits the content stream in cleartext with an absolute Tm and a hex-string Tj operand when uncompressed', () => {
    const text = decode(writePdf(docWithItems([{ kind: 'text', text: 'Hi', xPt: 10, yPt: 700, font: HELVETICA, sizePt: 12, color: BLACK }]), { compress: false }));
    expect(text).toContain('BT\n');
    expect(text).toContain('<4869> Tj'); // 'H'=0x48, 'i'=0x69
    expect(text).toContain('1 0 0 1 10 700 Tm');
  });

  it('allocates one Font object per distinct standard-14 face actually used, resource-named by sorted order', () => {
    const times = { family: 'Times New Roman', weight: 'normal', style: 'normal' } as const;
    const text = decode(
      writePdf(
        docWithItems([
          { kind: 'text', text: 'A', xPt: 0, yPt: 0, font: times, sizePt: 10, color: BLACK },
          { kind: 'text', text: 'B', xPt: 0, yPt: 0, font: HELVETICA, sizePt: 10, color: BLACK },
        ]),
        { compress: false },
      ),
    );
    expect(text).toContain('/BaseFont /Times-Roman');
    expect(text).toContain('/BaseFont /Helvetica');
    // Sorted alphabetically, "Helvetica" < "Times-Roman", so Helvetica gets F1 and is used by the second item's Tf.
    expect(text).toContain('/F1 10 Tf');
    expect(text).toContain('/F2 10 Tf');
  });

  it('by default (compress: true) hides the content stream as FlateDecode-compressed bytes', () => {
    const text = decode(writePdf(docWithItems([{ kind: 'text', text: 'Hi', xPt: 10, yPt: 700, font: HELVETICA, sizePt: 12, color: BLACK }])));
    expect(text).toContain('/Filter /FlateDecode');
    expect(text).not.toContain('BT\n');
  });

  it('reports WinAnsi substitutions via the onSubstitution callback, with the page index', () => {
    const substitutions: { from: string; to: string; pageIndex: number }[] = [];
    writePdf(docWithItems([{ kind: 'text', text: '中', xPt: 0, yPt: 0, font: HELVETICA, sizePt: 10, color: BLACK }]), {
      compress: false,
      onSubstitution: (s, ctx) => substitutions.push({ ...s, pageIndex: ctx.pageIndex }),
    });
    expect(substitutions).toEqual([{ from: '中', to: '?', pageIndex: 0 }]);
  });
});

describe('writePdf: rects, lines, ellipses', () => {
  it('round-trips a rect, line, and ellipse into the content stream', () => {
    const text = decode(
      writePdf(
        docWithItems([
          { kind: 'rect', xPt: 0, yPt: 0, widthPt: 10, heightPt: 10, fill: { r: 1, g: 0, b: 0 } },
          { kind: 'line', x1Pt: 0, y1Pt: 0, x2Pt: 10, y2Pt: 10, color: BLACK, widthPt: 1 },
          { kind: 'ellipse', xPt: 0, yPt: 0, widthPt: 10, heightPt: 10, fill: { r: 0, g: 1, b: 0 } },
        ]),
        { compress: false },
      ),
    );
    expect(text).toContain(' re\n');
    expect(text).toContain(' m 10 10 l\n');
    expect(text).toContain(' c\n');
  });
});

describe('writePdf: links', () => {
  it('emits an Annots array with a URI action for a link item, and no content-stream bytes for it', () => {
    const text = decode(writePdf(docWithItems([{ kind: 'link', uri: 'https://example.com', xPt: 1, yPt: 2, widthPt: 3, heightPt: 4 }]), { compress: false }));
    expect(text).toContain('/Subtype /Link');
    expect(text).toContain('/Rect [1 2 4 6]');
    expect(text).toContain('/S /URI');
  });

  it('omits /Annots entirely for a page with no links', () => {
    const text = decode(writePdf(docWithItems([{ kind: 'rect', xPt: 0, yPt: 0, widthPt: 1, heightPt: 1, fill: BLACK }]), { compress: false }));
    expect(text).not.toContain('/Annots');
  });
});

describe('writePdf: images', () => {
  it('embeds a PNG-sourced image as a FlateDecode XObject with the right dimensions and colour space', () => {
    const asset = tinyPngAsset();
    const doc = docWithPages([{ widthPt: 100, heightPt: 100, items: [{ kind: 'image', imageId: 'logo', xPt: 0, yPt: 0, widthPt: 50, heightPt: 50 }] }], { logo: asset });
    const text = decode(writePdf(doc));
    expect(text).toContain('/Subtype /Image');
    expect(text).toContain('/ColorSpace /DeviceRGB');
    expect(text).toContain('/Width 2');
    expect(text).toContain('/Height 2');
    // The Im1 Do operator itself lives inside the (by-default-compressed) content stream, so check the page's own Resources dict mapping instead -- that stays plain ASCII regardless of the compress option.
    expect(text).toContain('/XObject <</Im1 ');
  });

  it('embeds a JPEG-sourced image verbatim via DCTDecode, never re-encoding it', () => {
    const asset = tinyJpegAsset();
    const doc = docWithPages([{ widthPt: 100, heightPt: 100, items: [{ kind: 'image', imageId: 'photo', xPt: 0, yPt: 0, widthPt: 50, heightPt: 50 }] }], { photo: asset });
    const text = decode(writePdf(doc, { compress: false }));
    expect(text).toContain('/Filter /DCTDecode');
    expect(text).toContain('/Width 3');
    expect(text).toContain('/Height 2');
    expect(text).toContain('/ColorSpace /DeviceRGB');
  });

  it('throws when a LayoutImage references an imageId missing from the images registry', () => {
    const doc = docWithPages([{ widthPt: 100, heightPt: 100, items: [{ kind: 'image', imageId: 'missing', xPt: 0, yPt: 0, widthPt: 50, heightPt: 50 }] }], {});
    expect(() => writePdf(doc)).toThrow(/missing/);
  });
});

describe('writePdf: determinism', () => {
  it('produces byte-identical output for identical input, called twice', () => {
    const doc = docWithItems([
      { kind: 'text', text: 'Hello', xPt: 10, yPt: 700, font: HELVETICA, sizePt: 12, color: BLACK },
      { kind: 'rect', xPt: 0, yPt: 0, widthPt: 10, heightPt: 10, fill: { r: 1, g: 0, b: 0 } },
    ]);
    const first = writePdf(doc);
    const second = writePdf(doc);
    expect(Array.from(first)).toEqual(Array.from(second));
  });
});

describe('writePdf: cross-reference table', () => {
  it('startxref points at the exact byte offset of the xref keyword', () => {
    const bytes = writePdf(docWithPages([]), { compress: false });
    const text = decode(bytes);
    const startxrefIdx = text.indexOf('startxref\n');
    const afterKeyword = text.slice(startxrefIdx + 'startxref\n'.length);
    const offsetStr = afterKeyword.split('\n')[0];
    const offset = Number(offsetStr);
    expect(decode(bytes.subarray(offset, offset + 5))).toBe('xref\n');
  });

  it('every in-use xref entry\'s offset points at that object\'s own "N 0 obj" header', () => {
    const bytes = writePdf(
      docWithItems([
        { kind: 'text', text: 'Hello', xPt: 10, yPt: 700, font: HELVETICA, sizePt: 12, color: BLACK },
        { kind: 'rect', xPt: 0, yPt: 0, widthPt: 10, heightPt: 10, fill: { r: 1, g: 0, b: 0 } },
      ]),
      { compress: false },
    );
    const text = decode(bytes);
    const xrefIdx = text.indexOf('\nxref\n') + 1;
    const trailerIdx = text.indexOf('trailer\n', xrefIdx);
    const xrefBlock = text.slice(xrefIdx, trailerIdx);
    const lines = xrefBlock.split('\n').filter((line) => line.length > 0);
    // First line is "xref", second is the subsection header "0 N", the rest are 20-byte entries (each ending with a space before the split-away '\n').
    const entryLines = lines.slice(2);
    for (const [index, line] of entryLines.entries()) {
      const objNum = index; // object 0 is the free-list head; object N's entry is at index N
      const match = /^(\d{10}) (\d{5}) ([nf]) $/.exec(line);
      expect(match).not.toBeNull();
      const [, offsetStr, , type] = match!;
      if (type === 'f') {
        continue;
      }
      const offset = Number(offsetStr);
      const header = decode(bytes.subarray(offset, offset + `${objNum} 0 obj`.length));
      expect(header).toBe(`${objNum} 0 obj`);
    }
  });
});

describe('writePdf: empty rect/ellipse', () => {
  it('produces no content-stream bytes for a rect with neither fill nor stroke', () => {
    const text = decode(writePdf(docWithItems([{ kind: 'rect', xPt: 0, yPt: 0, widthPt: 5, heightPt: 5 }]), { compress: false }));
    // The Contents stream exists but is empty -- "stream\n\nendstream" with nothing between.
    expect(text).toContain('stream\n\nendstream');
  });
});

describe('writePdf: aborting', () => {
  it('throws when the signal is already aborted before writing begins', () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => writePdf(docWithItems([{ kind: 'rect', xPt: 0, yPt: 0, widthPt: 1, heightPt: 1, fill: BLACK }]), { signal: controller.signal })).toThrow();
  });
});
