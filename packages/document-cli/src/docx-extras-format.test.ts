import type { DocxExtras } from 'documents.js';
import { decodePackage, readDocxExtras } from 'documents.js';
import { describe, expect, it } from 'vitest';
import { formatDocxExtrasLines } from './docx-extras-format';
import { buildDocxWithExtras, DOCX_EXTRAS_FIXTURE } from './test-support/docx-extras-fixture';

const EMPTY_EXTRAS: DocxExtras = { comments: [], footnotes: [], headers: [], footers: [], numbering: {} };

function fixtureExtras(): DocxExtras {
  return readDocxExtras(decodePackage(buildDocxWithExtras()));
}

describe('formatDocxExtrasLines', () => {
  it('says so plainly when the document carries none of the five kinds of extra data', () => {
    expect(formatDocxExtrasLines(EMPTY_EXTRAS)).toStrictEqual(['This document carries no comments, footnotes, headers, footers, or numbering definitions.']);
  });

  it("renders every comment by 1-based position, an author-less comment reading '(no author)'", () => {
    const extras = fixtureExtras();
    expect(extras.comments).toHaveLength(2);
    const lines = formatDocxExtrasLines(extras);
    expect(lines).toContain('comments');
    expect(lines).toContain(`  [1] ${DOCX_EXTRAS_FIXTURE.commentAuthor}: ${DOCX_EXTRAS_FIXTURE.commentWithAuthorText}`);
    expect(lines).toContain(`  [2] (no author): ${DOCX_EXTRAS_FIXTURE.commentWithoutAuthorText}`);
  });

  it('renders the one real footnote, with the separator footnote already excluded by readDocxExtras itself', () => {
    const extras = fixtureExtras();
    expect(extras.footnotes).toHaveLength(1);
    expect(formatDocxExtrasLines(extras)).toContain(`  [1] ${DOCX_EXTRAS_FIXTURE.footnoteText}`);
  });

  it('renders headers and footers as their own labelled, 1-based-position sections', () => {
    const lines = formatDocxExtrasLines(fixtureExtras());
    expect(lines).toContain('headers');
    expect(lines).toContain(`  [1] ${DOCX_EXTRAS_FIXTURE.headerText}`);
    expect(lines).toContain('footers');
    expect(lines).toContain(`  [1] ${DOCX_EXTRAS_FIXTURE.footerText}`);
  });

  it('renders a numbering definition keyed by numId, its own level keyed by ilvl in ascending numeric order', () => {
    const lines = formatDocxExtrasLines(fixtureExtras());
    expect(lines).toContain('numbering');
    expect(lines).toContain(`  numId ${DOCX_EXTRAS_FIXTURE.numId}`);
    expect(lines).toContain(`    level 0: ${DOCX_EXTRAS_FIXTURE.numberingLevel.format} ${JSON.stringify(DOCX_EXTRAS_FIXTURE.numberingLevel.text)} starting at 1`);
  });

  it('separates non-empty sections with exactly one blank line, and never leads with one', () => {
    const lines = formatDocxExtrasLines(fixtureExtras());
    expect(lines[0]).toBe('comments');
    const blankIndices = lines.reduce<number[]>((acc, line, index) => (line === '' ? [...acc, index] : acc), []);
    // Five sections in the fixture (comments, footnotes, headers, footers, numbering) -> four separating blank lines.
    expect(blankIndices).toHaveLength(4);
  });
});
