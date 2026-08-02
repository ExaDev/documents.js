//#region src/inline/node.d.ts
type InlineNodeKind = 'text' | 'emphasis' | 'strong' | 'strikethrough' | 'codeSpan' | 'link' | 'image' | 'autolink' | 'hardBreak' | 'softBreak' | 'rawHtml' | 'entity' | 'container';
declare class InlineNode {
  readonly kind: InlineNodeKind;
  literal: string;
  destination: string;
  title: string | undefined;
  email: boolean;
  marker: '_' | '*';
  raw: string;
  parent: InlineNode | undefined;
  firstChild: InlineNode | undefined;
  lastChild: InlineNode | undefined;
  previous: InlineNode | undefined;
  next: InlineNode | undefined;
  constructor(kind: InlineNodeKind);
  appendChild(child: InlineNode): void;
  insertAfter(sibling: InlineNode): void;
  unlink(): void;
}
declare function createTextNode(literal: string): InlineNode;
//#endregion
export { InlineNode, InlineNodeKind, createTextNode };