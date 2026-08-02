// The MUTABLE, doubly-linked working node the inline phase builds during parsing, before converting to src/ast's own readonly MarkdownInlineNode union at the end (src/inline/inline.ts's toInlineAst).
//
// Why a second node type at all, rather than building MarkdownInlineNode directly: CommonMark's emphasis resolution is inherently a post-hoc restructuring pass, not a recursive descent. `*a **b* c**` cannot be decided until the whole block has been scanned, and resolving it means taking an already-emitted RUN OF SIBLINGS and re-parenting it inside a new emphasis node, repeatedly, while a delimiter stack holds live references to the text nodes those delimiters live in. A doubly-linked sibling list makes "move everything between these two nodes into a new node" an O(k) pointer update; the readonly arrays MarkdownInlineNode uses would force a rebuild of every enclosing array on each of what can be hundreds of such moves in one paragraph. The same reasoning applies to the delimiter stack itself (src/inline/delimiter.ts), which is a linked list for the same reason: a delimiter is removed from the MIDDLE of the stack routinely, and every other delimiter must keep its identity across that removal.
//
// This type is entirely internal: it is never exported from src/index.ts, never crosses a public boundary, and is discarded the moment toInlineAst has walked it.

export type InlineNodeKind =
  | 'text'
  | 'emphasis'
  | 'strong'
  | 'strikethrough'
  | 'codeSpan'
  | 'link'
  | 'image'
  | 'autolink'
  | 'hardBreak'
  | 'softBreak'
  | 'rawHtml'
  | 'entity'
  // The synthetic root every inline parse builds into -- never converted to an AST node itself, only its children are.
  | 'container';

export class InlineNode {
  readonly kind: InlineNodeKind;

  // Literal text (text/codeSpan/rawHtml), the resolved character(s) of an entity, or the destination of a link/image/autolink -- each node kind reads only the fields its own kind defines, exactly as MarkdownInlineNode's discriminated union does after conversion.
  literal = '';
  destination = '';
  title: string | undefined;
  email = false;
  // Which of `*`/`_` produced an emphasis/strong node, preserved so writeMarkdown can emit the original marker rather than normalising every document to one character.
  marker: '_' | '*' = '*';
  // An entity node's own literal source text (e.g. '&amp;'), kept alongside `literal`'s decoded value.
  raw = '';

  parent: InlineNode | undefined;
  firstChild: InlineNode | undefined;
  lastChild: InlineNode | undefined;
  previous: InlineNode | undefined;
  next: InlineNode | undefined;

  constructor(kind: InlineNodeKind) {
    this.kind = kind;
  }

  appendChild(child: InlineNode): void {
    child.unlink();
    child.parent = this;
    if (this.lastChild === undefined) {
      this.firstChild = child;
      this.lastChild = child;
      return;
    }
    child.previous = this.lastChild;
    this.lastChild.next = child;
    this.lastChild = child;
  }

  insertAfter(sibling: InlineNode): void {
    sibling.unlink();
    sibling.next = this.next;
    if (sibling.next !== undefined) {
      sibling.next.previous = sibling;
    }
    sibling.previous = this;
    this.next = sibling;
    sibling.parent = this.parent;
    if (sibling.next === undefined && sibling.parent !== undefined) {
      sibling.parent.lastChild = sibling;
    }
  }

  // Detaches this node from its siblings and parent, leaving its own children intact -- used both to discard a fully-consumed delimiter's text node and to move a node into a newly created emphasis/link wrapper.
  unlink(): void {
    if (this.previous !== undefined) {
      this.previous.next = this.next;
    } else if (this.parent !== undefined) {
      this.parent.firstChild = this.next;
    }
    if (this.next !== undefined) {
      this.next.previous = this.previous;
    } else if (this.parent !== undefined) {
      this.parent.lastChild = this.previous;
    }
    this.parent = undefined;
    this.next = undefined;
    this.previous = undefined;
  }
}

export function createTextNode(literal: string): InlineNode {
  const node = new InlineNode('text');
  node.literal = literal;
  return node;
}
