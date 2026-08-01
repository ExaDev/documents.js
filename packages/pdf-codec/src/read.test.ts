import { describe, expect, it } from 'vitest';
import {
  brokenStartxrefPdf,
  encryptedPdf,
  formXObjectPdf,
  inheritedPageAttributesPdf,
  inlineImagePdf,
  incrementalUpdatePdf,
  minimalClassicXrefPdf,
  nonZeroOriginMediaBoxPdf,
  pdfWithForeignHiddenAnnotationPdf,
  rotatedPagePdf,
  withInfoDictPdf,
  xrefStreamWithObjectStreamPdf,
} from './test-support/pdf';
import { PdfEncryptedError, PdfParseError } from './diagnostics';
import { decodePdfString, normalizeRotation, pageRotationTransform, readPdf } from './read';

function textLayoutItems(items: readonly { kind: string }[]): { kind: string }[] {
  return items.filter((i) => i.kind === 'text');
}

describe('readPdf: basic structure', () => {
  it('reads a single page with the right size and extracts its text', () => {
    const doc = readPdf(minimalClassicXrefPdf());
    expect(doc.pages).toHaveLength(1);
    const [page] = doc.pages;
    expect(page).toMatchObject({ widthPt: 200, heightPt: 100 });
    const [item] = page!.items;
    expect(item).toMatchObject({ kind: 'text', text: 'Hello' });
  });

  it('resolves the font family from /BaseFont', () => {
    const doc = readPdf(minimalClassicXrefPdf());
    const [item] = doc.pages[0]!.items;
    expect(item).toMatchObject({ font: { family: 'Helvetica', weight: 'normal', style: 'normal' } });
  });

  it('defaults to black fill colour', () => {
    const doc = readPdf(minimalClassicXrefPdf());
    const [item] = doc.pages[0]!.items;
    expect(item).toMatchObject({ color: { r: 0, g: 0, b: 0 } });
  });
});

describe('readPdf: cross-reference variants', () => {
  it('reads a page whose Catalog/Pages/Page live inside an object stream', () => {
    const doc = readPdf(xrefStreamWithObjectStreamPdf());
    expect(doc.pages).toHaveLength(1);
    expect(doc.pages[0]).toMatchObject({ widthPt: 200, heightPt: 100 });
  });

  it('recovers via a linear scan when startxref is broken', () => {
    const doc = readPdf(brokenStartxrefPdf());
    expect(doc.pages).toHaveLength(1);
    expect(textLayoutItems(doc.pages[0]!.items)).toHaveLength(1);
  });

  it('reflects the newest revision after an incremental update', () => {
    const doc = readPdf(incrementalUpdatePdf());
    expect(doc.pages[0]).toMatchObject({ widthPt: 400, heightPt: 300 });
  });
});

describe('readPdf: encryption and malformed input', () => {
  it('throws PdfEncryptedError for an encrypted PDF', () => {
    expect(() => readPdf(encryptedPdf())).toThrow(PdfEncryptedError);
  });

  it('throws a PdfParseError when there is no "%PDF-" header at all', () => {
    expect(() => readPdf(new TextEncoder().encode('not a pdf'))).toThrow(PdfParseError);
  });
});

describe('readPdf: page rotation', () => {
  it('swaps page dimensions and rotates extracted text for /Rotate 90', () => {
    const doc = readPdf(rotatedPagePdf());
    expect(doc.pages[0]).toMatchObject({ widthPt: 100, heightPt: 200 }); // swapped from the unrotated 200x100 MediaBox
    const [item] = textLayoutItems(doc.pages[0]!.items);
    // /Rotate 90 is clockwise (ISO 32000-1 7.7.3.3); matrix.ts's own rotationDeg convention is counter-clockwise-positive (matching rotationMatrix's documented convention), so a clockwise page rotation reports as -90 here.
    expect(item).toMatchObject({ rotationDeg: -90 });
  });

  it('only the rotated page changes size; a matching unrotated page does not', () => {
    const rotated = readPdf(rotatedPagePdf()).pages[0]!;
    const unrotated = readPdf(minimalClassicXrefPdf()).pages[0]!;
    expect(rotated.widthPt).toBe(unrotated.heightPt);
    expect(rotated.heightPt).toBe(unrotated.widthPt);
  });
});

describe('readPdf: non-zero-origin MediaBox', () => {
  it('shifts content coordinates by the MediaBox origin', () => {
    const doc = readPdf(nonZeroOriginMediaBoxPdf());
    expect(doc.pages[0]).toMatchObject({ widthPt: 200, heightPt: 100 }); // [50 50 250 150] -> same size, shifted origin
    const [item] = textLayoutItems(doc.pages[0]!.items);
    // The fixture's content places text at absolute (10, 50); MediaBox origin (50, 50) shifts that to (-40, 0).
    expect(item).toMatchObject({ xPt: -40, yPt: 0 });
  });
});

describe('readPdf: form XObjects', () => {
  it('recurses into a form XObject, composing the invoking cm into its content\'s position', () => {
    const doc = readPdf(formXObjectPdf());
    const [item] = textLayoutItems(doc.pages[0]!.items);
    expect(item).toMatchObject({ text: 'In a form', xPt: 20, yPt: 20 });
  });
});

describe('readPdf: inline images', () => {
  it('extracts an inline image, registered in the document image map', () => {
    const doc = readPdf(inlineImagePdf());
    const imageItems = doc.pages[0]!.items.filter((i) => i.kind === 'image');
    expect(imageItems).toHaveLength(1);
    const [image] = imageItems;
    expect(image).toMatchObject({ kind: 'image', xPt: 10, yPt: 0, widthPt: 100, heightPt: 100 });
    if (image?.kind !== 'image') {
      throw new Error('expected an image item');
    }
    expect(doc.images[image.imageId]).toMatchObject({ format: 'png' });
  });
});

describe('readPdf: page-tree attribute inheritance', () => {
  it('inherits MediaBox onto both pages, and swaps dimensions only for the rotated one', () => {
    const doc = readPdf(inheritedPageAttributesPdf());
    expect(doc.pages).toHaveLength(2);
    expect(doc.pages[0]).toMatchObject({ widthPt: 300, heightPt: 200 });
    expect(doc.pages[1]).toMatchObject({ widthPt: 200, heightPt: 300 }); // /Rotate 90 on the second page
  });
});

describe('readPdf: cancellation', () => {
  it('throws when the signal is already aborted before reading begins', () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => readPdf(minimalClassicXrefPdf(), { signal: controller.signal })).toThrow();
  });
});

describe('readPdf: metadata', () => {
  it('reads /Title, /Author, /Keywords, and /CreationDate from /Info', () => {
    const doc = readPdf(withInfoDictPdf());
    expect(doc.metadata).toMatchObject({
      title: 'Test Doc',
      author: 'Jane Smith',
      keywords: ['alpha', 'beta'],
      createdIso: '2024-01-15T10:30:00+02:00',
    });
  });
});

describe('readPdf: page notes', () => {
  // pdfWithForeignHiddenAnnotationPdf is built independently of src/pdf/write.ts (see test-support/pdf.ts's own top-of-file rationale) specifically so this proves readPageNotes's /T-marker check against a genuinely foreign annotation, not just against what our own writer happens to produce.
  it('does not mistake a third-party tool\'s own hidden sticky note for pptx speaker notes', () => {
    const doc = readPdf(pdfWithForeignHiddenAnnotationPdf());
    expect(doc.pages[0]!.notes).toBeUndefined();
  });
});

describe('normalizeRotation', () => {
  it('passes through each of the four valid values', () => {
    expect(normalizeRotation(0)).toBe(0);
    expect(normalizeRotation(90)).toBe(90);
    expect(normalizeRotation(180)).toBe(180);
    expect(normalizeRotation(270)).toBe(270);
  });

  it('normalises a negative rotation', () => {
    expect(normalizeRotation(-90)).toBe(270);
  });

  it('normalises a rotation past 360', () => {
    expect(normalizeRotation(450)).toBe(90);
  });

  it('defaults to 0 when absent', () => {
    expect(normalizeRotation(undefined)).toBe(0);
  });
});

describe('pageRotationTransform', () => {
  it('is the identity for 0, unchanged dimensions', () => {
    const result = pageRotationTransform(0, 200, 100);
    expect(result).toEqual({ matrix: [1, 0, 0, 1, 0, 0], widthPt: 200, heightPt: 100 });
  });

  it('maps all four corners correctly for 90 and swaps dimensions', () => {
    const { matrix, widthPt, heightPt } = pageRotationTransform(90, 200, 100);
    expect({ widthPt, heightPt }).toEqual({ widthPt: 100, heightPt: 200 });
    const applyPoint = (x: number, y: number): { x: number; y: number } => ({ x: x * matrix[0] + y * matrix[2] + matrix[4], y: x * matrix[1] + y * matrix[3] + matrix[5] });
    expect(applyPoint(0, 0)).toEqual({ x: 0, y: 200 });
    expect(applyPoint(200, 0)).toEqual({ x: 0, y: 0 });
    expect(applyPoint(200, 100)).toEqual({ x: 100, y: 0 });
    expect(applyPoint(0, 100)).toEqual({ x: 100, y: 200 });
  });

  it('maps opposite corners for 180, dimensions unchanged', () => {
    const { matrix, widthPt, heightPt } = pageRotationTransform(180, 200, 100);
    expect({ widthPt, heightPt }).toEqual({ widthPt: 200, heightPt: 100 });
    const applyPoint = (x: number, y: number): { x: number; y: number } => ({ x: x * matrix[0] + y * matrix[2] + matrix[4], y: x * matrix[1] + y * matrix[3] + matrix[5] });
    expect(applyPoint(0, 0)).toEqual({ x: 200, y: 100 });
    expect(applyPoint(200, 100)).toEqual({ x: 0, y: 0 });
  });

  it('maps all four corners correctly for 270 and swaps dimensions', () => {
    const { matrix, widthPt, heightPt } = pageRotationTransform(270, 200, 100);
    expect({ widthPt, heightPt }).toEqual({ widthPt: 100, heightPt: 200 });
    const applyPoint = (x: number, y: number): { x: number; y: number } => ({ x: x * matrix[0] + y * matrix[2] + matrix[4], y: x * matrix[1] + y * matrix[3] + matrix[5] });
    expect(applyPoint(0, 0)).toEqual({ x: 100, y: 0 });
    expect(applyPoint(200, 0)).toEqual({ x: 100, y: 200 });
    expect(applyPoint(200, 100)).toEqual({ x: 0, y: 200 });
    expect(applyPoint(0, 100)).toEqual({ x: 0, y: 0 });
  });
});

describe('decodePdfString', () => {
  it('decodes a UTF-16BE-with-BOM string', () => {
    const bytes = new Uint8Array([0xfe, 0xff, 0x00, 0x41, 0x00, 0x42]);
    expect(decodePdfString(bytes)).toBe('AB');
  });

  it('decodes a plain (no-BOM) string byte-for-byte as Latin-1', () => {
    const bytes = new TextEncoder().encode('Hello');
    expect(decodePdfString(bytes)).toBe('Hello');
  });
});
