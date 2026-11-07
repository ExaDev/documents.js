import { describe, expect, it } from 'vitest';
import {
  canonicalizeOpcPackage,
  comparePartDigests,
  compareProjections,
  csvToXlsx,
  encodeMarkdownText,
  markdownToDocx,
  projectDocxContent,
  projectXlsxContent,
} from '../../src';

const options = { memoryBudgetBytes: 2 ** 30 };

// Proves the content projection runs inside a Cloudflare Workers isolate (workerd): the streaming scanner, the canonical form, the package digests (Web Crypto) and the docx and xlsx projections use no Node-only API. The packages are built by the package's own writers, so the test needs no fixture.
describe('content projection under the Cloudflare Workers runtime', () => {
  it('projects a docx, finds a package equal to itself equivalent, and reports a dropped paragraph as loss', async () => {
    const original = markdownToDocx(encodeMarkdownText('# Title\n\nFirst paragraph.\n\nSecond paragraph.\n'));
    const shorter = markdownToDocx(encodeMarkdownText('# Title\n\nFirst paragraph.\n'));
    const projection = await projectDocxContent(original, options);
    expect(projection.skippedParts).toEqual([]);
    expect(projection.units.get('body')?.get('Second')).toBe(1);
    expect(compareProjections(projection, projection).verdict).toBe('equivalent');
    expect(compareProjections(projection, await projectDocxContent(shorter, options)).verdict).toBe('loss');
  });

  it('projects an xlsx by resolved cell and reports a changed value', async () => {
    const original = csvToXlsx(encodeMarkdownText('a,b\n1,2\n'));
    const changed = csvToXlsx(encodeMarkdownText('a,b\n1,3\n'));
    const projection = await projectXlsxContent(original, options);
    expect(projection.cells.size).toBe(4);
    const comparison = compareProjections(projection, await projectXlsxContent(changed, options));
    expect(comparison.cells?.valueDiffer).toBe(1);
    expect(comparison.verdict).toBe('loss');
  });

  it('digests a package in canonical form, so equal packages have no differing part', async () => {
    const bytes = markdownToDocx(encodeMarkdownText('Body\n'));
    const form = await canonicalizeOpcPackage(bytes, options);
    const report = comparePartDigests(form, await canonicalizeOpcPackage(bytes, options));
    expect(report.differing).toEqual([]);
    expect(report.identical.length).toBe(form.parts.size);
  });
});
