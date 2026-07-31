import type { Package, XmlElement, XmlNode } from 'odf.js';
import { formatOdfLength } from 'odf.js';
import { removeChild } from '../../xml/edit';
import { el } from '../../xml/fragment';
import { ensureAutomaticStyles, nextStyleName } from './automatic-styles';
import type { ParagraphInit } from './paragraph';
import { buildParagraph, OdtParagraph } from './paragraph';

// A genuinely new class shape with no docx analogue: ODF nests lists STRUCTURALLY -- a text:list contains text:list-item elements, each of which can itself contain either member text:p/text:h paragraphs or a further nested text:list -- unlike WordprocessingML's flat model, where every paragraph independently carries its own numId/level membership (see docx's paragraph.ts, DocxParagraph.list). OdtList/OdtListItem exist to build and navigate that real tree structure directly: list.addItem() returns an OdtListItem a caller appends paragraphs to; item.addNestedList() starts a further-nested text:list inside that same item, one level deeper. odf.js's own readOdt (src/typed/odt/read.ts) reads this back by walking the identical structure -- each top-level text:list gets a synthetic numId, and each level of text:list nesting inside a text:list-item increments ContentParagraph.list.level -- so a list built through this class round-trips to the level depths a caller actually built.

const LIST_STYLE_PREFIX = 'OdtList';
const MAX_LIST_LEVELS = 10; // ODF's own conventional ceiling (every real ODF producer emits exactly this many text:list-level-style-* children per text:list-style, regardless of how deep a given document's lists actually nest) -- matched here rather than guessing a smaller number that would leave a level 11 nesting silently unstyled.
const LIST_LEVEL_INDENT_PT = 18; // 0.25in per level, a conventional bullet-list indent step.
const LIST_LEVEL_LABEL_WIDTH_PT = 18;

function buildBulletListStyle(name: string): XmlElement {
  const levels: XmlElement[] = [];
  for (let level = 1; level <= MAX_LIST_LEVELS; level++) {
    levels.push(
      el('text:list-level-style-bullet', { 'text:level': String(level), 'text:bullet-char': '•' }, [
        el('style:list-level-properties', {
          'text:space-before': formatOdfLength(LIST_LEVEL_INDENT_PT * (level - 1), 'pt'),
          'text:min-label-width': formatOdfLength(LIST_LEVEL_LABEL_WIDTH_PT, 'pt'),
        }),
      ]),
    );
  }
  return el('text:list-style', { 'style:name': name }, levels);
}

// Mints a brand-new, uniquely-named bullet list-style and appends it to office:automatic-styles -- every new top-level OdtList gets its own, even though the bullet definition itself is always the same shape, keeping this free of any dedup bookkeeping (unlike StyleRegistry.intern's fingerprint cache, there is exactly one property set a list style here would ever need, so a second, identical entry costs a little extra XML but nothing else).
function internBulletListStyle(pkg: Package): string {
  const automaticStyles = ensureAutomaticStyles(pkg);
  const name = nextStyleName(automaticStyles, 'text:list-style', LIST_STYLE_PREFIX);
  automaticStyles.children.push(buildBulletListStyle(name));
  return name;
}

// A live view over a text:list-item element. Not independently removable through this editor (mirrors DocxTableCell/DocxTableRow, src/edit/docx/table.ts, neither of which carry a remove() of their own) -- an item's lifetime is tied to its owning OdtList.
export class OdtListItem {
  private readonly node: XmlElement;
  private readonly pkg: Package;

  constructor(node: XmlElement, pkg: Package) {
    this.node = node;
    this.pkg = pkg;
  }

  appendParagraph(init?: ParagraphInit): OdtParagraph {
    const paragraphElement = buildParagraph(this.pkg, init);
    this.node.children.push(paragraphElement);
    return new OdtParagraph(this.node.children, paragraphElement, this.pkg);
  }

  // Starts a further-nested text:list one level deeper, directly inside this item -- odf.js's own readOdt increments ContentParagraph.list.level by exactly one per text:list nested this way (src/typed/odt/read.ts's readListItems).
  addNestedList(): OdtList {
    const listElement = el('text:list', { 'text:style-name': internBulletListStyle(this.pkg) });
    this.node.children.push(listElement);
    return new OdtList(this.node.children, listElement, this.pkg);
  }
}

// A live view over a text:list element -- see docx's table.ts (DocxTable) for the same container/node/removed live-view shape.
export class OdtList {
  private readonly container: XmlNode[];
  private readonly node: XmlElement;
  private readonly pkg: Package;
  private removed = false;

  constructor(container: XmlNode[], node: XmlElement, pkg: Package) {
    this.container = container;
    this.node = node;
    this.pkg = pkg;
  }

  private live(): XmlElement {
    if (this.removed) {
      throw new Error('this OdtList has been removed from its body and can no longer be used');
    }
    return this.node;
  }

  items(): OdtListItem[] {
    const out: OdtListItem[] = [];
    for (const child of this.live().children) {
      if (child.type === 'element' && child.tag === 'text:list-item') {
        out.push(new OdtListItem(child, this.pkg));
      }
    }
    return out;
  }

  addItem(): OdtListItem {
    const itemElement = el('text:list-item');
    this.live().children.push(itemElement);
    return new OdtListItem(itemElement, this.pkg);
  }

  remove(): void {
    removeChild(this.container, this.live());
    this.removed = true;
  }
}

// Builds a fresh, top-level text:list from scratch (not a live view), minting its own bullet list-style. Used by OdtBody.appendList (editor.ts); addNestedList above builds a nested one the identical way, one level deeper in the tree.
export function buildList(pkg: Package): XmlElement {
  return el('text:list', { 'text:style-name': internBulletListStyle(pkg) });
}
