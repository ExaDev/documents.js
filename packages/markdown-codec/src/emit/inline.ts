// ContentRun[] -> markdown inline text: the structural inverse of src/lower/inline.ts. bold/italic/strike become emphasis/strong/strikethrough markers (the configured emphasisMarker doubled for bold, singled for italic; strikethrough is always `~~`, GFM's only syntax for it), hyperlink becomes a link (or, when the run's own text equals its own destination and it carries no other styling, a bare autolink -- `<dest>` rather than `[dest](dest)`), and a Courier-New-fontFamily run becomes a code span -- MarkdownDiagnosticCodes.CODE_SPAN_AS_MONOSPACE_RUN, since a run styled that way for a genuinely unrelated reason (some other format's own deliberate monospace font choice) is indistinguishable from a real markdown code span on the way back out. Two or more CONSECUTIVE runs sharing the same hyperlink render as one link spanning their combined text (MarkdownDiagnosticCodes.ADJACENT_LINKS_MERGED) -- markdown has no way to place two separate link boundaries back to back with nothing between them.
//
// Adjacent runs with DIFFERENT bold/italic/strike combinations are never wrapped independently and concatenated -- **bold** immediately followed by its own ___nested___ wrap would fuse into one ambiguous five-underscore delimiter run once written out, which is a real correctness bug, not a style nit. renderNestedStyles instead groups the run sequence hierarchically by bold, then by italic, then by strike, producing a properly NESTED wrap (`**bold *nested***`-shaped) whose closing delimiter run CommonMark's own algorithm resolves correctly (a closer consumes only as many delimiters as its innermost opener needs, leaving the rest for the next one out) -- exactly the well-known trick real markdown output already relies on for this exact shape.
//
// Escaping (escapeMarkdownText) is conservative: every ASCII punctuation character markdown itself gives meaning to is backslash-escaped, including a literal '<'. There is deliberately NO tag exemption any more: preserved raw HTML now rides the run's own markdown residue and re-emits verbatim beside this function (renderLeaf), so a pattern-match on tag-shaped text would only ever fire on LITERAL text that merely looks like a tag -- escaping that is exactly the correct behaviour, and leaving it bare was the RAW_TEXT_TAG_AMBIGUITY round-trip failure this retires.
//
// Preserved inline math (src/lower/inline.ts's own MATH_INLINE_PRESERVED_AS_TEXT case) is NOT given the same text-pattern-based exemption, deliberately: escapeMarkdownText already backslash-escapes every literal '(' and ')' it meets in ORDINARY text (both are in ESCAPE_CHARS below), so an ordinary escaped parenthetical remark -- "\(see below\)" -- is indistinguishable from a genuine preserved \( \) span once escaped, and a pattern-based exemption (tried and reverted) misrecognised the former as the latter on reparse. renderLeaf below instead keys off the run's own MATH_INLINE_FONT_MARKER fontFamily, the same non-pattern-based, opportunistic-reuse trick a code span's own Courier New marker already plays two paragraphs down.

import type {
  AnchorDescriptor,
  ContentRun,
  RunConstructExtent,
} from "document-schema.js";
import type { MarkdownDiagnosticSink } from "../diagnostics/diagnostics";
import { MarkdownDiagnosticCodes } from "../diagnostics/diagnostics";
import { isValidFootnoteLabel } from "../inline/footnote";
import {
  MATH_INLINE_FONT_MARKER,
  MONOSPACE_FONT_FAMILY,
} from "../shared/style-constants";

export interface InlineEmitContext {
  readonly sink: MarkdownDiagnosticSink;
  readonly emphasisMarker: string;
}

// Every ASCII punctuation character CommonMark's own backslash-escape grammar recognises (spec 0.31.2, "Backslash escapes") that genuinely needs escaping to round-trip safely, MINUS '(' and ')' (ExaDev/markdown-codec#53): neither carries any special meaning in ordinary running text under CommonMark's own grammar (a paren only means anything as part of an inline link/image's own "(dest)" syntax, immediately after a `]` this package always escapes anyway -- see the following paragraph), so escaping them was always unnecessary defensive punctuation-escaping, not a correctness requirement. Once \( \) inline math exists, that unnecessary escaping becomes actively harmful: it manufactures the exact \(...\) shape genuine preserved math uses out of ANY ordinary parenthetical remark ("(see below)"), which src/inline/inline.ts's own new \( recognition cannot tell apart from real math on a later reparse (this was tried -- keeping '('/')' escaped and instead pattern-matching a "genuine" math span on the way out -- and reverted; see this module's own top-of-file note and src/ast/ast.ts's own MarkdownMathInlineNode comment for why no text-pattern-based fix exists). A `]` immediately followed by an unescaped `(` could in principle be misread as inline link syntax, but that never happens here: this set still escapes `]` unconditionally, so a literal `]` from ordinary text is never emitted bare, and a REAL link/image's own "](dest)" is produced directly by this module's own emitRuns, never by escaping ordinary text.
const ESCAPE_CHARS: ReadonlySet<string> = new Set([
  "!",
  '"',
  "#",
  "$",
  "%",
  "&",
  "'",
  "*",
  "+",
  ",",
  "-",
  ".",
  "/",
  ":",
  ";",
  "<",
  "=",
  ">",
  "?",
  "@",
  "[",
  "\\",
  "]",
  "^",
  "_",
  "`",
  "{",
  "|",
  "}",
  "~",
]);

export function escapeMarkdownText(text: string): string {
  let out = "";
  let index = 0;
  while (index < text.length) {
    const char = text.charAt(index);
    if (char === "\n") {
      // A hard line break's own literal '\n' (src/lower/inline.ts's own mapping) -- rendered as a backslash immediately before a real newline, CommonMark's own unambiguous hard-break spelling (as opposed to the whitespace-sensitive "two trailing spaces" form).
      out += "\\\n";
      index += 1;
      continue;
    }
    if (ESCAPE_CHARS.has(char)) {
      out += `\\${char}`;
      index += 1;
      continue;
    }
    out += char;
    index += 1;
  }
  return out;
}

// CommonMark's own code-span padding rule (spec 0.31.2, "Code spans"): a span whose content begins AND ends with a space, but is not ENTIRELY spaces, has exactly one space stripped from each end on read -- this function has to add that one layer of padding back so the content survives a read -> write -> reparse round trip unchanged, but ONLY in that one exact case. A content string that is entirely spaces is explicitly EXEMPT from stripping (the rule's own "doesn't consist entirely of space characters" clause), so it must be written back verbatim with no padding at all -- adding padding there (as a single `text.trim().length === 0` check would) inserts spaces the reparse will never strip back out, corrupting a one-space span into three.
function renderCodeSpan(text: string): string {
  let longestBacktickRun = 0;
  let current = 0;
  for (const char of text) {
    if (char === "`") {
      current += 1;
      longestBacktickRun = Math.max(longestBacktickRun, current);
    } else {
      current = 0;
    }
  }
  const fence = "`".repeat(longestBacktickRun + 1);
  const isAllSpaces = text.length > 0 && text.trim().length === 0;
  const risksFenceCollision = text.startsWith("`") || text.endsWith("`");
  const wouldBeStrippedOnReparse =
    !isAllSpaces && text.startsWith(" ") && text.endsWith(" ");
  const needsPadding = risksFenceCollision || wouldBeStrippedOnReparse;
  return needsPadding ? `${fence} ${text} ${fence}` : `${fence}${text}${fence}`;
}

// The footnote-anchor extent naming run `index` as a reference site: a POINT extent (startRun === endRun === index, the boundary before that run), the shape both this package's own read side (src/lower/inline.ts's footnoteReference case) and ooxml.js's docx reader (a w:footnoteReference run) mint. A RANGED footnote anchor -- odf.js's reader spells its text:note reference that way -- is deliberately not matched: a markdown reference is a point, and a range over several runs has no single-run spelling, so its runs keep their own escaped text and only the construct is lost, the same silent loss every other run-level extent markdown has no syntax for already takes (a bookmark, a comment reference).
function footnoteReferenceAt(
  constructs: readonly RunConstructExtent[] | undefined,
  index: number,
): AnchorDescriptor | undefined {
  for (const extent of constructs ?? []) {
    if (
      extent.descriptor.kind === "anchor" &&
      extent.descriptor.anchorType === "footnote" &&
      extent.startRun === index &&
      extent.endRun === index
    ) {
      return extent.descriptor;
    }
  }
  return undefined;
}

// A run's own leaf text -- a code span for a monospace run, the `[^label]` spelling for a footnote reference site, escaped literal text otherwise. Deliberately carries no bold/italic/strike wrapping of its own: renderNestedStyles applies that OUTSIDE this function, over a whole GROUP of runs at once, which is what keeps adjacent differently-styled runs from producing an ambiguous concatenated delimiter run (see this module's own top-of-file note).
//
// A run carrying this package's own markdown HTML residue (src/lower/inline.ts's rawHtml case) re-emits that residue verbatim: re-serialising opaque residue is the restorable tier's whole mechanism, and it is what distinguishes genuine preserved HTML from literal text that merely looks like a tag -- the pattern-matching exemption escapeMarkdownText used to carry (leave a recognised tag unescaped) could not tell those apart and is gone, so ordinary text now always escapes a literal '<' and a real HTML run never passes through escaping at all.
//
// A footnote reference site is keyed off the run-level anchor extent naming it, not off anything about the run's own text: escapeMarkdownText escapes `[`, `^`, and `]`, so a deliberately-escaped literal `\[^1\]` and a genuine reference are the same run text by the time they reach here, and only the extent separates them (the identical non-pattern-based principle the math marker below plays). The spelling comes from the extent's own name -- the same authority the definition marker takes its label from (renderConstruct, src/emit/emit.ts) -- so the run's text is the materialised rendering (this package's own read mints it as `[^name]` verbatim; a foreign producer's contentless mark run loses nothing by being re-spelled). A name this package's own [^label] grammar cannot represent takes the definition half's degrade: the run's own text, escaped, plus CONSTRUCT_UNREPRESENTED.
function renderLeaf(
  run: ContentRun,
  context: InlineEmitContext,
  index: number,
  constructs: readonly RunConstructExtent[] | undefined,
): string {
  if (run.source?.format === "markdown") {
    return run.source.xml;
  }
  if (run.fontFamily === MONOSPACE_FONT_FAMILY) {
    context.sink({
      code: MarkdownDiagnosticCodes.CODE_SPAN_AS_MONOSPACE_RUN,
      severity: "info",
      message:
        "a run styled with the Courier New font family is rendered as a code span; a genuinely monospace run from another format is indistinguishable from a real markdown code span on the way back out",
    });
    return renderCodeSpan(run.text);
  }
  const footnote = footnoteReferenceAt(constructs, index);
  if (footnote !== undefined && isValidFootnoteLabel(footnote.name)) {
    return `[^${footnote.name}]`;
  }
  if (footnote !== undefined) {
    context.sink({
      code: MarkdownDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
      severity: "info",
      message: `a footnote reference anchor's own name "${footnote.name}" cannot be spelled as a "[^label]" marker (whitespace or "]" would reparse as something else); the run's own text renders escaped in its place, but the reference itself is not represented`,
    });
  }
  if (run.fontFamily === MATH_INLINE_FONT_MARKER) {
    // The \( \) delimiters are regenerated fresh around the run's own (unescaped) text -- this run's text is never passed through escapeMarkdownText at all, since it is not "ordinary punctuation that happens to need escaping" but raw LaTeX carried verbatim (see this module's own top-of-file note on why a text-pattern-based recognition of an already-escaped '(...)' cannot distinguish this from ordinary parenthetical prose).
    return `\\(${run.text}\\)`;
  }
  return escapeMarkdownText(run.text);
}

const STYLE_KEYS = ["bold", "italic", "strike"] as const;
type StyleKey = (typeof STYLE_KEYS)[number];

function styleActive(run: ContentRun, key: StyleKey): boolean {
  return run[key] === true;
}

// CommonMark's own emphasis rule (spec 0.31.2, "Emphasis and strong emphasis", rules 1-4): a `*` delimiter run may open/close emphasis regardless of what is adjacent to it on the inner side, but a `_` run may NOT do so "intraword" -- immediately adjacent, with no separating whitespace, to a letter or digit on the inner side. `foo*bar*` is `foo<em>bar</em>`, but the underscore spelling `foo_bar_` is not emphasis at all: the intraword restriction only exists for `_`, so writing an intraword-adjacent emphasis span back out with the configured emphasisMarker when that marker is `_` would silently produce LITERAL underscores on reparse rather than emphasis -- a real correctness bug, not a style nit.
const WORD_CHAR_PATTERN = /[\p{L}\p{N}]/u;

function isIntrawordRisk(body: string): boolean {
  if (body.length === 0) {
    return false;
  }
  return (
    WORD_CHAR_PATTERN.test(body.charAt(0)) ||
    WORD_CHAR_PATTERN.test(body.charAt(body.length - 1))
  );
}

// A second, distinct hazard from intraword adjacency: two delimiter occurrences that are logically separate (this wrap's own opening delimiter and whatever character sits immediately before it -- either plain preceding text in the same sibling sequence, or a directly-touching PARENT wrap's own delimiter one level further wrap, or a nested CHILD wrap's own delimiter sitting right at this body's edge) merge into one longer, differently-parsed delimiter run once concatenated with no separator between them. `candidate` collides when it is the same character as `precedingText`'s own trailing character (a sibling or enclosing wrap immediately to the left), or the same character as `body`'s own leading/trailing character (an immediately nested wrap touching this one's edge with nothing between).
function hasMarkerConflict(
  body: string,
  candidate: string,
  precedingText: string,
): boolean {
  if (candidate === "_" && isIntrawordRisk(body)) {
    return true;
  }
  if (
    body.length > 0 &&
    (body.startsWith(candidate) || body.endsWith(candidate))
  ) {
    return true;
  }
  return precedingText.endsWith(candidate);
}

// Tries the configured marker first, falls back to the other one when the configured choice would collide (either hazard above), and -- when NEITHER of the only two delimiter characters CommonMark offers is collision-free (a rare, adversarial-looking construct: several directly-touching nested/sibling emphasis spans with no separating text anywhere) -- falls back to the configured marker regardless, a genuine, bounded gap rather than a silent wrong answer; see src/test-support/conformance-exclusions.ts for the specific corpus examples this still cannot round-trip.
function pickEmphasisMarker(
  body: string,
  configured: string,
  precedingText: string,
): string {
  if (!hasMarkerConflict(body, configured, precedingText)) {
    return configured;
  }
  const alternate = configured === "_" ? "*" : "_";
  return hasMarkerConflict(body, alternate, precedingText)
    ? configured
    : alternate;
}

function wrapForStyle(
  body: string,
  key: StyleKey,
  context: InlineEmitContext,
  precedingText: string,
): string {
  if (key === "strike") {
    return `~~${body}~~`;
  }
  const marker = pickEmphasisMarker(
    body,
    context.emphasisMarker,
    precedingText,
  );
  const delimiter = key === "bold" ? marker.repeat(2) : marker;
  return `${delimiter}${body}${delimiter}`;
}

// Groups `runs` hierarchically -- first by bold, then (within each bold/non-bold group) by italic, then by strike -- rendering each group's own inner content recursively before wrapping it, so a bold span containing an italic sub-span comes out as a single, properly nested `**bold *nested***`-shaped wrap rather than two independently-wrapped, directly-concatenated spans. `out`, threaded into wrapForStyle as `precedingText`, is what lets pickEmphasisMarker see the immediately preceding sibling's own trailing character. `base` is the index `runs[0]` occupies in the PARAGRAPH's own run array (a slice may start anywhere), threaded so a leaf's renderLeaf can look its run up in the paragraph's run-level construct extents; each recursive slice adjusts it by its own local offset.
function renderNestedStyles(
  runs: readonly ContentRun[],
  depth: number,
  context: InlineEmitContext,
  base: number,
  constructs: readonly RunConstructExtent[] | undefined,
): string {
  if (depth >= STYLE_KEYS.length) {
    return runs
      .map((run, local) => renderLeaf(run, context, base + local, constructs))
      .join("");
  }
  const key = STYLE_KEYS[depth]!;
  let out = "";
  let index = 0;
  while (index < runs.length) {
    const current = runs[index];
    if (current === undefined) {
      break;
    }
    const active = styleActive(current, key);
    let end = index + 1;
    while (end < runs.length && styleActive(runs[end]!, key) === active) {
      end += 1;
    }
    const inner = renderNestedStyles(
      runs.slice(index, end),
      depth + 1,
      context,
      base + index,
      constructs,
    );
    out += active ? wrapForStyle(inner, key, context, out) : inner;
    index = end;
  }
  return out;
}

function isPlainAutolink(
  run: ContentRun,
  footnoteReference: AnchorDescriptor | undefined,
): boolean {
  // An autolink's own <...> form can never be empty (CommonMark's own URI/email autolink grammar both require at least one character between the brackets) -- `<>` is not valid autolink syntax at all and would reparse as literal text, so an empty destination (only reachable via a `[](/url)`-shaped empty-text link whose text happens to equal its own empty destination) must fall through to the ordinary `[text](dest)` form instead. A monospace (code-span), math-marked, or footnote-reference run is excluded the same way: each needs its own dedicated renderLeaf rendering (a code span's backtick fence, math's own \( \) delimiters, a reference's own unescaped `[^label]`), never the bare <...> autolink form, however coincidentally their own text might equal the surrounding hyperlink.
  if (
    run.hyperlink === undefined ||
    run.hyperlink.length === 0 ||
    run.bold === true ||
    run.italic === true ||
    run.strike === true ||
    run.fontFamily === MONOSPACE_FONT_FAMILY ||
    run.fontFamily === MATH_INLINE_FONT_MARKER ||
    footnoteReference !== undefined
  ) {
    return false;
  }
  return run.text === run.hyperlink || run.hyperlink === `mailto:${run.text}`;
}

export function escapeLinkDestination(destination: string): string {
  const needsAngleBrackets = /[\s()]/.test(destination);
  if (!needsAngleBrackets) {
    return destination;
  }
  return `<${destination.replace(/[<>]/g, (char) => `\\${char}`)}>`;
}

// A link title rendered inside its double-quoted spelling: CommonMark's own title grammar escapes only the quote character and the backslash inside a `"..."` title, and a newline collapses to a single space -- a title that spanned source lines is still one title, and a raw newline inside a rendered title would break the one-physical-line shape a table cell's row demands even at block level it serves nothing.
export function renderLinkTitle(title: string): string {
  return title
    .replace(/[\n\r]+/g, " ")
    .replace(/["\\]/g, (char) => `\\${char}`);
}

// The title annotation a hyperlink-carrying run group picked up from a covering run-level extent (src/lower/inline.ts's titled-link carry): the tightest `link` descriptor with a title whose range covers the whole group. Ranges are data, so cover-with-overlap is unambiguous to resolve -- innermost wins by largest startRun, then smallest endRun, the same tie-break document-schema.js's crossing-extent note applies to nested block brackets.
function linkTitleCovering(
  constructs: readonly RunConstructExtent[] | undefined,
  start: number,
  end: number,
): string | undefined {
  let tightest: RunConstructExtent | undefined;
  for (const extent of constructs ?? []) {
    if (
      extent.descriptor.kind !== "link" ||
      extent.descriptor.title === undefined
    ) {
      continue;
    }
    if (extent.startRun > start || extent.endRun < end) {
      continue;
    }
    const current = tightest;
    if (
      current === undefined ||
      extent.startRun > current.startRun ||
      (extent.startRun === current.startRun && extent.endRun < current.endRun)
    ) {
      tightest = extent;
    }
  }
  return tightest?.descriptor.kind === "link"
    ? tightest.descriptor.title
    : undefined;
}

// The top-level entry: groups the run sequence by hyperlink identity FIRST (adjacent same-hyperlink runs merge into one link, MarkdownDiagnosticCodes.ADJACENT_LINKS_MERGED), then renders each group's -- or each hyperlink-free stretch's -- own text via renderNestedStyles. A group covered by a titled link extent renders `](dest "title")`, the write-side inverse of src/lower/inline.ts's titled-link carry -- the runs keep the destination (ContentRun.hyperlink, the standing reconciliation) and the extent supplies only what the run field cannot hold.
export function emitRuns(
  runs: readonly ContentRun[],
  context: InlineEmitContext,
  constructs?: readonly RunConstructExtent[],
): string {
  let out = "";
  let index = 0;
  while (index < runs.length) {
    const run = runs[index];
    if (run === undefined) {
      break;
    }
    if (run.hyperlink === undefined) {
      let end = index + 1;
      while (end < runs.length && runs[end]?.hyperlink === undefined) {
        end += 1;
      }
      out += renderNestedStyles(
        runs.slice(index, end),
        0,
        context,
        index,
        constructs,
      );
      index = end;
      continue;
    }
    const hyperlink = run.hyperlink;
    let groupEnd = index + 1;
    while (groupEnd < runs.length && runs[groupEnd]?.hyperlink === hyperlink) {
      groupEnd += 1;
    }
    const group = runs.slice(index, groupEnd);
    if (group.length > 1) {
      context.sink({
        code: MarkdownDiagnosticCodes.ADJACENT_LINKS_MERGED,
        severity: "info",
        message: `${String(group.length)} adjacent runs share the hyperlink "${hyperlink}"; markdown has no way to place two link boundaries back to back, so they render as one link spanning their combined text`,
      });
    }
    const title = linkTitleCovering(constructs, index, groupEnd);
    if (
      title === undefined &&
      group.length === 1 &&
      isPlainAutolink(group[0]!, footnoteReferenceAt(constructs, index))
    ) {
      out += `<${group[0]!.text}>`;
    } else {
      const linkText = renderNestedStyles(group, 0, context, index, constructs);
      out += `[${linkText}](${escapeLinkDestination(hyperlink)}${title === undefined ? "" : ` "${renderLinkTitle(title)}"`})`;
    }
    index = groupEnd;
  }
  return out;
}

// The table-cell-specific variant (src/emit/table.ts): a GFM table row is exactly one physical line, so an embedded hard-break newline (rendered by emitRuns as a backslash-newline pair, matching escapeMarkdownText's own convention) cannot survive as-is -- it collapses to a single space instead. A bare (soft-break) newline is collapsed the same way, mirroring renderParagraphBody's own ATX-heading collapse (src/emit/emit.ts) -- a table cell has no source-level line wrap to hold either kind of break.
export function emitRunsSingleLine(
  runs: readonly ContentRun[],
  context: InlineEmitContext,
  constructs?: readonly RunConstructExtent[],
): string {
  return emitRuns(runs, context, constructs)
    .replace(/\\\n/g, " ")
    .replace(/\n/g, " ");
}
