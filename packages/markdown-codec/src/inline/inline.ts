// The inline phase: one block's raw inline content string -> src/ast's MarkdownInlineNode[]. A single left-to-right scan that dispatches on the current character, with two stacks (delimiters for emphasis/strong/strikethrough, brackets for links/images) resolved after the fact, exactly as CommonMark 0.31.2's own "Phase 2: inline structure" describes.
//
// Precedence, highest first, matching the spec's own "Precedence" section and the order of the dispatch below:
//   1. code spans -- a run of N backticks opens, and only a run of exactly N backticks closes; nothing inside is interpreted
//   2. backslash escapes and character references -- both consume their own source outright before any other construct sees it
//   3. autolinks and raw HTML tags -- both anchored on `<`, tried in that order
//   4. links and images -- resolved by the bracket stack, which binds MORE tightly than emphasis (`*[foo*](url)` is a link)
//   5. emphasis, strong emphasis, and strikethrough -- one shared delimiter stack, resolved by src/inline/delimiter.ts
//   6. hard and soft line breaks
//
// The link-reference-definition table is an INPUT, never built here. Definitions are document-global and forward-visible -- `[foo]` in the first paragraph resolves against a `[foo]: /url` on the document's last line -- so the whole document's definitions must already be known before any block's inlines are parsed. The block phase owns that scan and hands the finished table down; discovering definitions per-block during inline parsing would silently fail every forward reference.

import type { MarkdownImageNode, MarkdownInlineNode, MarkdownLinkNode } from '../ast/ast';
import { matchHtmlTag } from '../html/html';
import { containsAsciiControlOrSpace, isAsciiPunctuation } from './chars';
import type { Delimiter, DelimiterChar } from './delimiter';
import { DelimiterStack, isDelimiterChar, processEmphasis, scanDelimiterRun } from './delimiter';
import { matchEntity } from './entity';
import { applyGfmAutolinks } from './gfm-autolink';
import type { LinkReferenceMap, ParsedSpan } from './link';
import { matchLinkLabel, normalizeLinkLabel, parseLinkDestination, parseLinkTitle, skipInlineWhitespace } from './link';
import { InlineNode, createTextNode } from './node';

export interface InlineParseOptions {
  // GFM's extended (bracket-less) autolinks -- `www.example.com`, a bare `https://...`, a bare email address. Enabled by default because this package targets CommonMark *and* GFM; pure-CommonMark callers (and this package's own CommonMark conformance suite) switch it off, since a bare URL in paragraph text is plain text under CommonMark alone.
  readonly gfmAutolinks?: boolean;
  // GFM's `~`/`~~` strikethrough. Enabled by default for the same reason; with it off, every `~` is ordinary text, which is CommonMark's own reading.
  readonly gfmStrikethrough?: boolean;
}

// A run of characters that no inline construct can start with -- everything the dispatch below does NOT have a branch for. Sticky rather than sliced-and-anchored so scanning a long paragraph stays linear instead of re-copying the subject's tail on every plain-text run.
const PLAIN_TEXT_PATTERN = /[^\n`[\]\\!<&*_~]+/y;

// spec 0.31.2: "a scheme is any sequence of 2-32 characters beginning with an ASCII letter and followed by any combination of ASCII letters, digits, or the symbols plus, period, or hyphen", then a colon, then "zero or more characters other than ASCII control characters, space, `<`, and `>`".
const URI_AUTOLINK_PATTERN = /<[A-Za-z][A-Za-z0-9.+-]{1,31}:[^<>]*>/y;

// spec 0.31.2 adopts the HTML5 specification's own non-normative email regex verbatim for this purpose.
const EMAIL_AUTOLINK_PATTERN = /<([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)>/y;

// A hard line break is "two or more spaces at the end of a line" (spec 0.31.2, "Hard line breaks"); one trailing space is a soft break with the space dropped.
const HARD_BREAK_SPACES = '  ';

// A `]` closing a reference link needs the source text of the label between the brackets; a label of exactly two characters is `[]`, the COLLAPSED form, which carries no label of its own and reuses the link text instead.
const EMPTY_LABEL_LENGTH = 2;

interface Bracket {
  // The `[` or `![` text node this bracket opened with -- unlinked when the bracket resolves into a real link/image, left as literal text when it does not.
  readonly node: InlineNode;
  readonly previous: Bracket | undefined;
  // The delimiter stack's own top at the moment this bracket was pushed, used as the floor for the emphasis pass that runs when the bracket closes -- so emphasis inside a link resolves without ever pairing across the link's boundary.
  readonly previousDelimiter: Delimiter | undefined;
  // Source position of the `[` (for `![`, of the `[`, not of the `!`).
  readonly index: number;
  readonly image: boolean;
  // Cleared on every earlier link opener once a link successfully closes -- CommonMark's "no links inside links" rule. An image opener is left alone, since images may nest inside links and vice versa.
  active: boolean;
  // Set when a later bracket is pushed while this one is still open. A shortcut reference (`[foo]` with no second label) is impossible once the link text itself contained a bracket, so this short-circuits a lookup that could never match.
  bracketAfter: boolean;
}

interface LinkTarget {
  readonly destination: string;
  readonly title: string | undefined;
}

function stripOneSurroundingSpace(content: string): string {
  // spec 0.31.2: "If the resulting string both begins and ends with a space character, but does not consist entirely of space characters, a single space character is removed from the front and back."
  if (content.startsWith(' ') && content.endsWith(' ') && /[^ ]/.test(content)) {
    return content.slice(1, content.length - 1);
  }
  return content;
}

function createWrapper(kind: 'emphasis' | 'strong' | 'strikethrough', marker: DelimiterChar): InlineNode {
  const node = new InlineNode(kind);
  if (marker !== '~') {
    node.marker = marker;
  }
  return node;
}

class InlineParser {
  private readonly text: string;
  private readonly references: LinkReferenceMap;
  private readonly gfmStrikethrough: boolean;
  private readonly container = new InlineNode('container');
  private readonly delimiters = new DelimiterStack();
  private brackets: Bracket | undefined;
  private pos = 0;

  constructor(text: string, references: LinkReferenceMap, options: InlineParseOptions) {
    this.text = text;
    this.references = references;
    this.gfmStrikethrough = options.gfmStrikethrough ?? true;
  }

  parse(): InlineNode {
    while (this.pos < this.text.length) {
      this.step();
    }
    processEmphasis(this.delimiters, undefined, createWrapper);
    mergeAdjacentText(this.container);
    return this.container;
  }

  private step(): void {
    const char = this.text.charAt(this.pos);
    switch (char) {
      case '\n':
        this.parseLineBreak();
        return;
      case '\\':
        this.parseBackslash();
        return;
      case '`':
        this.parseCodeSpan();
        return;
      case '<':
        this.parseAngleBracket();
        return;
      case '&':
        this.parseEntity();
        return;
      case '[':
        this.parseOpenBracket();
        return;
      case '!':
        this.parseBang();
        return;
      case ']':
        this.parseCloseBracket();
        return;
      default:
        if (isDelimiterChar(char)) {
          this.parseDelimiterRun(char);
          return;
        }
        this.parsePlainText();
    }
  }

  private appendText(literal: string): InlineNode {
    const node = createTextNode(literal);
    this.container.appendChild(node);
    return node;
  }

  private parsePlainText(): void {
    PLAIN_TEXT_PATTERN.lastIndex = this.pos;
    const match = PLAIN_TEXT_PATTERN.exec(this.text);
    if (match === null) {
      // Unreachable while the dispatch above covers every character PLAIN_TEXT_PATTERN excludes; consuming one character keeps the loop strictly progressing rather than resting on that invariant.
      this.appendText(this.text.charAt(this.pos));
      this.pos += 1;
      return;
    }
    this.appendText(match[0]);
    this.pos += match[0].length;
  }

  // spec 0.31.2, "Hard line breaks"/"Soft line breaks": a line ending preceded by two or more spaces is a hard break (and the spaces are dropped); any other line ending is a soft break.
  private parseLineBreak(): void {
    this.pos += 1;
    const last = this.container.lastChild;
    if (last?.kind === 'text' && last.literal.endsWith(' ')) {
      const hard = last.literal.endsWith(HARD_BREAK_SPACES);
      last.literal = last.literal.replace(/ +$/, '');
      this.container.appendChild(new InlineNode(hard ? 'hardBreak' : 'softBreak'));
    } else {
      this.container.appendChild(new InlineNode('softBreak'));
    }
    // Leading spaces on the next line are not content. The block phase already strips a paragraph continuation line's indentation, so this only matters for a block whose raw content keeps it.
    while (this.text.charAt(this.pos) === ' ') {
      this.pos += 1;
    }
  }

  // spec 0.31.2, "Backslash escapes": a backslash before any ASCII punctuation character escapes it; a backslash before a line ending is a hard break; a backslash before anything else is a literal backslash.
  private parseBackslash(): void {
    this.pos += 1;
    const next = this.text.charAt(this.pos);
    if (next === '\n') {
      this.pos += 1;
      this.container.appendChild(new InlineNode('hardBreak'));
      return;
    }
    if (isAsciiPunctuation(next)) {
      this.appendText(next);
      this.pos += 1;
      return;
    }
    this.appendText('\\');
  }

  // spec 0.31.2, "Code spans": a backtick string of length N opens; the code span ends at the next backtick string of EXACTLY length N (a longer or shorter run is content, not a closer). With no such closer anywhere in the block, the opening run is literal text.
  private parseCodeSpan(): void {
    const start = this.pos;
    let openLength = 0;
    while (this.text.charAt(start + openLength) === '`') {
      openLength += 1;
    }
    const afterOpen = start + openLength;

    let scan = afterOpen;
    while (scan < this.text.length) {
      if (this.text.charAt(scan) !== '`') {
        scan += 1;
        continue;
      }
      let runLength = 0;
      while (this.text.charAt(scan + runLength) === '`') {
        runLength += 1;
      }
      if (runLength === openLength) {
        const node = new InlineNode('codeSpan');
        // spec 0.31.2: "First, line endings are converted to spaces."
        node.literal = stripOneSurroundingSpace(this.text.slice(afterOpen, scan).replace(/\n/g, ' '));
        this.container.appendChild(node);
        this.pos = scan + runLength;
        return;
      }
      scan += runLength;
    }

    this.appendText(this.text.slice(start, afterOpen));
    this.pos = afterOpen;
  }

  // `<` opens three mutually exclusive constructs, tried in spec order: a URI autolink, an email autolink, then a raw HTML tag. A `<` that starts none of them is ordinary text.
  private parseAngleBracket(): void {
    const uri = this.matchUriAutolink();
    if (uri !== undefined) {
      const node = new InlineNode('autolink');
      node.destination = uri;
      this.container.appendChild(node);
      this.pos += uri.length + 2;
      return;
    }

    EMAIL_AUTOLINK_PATTERN.lastIndex = this.pos;
    const email = EMAIL_AUTOLINK_PATTERN.exec(this.text);
    const address = email?.[1];
    if (email !== null && address !== undefined) {
      const node = new InlineNode('autolink');
      node.destination = address;
      node.email = true;
      this.container.appendChild(node);
      this.pos += email[0].length;
      return;
    }

    const tag = matchHtmlTag(this.text, this.pos);
    if (tag !== undefined) {
      const node = new InlineNode('rawHtml');
      node.literal = tag;
      this.container.appendChild(node);
      this.pos += tag.length;
      return;
    }

    this.appendText('<');
    this.pos += 1;
  }

  // The absolute URI between the angle brackets, or undefined when this is not a URI autolink. The "no ASCII control character or space" half of the spec's own definition is checked after matching rather than inside the pattern -- see containsAsciiControlOrSpace (src/inline/chars.ts) for why.
  private matchUriAutolink(): string | undefined {
    URI_AUTOLINK_PATTERN.lastIndex = this.pos;
    const match = URI_AUTOLINK_PATTERN.exec(this.text);
    if (match === null) {
      return undefined;
    }
    const uri = match[0].slice(1, match[0].length - 1);
    return containsAsciiControlOrSpace(uri) ? undefined : uri;
  }

  private parseEntity(): void {
    const entity = matchEntity(this.text, this.pos);
    if (entity === undefined) {
      this.appendText('&');
      this.pos += 1;
      return;
    }
    const node = new InlineNode('entity');
    node.raw = entity.raw;
    node.literal = entity.value;
    this.container.appendChild(node);
    this.pos += entity.raw.length;
  }

  private parseDelimiterRun(char: DelimiterChar): void {
    if (char === '~' && !this.gfmStrikethrough) {
      this.parseLiteralRun(char);
      return;
    }
    const run = scanDelimiterRun(this.text, this.pos, char);
    if (run === undefined) {
      // Only reachable for a tilde run longer than GFM's own two-tilde maximum, which is literal text rather than a delimiter.
      this.parseLiteralRun(char);
      return;
    }
    const node = this.appendText(this.text.slice(this.pos, this.pos + run.count));
    this.pos += run.count;
    if (run.canOpen || run.canClose) {
      this.delimiters.push(char, run, node);
    }
  }

  private parseLiteralRun(char: string): void {
    let length = 0;
    while (this.text.charAt(this.pos + length) === char) {
      length += 1;
    }
    this.appendText(this.text.slice(this.pos, this.pos + length));
    this.pos += length;
  }

  private pushBracket(node: InlineNode, index: number, image: boolean): void {
    if (this.brackets !== undefined) {
      this.brackets.bracketAfter = true;
    }
    this.brackets = { node, previous: this.brackets, previousDelimiter: this.delimiters.top, index, image, active: true, bracketAfter: false };
  }

  private parseOpenBracket(): void {
    const start = this.pos;
    this.pos += 1;
    this.pushBracket(this.appendText('['), start, false);
  }

  private parseBang(): void {
    const start = this.pos;
    this.pos += 1;
    if (this.text.charAt(this.pos) !== '[') {
      this.appendText('!');
      return;
    }
    this.pos += 1;
    this.pushBracket(this.appendText('!['), start + 1, true);
  }

  // spec 0.31.2, "Links"/"Images": on `]`, try an inline link `(dest "title")` first, then a full reference `[label]`, then a collapsed reference `[]`, then a shortcut reference (the link text itself as the label). A failed attempt leaves a literal `]` and pops the opener, so the same `[` is never reconsidered.
  private parseCloseBracket(): void {
    this.pos += 1;
    const afterCloseBracket = this.pos;

    const opener = this.brackets;
    if (opener === undefined) {
      this.appendText(']');
      return;
    }
    if (!opener.active) {
      this.brackets = opener.previous;
      this.appendText(']');
      return;
    }

    const target = this.resolveInlineLink() ?? this.resolveReferenceLink(opener, afterCloseBracket);
    if (target === undefined) {
      this.brackets = opener.previous;
      this.pos = afterCloseBracket;
      this.appendText(']');
      return;
    }

    const node = new InlineNode(opener.image ? 'image' : 'link');
    node.destination = target.destination;
    node.title = target.title;
    let moving = opener.node.next;
    while (moving !== undefined) {
      const following = moving.next;
      node.appendChild(moving);
      moving = following;
    }
    this.container.appendChild(node);
    processEmphasis(this.delimiters, opener.previousDelimiter, createWrapper);
    this.brackets = opener.previous;
    opener.node.unlink();

    if (!opener.image) {
      let earlier = this.brackets;
      while (earlier !== undefined) {
        if (!earlier.image) {
          earlier.active = false;
        }
        earlier = earlier.previous;
      }
    }
  }

  private resolveInlineLink(): LinkTarget | undefined {
    if (this.text.charAt(this.pos) !== '(') {
      return undefined;
    }
    const start = this.pos;
    const destination = parseLinkDestination(this.text, skipInlineWhitespace(this.text, start + 1));
    if (destination === undefined) {
      this.pos = start;
      return undefined;
    }
    const afterDestination = destination.end;
    let cursor = skipInlineWhitespace(this.text, afterDestination);

    // spec 0.31.2: "If both link destination and link title are present, they must be separated by spaces, tabs, and up to one line ending." Without that separator, what looks like a title is really part of the destination and the link does not parse at all.
    let title: ParsedSpan | undefined;
    if (cursor > afterDestination) {
      title = parseLinkTitle(this.text, cursor);
      if (title !== undefined) {
        cursor = skipInlineWhitespace(this.text, title.end);
      }
    }

    if (this.text.charAt(cursor) !== ')') {
      this.pos = start;
      return undefined;
    }
    this.pos = cursor + 1;
    return { destination: destination.value, title: title?.value };
  }

  private resolveReferenceLink(opener: Bracket, afterCloseBracket: number): LinkTarget | undefined {
    const labelStart = this.pos;
    const labelLength = matchLinkLabel(this.text, labelStart);
    let label: string | undefined;
    if (labelLength > EMPTY_LABEL_LENGTH) {
      label = this.text.slice(labelStart, labelStart + labelLength);
    } else if (!opener.bracketAfter) {
      // Both the collapsed form (`[foo][]`) and the shortcut form (`[foo]`) look the label up under the link text itself.
      label = this.text.slice(opener.index, afterCloseBracket);
    }
    if (labelLength > 0) {
      this.pos = labelStart + labelLength;
    }
    if (label === undefined) {
      return undefined;
    }
    const definition = this.references.get(normalizeLinkLabel(label));
    if (definition === undefined) {
      this.pos = labelStart;
      return undefined;
    }
    return { destination: definition.destination, title: definition.title };
  }
}

// Adjacent text nodes arise routinely (an escape, a leftover delimiter, and the plain run around them are three separate appends) and are semantically one run. Merging them keeps the AST a description of the content rather than of the scan that produced it, and gives the GFM autolink pass whole runs to match against instead of fragments.
function mergeAdjacentText(node: InlineNode): void {
  let child = node.firstChild;
  while (child !== undefined) {
    if (child.kind === 'text') {
      let following = child.next;
      while (following?.kind === 'text') {
        child.literal += following.literal;
        const after = following.next;
        following.unlink();
        following = after;
      }
      child = child.next;
      continue;
    }
    mergeAdjacentText(child);
    child = child.next;
  }
}

// An image's description is FLATTENED to plain text rather than kept as inline children, per CommonMark's own rule that it becomes the `alt` attribute (MarkdownImageNode.alt, src/ast). cmark's own plain-text rendering is restated here exactly: text, code-span, and raw-HTML literals contribute verbatim, a character reference contributes its decoded value, an autolink contributes its destination, and both break kinds contribute a single space (NOT a newline -- an alt attribute is one line).
function flattenToPlainText(node: InlineNode): string {
  switch (node.kind) {
    case 'text':
    case 'codeSpan':
    case 'rawHtml':
    case 'entity':
      return node.literal;
    case 'autolink':
      return node.destination;
    case 'softBreak':
    case 'hardBreak':
      return ' ';
    default: {
      let result = '';
      let child = node.firstChild;
      while (child !== undefined) {
        result += flattenToPlainText(child);
        child = child.next;
      }
      return result;
    }
  }
}

function toChildAstNodes(node: InlineNode): MarkdownInlineNode[] {
  const children: MarkdownInlineNode[] = [];
  let child = node.firstChild;
  while (child !== undefined) {
    const converted = toAstNode(child);
    if (converted !== undefined) {
      children.push(converted);
    }
    child = child.next;
  }
  return children;
}

function toLinkAstNode(node: InlineNode): MarkdownLinkNode {
  const children = toChildAstNodes(node);
  if (node.title === undefined) {
    return { type: 'link', destination: node.destination, children };
  }
  return { type: 'link', destination: node.destination, title: node.title, children };
}

function toImageAstNode(node: InlineNode): MarkdownImageNode {
  const alt = flattenToPlainText(node);
  if (node.title === undefined) {
    return { type: 'image', destination: node.destination, alt };
  }
  return { type: 'image', destination: node.destination, title: node.title, alt };
}

function toAstNode(node: InlineNode): MarkdownInlineNode | undefined {
  switch (node.kind) {
    case 'text':
      // A delimiter run fully consumed by a match leaves a zero-length text node behind; it is scaffolding, not content.
      return node.literal.length === 0 ? undefined : { type: 'text', value: node.literal };
    case 'emphasis':
      return { type: 'emphasis', marker: node.marker, children: toChildAstNodes(node) };
    case 'strong':
      return { type: 'strong', marker: node.marker, children: toChildAstNodes(node) };
    case 'strikethrough':
      return { type: 'strikethrough', children: toChildAstNodes(node) };
    case 'codeSpan':
      return { type: 'codeSpan', literal: node.literal };
    case 'link':
      return toLinkAstNode(node);
    case 'image':
      return toImageAstNode(node);
    case 'autolink':
      return { type: 'autolink', destination: node.destination, email: node.email };
    case 'hardBreak':
      return { type: 'hardBreak' };
    case 'softBreak':
      return { type: 'softBreak' };
    case 'rawHtml':
      return { type: 'rawHtml', literal: node.literal };
    case 'entity':
      return { type: 'entity', raw: node.raw, value: node.literal };
    case 'container':
      return undefined;
  }
}

// Parses one block's raw inline content. `references` is the document-global link-reference-definition table the block phase built -- see this module's own top-of-file note on why it cannot be discovered here.
export function parseInlines(content: string, references: LinkReferenceMap, options: InlineParseOptions = {}): MarkdownInlineNode[] {
  const root = new InlineParser(content, references, options).parse();
  if (options.gfmAutolinks ?? true) {
    applyGfmAutolinks(root);
    mergeAdjacentText(root);
  }
  return toChildAstNodes(root);
}
