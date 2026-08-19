import type { LayoutDocument } from 'documents.js';
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { waitForFrame } from '../../../test-support.js';
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
    {
      widthPt: 300,
      heightPt: 300,
      items: [{ kind: 'text', text: 'Page two', xPt: 5, yPt: 5, font: { family: 'Times-Roman', weight: 'bold', style: 'italic' }, sizePt: 14, color: { r: 0, g: 0, b: 1 } }],
    },
  ],
};

describe('PdfPageListScreen', () => {
  it('renders one row per page, each with its own size and an item-kind count summary', async () => {
    const { lastFrame } = render(<PdfHarness layout={SAMPLE_LAYOUT} />);
    const frame = await waitForFrame(lastFrame, (candidate) => candidate.includes('Page 1'));

    expect(frame).toContain('Pages (2 of 2)');
    expect(frame).toContain('Page 1 -- 612×792pt, 1 text, 1 rect, 1 link');
    expect(frame).toContain('Page 2 -- 300×300pt, 1 text');
  });

  // The whole point of xlsx opening as a read-only PDF preview (see state/types.ts's own XlsxOpenDocument doc comment): this screen -- and page-items.tsx/item-detail.tsx alongside it -- renders an open xlsx document exactly as it renders a real PDF, with no xlsx-specific branch anywhere in any of the three. requirePdfDocument (pdf/shared.ts) is the one broadened guard that makes this possible.
  it('renders identically for an open xlsx document, since both share the identical LayoutDocument shape', async () => {
    const { lastFrame } = render(<PdfHarness layout={SAMPLE_LAYOUT} format="xlsx" />);
    const frame = await waitForFrame(lastFrame, (candidate) => candidate.includes('Page 1'));

    expect(frame).toContain('Pages (2 of 2)');
    expect(frame).toContain('Page 1 -- 612×792pt, 1 text, 1 rect, 1 link');
    expect(frame).toContain('Page 2 -- 300×300pt, 1 text');
  });
});
