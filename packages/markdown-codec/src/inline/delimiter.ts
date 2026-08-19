// CommonMark's delimiter-run machinery: left/right-flanking classification, and the single `processEmphasis` pass that resolves EVERY delimiter-based construct this package supports -- `*` and `_` emphasis/strong emphasis (CommonMark 0.31.2, "Emphasis and strong emphasis") and GFM `~` strikethrough. Strikethrough is deliberately NOT a second implementation: it is one more delimiter character with its own open/close predicate and its own "how many delimiters does a match consume" answer, both expressed as branches inside the shared matcher below, so the notoriously subtle stack walk exists exactly once.
//
// The flanking rules and the "rule of three" are transcribed directly from the spec rather than approximated. This is the single hardest part of CommonMark to get right -- the conformance corpus devotes 132 of its 652 examples to emphasis alone -- and every simplification that looks harmless (treating left-flanking as "not followed by whitespace", skipping the rule of three, keeping one shared openers floor instead of one per delimiter signature) fails a real example in that corpus.

import { codePointAt, codePointBefore, isUnicodePunctuation, isUnicodeWhitespace } from './chars';
import type { InlineNode } from './node';

export type DelimiterChar = '*' | '_' | '~';

export function isDelimiterChar(char: string): char is DelimiterChar {
  return char === '*' || char === '_' || char === '~';
}

// GFM's strikethrough extension recognises a run of exactly one or two tildes as a delimiter; a run of three or more is literal text. (cmark-gfm's own strikethrough extension applies the same bound.)
const MAX_STRIKETHROUGH_RUN = 2;

export interface Delimiter {
  readonly char: DelimiterChar;
  // Delimiters still unconsumed in this run -- decremented as matches consume them, and the delimiter is dropped from the stack when it reaches zero.
  count: number;
  // The run's ORIGINAL length, which the rule of three is defined against and which therefore must survive every partial consumption of `count`.
  readonly origCount: number;
  readonly canOpen: boolean;
  readonly canClose: boolean;
  // The text node this run's remaining literal characters live in. Consuming delimiters truncates this node's literal; the node is unlinked entirely once the run is exhausted.
  readonly node: InlineNode;
  previous: Delimiter | undefined;
  next: Delimiter | undefined;
}

export interface DelimiterRun {
  readonly count: number;
  readonly canOpen: boolean;
  readonly canClose: boolean;
}

// Classifies the run of `char` starting at `start`, per spec 0.31.2's own left-flanking/right-flanking definitions:
//
// left-flanking  = not followed by Unicode whitespace, AND (not followed by Unicode punctuation OR preceded by Unicode whitespace or punctuation) right-flanking = not preceded by Unicode whitespace, AND (not preceded by Unicode punctuation OR followed by Unicode whitespace or punctuation)
//
// with the start and end of the block counting as whitespace. `*` may open whenever it is left-flanking and close whenever it is right-flanking; `_` is additionally restricted so intraword emphasis is impossible -- an `_` run that is both left- and right-flanking (i.e. sits between two word characters) can only open if it is preceded by punctuation, and can only close if it is followed by punctuation. That asymmetry is the whole reason `foo_bar_baz` is not emphasised while `foo*bar*baz` is.
export function scanDelimiterRun(text: string, start: number, char: DelimiterChar): DelimiterRun | undefined {
  let count = 0;
  while (text.charAt(start + count) === char) {
    count += 1;
  }
  if (count === 0) {
    return undefined;
  }
  if (char === '~' && count > MAX_STRIKETHROUGH_RUN) {
    return undefined;
  }

  const before = codePointBefore(text, start);
  const after = codePointAt(text, start + count);
  const beforeIsWhitespace = isUnicodeWhitespace(before);
  const beforeIsPunctuation = isUnicodePunctuation(before);
  const afterIsWhitespace = isUnicodeWhitespace(after);
  const afterIsPunctuation = isUnicodePunctuation(after);

  const leftFlanking = !afterIsWhitespace && (!afterIsPunctuation || beforeIsWhitespace || beforeIsPunctuation);
  const rightFlanking = !beforeIsWhitespace && (!beforeIsPunctuation || afterIsWhitespace || afterIsPunctuation);

  if (char === '_') {
    return { count, canOpen: leftFlanking && (!rightFlanking || beforeIsPunctuation), canClose: rightFlanking && (!leftFlanking || afterIsPunctuation) };
  }
  return { count, canOpen: leftFlanking, canClose: rightFlanking };
}

// The delimiter stack itself: a doubly-linked list whose TOP is `top`. A linked list rather than an array because a delimiter is routinely removed from the middle (every time a match consumes the delimiters between an opener and a closer), and because a bracket entry (src/inline/inline.ts) holds a live reference to whichever delimiter was on top when it was pushed, as the floor for its own emphasis pass -- a reference that must stay valid across arbitrary removals elsewhere in the stack.
export class DelimiterStack {
  top: Delimiter | undefined;

  push(char: DelimiterChar, run: DelimiterRun, node: InlineNode): void {
    const delimiter: Delimiter = {
      char,
      count: run.count,
      origCount: run.count,
      canOpen: run.canOpen,
      canClose: run.canClose,
      node,
      previous: this.top,
      next: undefined,
    };
    if (this.top !== undefined) {
      this.top.next = delimiter;
    }
    this.top = delimiter;
  }

  remove(delimiter: Delimiter): void {
    if (delimiter.previous !== undefined) {
      delimiter.previous.next = delimiter.next;
    }
    if (delimiter.next === undefined) {
      this.top = delimiter.previous;
    } else {
      delimiter.next.previous = delimiter.previous;
    }
  }
}

// A closer's "signature" for the openers-floor map below. The rule-of-three predicate depends only on the closer's own delimiter character, whether it can also open, and its original length modulo three -- so once a closer with a given signature has failed to find any opener above a position, no LATER closer with that same signature can succeed below it either, and the search floor can be raised permanently. Keying by all three (rather than cmark's coarser "one bucket for every `_`") keeps the pruning exactly sound: a coarser key would raise the floor for closers whose predicate differs from the one that failed.
function closerSignature(closer: Delimiter): string {
  return `${closer.char}${closer.canOpen ? '1' : '0'}${String(closer.origCount % 3)}`;
}

// spec 0.31.2, emphasis rules 9 and 10 -- the "rule of three": if one of the delimiters can both open and close, a match is forbidden when the sum of the two run lengths is a multiple of three, unless both lengths are themselves multiples of three. Expressed here in the equivalent form cmark uses, testing the closer's own length against 3 rather than both.
function isRuleOfThreeBlocked(opener: Delimiter, closer: Delimiter): boolean {
  return (closer.canOpen || opener.canClose) && closer.origCount % 3 !== 0 && (opener.origCount + closer.origCount) % 3 === 0;
}

function canMatch(opener: Delimiter, closer: Delimiter): boolean {
  if (opener.char !== closer.char || !opener.canOpen) {
    return false;
  }
  // GFM strikethrough has no rule of three; instead cmark-gfm requires the two runs to be the SAME length, so `~foo~~` and `~~foo~` are both literal text rather than a one-tilde match leaving a stray tilde behind.
  if (closer.char === '~') {
    return opener.count === closer.count;
  }
  return !isRuleOfThreeBlocked(opener, closer);
}

function delimitersConsumedByMatch(opener: Delimiter, closer: Delimiter): number {
  if (closer.char === '~') {
    return closer.count;
  }
  // spec 0.31.2 rule 13: "if one of the delimiters can both open and close emphasis, then the sum ..." -- operationally, a match consumes two delimiters (strong emphasis) whenever both runs still have two available, and one otherwise, with any remainder left on the stack to pair up again.
  return closer.count >= 2 && opener.count >= 2 ? 2 : 1;
}

function wrapperKindFor(closer: Delimiter, used: number): 'emphasis' | 'strong' | 'strikethrough' {
  if (closer.char === '~') {
    return 'strikethrough';
  }
  return used === 1 ? 'emphasis' : 'strong';
}

export type EmphasisWrapperFactory = (kind: 'emphasis' | 'strong' | 'strikethrough', marker: DelimiterChar) => InlineNode;

// The single emphasis-resolution pass, run once at the end of a block and once per successfully-closed link/image bracket (with that bracket's own saved stack top as `stackBottom`, so a link's inner emphasis resolves without ever pairing across the link's boundary).
//
// Walks upward from the first delimiter above `stackBottom` looking for closers; for each closer, walks BACK down for the nearest opener that `canMatch` accepts, stopping at `stackBottom` or at the floor already established for that closer's signature. On a match it truncates both delimiter runs by the number consumed, moves every node strictly between the two delimiter text nodes into a fresh wrapper, and drops any delimiters that sat between them (they can no longer pair with anything). On no match it raises that signature's floor, and discards the closer entirely unless it can also open -- a delimiter that can only close and found nothing will never match anything later either.
export function processEmphasis(stack: DelimiterStack, stackBottom: Delimiter | undefined, createWrapper: EmphasisWrapperFactory): void {
  const openersFloor = new Map<string, Delimiter | undefined>();

  let closer = stack.top;
  while (closer !== undefined && closer.previous !== stackBottom) {
    closer = closer.previous;
  }

  while (closer !== undefined) {
    if (!closer.canClose) {
      closer = closer.next;
      continue;
    }

    const signature = closerSignature(closer);
    const floor = openersFloor.has(signature) ? openersFloor.get(signature) : stackBottom;

    let opener = closer.previous;
    let matchedOpener: Delimiter | undefined;
    while (opener !== undefined && opener !== stackBottom && opener !== floor) {
      if (canMatch(opener, closer)) {
        matchedOpener = opener;
        break;
      }
      opener = opener.previous;
    }

    const failedCloser = closer;
    if (matchedOpener === undefined) {
      closer = closer.next;
      openersFloor.set(signature, failedCloser.previous);
      if (!failedCloser.canOpen) {
        stack.remove(failedCloser);
      }
      continue;
    }

    const used = delimitersConsumedByMatch(matchedOpener, closer);
    const openerNode = matchedOpener.node;
    const closerNode = closer.node;
    matchedOpener.count -= used;
    closer.count -= used;
    openerNode.literal = openerNode.literal.slice(0, openerNode.literal.length - used);
    closerNode.literal = closerNode.literal.slice(0, closerNode.literal.length - used);

    const wrapper = createWrapper(wrapperKindFor(closer, used), closer.char);
    let moving = openerNode.next;
    while (moving !== undefined && moving !== closerNode) {
      const following = moving.next;
      wrapper.appendChild(moving);
      moving = following;
    }
    openerNode.insertAfter(wrapper);

    // Every delimiter strictly between the pair is now enclosed by the new wrapper and can never pair with anything outside it -- drop them all at once rather than one at a time.
    if (matchedOpener.next !== closer) {
      matchedOpener.next = closer;
      closer.previous = matchedOpener;
    }

    if (matchedOpener.count === 0) {
      openerNode.unlink();
      stack.remove(matchedOpener);
    }
    if (closer.count === 0) {
      closerNode.unlink();
      const following = closer.next;
      stack.remove(closer);
      closer = following;
    }
  }

  while (stack.top !== undefined && stack.top !== stackBottom) {
    stack.remove(stack.top);
  }
}
