import type { ContentBlock, ContentParagraph } from 'document-schema.js';
import { describe, expect, it } from 'vitest';
import { readOdtContent } from '../../odf/odt/read';
import { createOdt } from './editor';

function isParagraph(block: ContentBlock): block is ContentParagraph {
  return block.kind === 'paragraph';
}

function paragraphsOf(pkg: Parameters<typeof readOdtContent>[0]): ContentParagraph[] {
  const content = readOdtContent(pkg);
  if (content.kind !== 'wordprocessing') {
    throw new Error('expected a wordprocessing ContentDocument');
  }
  return content.sections[0]!.blocks.filter(isParagraph);
}

describe('OdtList / OdtListItem: structural nesting', () => {
  it('a 2-level nested list reads back through readOdtContent with the correct ContentParagraph.list.level values', () => {
    const editor = createOdt();
    const list = editor.body.appendList();
    const topItem = list.addItem();
    topItem.appendParagraph({ text: 'Top level item' });
    const nestedList = topItem.addNestedList();
    nestedList.addItem().appendParagraph({ text: 'Nested item' });

    const paragraphs = paragraphsOf(editor.toPackage());
    const top = paragraphs.find((p) => p.runs.map((r) => r.text).join('') === 'Top level item');
    const nested = paragraphs.find((p) => p.runs.map((r) => r.text).join('') === 'Nested item');

    expect(top?.list?.level).toBe(0);
    expect(nested?.list?.level).toBe(1);
    // Both paragraphs belong to the same top-level list, even though the nested one is one level deeper -- odf.js's own readOdt assigns one synthetic numId per top-level text:list and threads it through every nested text:list beneath it.
    expect(nested?.list?.numId).toBe(top?.list?.numId);
  });

  it('a 3-level nested list increments the level once per nesting', () => {
    const editor = createOdt();
    const list = editor.body.appendList();
    const level0 = list.addItem();
    level0.appendParagraph({ text: 'Level 0' });
    const level1List = level0.addNestedList();
    const level1 = level1List.addItem();
    level1.appendParagraph({ text: 'Level 1' });
    const level2List = level1.addNestedList();
    level2List.addItem().appendParagraph({ text: 'Level 2' });

    const paragraphs = paragraphsOf(editor.toPackage());
    const levels = new Map(paragraphs.map((p) => [p.runs.map((r) => r.text).join(''), p.list?.level]));
    expect(levels.get('Level 0')).toBe(0);
    expect(levels.get('Level 1')).toBe(1);
    expect(levels.get('Level 2')).toBe(2);
  });

  it('multiple sibling items at the same level all report list.level 0', () => {
    const editor = createOdt();
    const list = editor.body.appendList();
    list.addItem().appendParagraph({ text: 'One' });
    list.addItem().appendParagraph({ text: 'Two' });
    expect(list.items()).toHaveLength(2);

    const paragraphs = paragraphsOf(editor.toPackage());
    expect(paragraphs.filter((p) => p.list?.level === 0)).toHaveLength(2);
  });

  it('remove() removes the list and throws on any further use', () => {
    const editor = createOdt();
    const list = editor.body.appendList();
    list.addItem().appendParagraph({ text: 'One' });
    expect(editor.lists()).toHaveLength(1);
    list.remove();
    expect(editor.lists()).toHaveLength(0);
    expect(() => list.items()).toThrow(/removed/);
  });
});
