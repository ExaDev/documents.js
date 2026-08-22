// Fractional/lexicographic sibling ordering keys (ExaDev/documents.js#660's refinement 1). The graph projection's sibling edges (CONTAINS among one parent's children, STYLED_BY among one node's ancestor style-chain entries) used to carry a dense integer position: inserting a new sibling anywhere but the end would mean renumbering every later sibling's edge. These keys are a LexoRank-style total order over plain strings instead -- inserting anywhere mints ONE new key that sorts between its two neighbours, touching only the one new edge. This is deliberately NOT a full CRDT (no per-actor sequence numbers, no tombstones, no merge semantics for concurrent writers): the issue is explicit that a full CRDT ordering is not warranted here, and this module is nothing more than a total order over strings plus the one maintenance operation (rebalancing) that order needs.
//
// Keys are strings over a fixed 36-character alphabet ('0'-'9' then 'a'-'z'), compared with ordinary less-than on strings -- plain prefix-rule lexicographic comparison (a string sorts before any longer string it is a strict prefix of), never a "decimal fraction padded with implicit trailing zeros" reading. That is a deliberate simplification: it means appending any character to a key always yields something greater than it (never equal, never a subtlety to reason about), at the cost of nothing -- a key ending in '0' is a perfectly ordinary key here, not an ambiguity to avoid.
export type OrderKey = string;

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const BASE = ALPHABET.length; // 36
const MAX_DIGIT = BASE - 1; // 35, i.e. 'z'
const MID_DIGIT = Math.floor(BASE / 2); // 18, i.e. 'i' -- the first key ever minted, leaving headroom on both sides rather than starting at either extreme.

// The one failure mode of a string-based fractional order: repeated insertion at the exact same spot (always "just before the current first sibling", say) grows the key by roughly one character per insertion once the digit budget at each position is used up. Bounding key length turns that unbounded growth into a named, catchable condition instead of a silently ballooning string -- the caller is expected to call rebalanceOrderKeys over the whole affected sibling list when this throws, an O(N) operation this module expects to be rare (see that function's own comment).
export const ORDER_KEY_MAX_LENGTH = 40;

export class OrderKeyBudgetExhaustedError extends Error {}

function checkBudget(prefix: string): void {
  if (prefix.length > ORDER_KEY_MAX_LENGTH) {
    throw new OrderKeyBudgetExhaustedError(
      `orderKey: exceeded the ${String(ORDER_KEY_MAX_LENGTH)}-character order-key budget -- call rebalanceOrderKeys over the full sibling list to restore headroom`,
    );
  }
}

function digitValue(char: string): number {
  const value = ALPHABET.indexOf(char);
  if (value === -1) throw new Error(`orderKey: "${char}" is not a valid order-key digit`);
  return value;
}

function digitChar(value: number): string {
  return ALPHABET[value]!;
}

// Shortest key strictly greater than `lower`, with no upper bound. Prefix rule: appending ANY character to `lower` already yields something greater than it, so the only real decision is which character leaves room on both sides for later inserts. Walks digit by digit only when `lower`'s own digit is already 'z' (no room to increase in place, so this position is copied verbatim and the search continues one digit deeper) or `lower` is exhausted (nothing left to increase, so a fresh mid-alphabet digit is appended).
function after(lower: string): string {
  let prefix = '';
  for (let i = 0; ; i++) {
    if (i >= lower.length) return prefix + digitChar(MID_DIGIT);
    const digit = digitValue(lower[i]!);
    if (digit < MAX_DIGIT) {
      const step = Math.max(1, Math.ceil((MAX_DIGIT - digit) / 2));
      return prefix + digitChar(digit + step);
    }
    prefix += digitChar(digit);
    checkBudget(prefix);
  }
}

// Shortest key strictly less than `upper`, with no lower bound. Symmetric to `after`: decreases the first digit that has room to decrease (digit > 0), copying every digit before it verbatim; a run of leading '0' digits in `upper` is copied as-is and the search continues deeper, because '0' has no room below it. A `upper` that is all zeros all the way to its end (no digit ever has room) has no key before it in this scheme -- there is no headroom left at the very bottom, so this throws the same budget error rebalancing exists to clear (this is intentionally the only place that error can fire without ever appending a character, since going deeper than `upper`'s own length while every digit stays 0 is exactly the "no room at all" case).
function before(upper: string): string {
  let prefix = '';
  for (let i = 0; ; i++) {
    if (i >= upper.length) {
      throw new OrderKeyBudgetExhaustedError(
        `orderKey: no key sorts before "${upper}" -- it has no headroom left below it; rebalance the sibling list instead`,
      );
    }
    const digit = digitValue(upper[i]!);
    if (digit > 0) {
      const step = Math.max(1, Math.ceil(digit / 2));
      return prefix + digitChar(digit - step);
    }
    prefix += digitChar(0);
    checkBudget(prefix);
  }
}

// Shortest key strictly between two given, already-ordered keys (`lower < upper`). Walks digit by digit while both share a digit (copying it verbatim, going deeper); the moment there is a gap of two or more between the two keys' digits at a position, a digit strictly between them is picked and the search stops there -- the shortest possible answer. A gap of exactly one digit (adjacent digits: e.g. lower's digit is 4, upper's is 5) has no room AT THIS POSITION, so the result commits to lower's own digit here (which is still < upper's digit, so anything of this form sorts below upper regardless of what follows) and recurses into `after` on the remainder of `lower` to find something greater than lower's own tail -- never a digit run ending in the meaningless trailing zero the module header warns about, because `after`'s own base case never appends '0' either.
function mid(lower: string, upper: string): string {
  let prefix = '';
  for (let i = 0; ; i++) {
    const lowDigit = i < lower.length ? digitValue(lower[i]!) : 0;
    // `upper` cannot be exhausted here while digits have matched so far without upper<=lower having already held (a shorter string that is a matching prefix of a longer one sorts first) -- so BASE stands in for "no constraint above" defensively, not as a reachable case.
    const highDigit = i < upper.length ? digitValue(upper[i]!) : BASE;
    if (highDigit - lowDigit >= 2) {
      return prefix + digitChar(lowDigit + Math.floor((highDigit - lowDigit) / 2));
    }
    if (highDigit - lowDigit === 1) {
      prefix += digitChar(lowDigit);
      checkBudget(prefix);
      return prefix + after(lower.slice(i + 1));
    }
    prefix += digitChar(lowDigit);
    checkBudget(prefix);
  }
}

// The one write primitive: a fresh key strictly between `lower` and `upper` (either or both may be omitted for "no neighbour on that side" -- omitting both is the very first key any sibling list ever mints). Throws OrderKeyBudgetExhaustedError, per the functions above, when satisfying that would need a key longer than ORDER_KEY_MAX_LENGTH; the fix is rebalanceOrderKeys over the whole sibling list, not a longer budget.
export function keyBetween(lower: OrderKey | undefined, upper: OrderKey | undefined): OrderKey {
  if (lower !== undefined && upper !== undefined && !(lower < upper)) {
    throw new Error(`orderKey: lower "${lower}" must sort strictly before upper "${upper}"`);
  }
  if (lower === undefined && upper === undefined) return digitChar(MID_DIGIT);
  if (lower === undefined) return before(upper!);
  if (upper === undefined) return after(lower);
  return mid(lower, upper);
}

// PRECISION_DIGITS base-36 digits of exact integer long division (no floating point) is more than enough resolution to keep count evenly spaced keys distinct and correctly ordered for any realistic sibling count: 36^8 is about 2.8 * 10^12 distinguishable positions.
const PRECISION_DIGITS = 8;

// The key for slot `numerator` out of `denominator` slots (1 <= numerator < denominator), via exact base-36 long division -- never floating point, so the result is exactly reproducible. The terminating digit of an exact fraction is provably never '0' (reaching remainder 0 in the same step as digit 0 would require the PRECEDING remainder to already have been 0, which would have ended the loop one step earlier), so this never needs -- and never performs -- the trailing-zero stripping a naive version might reach for.
function fractionKey(numerator: number, denominator: number): OrderKey {
  let remainder = numerator;
  let key = '';
  for (let i = 0; i < PRECISION_DIGITS; i++) {
    remainder *= BASE;
    const digit = Math.floor(remainder / denominator);
    key += digitChar(digit);
    remainder -= digit * denominator;
    if (remainder === 0) break;
  }
  return key;
}

// `count` fresh keys, strictly increasing, evenly spaced across the whole ordering space: the initial batch a group projection mints for its children's CONTAINS order or a node's STYLED_BY chain position, and equally what rebalanceOrderKeys reruns over an already-ordered sibling list once repeated same-spot insertion has exhausted the room between two neighbours. A side benefit of the exact-long-division implementation (not a correctness requirement, just tidiness): a fraction that terminates exactly never leaves a redundant trailing '0' digit, because reaching remainder 0 in the very step that also computes digit 0 would require the PRECEDING remainder to already have been 0 -- which would have ended the loop one step earlier.
export function initialOrderKeys(count: number): OrderKey[] {
  if (count <= 0) return [];
  return Array.from({ length: count }, (_, index) => fractionKey(index + 1, count + 1));
}

// Rebalancing (refinement 1's second half): recomputes fresh, evenly spaced keys for an existing ordered sibling list, discarding their old values -- an O(N) operation, meant to run only when keyBetween has thrown OrderKeyBudgetExhaustedError for that list. `existingKeysInOrder` is read only for its length; the caller re-associates the returned keys with the same siblings in the same relative order (index for index) that the old keys already encoded.
export function rebalanceOrderKeys(existingKeysInOrder: readonly OrderKey[]): OrderKey[] {
  return initialOrderKeys(existingKeysInOrder.length);
}
