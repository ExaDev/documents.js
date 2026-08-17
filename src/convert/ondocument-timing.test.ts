import { describe, expect, it } from 'vitest';
import type { DocumentPackage } from 'document-schema.js';
import { odsToPdf, odsToXlsx, pdfToXlsx, xlsxToMarkdown, xlsxToPdf } from './convert';
import { gridOdsBytes } from '../test-support/ods';

// Regression guard: the original hand-written xlsxToPdf/pdfToXlsx/xlsxToMarkdown/markdownToXlsx forwarded onDocument to the LAST hop of their internal composition, so the caller received the package that actually produced the output bytes (content+pages, frames stamped, for a toPdf/fromPdf final hop; content-only for a bridge final hop). The composition engine must preserve that: onDocument fires exactly once, on the LAST hop, not the first.
describe('onDocument fires on the last hop of a composed path', () => {
  it('xlsxToPdf reports a package with pages (the odsToPdf hop), not a content-only bridge package', () => {
    const xlsxBytes = odsToXlsx(gridOdsBytes());
    let captured: DocumentPackage | undefined;
    xlsxToPdf(xlsxBytes, { onDocument: (pkg) => { captured = pkg; } });
    if (captured === undefined) throw new Error('onDocument was not called');
    // The toPdf hop runs a layout engine, so its package carries pages and frame-stamped content; a bridge hop carries neither. The original xlsxToPdf forwarded onDocument to odsToPdf (the last hop), so pages must be defined.
    expect(captured.pages).toBeDefined();
    expect(captured.content.kind).toBe('spreadsheet');
  });

  it('pdfToXlsx reports a package with content only (the odsToXlsx bridge hop), pages undefined', () => {
    const pdfBytes = odsToPdf(gridOdsBytes());
    let captured: DocumentPackage | undefined;
    pdfToXlsx(pdfBytes, { onDocument: (pkg) => { captured = pkg; } });
    if (captured === undefined) throw new Error('onDocument was not called');
    // The last hop is odsToXlsx (a bridge), which reports content only.
    expect(captured.pages).toBeUndefined();
    expect(captured.content.kind).toBe('spreadsheet');
  });

  it('xlsxToMarkdown reports a package from the pdfToMarkdown hop (wordprocessing content + pages)', () => {
    const xlsxBytes = odsToXlsx(gridOdsBytes());
    let captured: DocumentPackage | undefined;
    xlsxToMarkdown(xlsxBytes, { onDocument: (pkg) => { captured = pkg; } });
    if (captured === undefined) throw new Error('onDocument was not called');
    // The last hop is pdfToMarkdown (fromPdf), which reconstructs wordprocessing content with frames attached and carries the read pages.
    expect(captured.content.kind).toBe('wordprocessing');
    expect(captured.pages).toBeDefined();
  });
});
