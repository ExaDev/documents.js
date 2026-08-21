import { describe, expect, it } from 'vitest';
import type { ContentParagraph, ContentRun } from './content';
import {
  applyParagraphStyleProperties,
  applyRunStyleProperties,
  DefinitionEntrySchema,
  DefinitionsTableSchema,
  overlayStyleEntries,
  resolveStyleChain,
  StyleEntrySchema,
  StylesTableSchema,
  type StyleEntry,
  type StylesTable,
} from './definitions';

const BODY: StyleEntry = {
  paragraph: { alignment: 'justify', spacingAfterPt: 6 },
  run: { sizePt: 11 },
};
const EMPHASIS: StyleEntry = {
  paragraph: { alignment: 'left' },
  run: { italic: true, sizePt: 14 },
};

describe('StyleEntrySchema enforces the entry shape', () => {
  it('accepts resolved canonical paragraph and run properties, either or both halves', () => {
    expect(StyleEntrySchema.safeParse(BODY).success).toBe(true);
    expect(StyleEntrySchema.safeParse({ paragraph: { lineSpacing: 1.5 } }).success).toBe(true);
    expect(StyleEntrySchema.safeParse({ run: { fontFamily: 'Carlito', bold: true } }).success).toBe(true);
    expect(StyleEntrySchema.safeParse({}).success).toBe(true);
  });

  it('rejects the banned per-node facts wherever they appear -- frames, sourcePath, and styleId fail outright, they are not silently stripped', () => {
    for (const banned of ['frames', 'sourcePath', 'styleId']) {
      expect(StyleEntrySchema.safeParse({ [banned]: 'x' }).success).toBe(false);
      expect(StyleEntrySchema.safeParse({ paragraph: { [banned]: 'x' } }).success).toBe(false);
      expect(StyleEntrySchema.safeParse({ run: { [banned]: 'x' } }).success).toBe(false);
    }
    expect(StyleEntrySchema.safeParse({ paragraph: { frames: [{ pageIndex: 0, xPt: 1, yPt: 1, widthPt: 1, heightPt: 1 }] } }).success).toBe(false);
  });

  it('rejects misnested properties -- run fields do not belong at entry level or under paragraph, and sizePt is the run field name, not fontPt', () => {
    expect(StyleEntrySchema.safeParse({ bold: true }).success).toBe(false);
    expect(StyleEntrySchema.safeParse({ paragraph: { bold: true } }).success).toBe(false);
    expect(StyleEntrySchema.safeParse({ run: { fontPt: 11 } }).success).toBe(false);
    expect(StyleEntrySchema.safeParse({ paragraph: { alignment: 'diagonal' } }).success).toBe(false);
  });

  it('rejects a basedOn-style graph edge inside the table', () => {
    expect(StyleEntrySchema.safeParse({ basedOn: 'other' }).success).toBe(false);
  });

  it('accepts the page-break properties on the paragraph half, matching the node field set', () => {
    expect(StyleEntrySchema.safeParse({ paragraph: { pageBreakBefore: true } }).success).toBe(true);
    expect(StyleEntrySchema.safeParse({ paragraph: { pageBreakAfter: true } }).success).toBe(true);
    expect(StyleEntrySchema.safeParse({ run: { pageBreakBefore: true } }).success).toBe(false);
  });
});

describe('StylesTableSchema', () => {
  it('accepts a table of named entries and rejects a non-entry value under a key', () => {
    expect(StylesTableSchema.safeParse({ s1: BODY, s2: EMPHASIS }).success).toBe(true);
    expect(StylesTableSchema.safeParse({ s1: { paragraph: { frames: [] } } }).success).toBe(false);
  });
});

describe('the definitions facility stays tenant-generic', () => {
  it('accepts and PRESERVES any tenant body -- unknown keys ride through a parse rather than being stripped', () => {
    const parsed = DefinitionEntrySchema.parse({ kind: 'link', url: 'https://example.com', title: 'Example' });
    expect(parsed).toEqual({ kind: 'link', url: 'https://example.com', title: 'Example' });
    const footnote = DefinitionEntrySchema.parse({ kind: 'footnote', marker: '1', blocks: [] });
    expect(footnote).toEqual({ kind: 'footnote', marker: '1', blocks: [] });
  });

  it('requires the tenant discriminator and rejects a non-string kind', () => {
    expect(DefinitionEntrySchema.safeParse({ url: 'https://example.com' }).success).toBe(false);
    expect(DefinitionEntrySchema.safeParse({ kind: 7 }).success).toBe(false);
  });

  it('carries no styles vocabulary of its own -- a StyleEntry is not a DefinitionEntry and vice versa', () => {
    expect(DefinitionEntrySchema.safeParse(BODY).success).toBe(false);
    expect(StyleEntrySchema.safeParse({ kind: 'link', url: 'https://example.com' }).success).toBe(false);
  });

  it('holds both tenants side by side in one table', () => {
    const table = {
      l1: { kind: 'link', url: 'https://example.com' },
      f1: { kind: 'footnote', marker: '1' },
    };
    expect(DefinitionsTableSchema.safeParse(table).success).toBe(true);
  });
});

describe('overlayStyleEntries', () => {
  it('innermost wins per property; a property only outer carries falls through', () => {
    const merged = overlayStyleEntries(BODY, EMPHASIS);
    expect(merged.paragraph).toEqual({ alignment: 'left', spacingAfterPt: 6 });
    expect(merged.run).toEqual({ sizePt: 14, italic: true });
  });

  it('emits no key for a half neither side carries', () => {
    const merged = overlayStyleEntries({}, { run: { bold: true } });
    expect(merged).toEqual({ run: { bold: true } });
    expect('paragraph' in merged).toBe(false);
  });

  it('explicitly-present-undefined inner values do not overwrite outer -- absence is not a value', () => {
    const merged = overlayStyleEntries(BODY, { paragraph: { alignment: undefined } });
    expect(merged.paragraph).toEqual({ alignment: 'justify', spacingAfterPt: 6 });
  });
});

describe('resolveStyleChain', () => {
  const styles: StylesTable = { base: BODY, emphasis: EMPHASIS };

  it('folds refs outermost-first with innermost winning', () => {
    expect(resolveStyleChain(styles, ['base', 'emphasis'])).toEqual(overlayStyleEntries(BODY, EMPHASIS));
    expect(resolveStyleChain(styles, ['emphasis', 'base'])).toEqual(overlayStyleEntries(EMPHASIS, BODY));
  });

  it('resolves one ref to itself and zero refs to an empty entry', () => {
    expect(resolveStyleChain(styles, ['base'])).toEqual(BODY);
    expect(resolveStyleChain(styles, [])).toEqual({});
  });

  it('throws on a ref naming no entry -- an unresolvable ref is loud, never a silent skip', () => {
    expect(() => resolveStyleChain(styles, ['base', 'missing'])).toThrow(/missing/);
  });
});

describe('applyParagraphStyleProperties and applyRunStyleProperties', () => {
  it('fills only the gaps: the node\'s own direct properties win, style values supply the rest', () => {
    const paragraph: ContentParagraph = {
      kind: 'paragraph',
      runs: [],
      alignment: 'center',
    };
    const effective = applyParagraphStyleProperties(BODY.paragraph, paragraph);
    expect(effective.alignment).toBe('center');
    expect(effective.spacingAfterPt).toBe(6);
    expect(effective).not.toBe(paragraph);
    expect(paragraph.spacingAfterPt).toBeUndefined();
  });

  it('returns the input object itself when there is nothing to apply', () => {
    const paragraph: ContentParagraph = { kind: 'paragraph', runs: [] };
    expect(applyParagraphStyleProperties(undefined, paragraph)).toBe(paragraph);
    const run: ContentRun = { text: 'x' };
    expect(applyRunStyleProperties(undefined, run)).toBe(run);
  });

  it('fills a page-break gap from the entry without overwriting the node\'s own flag', () => {
    const paragraph: ContentParagraph = { kind: 'paragraph', runs: [], pageBreakBefore: false };
    const effective = applyParagraphStyleProperties({ pageBreakBefore: true, pageBreakAfter: true }, paragraph);
    expect(effective.pageBreakBefore).toBe(false);
    expect(effective.pageBreakAfter).toBe(true);
  });

  it('applies run defaults under the run\'s own properties -- the chain\'s one extra level down', () => {
    const run: ContentRun = { text: 'x', sizePt: 9 };
    const effective = applyRunStyleProperties(EMPHASIS.run, run);
    expect(effective.sizePt).toBe(9);
    expect(effective.italic).toBe(true);
  });

  it('leaves non-style fields (text, hyperlink, sourcePath, frames) untouched', () => {
    const run: ContentRun = { text: 'x', hyperlink: 'https://example.com' };
    const effective = applyRunStyleProperties({ bold: true }, run);
    expect(effective.hyperlink).toBe('https://example.com');
    expect(effective.text).toBe('x');
  });
});
