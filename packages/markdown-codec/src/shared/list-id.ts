// The opaque numId string src/lower (mint) and src/emit (parse) share for GFM list encoding. document-schema.js's own ContentListMembership carries only {numId, level} -- no type/task/tight-loose field of its own -- so every property markdown itself needs to round-trip through a list is packed into this one opaque string instead: a monotonic per-document mint counter (never reused, mirroring odf.js's own readOdt/readListItems "list1", "list2", ... convention -- see that module's own top-of-file note on why a counter, not a reusable style name, is the identity), the marker type (bullet/ordered, with an ordered list's own non-default start number), whether the list is (at least partially) a GFM task list, and whether the list is loose (CommonMark's own tight/loose distinction). Grammar: `md{N}:{bullet|ordered}[@{start}][+task][+loose]`, e.g. "md1:bullet", "md2:ordered@3", "md3:bullet+task".
//
// Nesting mints NO new numId at all -- a nested list reuses its ENCLOSING list's own numId, incrementing only `level`, exactly mirroring odf.js's own nesting rule (a nested text:list keeps its enclosing list's numId, level+1). This is a deliberate, accepted limitation, not an oversight: if a nested list's own real marker type disagrees with the type baked into the numId at mint time, the numId's own type tag wins (first-wins) and the loser is reported via MarkdownDiagnosticCodes.LIST_MARKER_TYPE_CONFLICT (src/lower/lower.ts).
//
// A numId that does not match this grammar at all (e.g. "list1", "3" -- odf.js's own convention, or any other format's own numId scheme entirely) is a cross-format value this package never minted itself: src/emit falls back to rendering it as an ordinary bullet list -- tight, start 1, never a task list -- per MarkdownDiagnosticCodes.LIST_NUMID_FALLBACK, the documented cross-format contract.

const NUMID_PATTERN = /^md(\d+):(bullet|ordered)(?:@(\d+))?(\+task)?(\+loose)?$/;
const DEFAULT_ORDERED_START = 1;

export interface ListNumIdInfo {
  readonly type: 'bullet' | 'ordered';
  // Present only when type is 'ordered' and the start differs from the default (1).
  readonly start?: number;
  readonly task: boolean;
  readonly loose: boolean;
}

export interface ListNumIdMintOptions {
  readonly type: 'bullet' | 'ordered';
  readonly start?: number;
  readonly task: boolean;
  readonly loose: boolean;
}

// A monotonic per-lowered-document counter for minting fresh top-level numIds -- threaded by reference through one lowerMarkdown call, matching odf.js's own ListIdState precedent exactly (a fresh state per document, never shared across two separate lowerings).
export interface NumIdMintState {
  next: number;
}

export function createNumIdMintState(): NumIdMintState {
  return { next: 1 };
}

export function mintListNumId(state: NumIdMintState, options: ListNumIdMintOptions): string {
  const id = state.next;
  state.next += 1;
  const startSuffix = options.type === 'ordered' && options.start !== undefined && options.start !== DEFAULT_ORDERED_START ? `@${String(options.start)}` : '';
  const taskSuffix = options.task ? '+task' : '';
  const looseSuffix = options.loose ? '+loose' : '';
  return `md${String(id)}:${options.type}${startSuffix}${taskSuffix}${looseSuffix}`;
}

// Parses a numId this package's own mintListNumId produced, or undefined for anything else (a cross-format numId, or a malformed string) -- see this module's own top-of-file note for what src/emit does with undefined.
export function parseListNumId(numId: string): ListNumIdInfo | undefined {
  const match = NUMID_PATTERN.exec(numId);
  if (match === null) {
    return undefined;
  }
  const type = match[2];
  if (type === undefined || (type !== 'bullet' && type !== 'ordered')) {
    return undefined;
  }
  const startText = match[3];
  const start = type === 'ordered' && startText !== undefined ? Number.parseInt(startText, 10) : undefined;
  return { type, start, task: match[4] !== undefined, loose: match[5] !== undefined };
}

// The type this numId was MINTED with -- used by src/lower's own nested-list conflict check, which compares a nested list's real marker type against this without re-deriving every other property of the string.
export function mintedListType(numId: string): 'bullet' | 'ordered' | undefined {
  return parseListNumId(numId)?.type;
}
