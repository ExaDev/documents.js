// List-item structure: the marker grammar, the content-indent ("padding") computation every continuation line of an item is measured against, and the after-the-fact tight/loose decision.
//
// The padding rule is the single subtlest calculation in the whole block phase, and it is not "marker width plus one". Spec 0.31.2, "List items", basic case: "If a sequence of lines Ls constitute a list item with contents Bs, then the result of indenting each line of Ls by 1-3 spaces (the same for each line) also constitutes a list item with contents Bs" -- and, crucially, the content indent is determined by WHERE THE CONTENT ACTUALLY STARTS on the first line:
//
//   - 1 to 4 spaces after the marker: content starts there, so padding is the marker's own width plus exactly that many spaces. `-   foo` therefore continues at 4 columns, not 2.
//   - 5 or more spaces after the marker: the spec's own "item starting with indented code" rule takes over -- the content indent is marker width + 1, and the remaining spaces are part of the content (which is then indented code). `-     foo` is a list item whose content is a code block containing `  foo`.
//   - a marker followed by nothing at all (a blank first line): "if a sequence of lines Ls starting with a character other than a space or tab, and not separated from each other by more than one blank line, constitute a paragraph... " -- the practical rule is the same as the 5-or-more case, padding is marker width + 1, since there are no following spaces to measure. `-` alone opens an item whose content begins on a later line at 2 columns.
//
// The other rule that lives here only by being ABSENT: `- - -` is a thematic break, not a three-item list. That is not decided in this module at all -- it falls out of the block-start precedence order in src/block/block.ts, where the thematic-break matcher is tried before the list-item matcher. Stating it here as a special case would be a second, redundant answer to a question the ordering already settles.

import type { MarkdownBulletMarker, MarkdownOrderedListDelimiter } from '../ast/ast';
import type { LineCursor } from './line';
import { CODE_INDENT_COLUMNS } from './line';
import type { BlockNode, ListMarkerData } from './node';

// spec 0.31.2: "A bullet list marker is a `-`, `+`, or `*` character."
const BULLET_MARKER_PATTERN = /^[*+-]/;

// spec 0.31.2: "An ordered list marker is a sequence of 1-9 arabic digits (`0-9`), followed by either a `.` character or a `)` character."
const ORDERED_MARKER_PATTERN = /^(\d{1,9})([.)])/;

const NON_SPACE_PATTERN = /[^ \t\f\v\r\n]/;

// An ordered list may interrupt a paragraph only when it starts at 1 (spec 0.31.2: "In order for a list to interrupt a paragraph, it must start with 1").
const INTERRUPTING_ORDERED_START = 1;

function isBulletMarker(char: string): char is MarkdownBulletMarker {
  return char === '-' || char === '*' || char === '+';
}

function isOrderedDelimiter(char: string): char is MarkdownOrderedListDelimiter {
  return char === '.' || char === ')';
}

interface MarkerMatch {
  readonly length: number;
  readonly data: Omit<ListMarkerData, 'padding'>;
}

function matchMarker(rest: string, indent: number, containerIsParagraph: boolean): MarkerMatch | undefined {
  const bullet = BULLET_MARKER_PATTERN.exec(rest);
  if (bullet !== null) {
    const char = bullet[0];
    if (!isBulletMarker(char)) {
      return undefined;
    }
    return { length: bullet[0].length, data: { type: 'bullet', bulletChar: char, markerOffset: indent } };
  }
  const ordered = ORDERED_MARKER_PATTERN.exec(rest);
  const digits = ordered?.[1];
  const delimiter = ordered?.[2];
  if (ordered === null || digits === undefined || delimiter === undefined || !isOrderedDelimiter(delimiter)) {
    return undefined;
  }
  const start = Number.parseInt(digits, 10);
  if (containerIsParagraph && start !== INTERRUPTING_ORDERED_START) {
    return undefined;
  }
  return { length: ordered[0].length, data: { type: 'ordered', delimiter, start, markerOffset: indent } };
}

// Matches a list-item start at the line's next non-space position and, when it matches, ADVANCES the cursor to the item's own content column -- so the caller can add the item's first line straight away. Returns undefined without moving the cursor when this is not a list-item start.
//
// `containerIsParagraph` carries the two paragraph-interruption restrictions the spec places on a list that starts while a paragraph is open: an ordered list must start at 1, and the item's own first line must not be blank ("In order for a list to interrupt a paragraph, it must... not begin with a blank line").
export function parseListMarker(line: LineCursor, containerIsParagraph: boolean): ListMarkerData | undefined {
  if (line.indented) {
    return undefined;
  }
  const rest = line.restFromNextNonspace();
  const match = matchMarker(rest, line.indent, containerIsParagraph);
  if (match === undefined) {
    return undefined;
  }

  // spec 0.31.2: the marker must be followed by a space, a tab, or the end of the line -- `1.2` and `-foo` are not list items.
  const afterMarker = rest.charAt(match.length);
  if (afterMarker !== '' && afterMarker !== ' ' && afterMarker !== '\t') {
    return undefined;
  }
  if (containerIsParagraph && !NON_SPACE_PATTERN.test(rest.slice(match.length))) {
    return undefined;
  }

  line.advanceToNextNonspace();
  line.advance(match.length);

  // Measure the spaces following the marker in COLUMNS, stopping at the code-indent threshold: past that point the exact count no longer changes the answer, and a single tab can supply all of them at once. The threshold IS the code indent, not a number of its own -- spaces past it make the content indented code rather than the item's own content indent.
  const afterMarkerMark = line.mark();
  const afterMarkerColumn = line.column;
  // LineCursor.peek() reports a tab as a single space, one column at a time (src/scan), so testing for a space alone covers both -- there is no '\t' to compare against at this level.
  do {
    line.advance(1);
  } while (line.column - afterMarkerColumn <= CODE_INDENT_COLUMNS && line.peek() === ' ');
  const followingSpaces = line.column - afterMarkerColumn;
  const startsBlank = line.atEnd;

  if (followingSpaces > CODE_INDENT_COLUMNS || followingSpaces < 1 || startsBlank) {
    // Either the content is indented code (5+ columns past the marker) or there is no content on this line at all: the item's own content indent is the marker plus a single column, and everything past that is content.
    line.reset(afterMarkerMark);
    if (line.peek() === ' ') {
      line.advance(1);
    }
    return { ...match.data, padding: match.length + 1 };
  }
  return { ...match.data, padding: match.length + followingSpaces };
}

// Whether a newly started item continues the list that is already open, or starts a fresh one. spec 0.31.2: "a list is a sequence of list items of the same type" -- changing the bullet character or the ordered delimiter starts a new list, even with no blank line in between.
export function listsMatch(a: ListMarkerData, b: ListMarkerData): boolean {
  return a.type === b.type && a.delimiter === b.delimiter && a.bulletChar === b.bulletChar;
}

// Whether `block` ends with a blank line, looking through the last child of a list or list item to reach the block that actually recorded one. Memoised through BlockNode.lastLineChecked so a deeply nested list is descended at most once per finalisation rather than once per item.
function endsWithBlankLine(block: BlockNode): boolean {
  let current: BlockNode | undefined = block;
  while (current !== undefined) {
    if (current.lastLineBlank) {
      return true;
    }
    if (!current.lastLineChecked && (current.kind === 'list' || current.kind === 'listItem')) {
      current.lastLineChecked = true;
      current = current.lastChild;
      continue;
    }
    current.lastLineChecked = true;
    return false;
  }
  return false;
}

// The tight/loose decision, made once when the list closes. spec 0.31.2: "A list is loose if any of its constituent list items are separated by blank lines, or if any of its constituent list items directly contain two block-level elements with a blank line between them." Both halves are tested here -- an item that ends with a blank line and has a following sibling (the items are separated), and a block inside an item that ends with a blank line and is followed by anything (the item's own blocks are separated).
export function finalizeListTightness(list: BlockNode): void {
  for (const [index, item] of list.children.entries()) {
    const hasFollowingItem = index < list.children.length - 1;
    if (hasFollowingItem && endsWithBlankLine(item)) {
      list.tight = false;
      return;
    }
    for (const [childIndex, child] of item.children.entries()) {
      const hasFollowingBlock = childIndex < item.children.length - 1;
      if ((hasFollowingItem || hasFollowingBlock) && endsWithBlankLine(child)) {
        list.tight = false;
        return;
      }
    }
  }
}
