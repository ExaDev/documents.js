// Fractional/lexicographic sibling order keys for ExaDev/documents.js#660: a graph-native alternative to the dense integer `order` the projection minted before this module existed. A dense integer forces a renumber of every later sibling on every insertion (insert at index 1 of [0,1,2] and the old 1,2 must become 2,3, touching edges that never actually moved); a string that sorts lexicographically exactly as its intended sequence sorts numerically lets an insertion mint one new key strictly between its neighbours and touch nothing else. Base-36 (digits 0-9a-z) keeps the alphabet compact while staying a plain, sortable ASCII string -- no separate numeric parse step is needed anywhere a key is compared, only String comparison.
//
// Two operations, two lifecycles: `orderKeyForIndex`/`renumberedOrderKeys` mint the WIDE, evenly spaced keys a fresh projection (or a full rebalance) wants, and `orderKeyBetween` mints the NARROW, bisected keys a later single insertion wants without disturbing any sibling already minted. A projection never calls `orderKeyBetween` itself -- it always projects from a whole DocumentPackage and always mints via index -- but the graph's own consumers (an editor inserting one sibling into an already-projected graph) need it, which is why it is published from here rather than kept as this module's own private implementation detail.

// 36^8 ~= 2.8x10^12 addressable slots -- enough headroom that no real sibling list ever needs a wider initial encoding.
const ORDER_KEY_WIDTH = 8;

// Spacing between consecutive minted siblings, in the base-36 integer space -- the number of `orderKeyBetween` bisections available before a `renumberedOrderKeys` rebalance is needed.
const ORDER_KEY_GAP = 1000;

const BASE = 36;

// The total precision `orderKeyBetween` is allowed to grow a key to before it gives up: ~8 extra digits of bisection precision beyond the initial 8-digit width before a rebalance is required -- matches the issue's own framing that rebalancing must be rare, not frequent.
const ORDER_KEY_MAX_LENGTH = 16;

function toBase36(value: number): string {
  return value.toString(BASE);
}

function digitValue(char: string): number {
  return parseInt(char, BASE);
}

// Mints the WIDE key for a freshly projected sibling at `index`: `index * ORDER_KEY_GAP` in base 36, left-padded to ORDER_KEY_WIDTH. The gap is what leaves room for `orderKeyBetween` to bisect later without ever needing to touch this key or its neighbours.
export function orderKeyForIndex(index: number): string {
  const scaled = index * ORDER_KEY_GAP;
  const encoded = toBase36(scaled);
  if (encoded.length > ORDER_KEY_WIDTH) {
    throw new Error(`orderKeyForIndex: index ${index} does not fit in ${ORDER_KEY_WIDTH} base-36 digits`);
  }
  return encoded.padStart(ORDER_KEY_WIDTH, '0');
}

// The rebalance operation: a fresh, evenly spaced key list for `count` siblings, exactly `[orderKeyForIndex(0), ..., orderKeyForIndex(count - 1)]`. Reaching for this is the intended response to `orderKeyBetween` running out of room between two neighbours -- re-mint the whole sibling list rather than bisecting forever.
export function renumberedOrderKeys(count: number): string[] {
  return Array.from({ length: count }, (_, index) => orderKeyForIndex(index));
}

// Standard bounded-precision LexoRank/fractional-indexing midpoint bisection over base-36 digit strings, treating a shorter string as right-padded with implicit '0' digits (a shorter key already sorts before a longer one that shares its prefix, exactly as an implicit trailing zero would). Walks both strings digit by digit: while digits agree, the shared prefix carries over verbatim. At the first differing position, `low`'s digit is always the smaller of the two (a shared-prefix invariant of `low < high`), so a gap of 2 or more between the digits has an integer midpoint strictly between them and the walk is done in one step. A gap of exactly 1 (truly adjacent digits, e.g. '3' and '4') has no room at this precision: the digit is fixed to `low`'s value, and from that position on `high` is no longer consulted at all -- any string sharing that prefix is already guaranteed to sort below the original `high`, because `high`'s own digit there was one greater -- so the walk descends one digit deeper comparing only against the implicit top of the base (`BASE`, one past the highest real digit, standing in for "unbounded"). This is exactly "extend one more digit of precision and recurse against the widest possible upper bound." Capped at ORDER_KEY_MAX_LENGTH total digits: once producing a strictly-between key would need to exceed that length, the interval is genuinely exhausted and the loud refusal is the documented rebalance signal, not a silent duplicate or an unbounded string.
export function orderKeyBetween(low: string, high: string): string {
  if (!(low < high)) {
    throw new Error('orderKeyBetween: low must sort strictly before high');
  }
  let prefix = '';
  let position = 0;
  let highExhausted = false;
  for (;;) {
    if (prefix.length >= ORDER_KEY_MAX_LENGTH) {
      throw new Error('orderKeyBetween: no room left between these keys; rebalance with renumberedOrderKeys');
    }
    const lowDigit = position < low.length ? digitValue(low[position]!) : 0;
    const highDigit = !highExhausted && position < high.length ? digitValue(high[position]!) : BASE;
    if (lowDigit === highDigit) {
      prefix += toBase36(lowDigit);
      position += 1;
      continue;
    }
    if (highDigit - lowDigit >= 2) {
      const midDigit = lowDigit + Math.floor((highDigit - lowDigit) / 2);
      return prefix + toBase36(midDigit);
    }
    // Adjacent digits (or low has run past high's own length with nothing left to compare, which cannot happen for a genuine low < high but is handled identically): fix this position at low's digit and treat every position from here on as bounded only by the implicit top of the base.
    prefix += toBase36(lowDigit);
    position += 1;
    highExhausted = true;
  }
}
