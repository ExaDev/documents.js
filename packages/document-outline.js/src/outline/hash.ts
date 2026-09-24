// The exact stable-hash recipe (every step is part of the published contract; changing any step changes every hash ever issued):
// 1. Strip every `$schema` key from the value, at any depth: a serialised tree-form package carries a release-pinned `$schema` URI that labels the content rather than being content (document-schema.js's own schema-io strips it the same way before ITS canonicalisation, so both canonicalisers exclude exactly the one key). Without this step, reserialising the same package against a different schema release would change every hash, which would make a hash name the release it was minted under rather than the document — the opposite of stable. No content schema field is named `$schema`, so no hash ever issued changes.
// 2. Canonicalise the value: rebuild every plain object with its own keys sorted ascending by UTF-16 code unit (Array.prototype.sort's default comparison — a total, implementation-specified-stable order), preserving arrays in order and primitives as-is. This removes construction-order differences between independently built but structurally identical content, which is the whole point: two readers producing the same logical leaf must hash equal regardless of the order they happened to assign fields.
// 3. JSON.stringify the canonicalised value with no spacing. Objects whose optional fields were left absent versus explicitly assigned undefined collapse to the same string, because JSON.stringify drops undefined-valued properties — intended: both spellings mean "field absent" in the content schemas. Numbers use ECMAScript's own number-to-string, which is specified exactly, so the same numeric value always yields the same digits.
// 4. UTF-8 encode the JSON text with TextEncoder (available in Node, browsers, and workerd alike — no node:buffer, no node:util TextDecoder polyfill).
// 5. SHA-256 over those bytes, implemented below by hand for the same Worker-isomorphism reason: node:crypto's createHash is banned in runtime src by this package's ESLint guard, and every Web Crypto subtle.digest is async (and unavailable synchronously inside a synchronous helper), so a pure-integer SHA-256 keeps leafContentHash a plain function call.
// 6. Hex-encode the 32 digest bytes, lowercase.
// The result is deterministic across processes and platforms (every step is either an ECMAScript-specified operation or a fixed byte-level algorithm), equal for independently constructed identical content, and different for different content up to SHA-256's collision resistance.
export function stableContentHash(value: unknown): string {
  return sha256Hex(
    new TextEncoder().encode(
      JSON.stringify(canonicalise(stripSchemaKeys(value))),
    ),
  );
}

// Same narrow-to-record guard node.ts uses for its OutlineNode check (and document-schema.js's content guards before it): after the typeof/null/array checks this narrows the value to Record<string, unknown> without an `as` assertion.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Recipe step 1: remove every `$schema` key at any depth, rebuilding rather than mutating so the input is never touched. Runs BEFORE canonicalisation (the strip and the sort are independent orderings of the same walk, but this order keeps canonicalise's own contract — the documented recipe for anyone who imports it — free of the label-key concern, which belongs to hashing alone).
function stripSchemaKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSchemaKeys);
  if (isRecord(value)) {
    const stripped: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (key === "$schema") continue;
      stripped[key] = stripSchemaKeys(entry);
    }
    return stripped;
  }
  return value;
}

// Step 1 of the documented recipe, exported because the decompose/flatten bijection tests canonicalise with the exact same function (src/outline/bijection.test.ts) — one canonical key order across the package, not a second recipe that could drift from the hash's. `unknown` in, `unknown` out: the output is a fresh structure safe to hand to JSON.stringify, never a mutation of the input. Plain objects (the JSON-mappable class) are rebuilt with sorted keys; arrays and primitives pass through structurally untouched (arrays are copied so the output never aliases the input).
export function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (isRecord(value)) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort())
      sorted[key] = canonicalise(value[key]);
    return sorted;
  }
  return value;
}

const HEX_RADIX = 16;
const HEX_DIGITS_PER_BYTE = 2;

function sha256Hex(bytes: Uint8Array): string {
  const digest = sha256(bytes);
  let hex = "";
  for (const byte of digest)
    hex += byte.toString(HEX_RADIX).padStart(HEX_DIGITS_PER_BYTE, "0");
  return hex;
}

// SHA-256, FIPS 180-4. Hand-rolled over Uint8Array/DataView with 32-bit integer arithmetic only: no Node crypto, no async SubtleCrypto, so the hash helper stays a synchronous, Worker-isomorphic plain function. Test vectors for the empty string and 'abc' are pinned in hash.test.ts against the specification's own published digests.
const WORD_BITS = 32;
const BITS_PER_BYTE = 8;
const BYTES_PER_WORD = WORD_BITS / BITS_PER_BYTE; // 4: a 32-bit word is 4 bytes.
const UINT32_MODULUS = 2 ** WORD_BITS;
const SHA256_ROUNDS = 64; // FIPS 180-4's own round count, and the message schedule's own word count.
const DIGEST_WORDS = 8; // h0..h7.

function isPrime(candidate: number): boolean {
  for (let divisor = 2; divisor * divisor <= candidate; divisor++) {
    if (candidate % divisor === 0) return false;
  }
  return true;
}

// The first `count` primes, starting at 2. Trial division is more than fast enough here: this only ever runs at module load to seed K and H_INIT below, over the first 64 primes (the largest is 311).
function firstPrimes(count: number): number[] {
  const primes: number[] = [];
  let candidate = 2;
  while (primes.length < count) {
    if (isPrime(candidate)) primes.push(candidate);
    candidate += 1;
  }
  return primes;
}

// The first 32 bits of a positive real number's own fractional part, as an unsigned 32-bit integer.
function fractionalBits(value: number): number {
  const fraction = value - Math.floor(value);
  return Math.floor(fraction * UINT32_MODULUS) >>> 0;
}

// FIPS 180-4 section 4.2.2's own 64 round constants: the first 32 bits of the fractional part of the cube root of each of the first 64 primes. Derived here from that definition, rather than transcribed as a literal table, so the values are provably what the specification defines rather than a copy that could silently diverge from it; verified byte-for-byte against the specification's own published table before this derivation replaced it, and cross-checked indirectly on every run by hash.test.ts's pinned digests for the empty string and 'abc'.
const K = firstPrimes(SHA256_ROUNDS).map((prime) =>
  fractionalBits(Math.cbrt(prime)),
);

// FIPS 180-4 section 5.3.3's own published initial hash values: the first 32 bits of the fractional part of the square root of each of the first 8 primes. Same derivation reasoning as K above.
const H_INIT = firstPrimes(DIGEST_WORDS).map((prime) =>
  fractionalBits(Math.sqrt(prime)),
);

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (WORD_BITS - n))) >>> 0;
}

// Writes the SHA-256 length suffix — the message's own bit length as a big-endian 64-bit integer — at `offset` in `view`. Split out from sha256 below so the arithmetic (only observable once a message exceeds 2^32 bits, ~512 MiB, an input size no unit test can afford to allocate and hash) is exercisable directly against an arbitrary `bitLength` number rather than requiring an actual multi-hundred-megabyte byte array to reach it. Exported for exactly that test.
export function writeBitLength(
  view: DataView,
  offset: number,
  bitLength: number,
): void {
  view.setUint32(offset, Math.floor(bitLength / UINT32_MODULUS));
  view.setUint32(offset + BYTES_PER_WORD, bitLength >>> 0);
}

// Bounds-checked in place of a bare `w[i] = value`: Uint32Array silently drops an out-of-range write and returns `undefined` (not a throw) for an out-of-range read, so a loop bound weakened by one (i <= 64 instead of i < 64) would otherwise write to index 64 — one past `w`'s own 64-element length — with no observable effect at all, since nothing ever reads that index back. Throwing here is what turns that boundary into a genuine, catchable failure instead of a silently-absorbed no-op. Split out from sha256 below, the same reason writeBitLength above is: no legitimate call through sha256's own correctly-bounded loop can ever reach the throw, so it needs a direct unit test calling this function itself with an out-of-range index. Exported for exactly that test.
export function writeScheduleWord(
  w: Uint32Array,
  i: number,
  value: number,
): void {
  if (i >= w.length) {
    throw new Error(
      `sha256: message schedule index ${String(i)} out of bounds (0..${String(w.length - 1)})`,
    );
  }
  w[i] = value;
}

const BLOCK_SIZE_LOG2 = 6; // 64-byte (512-bit) blocks, kept as its own power-of-two exponent for the round-up bit trick below.
const BLOCK_SIZE_BYTES = 1 << BLOCK_SIZE_LOG2;
const WORDS_PER_BLOCK = BLOCK_SIZE_BYTES / BYTES_PER_WORD; // 16
const LENGTH_SUFFIX_BYTES = 2 * BYTES_PER_WORD; // 8: the appended 64-bit big-endian bit-length.
const PADDING_MARKER_BYTE = 0x80;
const DIGEST_BYTES = DIGEST_WORDS * BYTES_PER_WORD; // 32

// Rotation/shift amounts for FIPS 180-4 section 4.1.2's four named functions. Sigma0/Sigma1 (capital) operate on the compression loop's `a`/`e`; sigma0/sigma1 (small) operate on the message schedule's `w15`/`w2`.
const SIGMA0_ROTR_A = 2;
const SIGMA0_ROTR_B = 13;
const SIGMA0_ROTR_C = 22;
const SIGMA1_ROTR_A = 6;
const SIGMA1_ROTR_B = 11;
const SIGMA1_ROTR_C = 25;
const SMALL_SIGMA0_ROTR_A = 7;
const SMALL_SIGMA0_ROTR_B = 18;
const SMALL_SIGMA0_SHR = 3;
const SMALL_SIGMA1_ROTR_A = 17;
const SMALL_SIGMA1_ROTR_B = 19;
const SMALL_SIGMA1_SHR = 10;

// FIPS 180-4 section 6.2.2 step 1's own message-schedule recurrence: Wt = sigma1(W[t-2]) + W[t-7] + sigma0(W[t-15]) + W[t-16].
const SCHEDULE_LOOKBACK_16 = 16;
const SCHEDULE_LOOKBACK_15 = 15;
const SCHEDULE_LOOKBACK_7 = 7;

export function sha256(bytes: Uint8Array): Uint8Array {
  const bitLength = bytes.length * BITS_PER_BYTE;
  // Pad to a multiple of 512 bits: append the 0x80 marker byte, zeros, then the original bit length as a big-endian 64-bit integer. Every practical input is far below 2^53 bits, so the high 32 bits are Math.floor(bitLength / 2^32) and the low 32 are bitLength >>> 0.
  const paddedLength =
    (((bytes.length + LENGTH_SUFFIX_BYTES) >> BLOCK_SIZE_LOG2) + 1) <<
    BLOCK_SIZE_LOG2;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = PADDING_MARKER_BYTE;
  const view = new DataView(padded.buffer);
  writeBitLength(view, paddedLength - LENGTH_SUFFIX_BYTES, bitLength);
  let h0 = H_INIT[0]!;
  let h1 = H_INIT[1]!;
  let h2 = H_INIT[2]!;
  let h3 = H_INIT[3]!;
  let h4 = H_INIT[4]!;
  let h5 = H_INIT[5]!;
  let h6 = H_INIT[6]!;
  let h7 = H_INIT[7]!;
  const w = new Uint32Array(K.length);
  for (let offset = 0; offset < paddedLength; offset += BLOCK_SIZE_BYTES) {
    for (let i = 0; i < WORDS_PER_BLOCK; i++)
      w[i] = view.getUint32(offset + i * BYTES_PER_WORD);
    for (let i = WORDS_PER_BLOCK; i < K.length; i++) {
      const w15 = w[i - SCHEDULE_LOOKBACK_15]!;
      const w2 = w[i - 2]!;
      const s0 =
        rotr(w15, SMALL_SIGMA0_ROTR_A) ^
        rotr(w15, SMALL_SIGMA0_ROTR_B) ^
        (w15 >>> SMALL_SIGMA0_SHR);
      const s1 =
        rotr(w2, SMALL_SIGMA1_ROTR_A) ^
        rotr(w2, SMALL_SIGMA1_ROTR_B) ^
        (w2 >>> SMALL_SIGMA1_SHR);
      writeScheduleWord(
        w,
        i,
        (w[i - SCHEDULE_LOOKBACK_16]! +
          s0 +
          w[i - SCHEDULE_LOOKBACK_7]! +
          s1) >>>
          0,
      );
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let i = 0; i < K.length; i++) {
      const s1 =
        rotr(e, SIGMA1_ROTR_A) ^
        rotr(e, SIGMA1_ROTR_B) ^
        rotr(e, SIGMA1_ROTR_C);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + K[i]! + w[i]!) >>> 0;
      const s0 =
        rotr(a, SIGMA0_ROTR_A) ^
        rotr(a, SIGMA0_ROTR_B) ^
        rotr(a, SIGMA0_ROTR_C);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }
  const digest = new Uint8Array(DIGEST_BYTES);
  const out = new DataView(digest.buffer);
  const words = [h0, h1, h2, h3, h4, h5, h6, h7];
  for (const [index, word] of words.entries()) {
    out.setUint32(index * BYTES_PER_WORD, word);
  }
  return digest;
}
