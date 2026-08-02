// ContentRun[] -> markdown inline text: the structural inverse of src/lower/inline.ts. bold/italic/strike become emphasis/strong/strikethrough markers (the configured emphasisMarker doubled for bold, singled for italic; strikethrough is always `~~`, GFM's only syntax for it), hyperlink becomes a link (or, when the run's own text equals its own destination and it carries no other styling, a bare autolink -- `<dest>` rather than `[dest](dest)`), and a Courier-New-fontFamily run becomes a code span -- MarkdownDiagnosticCodes.CODE_SPAN_AS_MONOSPACE_RUN, since a run styled that way for a genuinely unrelated reason (some other format's own deliberate monospace font choice) is indistinguishable from a real markdown code span on the way back out. Two or more CONSECUTIVE runs sharing the same hyperlink render as one link spanning their combined text (MarkdownDiagnosticCodes.ADJACENT_LINKS_MERGED) -- markdown has no way to place two separate link boundaries back to back with nothing between them.
//
// Adjacent runs with DIFFERENT bold/italic/strike combinations are never wrapped independently and concatenated -- **bold** immediately followed by its own ___nested___ wrap would fuse into one ambiguous five-underscore delimiter run once written out, which is a real correctness bug, not a style nit. renderNestedStyles instead groups the run sequence hierarchically by bold, then by italic, then by strike, producing a properly NESTED wrap (`**bold *nested***`-shaped) whose closing delimiter run CommonMark's own algorithm resolves correctly (a closer consumes only as many delimiters as its innermost opener needs, leaving the rest for the next one out) -- exactly the well-known trick real markdown output already relies on for this exact shape.
//
// Escaping (escapeMarkdownText) is conservative: every ASCII punctuation character markdown itself gives meaning to is backslash-escaped, UNLESS it is the `<` of a tag src/html/html.ts's own matchHtmlTag would recognise as raw HTML -- exempting exactly that span (not "any `<`") is what lets a paragraph carrying preserved raw HTML (src/lower/inline.ts's own RAW_HTML_PRESERVED_AS_TEXT case) survive a write-then-read round trip AS HTML rather than as escaped literal text.

import type { ContentRun } from 'document-schema.js';
import type { MarkdownDiagnosticSink } from '../diagnostics/diagnostics';
import { MarkdownDiagnosticCodes } from '../diagnostics/diagnostics';
import { matchHtmlTag } from '../html/html';
import { MONOSPACE_FONT_FAMILY } from '../shared/style-constants';

export interface InlineEmitContext {
  readonly sink: MarkdownDiagnosticSink;
  readonly emphasisMarker: string;
}

// Every ASCII punctuation character CommonMark's own backslash-escape grammar recognises (spec 0.31.2, "Backslash escapes") -- escaping any OTHER character is a no-op under that same grammar, so this set is deliberately the full ASCII-punctuation set src/inline/chars.ts already names, not a hand-picked subset of "characters that look dangerous".
const ESCAPE_CHARS: ReadonlySet<string> = new Set(['!', '"', '#', '$', '%', '&', "'", '(', ')', '*', '+', ',', '-', '.', '/', ':', ';', '<', '=', '>', '?', '@', '[', '\\', ']', '^', '_', '`', '{', '|', '}', '~']);

export function escapeMarkdownText(text: string): string {
  let out = '';
  let index = 0;
  while (index < text.length) {
    const char = text.charAt(index);
    if (char === '<') {
      const tag = matchHtmlTag(text, index);
      if (tag !== undefined) {
        out += tag;
        index += tag.length;
        continue;
      }
    }
    if (char === '\n') {
      // A hard line break's own literal '\n' (src/lower/inline.ts's own mapping) -- rendered as a backslash immediately before a real newline, CommonMark's own unambiguous hard-break spelling (as opposed to the whitespace-sensitive "two trailing spaces" form).
      out += '\\\n';
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

function renderCodeSpan(text: string): string {
  let longestBacktickRun = 0;
  let current = 0;
  for (const char of text) {
    if (char === '`') {
      current += 1;
      longestBacktickRun = Math.max(longestBacktickRun, current);
    } else {
      current = 0;
    }
  }
  const fence = '`'.repeat(longestBacktickRun + 1);
  const needsPadding = text.length > 0 && (text.startsWith('`') || text.endsWith('`') || text.trim().length === 0);
  return needsPadding ? `${fence} ${text} ${fence}` : `${fence}${text}${fence}`;
}

// A run's own leaf text -- a code span for a monospace run, escaped literal text otherwise. Deliberately carries no bold/italic/strike wrapping of its own: renderNestedStyles applies that OUTSIDE this function, over a whole GROUP of runs at once, which is what keeps adjacent differently-styled runs from producing an ambiguous concatenated delimiter run (see this module's own top-of-file note).
function renderLeaf(run: ContentRun, context: InlineEmitContext): string {
  if (run.fontFamily === MONOSPACE_FONT_FAMILY) {
    context.sink({ code: MarkdownDiagnosticCodes.CODE_SPAN_AS_MONOSPACE_RUN, severity: 'info', message: 'a run styled with the Courier New font family is rendered as a code span; a genuinely monospace run from another format is indistinguishable from a real markdown code span on the way back out' });
    return renderCodeSpan(run.text);
  }
  return escapeMarkdownText(run.text);
}

const STYLE_KEYS = ['bold', 'italic', 'strike'] as const;
type StyleKey = (typeof STYLE_KEYS)[number];

function styleActive(run: ContentRun, key: StyleKey): boolean {
  return run[key] === true;
}

function wrapForStyle(body: string, key: StyleKey, context: InlineEmitContext): string {
  if (key === 'strike') {
    return `~~${body}~~`;
  }
  const marker = key === 'bold' ? context.emphasisMarker.repeat(2) : context.emphasisMarker;
  return `${marker}${body}${marker}`;
}

// Groups `runs` hierarchically -- first by bold, then (within each bold/non-bold group) by italic, then by strike -- rendering each group's own inner content recursively before wrapping it, so a bold span containing an italic sub-span comes out as a single, properly nested `**bold *nested***`-shaped wrap rather than two independently-wrapped, directly-concatenated spans.
function renderNestedStyles(runs: readonly ContentRun[], depth: number, context: InlineEmitContext): string {
  if (depth >= STYLE_KEYS.length) {
    return runs.map((run) => renderLeaf(run, context)).join('');
  }
  const key = STYLE_KEYS[depth]!;
  let out = '';
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
    const inner = renderNestedStyles(runs.slice(index, end), depth + 1, context);
    out += active ? wrapForStyle(inner, key, context) : inner;
    index = end;
  }
  return out;
}

function isPlainAutolink(run: ContentRun): boolean {
  if (run.hyperlink === undefined || run.bold === true || run.italic === true || run.strike === true || run.fontFamily === MONOSPACE_FONT_FAMILY) {
    return false;
  }
  return run.text === run.hyperlink || run.hyperlink === `mailto:${run.text}`;
}

function escapeLinkDestination(destination: string): string {
  const needsAngleBrackets = /[\s()]/.test(destination);
  if (!needsAngleBrackets) {
    return destination;
  }
  return `<${destination.replace(/[<>]/g, (char) => `\\${char}`)}>`;
}

// The top-level entry: groups the run sequence by hyperlink identity FIRST (adjacent same-hyperlink runs merge into one link, MarkdownDiagnosticCodes.ADJACENT_LINKS_MERGED), then renders each group's -- or each hyperlink-free stretch's -- own text via renderNestedStyles.
export function emitRuns(runs: readonly ContentRun[], context: InlineEmitContext): string {
  let out = '';
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
      out += renderNestedStyles(runs.slice(index, end), 0, context);
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
      context.sink({ code: MarkdownDiagnosticCodes.ADJACENT_LINKS_MERGED, severity: 'info', message: `${String(group.length)} adjacent runs share the hyperlink "${hyperlink}"; markdown has no way to place two link boundaries back to back, so they render as one link spanning their combined text` });
    }
    if (group.length === 1 && isPlainAutolink(group[0]!)) {
      out += `<${group[0]!.text}>`;
    } else {
      const linkText = renderNestedStyles(group, 0, context);
      out += `[${linkText}](${escapeLinkDestination(hyperlink)})`;
    }
    index = groupEnd;
  }
  return out;
}

// The table-cell-specific variant (src/emit/table.ts): a GFM table row is exactly one physical line, so an embedded hard-break newline (rendered by emitRuns as a backslash-newline pair, matching escapeMarkdownText's own convention) cannot survive as-is -- it collapses to a single space instead.
export function emitRunsSingleLine(runs: readonly ContentRun[], context: InlineEmitContext): string {
  return emitRuns(runs, context).replace(/\\\n/g, ' ');
}
