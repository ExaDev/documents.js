import type { LayoutDocument } from 'documents.js';
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { settle, waitForFrame } from '../../../test-support.js';
import { PdfHarness } from './test-support.js';

const SAMPLE_LAYOUT: LayoutDocument = {
  formatVersion: 1,
  metadata: {},
  images: {},
  pages: [
    {
      widthPt: 612,
      heightPt: 792,
      items: [
        { kind: 'text', text: 'Hello, world', xPt: 10, yPt: 20, font: { family: 'Helvetica', weight: 'normal', style: 'normal' }, sizePt: 12, color: { r: 0, g: 0, b: 0 } },
        { kind: 'link', uri: 'https://example.com', xPt: 10, yPt: 40, widthPt: 100, heightPt: 12 },
        { kind: 'rect', xPt: 0, yPt: 0, widthPt: 50, heightPt: 25, fill: { r: 1, g: 0, b: 0 } },
      ],
    },
  ],
};

const ESCAPE_CHAR_CODE = 27;
// Built via String.fromCharCode with the plain numeric escape code, not a literal or backslash-escaped control character in this source file's own text, since a raw control byte written directly into this file has proven not to survive edits to it reliably.
const ESCAPE = String.fromCharCode(ESCAPE_CHAR_CODE);

describe('PdfPageItemsScreen and PdfItemDetailScreen for a genuine pdf document (a real live-view PdfEditor -- item-detail is a real field editor, see edit.test.tsx for the actual editing flows)', () => {
  it('lists every item on the page with a kind-appropriate preview, and drills into a field editor on Enter', async () => {
    const { lastFrame, stdin } = render(<PdfHarness layout={SAMPLE_LAYOUT} />);
    await waitForFrame(lastFrame, (candidate) => candidate.includes('Page 1'));
    await settle();

    // pdfPageList -> pdfPageItems
    stdin.write('\r');
    const itemsFrame = await waitForFrame(lastFrame, (candidate) => candidate.includes('Page 1 items'));
    expect(itemsFrame).toContain('Page 1 items (3 of 3)');
    expect(itemsFrame).toContain('1. text -- Hello, world');
    expect(itemsFrame).toContain('2. link -- https://example.com');
    expect(itemsFrame).toContain('3. rect -- 50×25pt');
    await settle();

    // pdfPageItems -> pdfItemDetail, for the first (text) item -- a real field editor for a genuine 'pdf'-format document (see shared.ts's own isEditablePdfDocument), not the read-only field dump an xlsx preview still gets (see the describe block below).
    stdin.write('\r');
    const detailFrame = await waitForFrame(lastFrame, (candidate) => candidate.includes('Page 1, item 1'));
    expect(detailFrame).toContain('Page 1, item 1 -- text');
    expect(detailFrame).toContain('Text: Hello, world');
    expect(detailFrame).toContain('X: 10.0pt');
    expect(detailFrame).toContain('Y: 20.0pt');
    expect(detailFrame).toContain('Font family: Helvetica');
    expect(detailFrame).toContain('Size: 12pt');
    expect(detailFrame).toContain('Colour: #000000');
    await settle();

    // Esc backs out of pdfItemDetail to pdfPageItems, not all the way to pdfPageList.
    stdin.write(ESCAPE);
    const backFrame = await waitForFrame(lastFrame, (candidate) => candidate.includes('Page 1 items'));
    expect(backFrame).toContain('Page 1 items (3 of 3)');
  });

  it("renders a rect item's fill colour and size as editable rows", async () => {
    const { lastFrame, stdin } = render(<PdfHarness layout={SAMPLE_LAYOUT} />);
    await waitForFrame(lastFrame, (candidate) => candidate.includes('Page 1'));
    await settle();

    stdin.write('\r');
    await waitForFrame(lastFrame, (candidate) => candidate.includes('Page 1 items'));
    await settle();

    // Move down to the third (rect) item, then open its detail.
    stdin.write('j');
    await settle();
    stdin.write('j');
    await settle();
    stdin.write('\r');

    const frame = await waitForFrame(lastFrame, (candidate) => candidate.includes('Page 1, item 3'));
    expect(frame).toContain('Page 1, item 3 -- rect');
    expect(frame).toContain('Width: 50.0pt');
    expect(frame).toContain('Height: 25.0pt');
    expect(frame).toContain('Fill: #ff0000');
  });
});

describe('PdfItemDetailScreen for an xlsx preview (no live PdfEditor at all -- still the read-only field dump)', () => {
  it("keeps the old read-only 'Kind:'/'Position:' field dump, unlike a genuine pdf document above", async () => {
    const { lastFrame, stdin } = render(<PdfHarness layout={SAMPLE_LAYOUT} format="xlsx" />);
    await waitForFrame(lastFrame, (candidate) => candidate.includes('Page 1'));
    await settle();

    stdin.write('\r');
    await waitForFrame(lastFrame, (candidate) => candidate.includes('Page 1 items'));
    await settle();

    stdin.write('\r');
    const detailFrame = await waitForFrame(lastFrame, (candidate) => candidate.includes('Page 1, item 1'));
    expect(detailFrame).toContain('Kind: text');
    expect(detailFrame).toContain('Text: Hello, world');
    expect(detailFrame).toContain('Position: (10.0, 20.0)pt');
    expect(detailFrame).toContain('Font family: Helvetica');
    expect(detailFrame).toContain('Size: 12pt');
    expect(detailFrame).toContain('Colour: #000000');
    // No editable-row hint at all -- this is the plain, un-editable dump.
    expect(detailFrame).not.toContain('Enter to edit a field');
    expect(detailFrame).toContain('Esc / ← / h to go back');
  });
});
