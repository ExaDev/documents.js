import { describe, expect, it } from 'vitest';
import type { ContentBlock, ContentDocument, ContentParagraph, ContentRun, DocumentPackage } from 'document-schema.js';
import { DocumentPackageSchema } from 'document-schema.js';
import { assemblePackage, factorStyles } from './factor-styles';
import { flattenPackage } from './flatten';
import { canonicalise } from './canonicalise';

// The minting rules as focused fixtures: the >=2 frequency threshold, the paragraph/run namespaces, the ban list (frames/sourcePath/styleId never enter a tuple), refs on wrappers only, the frozen-key rule for nested wrappers, chain-scoped stripping for nodes aliased under sibling wrappers, entry ordering and determinism, and idempotence. The bijection corpus (bijection.test.ts) re-runs the effective-equality and idempotence laws over real reader/conversion output; these tests pin the mechanism itself on minimal hand-built documents.

const SECTION = { pageSize: { widthPt: 595, heightPt: 842 }, margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 } };

function run(text: string, properties: Record<string, unknown> = {}): ContentRun {
  return { text, ...properties };
}

function paragraph(runs: readonly ContentRun[], properties: Record<string, unknown> = {}): ContentParagraph {
  return { kind: 'paragraph', runs: [...runs], ...properties };
}

function wordprocessingDoc(blocks: ContentBlock[], metadata: Record<string, unknown> = {}): ContentDocument {
  return { kind: 'wordprocessing', metadata, sections: [{ ...SECTION, blocks }] };
}

function canon(value: unknown): unknown {
  return JSON.parse(JSON.stringify(canonicalise(value)));
}

// Recovers every group wrapper carrying a style ref, in tree order, as [ref, node-kind] pairs -- the shape assertions below read the minted tree through it rather than by index-walking.
function refsOf(pkg: DocumentPackage): { readonly ref: string; readonly nodeKind: string }[] {
  const found: { readonly ref: string; readonly nodeKind: string }[] = [];
  function walk(value: unknown): void {
    if (Array.isArray(value)) {
      for (const child of value) walk(child);
      return;
    }
    if (typeof value !== 'object' || value === null) return;
    const record = value as Record<string, unknown>;
    if ('node' in record && 'children' in record && typeof record.style === 'string') {
      const node = record.node;
      const kind = typeof node === 'object' && node !== null && 'kind' in node && typeof node.kind === 'string' ? node.kind : 'shape/anchor';
      found.push({ ref: record.style, nodeKind: kind });
    }
    for (const child of Object.values(record)) walk(child);
  }
  walk(pkg.children);
  return found;
}

function containsKeyAnywhere(value: unknown, key: string): boolean {
  if (Array.isArray(value)) return value.some((child) => containsKeyAnywhere(child, key));
  if (typeof value !== 'object' || value === null) return false;
  for (const [k, child] of Object.entries(value)) {
    if (k === key) return true;
    if (containsKeyAnywhere(child, key)) return true;
  }
  return false;
}

describe('factorStyles minting', () => {
  it('factors a paragraph tuple occurring twice onto a wrapper ref and strips it from both positions', () => {
    const doc = wordprocessingDoc([
      paragraph([run('one')], { indentLeftPt: 20, alignment: 'left' }),
      paragraph([run('two')], { indentLeftPt: 20, alignment: 'left' }),
      paragraph([run('three')], { indentLeftPt: 20, alignment: 'right' }),
    ]);
    const minted = assemblePackage(doc);
    // The section wrapper is the one scope whose extent holds both indentLeftPt-20-left positions (bare leaves at section root), and alignment+indent are carried by every extent paragraph, so one entry covers both keys for the two matching positions. The third paragraph keeps its differing alignment inline (present-wins), and shares the indent through the same entry only if its tuple matched -- it does not (alignment differs), so it stays fully inline.
    expect(refsOf(minted)).toEqual([{ ref: 's1', nodeKind: 'section' }]);
    const styles = minted.styles ?? {};
    expect(Object.keys(styles)).toEqual(['s1']);
    expect(styles.s1).toEqual({ paragraph: { alignment: 'left', indentLeftPt: 20 } });
    expect(minted.kind).toBe('wordprocessing');
    if (minted.kind !== 'wordprocessing') throw new Error('expected wordprocessing');
    const strip1 = minted.children[0]?.children[0];
    const strip2 = minted.children[0]?.children[1];
    const keep3 = minted.children[0]?.children[2];
    expect(strip1).toMatchObject({ kind: 'paragraph', runs: [{ text: 'one' }] });
    expect(strip1).not.toHaveProperty('indentLeftPt');
    expect(strip1).not.toHaveProperty('alignment');
    expect(strip2).not.toHaveProperty('indentLeftPt');
    expect(keep3).toMatchObject({ alignment: 'right', indentLeftPt: 20 });
    expect(DocumentPackageSchema.safeParse(minted).success).toBe(true);
  });

  it('mints nothing for singletons -- a ref plus its entry is larger than the inline tuple', () => {
    const doc = wordprocessingDoc([
      paragraph([run('only')], { indentLeftPt: 20 }),
      paragraph([run('other')], { indentLeftPt: 40 }),
    ]);
    const minted = assemblePackage(doc);
    expect(minted.styles).toBeUndefined();
    expect(refsOf(minted)).toEqual([]);
  });

  it('never factors the ban list: frames, sourcePath, and styleId stay per-node', () => {
    const doc = wordprocessingDoc([
      paragraph([run('one', { bold: true })], { styleId: 'Heading1' }),
      paragraph([run('two', { bold: true })], { styleId: 'Heading1' }),
    ]);
    const minted = assemblePackage(doc);
    expect(refsOf(minted)).toEqual([{ ref: 's1', nodeKind: 'section' }]);
    // styleId is identical on both paragraphs and occurs twice, but it is a per-node fact: no entry carries it and no paragraph loses it. bold occurs twice AND is carried by both extent runs, so the run half legitimately mints.
    expect(minted.styles?.s1).toEqual({ run: { bold: true } });
    expect(containsKeyAnywhere(minted.children, 'styleId')).toBe(true);
    expect(containsKeyAnywhere(minted.styles, 'styleId')).toBe(false);
  });

  it('mints run tuples on the wrapper whose extent covers the runs, stripping them from the runs', () => {
    const body = shapeBlocks(paragraph([run('a', { bold: true, sizePt: 12 })]), paragraph([run('b', { bold: true, sizePt: 12 })]));
    const doc: ContentDocument = { kind: 'presentation', metadata: {}, slides: [{ size: { widthPt: 960, heightPt: 540 }, shapes: [body], notes: '' }] };
    const minted = assemblePackage(doc);
    // Outermost-first: the slide wrapper's extent already covers both shape flows, so it (not the deeper shape group) carries the ref -- one entry styles every run in the slide, which is exactly the "slide body text" case the rule exists for.
    expect(refsOf(minted)).toEqual([{ ref: 's1', nodeKind: 'slide' }]);
    expect(minted.styles?.s1).toEqual({ run: { bold: true, sizePt: 12 } });
    const flat = flattenPackage(minted);
    if (flat.kind !== 'presentation') throw new Error('expected presentation');
    const runs = flat.slides[0]!.shapes[0]!.blocks.flatMap((block) => (block.kind === 'paragraph' ? block.runs : []));
    expect(runs).toEqual([run('a', { bold: true, sizePt: 12 }), run('b', { bold: true, sizePt: 12 })]);
  });

  it('freezes an ancestor\'s minted key for nested wrappers -- a deeper different value never shadows the ref that restores it', () => {
    const h1 = paragraph([run('Chapter')], { headingLevel: 1, indentLeftPt: 20 });
    const body1 = paragraph([run('one')], { indentLeftPt: 20 });
    const body2 = paragraph([run('two')], { indentLeftPt: 20 });
    const h2 = paragraph([run('Part')], { headingLevel: 2, indentLeftPt: 40 });
    const body3 = paragraph([run('three')], { indentLeftPt: 40 });
    const body4 = paragraph([run('four')], { indentLeftPt: 40 });
    const doc = wordprocessingDoc([h1, body1, body2, h2, body3, body4]);
    const minted = assemblePackage(doc);
    // The section mints {indentLeftPt: 20} (three positions: the H1 anchor and its two body leaves -- the H2 branch carries a different value and stays inline). indentLeftPt is then frozen for every wrapper below, so the H2 group -- whose extent shares {indentLeftPt: 40} three times -- mints nothing: re-minting the key with 40 would silently rewrite the value the section's ref restores for the stripped 20-positions in nothing, but would shadow it for any nested stripped position, and freezing is the rule that keeps the two namespaces apart.
    expect(refsOf(minted)).toEqual([{ ref: 's1', nodeKind: 'section' }]);
    expect(minted.styles?.s1).toEqual({ paragraph: { indentLeftPt: 20 } });
    if (minted.kind !== 'wordprocessing') throw new Error('expected wordprocessing');
    // The H2 nests INSIDE the still-open H1 group (decompose's stack), so find it by text anywhere in the tree.
    const h2Group = findGroupByText(minted, 'Part');
    expect(h2Group).toMatchObject({ node: { kind: 'paragraph', headingLevel: 2, indentLeftPt: 40 } });
    expect(h2Group).not.toHaveProperty('style');
    // Resolution restores the stripped positions exactly and leaves the H2 branch alone: gap-fill on the section's chain returns indentLeftPt 20 to the stripped three, and the inline 40s win where they sit.
    const flat = flattenPackage(minted);
    if (flat.kind !== 'wordprocessing') throw new Error('expected wordprocessing');
    const indents = flat.sections[0]!.blocks.map((block) => (block.kind === 'paragraph' ? block.indentLeftPt : undefined));
    expect(indents).toEqual([20, 20, 20, 40, 40, 40]);
  });

  it('orders entries by descending frequency and mints deterministically', () => {
    const doc: ContentDocument = {
      kind: 'wordprocessing',
      metadata: {},
      sections: [
        { ...SECTION, blocks: [paragraph([run('a')], { alignment: 'center' }), paragraph([run('b')], { alignment: 'center' })] },
        { ...SECTION, blocks: [paragraph([run('c')], { lineSpacing: 1.5 }), paragraph([run('d')], { lineSpacing: 1.5 }), paragraph([run('e')], { lineSpacing: 1.5 })] },
      ],
    };
    const minted = assemblePackage(doc);
    // lineSpacing occurs on three positions (section two), alignment on two (section one): the more frequent entry takes s1 regardless of document order, and the same input mints the identical tree twice.
    expect(minted.styles && Object.keys(minted.styles)).toEqual(['s1', 's2']);
    expect(minted.styles?.s1).toEqual({ paragraph: { lineSpacing: 1.5 } });
    expect(minted.styles?.s2).toEqual({ paragraph: { alignment: 'center' } });
    expect(canon(assemblePackage(doc))).toEqual(canon(minted));
  });

  it('is idempotent: factoring a second time mints the identical table and tree', () => {
    const doc = wordprocessingDoc([
      paragraph([run('one', { bold: true })], { indentLeftPt: 20, alignment: 'left' }),
      paragraph([run('two', { bold: true })], { indentLeftPt: 20, alignment: 'left' }),
    ]);
    const once = assemblePackage(doc);
    const twice = factorStyles(once);
    expect(canon(twice)).toEqual(canon(once));
    expect(twice.styles).toEqual(once.styles);
  });

  it('keeps flat output free of refs and effective-equal to the unfactored form, combining halves on one wrapper', () => {
    const doc = wordprocessingDoc([
      paragraph([run('one', { bold: true, sizePt: 14 })], { indentLeftPt: 20, alignment: 'left' }),
      paragraph([run('two', { bold: true, sizePt: 14 })], { indentLeftPt: 20, alignment: 'left' }),
      paragraph([run('three', { sizePt: 14 })], { indentLeftPt: 20, alignment: 'left' }),
    ]);
    const minted = assemblePackage(doc);
    // Every extent paragraph carries alignment+indentLeftPt and every run carries sizePt, so the section's one entry combines the paragraph half (three stripped positions) with the run half (three stripped runs); bold occurs on only two of the three runs, so it is not common and stays inline everywhere.
    expect(minted.styles?.s1).toEqual({ paragraph: { alignment: 'left', indentLeftPt: 20 }, run: { sizePt: 14 } });
    expect(refsOf(minted)).toEqual([{ ref: 's1', nodeKind: 'section' }]);
    const flat = flattenPackage(minted);
    expect(containsKeyAnywhere(flat, 'style')).toBe(false);
    expect(canon(flat)).toEqual(canon(doc));
    // Law (ii) in its direct form: the factored tree's materialised flat form IS the unfactored content, key for key (a wrapper carrying a ref the styles table does not back is malformed, so the comparison runs against the original document rather than a ref-stripped tree).
  });

  it('strips by copying, never mutating the input content', () => {
    const p1 = paragraph([run('one')], { indentLeftPt: 20 });
    const p2 = paragraph([run('two')], { indentLeftPt: 20 });
    const doc = wordprocessingDoc([p1, p2]);
    const snapshot = structuredClone(doc);
    assemblePackage(doc);
    expect(doc).toEqual(snapshot);
    expect(p1.indentLeftPt).toBe(20);
    expect(p2.indentLeftPt).toBe(20);
  });

  it('strips an aliased node at every position whose own chain minted -- identical tuple, both sibling wrappers mint', () => {
    const shared = paragraph([run('a')], { alignment: 'center', indentLeftPt: 20 });
    const doc: ContentDocument = {
      kind: 'wordprocessing',
      metadata: {},
      sections: [
        { ...SECTION, blocks: [shared, paragraph([run('b')], { alignment: 'center', indentLeftPt: 20 })] },
        { ...SECTION, blocks: [shared, paragraph([run('c')], { alignment: 'center', indentLeftPt: 20 })] },
      ],
    };
    const minted = assemblePackage(doc);
    // Both sections' extents hold two matching positions (the shared node plus a sibling leaf), so each mints the identical entry content and shares ONE table entry through the canonical key -- two refs, one row. Global factored bookkeeping would mark the shared node done at the first section, leaving the second position's chain ref-less while a node-keyed strip still took its properties; branch-scoped, both positions resolve their own ref back.
    expect(refsOf(minted)).toEqual([
      { ref: 's1', nodeKind: 'section' },
      { ref: 's1', nodeKind: 'section' },
    ]);
    expect(minted.styles?.s1).toEqual({ paragraph: { alignment: 'center', indentLeftPt: 20 } });
    const flat = flattenPackage(minted);
    expect(canon(flat)).toEqual(canon(doc));
  });

  it('strips an aliased node by its own branch\'s key set when sibling wrappers mint divergent entries', () => {
    const shared = paragraph([run('a')], { alignment: 'center', indentLeftPt: 20 });
    const doc: ContentDocument = {
      kind: 'wordprocessing',
      metadata: {},
      sections: [
        { ...SECTION, blocks: [shared, paragraph([run('b')], { alignment: 'center' })] },
        { ...SECTION, blocks: [shared, paragraph([run('c')], { alignment: 'center', indentLeftPt: 20 })] },
      ],
    };
    const minted = assemblePackage(doc);
    // Section one's extent shares only alignment (its second paragraph carries no indent), so it mints the alignment-only entry and strips just that key off the shared node's first position; section two's extent shares both keys and mints the wider entry. Whichever section plans second would overwrite a node-keyed global strip's key set, leaving the first position stripped of indentLeftPt with a ref that restores only alignment; per-wrapper strips keep each position's strip the set its own ref restores.
    expect(minted.styles?.s1).toEqual({ paragraph: { alignment: 'center' } });
    expect(minted.styles?.s2).toEqual({ paragraph: { alignment: 'center', indentLeftPt: 20 } });
    if (minted.kind !== 'wordprocessing') throw new Error('expected wordprocessing');
    const flat = flattenPackage(minted);
    if (flat.kind !== 'wordprocessing') throw new Error('expected wordprocessing');
    expect(flat.sections[0]!.blocks[0]).toMatchObject({ alignment: 'center', indentLeftPt: 20 });
    expect(flat.sections[1]!.blocks[0]).toMatchObject({ alignment: 'center', indentLeftPt: 20 });
    expect(canon(flat)).toEqual(canon(doc));
  });

  it('leaves an aliased node fully inline at a position whose own chain minted nothing', () => {
    const shared = paragraph([run('a')], { indentLeftPt: 20 });
    const doc: ContentDocument = {
      kind: 'wordprocessing',
      metadata: {},
      sections: [
        { ...SECTION, blocks: [shared, paragraph([run('b')], { indentLeftPt: 20 })] },
        { ...SECTION, blocks: [shared] },
      ],
    };
    const minted = assemblePackage(doc);
    // Section one mints (two matching positions); section two's extent is the aliased node alone -- a singleton, below the threshold -- so its chain carries no ref and the node must keep every property inline there: a node-keyed global strip would strip it at BOTH positions with no ref to restore the second.
    expect(refsOf(minted)).toEqual([{ ref: 's1', nodeKind: 'section' }]);
    expect(minted.styles?.s1).toEqual({ paragraph: { indentLeftPt: 20 } });
    if (minted.kind !== 'wordprocessing') throw new Error('expected wordprocessing');
    expect(minted.children[1]?.children[0]).toMatchObject({ kind: 'paragraph', indentLeftPt: 20 });
    const flat = flattenPackage(minted);
    expect(canon(flat)).toEqual(canon(doc));
  });

  it('mints nothing for a formula package (one leaf, no wrappers)', () => {
    const doc: ContentDocument = { kind: 'formula', metadata: {}, formula: { mathml: [] } };
    const minted = assemblePackage(doc);
    expect(minted.styles).toBeUndefined();
    expect(DocumentPackageSchema.safeParse(minted).success).toBe(true);
  });
});

// Finds the first group wrapper anywhere in the tree whose anchor paragraph's first run text matches -- the frozen-key test's H2 group sits nested inside the H1 group, not at any fixed depth.
function findGroupByText(pkg: DocumentPackage, text: string): { node: unknown; style?: string } | undefined {
  let found: { node: unknown; style?: string } | undefined;
  function walk(value: unknown): void {
    if (found !== undefined) return;
    if (Array.isArray(value)) {
      for (const child of value) walk(child);
      return;
    }
    if (typeof value !== 'object' || value === null) return;
    if ('node' in value && 'children' in value) {
      const node = value.node as ContentParagraph;
      if (node.kind === 'paragraph' && node.runs[0]?.text === text) {
        found = value;
        return;
      }
    }
    for (const child of Object.values(value)) walk(child);
  }
  walk(pkg.children);
  return found;
}

function shapeBlocks(...blocks: ContentBlock[]): { frame: { xPt: number; yPt: number; widthPt: number; heightPt: number }; insetLeftPt: number; insetTopPt: number; insetRightPt: number; insetBottomPt: number; blocks: ContentBlock[] } {
  return { frame: { xPt: 0, yPt: 0, widthPt: 400, heightPt: 300 }, insetLeftPt: 0, insetTopPt: 0, insetRightPt: 0, insetBottomPt: 0, blocks: [...blocks] };
}
