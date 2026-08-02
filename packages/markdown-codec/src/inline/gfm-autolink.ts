// GFM's "autolinks (extension)" -- bare `www.`-prefixed, `http(s)://`-prefixed, `mailto:`/`xmpp:`-prefixed, and bare-email links written WITHOUT the surrounding `<`/`>` CommonMark autolinks require.
//
// Structured as a post-pass over already-parsed text nodes rather than as a branch in the inline phase's own dispatch loop, matching cmark-gfm's own extension architecture: an extended autolink has no distinguishing opening character to dispatch on (it starts with an ordinary letter), and its extent depends on trailing-punctuation trimming that can only be decided once the whole run of text is in hand. Running it after the fact also gives the "no autolinks inside a link" rule for free -- the walk simply does not descend into link, image, codeSpan, autolink, or rawHtml nodes.
//
// An extended autolink becomes a LINK node with an explicit text child, not a MarkdownAutolinkNode. That is deliberate and follows cmark-gfm's own choice: a `www.example.com` autolink's displayed text and its resolved destination genuinely differ (`http://` is prepended to the destination only), and MarkdownAutolinkNode carries a single `destination` field precisely because a CommonMark `<...>` autolink's text and destination are by definition the same string. Forcing the extension through that node type would need a second field on it that no CommonMark autolink ever uses.
//
// Off by default is NOT the choice here: this package targets CommonMark *and* GFM, so InlineParseOptions.gfmAutolinks defaults to true. The CommonMark conformance suite (src/inline/conformance.test.ts) disables it explicitly, because a bare `http://foo.bar` in paragraph text is plain text under CommonMark and a link under GFM -- a genuine specification fork, not a bug in either mode.

import { InlineNode, createTextNode } from './node';

// GFM: "A valid domain consists of segments of alphanumeric characters, underscores (_) and hyphens (-) separated by periods (.). There must be at least one period, and no underscores may be present in the last two segments of the domain."
const DOMAIN_SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/;
const MIN_DOMAIN_SEGMENTS = 2;
const UNDERSCORE_FREE_TRAILING_SEGMENTS = 2;

// GFM: an extended autolink may only begin at the start of a line, or after whitespace, or after one of `*`, `_`, `~`, `(`.
const VALID_PRECEDING_CHARACTERS: ReadonlySet<string> = new Set(['*', '_', '~', '(']);

// GFM: "Trailing punctuation (specifically, ?, !, ., ,, :, *, _, and ~) will not be considered part of the autolink, though they may be included in the interior of the link."
const TRAILING_PUNCTUATION: ReadonlySet<string> = new Set(['?', '!', '.', ',', ':', '*', '_', '~']);

const EMAIL_LOCAL_PART_PATTERN = /[A-Za-z0-9._+-]/;
const ENTITY_TAIL_PATTERN = /&[A-Za-z0-9]+;$/;

const WWW_PREFIX = 'www.';
const HTTP_PREFIXES = ['http://', 'https://'];
const PROTOCOL_PREFIXES = ['mailto:', 'xmpp:'];

// Node kinds an extended autolink may never appear inside: a real link or image (GFM inherits CommonMark's "no links inside links"), a code span or raw HTML tag (both literal text by definition), and an existing autolink.
const OPAQUE_KINDS: ReadonlySet<string> = new Set(['link', 'image', 'codeSpan', 'rawHtml', 'autolink']);

function isWhitespace(char: string): boolean {
  return char === '' || char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f';
}

function isValidStartBoundary(text: string, index: number): boolean {
  if (index === 0) {
    return true;
  }
  const before = text.charAt(index - 1);
  return isWhitespace(before) || VALID_PRECEDING_CHARACTERS.has(before);
}

function isValidDomain(domain: string): boolean {
  const segments = domain.split('.');
  if (segments.length < MIN_DOMAIN_SEGMENTS) {
    return false;
  }
  if (!segments.every((segment) => DOMAIN_SEGMENT_PATTERN.test(segment))) {
    return false;
  }
  return segments.slice(-UNDERSCORE_FREE_TRAILING_SEGMENTS).every((segment) => !segment.includes('_'));
}

// GFM's own trailing-trimming rules, applied in the order the specification states them: strip the named trailing punctuation; then strip an unmatched closing paren (a link ending in `)` keeps it only when the parens inside balance, so `(see http://example.com/a(b))` links `http://example.com/a(b)`); then strip a trailing `;` that is really the tail of a character reference such as `&amp;`. Each strip can expose another, so the three run to a fixed point.
function trimTrailingPunctuation(candidate: string): string {
  let end = candidate.length;
  for (;;) {
    const before = end;
    while (end > 0 && TRAILING_PUNCTUATION.has(candidate.charAt(end - 1))) {
      end -= 1;
    }
    if (end > 0 && candidate.charAt(end - 1) === ')') {
      const slice = candidate.slice(0, end);
      if (slice.split(')').length > slice.split('(').length) {
        end -= 1;
      }
    }
    if (end > 0 && candidate.charAt(end - 1) === ';') {
      const entityTail = ENTITY_TAIL_PATTERN.exec(candidate.slice(0, end));
      if (entityTail !== null) {
        end -= entityTail[0].length;
      }
    }
    if (end === before) {
      return candidate.slice(0, end);
    }
  }
}

interface AutolinkMatch {
  // The literal source text the link covers, which is also its displayed text.
  readonly text: string;
  // The resolved href, which differs from `text` for a `www.`-prefixed link and for a bare email address.
  readonly destination: string;
  readonly start: number;
}

// The run of characters an extended autolink can consist of at all, before trailing-punctuation trimming: everything up to whitespace or `<`.
function scanRawCandidate(text: string, start: number): string {
  let end = start;
  while (end < text.length && !isWhitespace(text.charAt(end)) && text.charAt(end) !== '<') {
    end += 1;
  }
  return text.slice(start, end);
}

function matchPrefixed(text: string, index: number, prefixLength: number, destinationPrefix: string, requireValidDomain: boolean): AutolinkMatch | undefined {
  const trimmed = trimTrailingPunctuation(scanRawCandidate(text, index));
  if (trimmed.length <= prefixLength) {
    return undefined;
  }
  if (requireValidDomain) {
    const afterPrefix = trimmed.slice(prefixLength);
    const domain = afterPrefix.split(/[/?#]/)[0] ?? '';
    if (!isValidDomain(domain)) {
      return undefined;
    }
  }
  return { text: trimmed, destination: destinationPrefix + trimmed, start: index };
}

// A bare email address. Anchored on the `@` rather than scanned forward from a start boundary, because the local part is only recognisable in retrospect -- there is no prefix to dispatch on.
function matchEmailAt(text: string, atIndex: number): AutolinkMatch | undefined {
  let start = atIndex;
  while (start > 0 && EMAIL_LOCAL_PART_PATTERN.test(text.charAt(start - 1))) {
    start -= 1;
  }
  if (start === atIndex || !isValidStartBoundary(text, start)) {
    return undefined;
  }
  const local = text.slice(start, atIndex);
  // GFM: the local part "may not start or end with a period".
  if (local.startsWith('.') || local.endsWith('.')) {
    return undefined;
  }
  // GFM trims a trailing `-` or `_` from an email domain as well as the shared trailing punctuation.
  const domain = trimTrailingPunctuation(scanRawCandidate(text, atIndex + 1)).replace(/[-_]+$/, '');
  if (!isValidDomain(domain)) {
    return undefined;
  }
  const address = `${local}@${domain}`;
  return { text: address, destination: `mailto:${address}`, start };
}

function startsWithIgnoringCase(text: string, index: number, prefix: string): boolean {
  return text.slice(index, index + prefix.length).toLowerCase() === prefix;
}

function findAutolinkAt(text: string, index: number): AutolinkMatch | undefined {
  if (text.charAt(index) === '@') {
    return matchEmailAt(text, index);
  }
  if (!isValidStartBoundary(text, index)) {
    return undefined;
  }
  if (startsWithIgnoringCase(text, index, WWW_PREFIX)) {
    return matchPrefixed(text, index, WWW_PREFIX.length, 'http://', true);
  }
  for (const prefix of HTTP_PREFIXES) {
    if (startsWithIgnoringCase(text, index, prefix)) {
      return matchPrefixed(text, index, prefix.length, '', true);
    }
  }
  for (const prefix of PROTOCOL_PREFIXES) {
    if (startsWithIgnoringCase(text, index, prefix)) {
      return matchPrefixed(text, index, prefix.length, '', false);
    }
  }
  return undefined;
}

function expandTextNode(node: InlineNode): void {
  const text = node.literal;
  let cursor = 0;
  let anchor: InlineNode = node;
  let matches = 0;
  let index = 0;

  while (index < text.length) {
    const found = findAutolinkAt(text, index);
    if (found === undefined || found.start < cursor) {
      index += 1;
      continue;
    }
    if (found.start > cursor) {
      const before = createTextNode(text.slice(cursor, found.start));
      anchor.insertAfter(before);
      anchor = before;
    }
    const link = new InlineNode('link');
    link.destination = found.destination;
    link.appendChild(createTextNode(found.text));
    anchor.insertAfter(link);
    anchor = link;
    cursor = found.start + found.text.length;
    matches += 1;
    index = cursor;
  }

  if (matches === 0) {
    return;
  }
  if (cursor < text.length) {
    anchor.insertAfter(createTextNode(text.slice(cursor)));
  }
  node.unlink();
}

// Walks a parsed inline tree and replaces every extended-autolink run inside an eligible text node with a real link node.
export function applyGfmAutolinks(root: InlineNode): void {
  let child = root.firstChild;
  while (child !== undefined) {
    const following = child.next;
    if (child.kind === 'text') {
      expandTextNode(child);
    } else if (!OPAQUE_KINDS.has(child.kind)) {
      applyGfmAutolinks(child);
    }
    child = following;
  }
}
