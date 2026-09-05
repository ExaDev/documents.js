// The opaque numId string src/lower (mint) and src/emit (parse) share for GFM list encoding. document-schema.js's own ContentListMembership carries only {numId, level} -- no type/task/tight-loose field of its own -- so every property markdown itself needs to round-trip through a list is packed into this one opaque string instead: a monotonic per-document mint counter (never reused, mirroring odf.js's own readOdt/readListItems "list1", "list2", ... convention -- see that module's own top-of-file note on why a counter, not a reusable style name, is the identity), the marker type (bullet/ordered, with an ordered list's own non-default start number), whether the list is (at least partially) a GFM task list, whether the list is loose (CommonMark's own tight/loose distinction), and (ExaDev/documents.js#990) the itemId of the list item this list is minted DIRECTLY INSIDE, when there is one (see the `+owner=` suffix below). Grammar: `md{N}:{bullet|ordered}[@{start}][+task][+loose][+owner={itemId}]`, e.g. "md1:bullet", "md2:ordered@3", "md3:bullet+task", "md4:bullet+owner=md-i1".
//
// Nesting mints NO new numId at all -- a nested list reuses its ENCLOSING list's own numId, incrementing only `level`, exactly mirroring odf.js's own nesting rule (a nested text:list keeps its enclosing list's numId, level+1). This is a deliberate, accepted limitation, not an oversight: if a nested list's own real marker type disagrees with the type baked into the numId at mint time, the numId's own type tag wins (first-wins) and the loser is reported via MarkdownDiagnosticCodes.LIST_MARKER_TYPE_CONFLICT (src/lower/lower.ts).
//
// The `+owner={itemId}` suffix is a DIFFERENT kind of fact from the other four: not a property of how this list itself renders, but a record of WHOSE list item this one is nested directly inside, for a list that would otherwise carry no trace of that at all. It exists for exactly one shape: src/lower/lower.ts's lowerBlockquote threads the enclosing list item's own membership straight through a quote's DIRECTLY-WRAPPED PARAGRAPHS (the quote-indent's own dual carry), but when the quote's content is itself a list, lowerList always mints that list a completely FRESH numId/itemId of its own (a list directly under a blockquote is never a continuation of whatever item enclosed the quote) -- so none of ITS paragraphs share the enclosing item's itemId either, and the construct wrapping it would otherwise carry no data at all connecting it back to that item. Tagging the fresh list's own numId with its minting-time enclosing itemId (lowerList reads BlockLowerContext.list.itemId, which names precisely that item, since only a list item's own context ever flows unchanged through a blockquote) gives src/emit's own constructCarriesListItemId a real fact to read instead of a lookahead guess. A top-level list (no enclosing item) mints no owner suffix at all, exactly as today.
//
// A numId that does not match this grammar at all (e.g. "list1", "3" -- odf.js's own convention, or any other format's own numId scheme entirely) is a cross-format value this package never minted itself: src/emit falls back to rendering it as an ordinary bullet list -- tight, start 1, never a task list -- per MarkdownDiagnosticCodes.LIST_NUMID_FALLBACK, the documented cross-format contract. A ContentListMembership with no numId at all (optional since document-schema.js 3.3.0, for a source that carries only a depth) gets the same src/emit fallback under the same code.

const NUMID_PATTERN =
  /^md(\d+):(bullet|ordered)(?:@(\d+))?(\+task)?(\+loose)?(?:\+owner=(md-i\d+))?$/;
const DEFAULT_ORDERED_START = 1;

export interface ListNumIdInfo {
  readonly type: "bullet" | "ordered";
  // Present only when type is 'ordered' and the start differs from the default (1).
  readonly start?: number;
  readonly task: boolean;
  readonly loose: boolean;
  // The itemId of the list item this list was minted directly inside (via a blockquote), when there is one -- see this module's own top-of-file note on the `+owner=` suffix. Absent for an ordinary top-level or genuinely-nested list, exactly as today.
  readonly ownerItemId?: string;
}

export interface ListNumIdMintOptions {
  readonly type: "bullet" | "ordered";
  readonly start?: number;
  readonly task: boolean;
  readonly loose: boolean;
  readonly ownerItemId?: string;
}

// A monotonic per-lowered-document counter for minting fresh top-level numIds -- threaded by reference through one lowerMarkdown call, matching odf.js's own ListIdState precedent exactly (a fresh state per document, never shared across two separate lowerings).
export interface NumIdMintState {
  next: number;
}

export function createNumIdMintState(): NumIdMintState {
  return { next: 1 };
}

export function mintListNumId(
  state: NumIdMintState,
  options: ListNumIdMintOptions,
): string {
  const id = state.next;
  state.next += 1;
  const startSuffix =
    options.type === "ordered" &&
    options.start !== undefined &&
    options.start !== DEFAULT_ORDERED_START
      ? `@${String(options.start)}`
      : "";
  const taskSuffix = options.task ? "+task" : "";
  const looseSuffix = options.loose ? "+loose" : "";
  const ownerSuffix =
    options.ownerItemId !== undefined ? `+owner=${options.ownerItemId}` : "";
  return `md${String(id)}:${options.type}${startSuffix}${taskSuffix}${looseSuffix}${ownerSuffix}`;
}

// Parses a numId this package's own mintListNumId produced, or undefined for anything else (a cross-format numId, or a malformed string) -- see this module's own top-of-file note for what src/emit does with undefined.
export function parseListNumId(numId: string): ListNumIdInfo | undefined {
  const match = NUMID_PATTERN.exec(numId);
  if (match === null) {
    return undefined;
  }
  const type = match[2];
  if (type === undefined || (type !== "bullet" && type !== "ordered")) {
    return undefined;
  }
  const startText = match[3];
  const start =
    type === "ordered" && startText !== undefined
      ? Number.parseInt(startText, 10)
      : undefined;
  return {
    type,
    start,
    task: match[4] !== undefined,
    loose: match[5] !== undefined,
    ownerItemId: match[6],
  };
}

// The type this numId was MINTED with -- used by src/lower's own nested-list conflict check, which compares a nested list's real marker type against this without re-deriving every other property of the string.
export function mintedListType(
  numId: string,
): "bullet" | "ordered" | undefined {
  return parseListNumId(numId)?.type;
}

// The opaque itemId string src/lower (mint) and src/emit (compare) share for list-item IDENTITY (document-schema.js's ContentListMembership.itemId): one id per item, shared by every block of that item, distinguishing "one item, several blocks" from "several items sharing this numId/level". Drawn from the same monotonic per-document counter as numIds (never reused, never colliding -- the `md-i` prefix is outside the numId grammar), threaded through the same NumIdMintState so one lowering mints both families without a second state object.
export function mintListItemId(state: NumIdMintState): string {
  const id = state.next;
  state.next += 1;
  return `md-i${String(id)}`;
}
