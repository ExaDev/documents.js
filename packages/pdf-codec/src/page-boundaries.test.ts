import { describe, expect, it } from 'vitest';
import type { LayoutItem, LayoutText } from './layout';
import { readPdf } from './read';
import { cropBoxPdf, equalCropBoxPdf, inheritedCropBoxPdf, printBoxesPdf, rotatedCropBoxPdf } from './test-support/pdf';

function textItems(items: readonly LayoutItem[]): LayoutText[] {
  return items.filter((item): item is LayoutText => item.kind === 'text');
}

// The page-boundaries cluster (#759): the crop box is the visible region (ISO 32000-1 14.11.2), so it -- not the media box -- is the page geometry a consumer sees, content wholly outside it is not visible at all, and the boxes beyond the visible one (the media box a distinct crop hides, plus /BleedBox /TrimBox /ArtBox) are quarantined as a residue row rather than silently dropped.

describe('readPdf: crop box as the visible region', () => {
  it('reports the crop box as the page geometry, positions relative to its origin', () => {
    const page = readPdf(cropBoxPdf()).pages[0]!;
    expect(page).toMatchObject({ widthPt: 100, heightPt: 50 }); // CropBox [100 0 200 50]
    const [inside] = textItems(page.items);
    // (120, 20) in PDF space, crop origin (100, 0) -> (20, 20).
    expect(inside).toMatchObject({ text: 'inside', xPt: 20, yPt: 20 });
  });

  it('drops content wholly outside the crop box', () => {
    const page = readPdf(cropBoxPdf()).pages[0]!;
    const texts = textItems(page.items).map((item) => item.text);
    expect(texts).toEqual(['inside']); // the (10, 80) text lives wholly in the cropped-away half
  });

  it('keeps partially-visible content with its original, unclipped geometry', () => {
    const page = readPdf(cropBoxPdf()).pages[0]!;
    const straddle = page.items.find((item) => item.kind === 'rect');
    // The rect spans x 190..210 against the boundary at 200; a viewer clips the drawing, but the item layer keeps the source geometry -- clipping would invent data the format never stated.
    expect(straddle).toMatchObject({ xPt: 90, yPt: 20, widthPt: 20, heightPt: 10 });
  });

  it('does not filter link annotations, which are anchored constructs rather than painted content', () => {
    const page = readPdf(cropBoxPdf()).pages[0]!;
    const link = page.items.find((item) => item.kind === 'link');
    // /Rect [10 70 60 84] is in the cropped-away half; the link survives with its shifted position, exactly as the optional-content filter treats annotation kinds as not layer-governed content.
    expect(link).toMatchObject({ uri: 'https://example.com/marks', xPt: -90, yPt: 70 });
  });

  it('origin-normalises the crop rect in the rotated frame too', () => {
    const page = readPdf(rotatedCropBoxPdf()).pages[0]!;
    expect(page).toMatchObject({ widthPt: 50, heightPt: 100 }); // the rotated crop spans x 0..50, y 0..100
    const [inside] = textItems(page.items);
    // (120, 20) rotated 90 about the media box: (x, y) -> (y, 200 - x) = (20, 80); the rotated crop's own min corner is (0, 0), so no further shift applies.
    expect(inside).toMatchObject({ text: 'inside', xPt: 20, yPt: 80 });
    expect(textItems(page.items).some((item) => item.text === 'outside')).toBe(false);
  });

  it('honours a CropBox inherited from the parent Pages node', () => {
    const page = readPdf(inheritedCropBoxPdf()).pages[0]!;
    expect(page).toMatchObject({ widthPt: 200, heightPt: 50 });
    const [inside] = textItems(page.items);
    expect(inside).toMatchObject({ text: 'inside', xPt: 10, yPt: 20 }); // inherited crop origin (0, 0): no shift
    expect(textItems(page.items).some((item) => item.text === 'outside')).toBe(false);
  });
});

describe('readPdf: page-boundary residue', () => {
  it('quarantines the boxes a distinct crop box hides', () => {
    const doc = readPdf(cropBoxPdf());
    const row = doc.source?.['page-boxes'];
    expect(row?.format).toBe('pdf');
    expect(row?.xml).toContain('/Page 0');
    expect(row?.xml).toContain('/MediaBox [0 0 200 100]');
    expect(row?.xml).toContain('/CropBox [100 0 200 50]');
  });

  it('quarantines /BleedBox, /TrimBox, and /ArtBox without cropping to them', () => {
    const doc = readPdf(printBoxesPdf());
    expect(doc.pages[0]).toMatchObject({ widthPt: 200, heightPt: 100 }); // the equal CropBox: nothing is hidden
    expect(textItems(doc.pages[0]!.items).length).toBeGreaterThan(0);
    const row = doc.source?.['page-boxes'];
    expect(row?.xml).toContain('/BleedBox [0 0 210 110]');
    expect(row?.xml).toContain('/TrimBox [5 5 195 95]');
    expect(row?.xml).toContain('/ArtBox [10 10 190 90]');
  });

  it('records nothing when the declared boxes carry no fact beyond the visible one', () => {
    const doc = readPdf(equalCropBoxPdf());
    expect(doc.pages[0]).toMatchObject({ widthPt: 200, heightPt: 100 });
    expect(textItems(doc.pages[0]!.items).length).toBeGreaterThan(0);
    expect(doc.source?.['page-boxes']).toBeUndefined();
  });
});
