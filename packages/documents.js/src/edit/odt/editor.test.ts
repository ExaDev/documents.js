import { decodePackage } from 'odf.js';
import { describe, expect, it } from 'vitest';
import { assertAutomaticStylesOnlyAppended } from '../../test-support/odf-style-fidelity';
import { minimalOdtBytes, minimalOdtPackage } from '../../test-support/odt';
import { createOdt, openOdt } from './editor';

describe('openOdt / createOdt', () => {
  it('openOdt reads an existing package and exposes its paragraphs', () => {
    const editor = openOdt(minimalOdtBytes());
    const paragraphs = editor.paragraphs();
    expect(paragraphs.length).toBeGreaterThan(0);
    expect(paragraphs.map((p) => p.text).join(' ')).toContain('Second paragraph');
  });

  it('openOdt exposes existing tables', () => {
    const editor = openOdt(minimalOdtBytes());
    const tables = editor.tables();
    expect(tables).toHaveLength(1);
    expect(tables[0]?.cell(0, 0).text).toContain('A1');
    expect(tables[0]?.cell(0, 1).text).toContain('B1');
  });

  it('createOdt starts from a valid, empty, encodable package', () => {
    const editor = createOdt();
    expect(editor.paragraphs()).toHaveLength(0);
    const bytes = editor.toBytes();
    expect(decodePackage(bytes)).toEqual(editor.toPackage());
  });
});

describe('OdtEditor.body', () => {
  it('appendParagraph/appendTable/appendList/appendPageBreak all round-trip through toBytes', () => {
    const editor = createOdt();
    editor.body.appendParagraph({ text: 'First' });
    editor.body.appendPageBreak();
    editor.body.appendParagraph({ text: 'Second' });
    editor.body.appendTable({ rows: 1, columns: 1 }).cell(0, 0).appendParagraph({ text: 'Cell' });
    editor.body.appendList().addItem().appendParagraph({ text: 'Item' });
    expect(() => editor.toBytes()).not.toThrow();
    expect(decodePackage(editor.toBytes())).toEqual(editor.toPackage());
  });

  it('appendPageBreak inserts an empty paragraph pointed at the shared page-break style, reused (not re-minted) across calls', () => {
    const editor = createOdt();
    editor.body.appendPageBreak();
    editor.body.appendPageBreak();
    const styleNames = editor
      .paragraphs()
      .map((p) => p.styleId)
      .filter((id) => id !== undefined);
    expect(new Set(styleNames).size).toBe(1);
  });
});

describe('live-view fidelity: mutating one run must not change any other part', () => {
  it('mutating a run in content.xml leaves every other part byte-for-byte unchanged, except appending the new automatic style', () => {
    const before = minimalOdtPackage();
    const editor = openOdt(minimalOdtBytes());
    // The fixture's first paragraph-level child is a heading (text:h, no runs); the run to mutate lives in the first paragraph that carries one -- found rather than indexed, since paragraphs() surfaces text:p and text:h both.
    const run = editor.paragraphs().find((p) => p.runs().length > 0)?.runs()[0];
    if (run === undefined) {
      throw new Error('expected at least one text:span run in the fixture');
    }
    run.text = 'Mutated!';
    run.bold = true;

    const after = editor.toPackage();
    expect(after.parts['content.xml']).not.toEqual(before.parts['content.xml']);
    assertAutomaticStylesOnlyAppended(before, after);
  });

  it('adding a new paragraph leaves every existing automatic style entry untouched', () => {
    const before = minimalOdtPackage();
    const editor = openOdt(minimalOdtBytes());
    editor.body.appendParagraph({ text: 'New paragraph' });
    assertAutomaticStylesOnlyAppended(before, editor.toPackage());
  });
});

describe('full editor round trip: open a real odt, mutate an existing run, add a paragraph, save, reopen', () => {
  it('the mutation and the addition both survive, and every untouched style entry from before the edit is still present', () => {
    const before = minimalOdtPackage();
    const editor = openOdt(minimalOdtBytes());

    // Mutate bold/colour/alignment on the existing "bold text" run (a real text:span already present in the fixture, referencing a pre-existing automatic style) -- found rather than indexed, since the fixture's first paragraph-level child is a heading (text:h) and paragraphs() surfaces text:p and text:h both.
    const paragraph = editor.paragraphs().find((p) => p.runs().some((r) => r.text === 'bold text'));
    if (paragraph === undefined) {
      throw new Error('expected at least one paragraph in the fixture');
    }
    const run = paragraph.runs().find((r) => r.text === 'bold text');
    if (run === undefined) {
      throw new Error('expected the fixture to have an existing "bold text" run');
    }
    run.bold = true; // already true in the fixture -- re-asserting it still exercises the resolve-merge-intern path
    run.color = { r: 0, g: 0, b: 1 };
    paragraph.alignment = 'center';

    // Add a brand-new paragraph alongside the existing content.
    editor.body.appendParagraph({ text: 'Freshly added paragraph' });

    const bytes = editor.toBytes();
    assertAutomaticStylesOnlyAppended(before, editor.toPackage());

    // Save, then reopen from the serialized bytes -- not the same in-memory Package -- to prove the mutation is real, encoded XML, not just an in-memory object mutation.
    const reopened = openOdt(bytes);
    const reopenedParagraphs = reopened.paragraphs();
    expect(reopenedParagraphs.map((p) => p.text)).toContain('Freshly added paragraph');

    const reopenedTarget = reopenedParagraphs.find((p) => p.text.includes('bold text'));
    if (reopenedTarget === undefined) {
      throw new Error('expected the mutated paragraph to survive the round trip');
    }
    expect(reopenedTarget.alignment).toBe('center');
    const reopenedRun = reopenedTarget.runs().find((r) => r.text === 'bold text');
    expect(reopenedRun?.bold).toBe(true);
    expect(reopenedRun?.color).toEqual({ r: 0, g: 0, b: 1 });

    // Everything the edit never touched -- the heading, the table -- is still there untouched.
    expect(reopened.tables()[0]?.cell(0, 0).text).toContain('A1');
  });
});
