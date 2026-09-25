// The list-rendering section split from emit.ts: every list-item renderer and the region-collection scan that assembles items, generalised over ListRegionItem.

import { MarkdownDiagnosticCodes } from "../diagnostics/diagnostics";
import type {
  ConstructDescriptor,
  ContentBlock,
  ContentListMembership,
  ContentParagraph,
} from "document-schema.js";
import type { ListNumIdInfo } from "../shared/list-id";
import { parseListNumId } from "../shared/list-id";
import {
  TASK_CHECKBOX_CHECKED,
  TASK_CHECKBOX_UNCHECKED,
} from "../shared/style-constants";
import type { EmitContext, RenderableBlock } from "./emit";
import {
  canInterruptOpenParagraph,
  isDataUri,
  renderParagraphBody,
  renderTopLevelBlock,
} from "./emit";
import { isValidFootnoteLabel } from "../inline/footnote";
import {
  escapeLinkDestination,
  escapeMarkdownText,
  renderLinkTitle,
} from "./inline";
import { emitImage } from "./image";
import { splitLines, terminatesCleanly } from "./setext";
import {
  HTML_PREFORMATTED_STYLE_ID,
  QUOTE_INDENT_PT,
} from "../shared/style-constants";

// --- List rendering: every ContentParagraph carrying .list is its own list item (see src/lower/lower.ts's own top-of-file note on why ContentListMembership cannot distinguish a continuation paragraph from a fresh sibling item — this package resolves that ambiguity the same way on both sides, consistently). A construct (most commonly a blockquote's division pair) sitting directly inside an item shares that item's own membership on its own wrapped paragraphs — src/lower/lower.ts's lowerBlockquote threads the enclosing BlockLowerContext.list straight through a quote's own children — so ListRegionItem below generalises every function in this section from plain ContentParagraph blocks to that heterogeneous shape (a plain list-tagged paragraph, or a construct carrying one), letting a construct stay nested inside the item it interrupts rather than fracturing it into separate top-level content (renderItems' own region-collection scan is where that heterogeneous run is actually assembled, via constructCarriesListItemId below). ---

// numId undefined is a depth-only ContentListMembership — document-schema.js 3.3.0+ makes numId optional for sources that carry a level but no numbering identity of their own (OOXML drawing paragraphs' a:pPr/@lvl being the motivating case) — and it lands in the same documented cross-format fallback as a foreign numId string: with no marker type, task-ness, or loose-ness to recover, the item renders as an ordinary, tight, non-task bullet at its own level.
export function listInfoFor(
  numId: string | undefined,
  context: EmitContext,
): ListNumIdInfo | undefined {
  if (numId === undefined) {
    if (!context.reportedAbsentNumIdFallback) {
      context.reportedAbsentNumIdFallback = true;
      context.sink({
        code: MarkdownDiagnosticCodes.LIST_NUMID_FALLBACK,
        severity: "info",
        message:
          "a list membership with no numId of its own (a depth-only ContentListMembership) has no marker type, task-ness, or loose-ness to recover and falls back to an ordinary, tight, non-task bullet list",
      });
    }
    return undefined;
  }
  const info = parseListNumId(numId);
  if (info === undefined && !context.reportedFallbackNumIds.has(numId)) {
    context.reportedFallbackNumIds.add(numId);
    context.sink({
      code: MarkdownDiagnosticCodes.LIST_NUMID_FALLBACK,
      severity: "info",
      message: `numId "${numId}" was not minted by this package's own src/lower and falls back to an ordinary, tight, non-task bullet list`,
    });
  }
  return info;
}

// Strips the leading checkbox glyph run the pre-field lowering prepended, so renderParagraphBody does not ALSO print the raw glyph character in the item's own body text — the marker rendered by renderListItemMarker below carries the equivalent `[x]`/`[ ]` text instead. Reached only for the legacy glyph spelling; the membership-field spelling has no glyph run to strip.
export function stripCheckboxRun(item: ContentParagraph): ContentParagraph {
  const first = item.runs[0];
  const checked = first?.text.startsWith(`${TASK_CHECKBOX_CHECKED} `);
  const glyphPrefix =
    checked === true
      ? `${TASK_CHECKBOX_CHECKED} `
      : `${TASK_CHECKBOX_UNCHECKED} `;
  if (first?.text.startsWith(glyphPrefix) !== true) {
    return item;
  }
  const strippedText = first.text.slice(glyphPrefix.length);
  const runs =
    strippedText.length === 0
      ? item.runs.slice(1)
      : [{ ...first, text: strippedText }, ...item.runs.slice(1)];
  return { ...item, runs };
}

// One item of a list region once its own list identity is known: either a plain list-tagged paragraph, or a construct (a division, almost always) directly interrupting the item — see the region-collection scan in renderItems for how a construct's own membership is resolved (always inherited from the paragraph it interrupts, via constructCarriesListItemId, never independently re-derived from the construct's own subtree). `list` is carried directly on every variant rather than re-read from `block`/`item` on each access, since a construct has no membership of its own to re-read in the first place.
export type ListRegionItem =
  | {
      readonly kind: "paragraph";
      readonly block: ContentParagraph;
      readonly list: ContentListMembership;
    }
  | {
      readonly kind: "construct";
      readonly item: ConstructItem;
      readonly list: ContentListMembership;
    };

// Recovers the plain EmitItem shape underneath a ListRegionItem, for the two helpers below (emitItemCanInterrupt/lastStyleIdOf) that already know how to recurse through a construct's own children and have no need for the list identity ListRegionItem adds on top.
export function toEmitItem(item: ListRegionItem): EmitItem {
  return item.kind === "paragraph" ? { block: item.block } : item.item;
}

// One item's first-block preparation: the checkbox text its marker line carries, and the SAME paragraph with any legacy checkbox glyph run already stripped out of it, when one was found. The membership's own checked field is the current spelling and needs no task-flagged numId behind it; the glyph sniff is gated on the numId's task flag AND on the first block actually being a paragraph (a construct has no runs of its own to sniff a glyph from), so an ordinary item whose text happens to begin with a ballot-box glyph is never misread as a checkbox. Doing the strip here, once, rather than returning a separate "please strip" boolean for listRegionItemBody to act on later, means no second site ever needs to re-derive from the run text whether stripping applies — the one place that already found the glyph is the one place that removes it.
export interface FirstBlockCheckbox {
  readonly checkboxText: string;
  readonly strippedFirstBlock: ContentParagraph | undefined;
}

export function firstBlockCheckbox(
  first: ListRegionItem,
  taskNumId: boolean,
): FirstBlockCheckbox {
  if (first.list.checked !== undefined) {
    return {
      checkboxText: first.list.checked ? "[x] " : "[ ] ",
      strippedFirstBlock: undefined,
    };
  }
  if (!taskNumId || first.kind !== "paragraph") {
    return { checkboxText: "", strippedFirstBlock: undefined };
  }
  // A paragraph with no runs at all has no leading text to sniff a glyph from, which `leading?.startsWith(...) === true` answers directly. No stand-in empty string is substituted for the absent run, since an absent run and a run whose text merely fails to start with a glyph are the same answer here anyway.
  const leading = first.block.runs[0]?.text;
  if (leading?.startsWith(`${TASK_CHECKBOX_CHECKED} `) === true) {
    return {
      checkboxText: "[x] ",
      strippedFirstBlock: stripCheckboxRun(first.block),
    };
  }
  if (leading?.startsWith(`${TASK_CHECKBOX_UNCHECKED} `) === true) {
    return {
      checkboxText: "[ ] ",
      strippedFirstBlock: stripCheckboxRun(first.block),
    };
  }
  return { checkboxText: "", strippedFirstBlock: undefined };
}

export interface RenderedListMarker {
  // The visible marker text prepended to the item's own first line — bullet/ordinal glyph AND, for a task item, its checkbox text.
  readonly full: string;
  // The bullet/ordinal glyph's own width alone (glyph + one space), EXCLUDING any checkbox text — what CommonMark's own list-item continuation rule actually measures (spec 0.31.2, "List items": the marker plus its own padding, not whatever content happens to follow on the first line). Using `full.length` for a nested list's own indent would over-indent it past what a real reparse recognises as still belonging to this item, since a task item's checkbox glyph is ordinary FIRST-LINE CONTENT, not part of the marker.
  readonly bareLength: number;
}

export function renderListItemMarker(
  numId: string | undefined,
  info: ListNumIdInfo | undefined,
  glyph: string,
  checkboxText: string,
  context: EmitContext,
): RenderedListMarker {
  // Only a parsed numId string can carry type 'ordered', so the ordered-counter key is present exactly when this branch is live.
  if (info?.type === "ordered" && numId !== undefined) {
    const next = context.orderedCounters.get(numId) ?? info.start ?? 1;
    context.orderedCounters.set(numId, next + 1);
    const bare = `${String(next)}${glyph} `;
    return { full: `${bare}${checkboxText}`, bareLength: bare.length };
  }
  const bare = `${glyph} `;
  return { full: `${bare}${checkboxText}`, bareLength: bare.length };
}

// The two glyphs CommonMark's own list-item grammar recognises for each marker type (spec 0.31.2, "List items"): a bullet list marker is '-', '+', or '*'; an ordered list delimiter is '.' or ')'. Only two candidates for ORDERED because that is every legal delimiter the grammar defines; BULLET keeps all three so a collision has a glyph left even after one alternation.
export const BULLET_GLYPH_CANDIDATES = ["-", "+", "*"] as const;
export const ORDERED_GLYPH_CANDIDATES = [".", ")"] as const;

export interface ListSiblingSignature {
  readonly numId: string;
  readonly type: "bullet" | "ordered";
  readonly glyph: string;
}

// The bullet character or ordered delimiter a numId renders with, memoised in context.resolvedListGlyphs the first time renderListRegion reaches it so every item of the SAME numId agrees on one glyph. Defaults to the configured bulletMarker/orderedDelimiter, EXCEPT when `numId` immediately follows a DIFFERENT numId of the SAME type in the CURRENT list region (renderListRegion's own numId-boundary loop passes the immediately preceding numId's own resolved signature as `previousSibling`) and that sibling already resolved to the identical default glyph: two adjacent lists rendered with the SAME bullet character or ordered delimiter are indistinguishable, on reparse, from one continuous list (CommonMark spec 0.31.2 examples 301/302 — `- foo\n- bar\n+ baz` and `1. foo\n2. bar\n3) baz`, each a source that used two DIFFERENT marker glyphs specifically so the second list would not continue the first) — a blank line between the numId-boundary's own two parts (renderListRegion's own `out += sameList && !loose ? "\n" : "\n\n"`) does not by itself force a fresh list the way a genuine glyph change does. Alternating to the next candidate glyph is what actually reproduces that boundary; picking the first candidate that ISN'T the colliding default keeps the choice deterministic and, for a run of three or more adjacent same-type lists, alternates back and forth rather than drifting through every candidate in turn.
export function resolveListGlyph(
  numId: string,
  type: "bullet" | "ordered",
  previousSibling: ListSiblingSignature | undefined,
  context: EmitContext,
): string {
  const cached = context.resolvedListGlyphs.get(numId);
  if (cached !== undefined) {
    return cached;
  }
  const defaultGlyph =
    type === "ordered" ? context.orderedDelimiter : context.bulletMarker;
  const collides =
    previousSibling?.type === type && previousSibling.glyph === defaultGlyph;
  const candidates =
    type === "ordered" ? ORDERED_GLYPH_CANDIDATES : BULLET_GLYPH_CANDIDATES;
  const glyph = collides
    ? (candidates.find((candidate) => candidate !== defaultGlyph) ??
      defaultGlyph)
    : defaultGlyph;
  context.resolvedListGlyphs.set(numId, glyph);
  return glyph;
}

export interface ListItemPart {
  // undefined = a depth-only membership with no numId of its own; consecutive such parts share that absence as their list identity, rendering as one tight bullet list.
  readonly numId: string | undefined;
  readonly text: string;
}

// One item's own contiguous run of same-level, same-itemId blocks (kind 'own') — a plain paragraph, or a construct renderItems' own region-collection scan already verified shares this exact itemId — or the deeper-level blocks of a nested sub-list sitting between two such runs (kind 'nested') — see collectListItem below for why an item can carry more than one 'own' run.
export interface ItemOwnSegment {
  readonly kind: "own";
  readonly blocks: readonly ListRegionItem[];
}
export interface ItemNestedSegment {
  readonly kind: "nested";
  readonly blocks: readonly ListRegionItem[];
}
export type ItemSegment = ItemOwnSegment | ItemNestedSegment;

// The contiguous run, starting at `from`, of items sharing this exact level and itemId. collectListItem's own leading call is the ONLY call site where `items[from]` is guaranteed to already match (it reads level/itemId from items[from] itself before calling), so there the result is always at least `from + 1`; the resume call inside its loop has no such guarantee — `from` sits right after a nested sub-list run, and the next item there may belong to a different item, a different level, or not exist at all — so a result equal to `from` (no match at all) is a real, expected outcome that caller explicitly checks for rather than something this function rules out.
export function consumeSameItemRun(
  items: readonly ListRegionItem[],
  from: number,
  level: number,
  itemId: string,
): number {
  let end = from;
  // No separate `end < items.length` bound: `items[end]` running off the end already returns undefined, which the very next check below catches and breaks on — an explicit length comparison here would be redundant with that undefined check on every real input, never independently true or false.
  for (;;) {
    const candidate = items[end];
    if (candidate?.list.level !== level || candidate.list.itemId !== itemId) {
      break;
    }
    end += 1;
  }
  return end;
}

// Collects one list item's FULL run starting at `start`: its own leading same-level/same-itemId run (plain blocks and any directly-interrupting construct alike), then any nested (deeper-level) sub-list content, then — when the item's own blocks resume immediately after that nested content, sharing the same itemId — another own-level run, alternating for as long as the pattern repeats. This is the write-side shape CommonMark spec 0.31.2 example 325 names directly ("* foo\n  * bar\n\n  baz"): a nested sub-list can sit in the MIDDLE of one item's own blocks, not only after all of them, and only itemId (never numId+level alone) can tell that "baz" belongs to the same item as "foo" rather than starting a new sibling. A membership with no itemId at all never resumes: its own segment is always exactly the one item at `start`, exactly as this writer always treated a cross-format item.
export function collectListItem(
  items: readonly ListRegionItem[],
  start: number,
  level: number,
  itemId: string | undefined,
): { readonly segments: readonly ItemSegment[]; readonly next: number } {
  const segments: ItemSegment[] = [];
  let index = start;

  const ownEnd =
    itemId === undefined
      ? index + 1
      : consumeSameItemRun(items, index, level, itemId);
  segments.push({ kind: "own", blocks: items.slice(index, ownEnd) });
  index = ownEnd;

  for (;;) {
    let nestedEnd = index;
    // No separate `nestedEnd < items.length` bound: `items[nestedEnd]` running off the end already yields `candidateLevel === undefined`, which the check below already breaks on.
    for (;;) {
      const candidateLevel = items[nestedEnd]?.list.level;
      if (candidateLevel === undefined || candidateLevel <= level) {
        break;
      }
      nestedEnd += 1;
    }
    if (nestedEnd === index) {
      break;
    }
    segments.push({ kind: "nested", blocks: items.slice(index, nestedEnd) });
    index = nestedEnd;

    if (itemId === undefined) {
      break;
    }
    // No separate "did anything actually resume?" check: when nothing does, resumedEnd stays equal to index, so this pushes a harmless empty "own" segment (segments.push/segment.blocks are never read for their COUNT, only segments[0] and each segment's own blocks) and the loop's own nested-run check above terminates it on the very next pass, since index is unchanged from this one.
    const resumedEnd = consumeSameItemRun(items, index, level, itemId);
    segments.push({ kind: "own", blocks: items.slice(index, resumedEnd) });
    index = resumedEnd;
  }

  return { segments, next: index };
}

// Whether an EmitItem's own rendered spelling unconditionally interrupts an open paragraph when it immediately follows one, with no blank line between them — generalises canInterruptOpenParagraph (paragraph-keyed, checking its own actual rendered heading spelling too, not just its styleId) to a construct too. A materialised division's '> ' marker interrupts regardless of what it wraps (CommonMark spec 0.31.2's own list of blocks that can interrupt a paragraph includes block quotes — confirmed directly by spec example 245, "foo\n> bar\n", where "> bar" opens a fresh blockquote with no blank line needed). A construct rendering TRANSPARENTLY (no marker of its own to interrupt with — see isMaterialisedDivision) is not itself a boundary at all, so the question passes straight through, recursively, to its own first child.
export function emitItemCanInterrupt(
  item: EmitItem,
  context: EmitContext,
): boolean {
  if (!isConstructItem(item)) {
    return item.block.kind === "paragraph"
      ? canInterruptOpenParagraph(item.block, context)
      : true;
  }
  if (isMaterialisedDivision(item)) {
    return true;
  }
  const first = item.children[0];
  return first === undefined ? true : emitItemCanInterrupt(first, context);
}

// The styleId of the last paragraph an EmitItem's own rendering actually ends on, looking straight through any construct wrapper (marked or transparent) to find it. A construct's own '> ' marker (or the lack of one) changes whether IT interrupts whatever follows (emitItemCanInterrupt above), but not whether what it wraps leaves an open paragraph behind for CommonMark's own lazy-continuation rule to absorb a following unmarked line into — that risk is a property of the innermost content alone, at any nesting depth, since laziness itself cascades through nested containers unchanged. Feeding this straight into the existing terminatesCleanly/requiresBlankLineBefore therefore needs no change to either for a construct to be handled exactly as safely, or unsafely, as a bare paragraph already was.
export function lastStyleIdOf(item: EmitItem): string | undefined {
  if (isConstructItem(item)) {
    const last = item.children[item.children.length - 1];
    return last === undefined ? undefined : lastStyleIdOf(last);
  }
  return item.block.kind === "paragraph" ? item.block.styleId : undefined;
}

export function regionItemCanInterrupt(
  item: ListRegionItem,
  context: EmitContext,
): boolean {
  return emitItemCanInterrupt(toEmitItem(item), context);
}

export function lastStyleIdOfRegionItem(
  item: ListRegionItem,
): string | undefined {
  return lastStyleIdOf(toEmitItem(item));
}

// One list-region item's own rendered body, with no marker/indent applied yet. A plain paragraph renders through renderParagraphBody exactly as before (using `overrideParagraph` in place of the item's own block when the caller already prepared a checkbox-glyph-stripped version, per firstBlockCheckbox above); a construct renders through renderConstruct — the SAME function renderItems reaches for a construct that is NOT part of any list region, so a construct's own markdown spelling never diverges depending on whether it happens to sit inside a list item, EXCEPT for context.enclosingItemId, set here for the duration of that one call: it is what lets renderItems' own recursive walk over the construct's children tell inherited pass-through membership (this exact item, see EmitContext's own field comment) apart from a genuinely fresh nested list.
export function listRegionItemBody(
  item: ListRegionItem,
  context: EmitContext,
  overrideParagraph: ContentParagraph | undefined,
): string {
  if (item.kind === "paragraph") {
    return renderParagraphBody(overrideParagraph ?? item.block, context);
  }
  const previousEnclosingItemId = context.enclosingItemId;
  context.enclosingItemId = item.list.itemId;
  const body = renderConstruct(item.item, context);
  context.enclosingItemId = previousEnclosingItemId;
  return body;
}

// Whether a list-region item immediately following `previousStyleId`, with no blank line between them, risks CommonMark's own lazy-continuation rule silently absorbing it into the PRECEDING block instead of starting a fresh one. HTML_PREFORMATTED_STYLE_ID as `previousStyleId` is checked unconditionally, first, regardless of `next`: an open HTML block (CommonMark start conditions 1-7) is not a paragraph at all, and regionItemCanInterrupt answers a different question — "does this item interrupt an open PARAGRAPH" — that has no bearing on what interrupts an open HTML block, which several of those seven conditions close only at a blank line (and, per terminatesCleanly's own note, this package cannot tell which of the seven conditions it produced, so it always assumes the least permissive). Past that, "can this ever go wrong" and "is this item itself safe to follow with" are different properties (see terminatesCleanly and regionItemCanInterrupt above), and a blank line is required only when BOTH answers are unfavourable: terminatesCleanly(previousStyleId) means there is no open paragraph left for anything to absorb into, regardless of what `next` is; regionItemCanInterrupt(next, context) means `next` starts fresh unconditionally when `previousStyleId` IS an open paragraph (never an open HTML block, handled above) — true unconditionally for a materialised construct (a '>' marker always interrupts), and deferring to canInterruptOpenParagraph for a plain paragraph exactly as before. `previousStyleId` for an item immediately following a nested sub-list, or a construct, is that run's own LAST rendered paragraph's styleId found by looking straight through it (lastStyleIdOfRegionItem) rather than treating "just finished a nested list" or "just finished a construct" as blanket-safe — a plain paragraph ending either is exactly as open as any other, and a following line at the outer item's own continuation indent is CommonMark's own lazy continuation of THAT paragraph, not something the outer item's markers (or the construct's own marker) make safe (spec 0.31.2 example 325 is this exact shape for a nested sub-list, and is why it requires the blank line it has). Two blocks that are BOTH plain (or one/both Quote-styled) are genuinely ambiguous without a blank line: for two plain paragraphs specifically, src/lower/lower.ts's own reader can only ever produce that pair when a real source blank line separated them in the first place (two adjacent non-blank plain-text lines are read as ONE multi-line paragraph, never two), so re-inserting the blank line here is not merely safe, it is what the source actually had.
export function requiresBlankLineBefore(
  next: ListRegionItem,
  previousStyleId: string | undefined,
  context: EmitContext,
): boolean {
  if (previousStyleId === HTML_PREFORMATTED_STYLE_ID) {
    return true;
  }
  return (
    !terminatesCleanly(previousStyleId) &&
    !regionItemCanInterrupt(next, context)
  );
}

// Renders one contiguous, flat run of list-region items — plain .list-carrying paragraphs, and any construct directly interrupting one of them — possibly spanning several sibling top-level lists back to back, and arbitrarily nested sub-lists (an item whose own level is deeper than its predecessor's is that predecessor's own nested list content, recursed into here via collectListItem's 'nested' segments). One ITEM is every block sharing one itemId — the write-side inverse of src/lower/lower.ts's minted item identity — so a multi-block item renders one marker line with every later block of its own continued on the continuation indent, any nested sub-list content indented in place between them, and any interrupting construct rendered (and indented) exactly where it falls in that same run. A membership with no itemId at all is the cross-format shape: each paragraph is its own item, exactly as this writer always treated them. Spacing between two items of the SAME item run is a blank line whenever requiresBlankLineBefore says one is structurally required (see that function), and OTHERWISE only when the item's own numId was minted loose (info.loose) — never unconditionally: forcing a blank line onto every continuation would silently turn a tight list loose on the way out (spec 0.31.2 example 300's own regression, a heading directly followed by a plain paragraph with no blank line between them in a tight list). Loose/tight spacing between two SIBLING items sharing the same numId is read from that same numId's own `loose` flag; a boundary between two DIFFERENT numIds always gets a blank line, matching how two genuinely separate lists always render with visual separation.
export function renderListRegion(
  items: readonly ListRegionItem[],
  context: EmitContext,
): string {
  const parts: ListItemPart[] = [];
  let index = 0;
  // The immediately preceding numId's own resolved type/glyph, local to this call (never read across a recursive call into a nested sub-list, or across a separate top-level renderListRegion call) — exactly the scope resolveListGlyph's own collision check needs: two lists are only a genuine ADJACENCY risk when nothing else renders between them, which is precisely what "both sit in the SAME renderListRegion call's own items array" already guarantees. Left unset (and never consulted) for a depth-only membership (numId undefined, the cross-format shape LIST_NUMID_FALLBACK already documents) — a rare cross-format edge case this glyph-alternation scheme does not extend to.
  let previousSibling: ListSiblingSignature | undefined;
  // No separate `index < items.length` bound: `items[index]` running off the end already returns undefined, which the very next check breaks on.
  for (;;) {
    const item = items[index];
    if (item === undefined) {
      break;
    }
    const { numId, level, itemId } = item.list;
    const info = listInfoFor(numId, context);
    const loose = info?.loose === true;
    const type = info?.type ?? "bullet";
    // A depth-only membership (numId undefined) always resolves through listInfoFor's OWN undefined-numId branch, which never returns real ListNumIdInfo — so `type` above is always its own "bullet" default here, and `type === "ordered"` can never be true in this branch specifically; only the numId-carrying side ever sees a genuinely ordered type.
    const glyph =
      numId === undefined
        ? context.bulletMarker
        : resolveListGlyph(numId, type, previousSibling, context);
    if (numId !== undefined) {
      previousSibling = { numId, type, glyph };
    }

    const { segments, next } = collectListItem(items, index, level, itemId);
    const first = segments[0]?.blocks[0];
    if (first === undefined) {
      break;
    }
    const { checkboxText, strippedFirstBlock } = firstBlockCheckbox(
      first,
      info?.task === true,
    );
    const marker = renderListItemMarker(
      numId,
      info,
      glyph,
      checkboxText,
      context,
    );
    const indent = " ".repeat(marker.bareLength);

    // Seeded with the marker itself rather than with an empty string: segments[0] is always an 'own' segment holding at least the block `first` was just read from (collectListItem's own leading run), so the first block below always appends its own first line straight onto this marker.
    let text = marker.full;
    let renderedFirstLine = false;
    let previousStyleId: string | undefined;
    for (const segment of segments) {
      if (segment.kind === "nested") {
        const nested = renderListRegion(segment.blocks, context)
          .split("\n")
          .map((line) => (line.length === 0 ? line : `${indent}${line}`))
          .join("\n");
        text += `\n${nested}`;
        // segment.blocks is the flat, in-order slice of every deeper-level item this nested run rendered, regardless of how many further nesting levels it recursed through — rendering always processes that slice front to back, so its LAST element is exactly the last content this nested call above actually produced. Looking straight through it to the real last styleId (lastStyleIdOfRegionItem), not blanket "just finished a nested list, always safe", is what requiresBlankLineBefore needs next.
        const lastNested = segment.blocks[segment.blocks.length - 1];
        previousStyleId =
          lastNested === undefined
            ? undefined
            : lastStyleIdOfRegionItem(lastNested);
        continue;
      }
      for (const block of segment.blocks) {
        if (!renderedFirstLine) {
          const [firstLine, ...restLines] = splitLines(
            listRegionItemBody(block, context, strippedFirstBlock),
            "\n",
          );
          text += [
            firstLine,
            ...restLines.map((line) => `${indent}${line}`),
          ].join("\n");
          renderedFirstLine = true;
          previousStyleId = lastStyleIdOfRegionItem(block);
          continue;
        }
        const rendered = listRegionItemBody(block, context, undefined)
          .split("\n")
          .map((line) => (line.length === 0 ? line : `${indent}${line}`))
          .join("\n");
        const blank =
          loose || requiresBlankLineBefore(block, previousStyleId, context);
        text += blank ? `\n\n${rendered}` : `\n${rendered}`;
        previousStyleId = lastStyleIdOfRegionItem(block);
      }
    }

    parts.push({ numId, text });
    index = next;
  }

  let out = "";
  for (const [partIndex, part] of parts.entries()) {
    if (partIndex > 0) {
      const previous = parts[partIndex - 1]!;
      // Looseness is read only once the two parts are already known to belong to the same list: a boundary between two DIFFERENT numIds always gets a blank line regardless of either side's own loose flag, so that flag is never consulted there. A depth-only membership (numId undefined) has no numId to read a flag from and always continues tightly, matching listInfoFor's own fallback to a tight bullet list.
      const continuesTightly =
        previous.numId === part.numId &&
        (previous.numId === undefined ||
          parseListNumId(previous.numId)?.loose !== true);
      out += continuesTightly ? "\n" : "\n\n";
    }
    out += part.text;
  }
  return out;
}

// --- Construct boundary markers (document-schema.js 4.2.0): the flat form encodes a construct as a MATCHED PAIR of markers bracketing the blocks it spans, so the writer's first job over any block list is to recover that bracketing as a tree before rendering anything. ---

// One item of a block list once the markers have been resolved: either an ordinary content block, or a construct with its own extent recovered as children (which may themselves contain further constructs, at any nesting depth).
export type EmitItem = { readonly block: RenderableBlock } | ConstructItem;

export interface ConstructItem {
  readonly descriptor: ConstructDescriptor;
  readonly children: readonly EmitItem[];
}

export function isConstructItem(item: EmitItem): item is ConstructItem {
  return "descriptor" in item;
}

// Whether a construct's own rendered spelling opens with a self-delimiting marker on every line ('> ' for a division, per renderConstruct below) rather than rendering transparently as its own children's content with nothing distinguishing it — see renderConstruct's own comment for why the blockquote spelling is gated on the wrapped paragraphs' own indentLeftPt dual carry rather than on descriptor.kind alone (a division whose paragraphs carry no such indent is a FOREIGN one, and renders transparently). This same test doubles as the write-side "does this construct's own marker unconditionally interrupt an open paragraph" signal renderListRegion below needs (a materialised division's '> ' does, per CommonMark spec 0.31.2's own list of blocks that can interrupt a paragraph; a transparent construct instead defers to whatever its own first child renders as).
// The left indent a paragraph that carries no indentLeftPt field at all effectively has: document-schema.js leaves the field optional, and an absent one is no indentation rather than an unknown amount of it.
export const UNINDENTED_PT = 0;

export function isMaterialisedDivision(item: ConstructItem): boolean {
  return (
    item.descriptor.kind === "division" &&
    item.children.every((child) => {
      if (isConstructItem(child)) {
        return true;
      }
      // A paragraph carrying no indentLeftPt at all answers this threshold question identically to one carrying less than a quote level of it, so the absence is defaulted into the comparison rather than tested separately ahead of it.
      return (
        child.block.kind !== "paragraph" ||
        (child.block.indentLeftPt ?? UNINDENTED_PT) >= QUOTE_INDENT_PT
      );
    })
  );
}

// Bracket matching, per document-schema.js's own contract: a constructEnd closes the nearest preceding still-open constructStart in the SAME block list, and the blocks between them are that construct's extent. emitMarkdown validates the whole list's balance up front (findConstructMarkerImbalance — the one shared definition of that check, which this writer, every sibling codec, and documents.js's decompose all have to agree on exactly), so by the time this runs a closing marker for every open one is known to exist.
export function groupConstructItems(
  blocks: readonly ContentBlock[],
  start: number,
): { readonly items: EmitItem[]; readonly next: number } {
  const items: EmitItem[] = [];
  let index = start;
  // No separate `index < blocks.length` bound: `blocks[index]` running off the end already returns undefined, which the very next check breaks on.
  for (;;) {
    const block = blocks[index];
    if (block === undefined) {
      break;
    }
    index += 1;
    if (block.kind === "constructEnd") {
      return { items, next: index };
    }
    if (block.kind === "constructStart") {
      const nested = groupConstructItems(blocks, index);
      items.push({ descriptor: block.descriptor, children: nested.items });
      index = nested.next;
      continue;
    }
    items.push({ block });
  }
  return { items, next: index };
}

// Columns of indentation a footnote definition's own continuation lines carry — the same four src/block/block.ts's continueFootnoteDefinition strips back off, and the same four Pandoc and GitHub both write. Deliberately NOT the rendered `[^label]: ` marker's own width (which varies with the label): a reader measures the continuation indent against a fixed column, not against whatever the marker happened to occupy.
export const FOOTNOTE_CONTINUATION_INDENT = 4;

// The write-side inverse of src/lower/lower.ts's lowerFootnoteDefinition: the anchor's own name becomes the `[^label]:` marker, and its extent becomes the definition's body, every line after the first indented to the continuation column. An empty extent (the point anchor a bodyless `[^1]:` lowers to) emits the bare marker rather than a marker followed by a trailing space.
export function renderFootnoteDefinition(name: string, body: string): string {
  const marker = `[^${name}]:`;
  if (body.length === 0) {
    return marker;
  }
  const indent = " ".repeat(FOOTNOTE_CONTINUATION_INDENT);
  const [firstLine, ...restLines] = splitLines(body, "\n");
  return [
    `${marker} ${firstLine}`,
    ...restLines.map((line) => (line.length === 0 ? line : `${indent}${line}`)),
  ].join("\n");
}

// A construct markdown has a syntax for renders as that syntax; one it does not is TRANSPARENT — its extent still renders in place, and only the construct's own identity is lost. That is the correct degrade rather than dropping the extent: a ContentDocument reaching this writer from another codec (an odt division, a docx content control, a tracked-change wrapper) carries real content inside markers markdown cannot spell, and dropping the wrapper's content along with the wrapper would lose the document, not just the construct.
//
// `anchor` has a markdown spelling for its footnote arm, and `link` for exactly one shape: the titled resolved image src/lower/lower.ts brackets with a pair — `![alt](dest "title")`, the destination restored verbatim from the descriptor's target instead of re-embedded as a data: URI. Everything else (a bookmark, an endnote, a comment, an internal-target link, any other descriptor kind) has no CommonMark or GFM syntax at all.
export function renderConstruct(
  item: ConstructItem,
  context: EmitContext,
): string {
  const { descriptor } = item;
  if (descriptor.kind === "anchor" && descriptor.anchorType === "footnote") {
    const body = renderItems(item.children, context);
    if (isValidFootnoteLabel(descriptor.name)) {
      return renderFootnoteDefinition(descriptor.name, body);
    }
    context.sink({
      code: MarkdownDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
      severity: "info",
      message: `a footnote anchor's own name "${descriptor.name}" cannot be spelled as a "[^label]:" marker (whitespace or "]" would reparse as something else); its own extent still renders in place, but the construct itself is not represented`,
    });
    return body;
  }
  // The blockquote spelling is gated on this package's own dual carry, not on the descriptor kind alone — see isMaterialisedDivision above for exactly what that gate checks and why. A division whose paragraphs carry no such indent is a FOREIGN one — an ODF text:section, a tagged-PDF /Sect — and renders transparently below: a named section is not a markdown blockquote, and rendering it as one would invent a construct the source never had. No separate `descriptor.kind === "division"` guard here: isMaterialisedDivision's own first check already tests that, so a non-division descriptor is refused there regardless, making an outer duplicate of the same check redundant.
  if (isMaterialisedDivision(item)) {
    context.divisionDepth += 1;
    const body = renderItems(item.children, context);
    context.divisionDepth -= 1;
    return body
      .split("\n")
      .map((line) => (line.length === 0 ? ">" : `> ${line}`))
      .join("\n");
  }
  if (descriptor.kind === "link" && descriptor.target.kind === "external") {
    // The mint condition is exact — a pair around precisely one image block, the shape this package's own read side mints. A link construct of any other shape (an annotated block extent from another codec, a run-level pair flattened into a block list) renders transparently below rather than being guessed at.
    const onlyChild =
      item.children.length === 1 && !isConstructItem(item.children[0]!)
        ? item.children[0]!.block
        : undefined;
    if (onlyChild?.kind === "image" && !isDataUri(descriptor.target.uri)) {
      const alt = escapeMarkdownText(onlyChild.altText ?? "");
      return `![${alt}](${escapeLinkDestination(descriptor.target.uri)}${descriptor.title === undefined ? "" : ` "${renderLinkTitle(descriptor.title)}"`})`;
    }
    if (
      onlyChild?.kind === "image" &&
      isDataUri(descriptor.target.uri) &&
      !context.embedImages
    ) {
      // The destination IS the bytes and the caller asked for no bytes — the pair falls back to the plain no-bytes rendering and the construct goes unrepresented for it.
      return emitImage(onlyChild, false);
    }
  }
  const body = renderItems(item.children, context);
  const detail =
    descriptor.kind === "anchor"
      ? `${descriptor.kind} (${descriptor.anchorType})`
      : descriptor.kind;
  context.sink({
    code: MarkdownDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
    severity: "info",
    message: `a "${detail}" construct has no markdown syntax; its own extent still renders in place, but the construct itself is not represented`,
  });
  return body;
}

// Whether a construct's own recursive extent carries data connecting it back to the given list itemId — the single test renderItems' own region-collection loop below uses to decide whether a construct immediately following a list-region run genuinely belongs to the item it interrupts (absorbed into the SAME ListRegionItem run, staying nested inside that item on write) or is a genuinely separate, unrelated construct (left to render as ordinary top-level content). Two shapes carry that data, both minted at lower time rather than inferred here: a plain paragraph directly inside the construct sharing this exact itemId (src/lower/lower.ts's lowerBlockquote threads the enclosing item's own membership straight through a quote's directly-wrapped paragraphs), or a plain paragraph carrying a numId whose own `+owner=` suffix (src/shared/list-id.ts) names this itemId — the shape a quote wrapping a GENUINELY FRESH nested list of its own produces (lowerList always mints that list independently, so none of its OWN paragraphs share the enclosing item's itemId directly; the owner suffix on its numId is the only place that fact survives). ExaDev/documents.js#990's fix reads ownership from the construct's own content in every shape lowering can produce, at any nesting depth, rather than guessing from what happens to follow the construct's own extent in the block list. Matching is scoped to the SPECIFIC itemId passed in, not "any list identity found inside" — a construct's own subtree can legitimately contain an item at a DIFFERENT list level sharing no itemId with the one being tested (a fresh nested sub-list one level deeper, minted with its own itemId and its own, different owner tag or none at all), and only an exact match tells "genuinely this item's own content" apart from that. More than one item can genuinely be "open" at once at the point a construct is encountered — an outer item interrupted midway by its own nested sub-list (CommonMark spec 0.31.2 example 325) leaves BOTH the outer item's and the inner item's own membership still live — so the caller does not call this with a single fixed itemId: it walks every level currently open, deepest first, calling this once per level until one matches or none do. This function itself only ever answers for the one itemId it was given; the "at any nesting depth" claim above is about the construct's OWN subtree (this function's recursion), not about how many itemIds the caller may try.
export function constructCarriesListItemId(
  item: ConstructItem,
  itemId: string,
): boolean {
  return item.children.some((child) => {
    if (isConstructItem(child)) {
      return constructCarriesListItemId(child, itemId);
    }
    if (child.block.kind !== "paragraph") {
      return false;
    }
    const list = child.block.list;
    if (list?.itemId === itemId) {
      return true;
    }
    return (
      list?.numId !== undefined &&
      parseListNumId(list.numId)?.ownerItemId === itemId
    );
  });
}

// Whether a paragraph's own list membership is INHERITED pass-through rather than a list identity of its own — true exactly when its itemId matches context.enclosingItemId (see that field's own comment): the paragraph sits inside a construct whose extent was absorbed into an already-open list item purely so that item could be recognised as such, not because the paragraph is itself a fresh list item. renderItems checks this before treating a .list-carrying paragraph as the start (or continuation) of a marker-bearing list region — rendering one as a marker line would invent a bullet the source never had.
export function isInheritedListMembership(
  list: Readonly<ContentListMembership>,
  context: EmitContext,
): boolean {
  return list.itemId !== undefined && list.itemId === context.enclosingItemId;
}

// A consecutive run of quoted top-level blocks at the SAME depth is genuinely ambiguous once lowered — ContentParagraph.indentLeftPt has no field distinguishing "one blockquote containing several blocks" from "several independent blockquotes back to back at the same depth" (document-schema.js carries no ContentBlockquote container of its own; src/lower/lower.ts flattens both shapes identically). Joining every top-level block with a bare blank line, as below, resolves that ambiguity by always choosing the "independent blockquotes" reading — the correctness-preserving default, since re-joining two ADJACENT SAME-depth quoted blocks into one blockquote (tried and reverted here) fixes no example src/test-support/conformance-exclusions.ts's own exclusion list was not already going to fail on for some other, already-documented reason (see that module's own ADJACENT_SAME_DEPTH reason, which cross-references this exact comment), while genuinely breaking two real cases (two independent same-depth blockquotes with nothing between them) that this simpler join gets right.
export function renderItems(
  items: readonly EmitItem[],
  context: EmitContext,
): string {
  const parts: string[] = [];
  let index = 0;
  // No separate `index < items.length` bound: `items[index]` running off the end already returns undefined, which the very next check breaks on.
  for (;;) {
    const item = items[index];
    if (item === undefined) {
      break;
    }
    if (isConstructItem(item)) {
      const rendered = renderConstruct(item, context);
      if (rendered.length > 0) {
        parts.push(rendered);
      }
      index += 1;
      continue;
    }
    if (
      item.block.kind === "paragraph" &&
      item.block.list !== undefined &&
      !isInheritedListMembership(item.block.list, context)
    ) {
      // The region can span several items (a plain paragraph is always absorbed unconditionally — renderListRegion's own collectListItem is what tells a continuation of the SAME item apart from a fresh sibling), so `openMemberships` tracks every item's own membership CURRENTLY open, keyed by nesting level — not just the single most recently absorbed one. A single slot cannot survive a nested sub-list: once one of the nested item's own paragraphs is absorbed (unconditionally, like any other list-tagged paragraph — level is not part of the absorption test), the slot holds the INNER item's membership, so a construct immediately following that resumes the OUTER item (CommonMark spec 0.31.2 example 325's own "nested sub-list in the middle of one item's own blocks" shape, generalised to a construct instead of a plain paragraph) would be tested against the wrong itemId and wrongly fracture out to top level. `openMemberships` fixes this by popping every entry at or deeper than a newly-absorbed paragraph's own level before pushing it — so the stack always holds exactly the memberships genuinely still open at each shallower level, the outer item's included — and matching a construct against it deepest-first (constructCarriesListItemId is scoped to one exact itemId, never "any list identity found inside", so at most one level can genuinely match): the currently-innermost open item first, then walking outward to whichever shallower item the construct actually resumes.
      const region: ListRegionItem[] = [];
      let end = index;
      const openMemberships: ContentListMembership[] = [];
      for (;;) {
        const candidate = items[end];
        if (candidate === undefined) {
          break;
        }
        if (isConstructItem(candidate)) {
          let matched: ContentListMembership | undefined;
          for (let i = openMemberships.length - 1; i >= 0; i -= 1) {
            const membership = openMemberships[i]!;
            if (
              membership.itemId !== undefined &&
              constructCarriesListItemId(candidate, membership.itemId)
            ) {
              matched = membership;
              break;
            }
          }
          if (matched === undefined) {
            break;
          }
          region.push({
            kind: "construct",
            item: candidate,
            list: matched,
          });
          end += 1;
          continue;
        }
        if (
          candidate.block.kind !== "paragraph" ||
          candidate.block.list === undefined ||
          isInheritedListMembership(candidate.block.list, context)
        ) {
          break;
        }
        const list = candidate.block.list;
        while (
          openMemberships.length > 0 &&
          openMemberships[openMemberships.length - 1]!.level >= list.level
        ) {
          openMemberships.pop();
        }
        openMemberships.push(list);
        region.push({
          kind: "paragraph",
          block: candidate.block,
          list,
        });
        end += 1;
      }
      parts.push(renderListRegion(region, context));
      index = end;
      continue;
    }
    const rendered = renderTopLevelBlock(item.block, context);
    if (rendered.length > 0) {
      parts.push(rendered);
    }
    index += 1;
  }
  return parts.join("\n\n");
}
