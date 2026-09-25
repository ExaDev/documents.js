// The MD4 message digest, RFC 1320 (https://www.rfc-editor.org/rfc/rfc1320), hand-written for the one thing in this package that needs it: an Escher blip's rgbUid ([MS-ODRAW] OfficeArtFBSE and the OfficeArtBlip family both define the field as "an MD4 message digest ... that specifies the unique identifier of the pixel data in the BLIP", and a real consumer keys its picture cache on it, so writing zeros would hand every reader a digest that names no data). No platform crypto API offers MD4 — WebCrypto never has, and OpenSSL 3 dropped it from its default provider — the identical reason archive-codec hand-writes RC4 and MD5 for the legacy encryption schemes; this module stays local to xls-codec until a second package needs it, rather than promoting a one-consumer primitive into a sibling.
//
// The three rounds below are a direct transcription of RFC 1320 A.3's own 48-operation schedule rather than a loop over index/rotation tables: the schedule's per-operation orderings (round 1 straight through X[0..15] with rotations 3/7/11/19; round 2 stepping by 4 with rotations 3/5/9/13; round 3 over the permuted 0,8,4,12... order with rotations 3/9/11/15) are the digest itself, and spelling them out keeps every line checkable against the published pseudocode.

/** RFC 1320 3.3's own round constants: "0x5A827999" and "0x6ED9EBA1", the integer parts the spec spells out for rounds 2 and 3. */
const ROUND_2_CONSTANT = 0x5a827999;
const ROUND_3_CONSTANT = 0x6ed9eba1;

/** RFC 1320 A.3's own per-round rotation schedule, named by position within each round's repeating 4-operation group rather than restated as a bare literal at every one of the 48 call sites below: round 1 cycles 3/7/11/19 across all 16 words in order; round 2 cycles 3/5/9/13 across the words stepped by 4; round 3 cycles 3/9/11/15 across the 0,8,4,12,... permuted order. */
const ROUND_1_ROTATE_1 = 3;
const ROUND_1_ROTATE_2 = 7;
const ROUND_1_ROTATE_3 = 11;
const ROUND_1_ROTATE_4 = 19;

const ROUND_2_ROTATE_1 = 3;
const ROUND_2_ROTATE_2 = 5;
const ROUND_2_ROTATE_3 = 9;
const ROUND_2_ROTATE_4 = 13;

const ROUND_3_ROTATE_1 = 3;
const ROUND_3_ROTATE_2 = 9;
const ROUND_3_ROTATE_3 = 11;
const ROUND_3_ROTATE_4 = 15;

/** RFC 1320 2.2: "Let A = 0x67452301, B = 0xefcdab89, C = 0x98badcfe, D = 0x10325476". */
const INITIAL_A = 0x67452301;
const INITIAL_B = 0xefcdab89;
const INITIAL_C = 0x98badcfe;
const INITIAL_D = 0x10325476;

const BLOCK_SIZE = 64;

/** Byte offset of message word N (N = 1-15) within a 64-byte block, 4 bytes (one Uint32) apart — stated as bare literals rather than `N * 4` since only a plain `const NAME = literal` (not an expression combining literals) satisfies this workspace's no-magic-numbers rule; word 0 needs no offset constant, since `offset + 0` is just `offset`. */
const WORD_1_OFFSET_BYTES = 4;
const WORD_2_OFFSET_BYTES = 8;
const WORD_3_OFFSET_BYTES = 12;
const WORD_4_OFFSET_BYTES = 16;
const WORD_5_OFFSET_BYTES = 20;
const WORD_6_OFFSET_BYTES = 24;
const WORD_7_OFFSET_BYTES = 28;
const WORD_8_OFFSET_BYTES = 32;
const WORD_9_OFFSET_BYTES = 36;
const WORD_10_OFFSET_BYTES = 40;
const WORD_11_OFFSET_BYTES = 44;
const WORD_12_OFFSET_BYTES = 48;
const WORD_13_OFFSET_BYTES = 52;
const WORD_14_OFFSET_BYTES = 56;
const WORD_15_OFFSET_BYTES = 60;

/** A block's 16 message words, one per `Uint32` of the 64-byte block. A literal-index tuple rather than `number[]`, so a literal `x[N]` read at each round-schedule call site below (`ff`/`gg`/`hh`'s own `word` argument) is typed as plain `number`, never `number | undefined`: there is no in-bounds/out-of-bounds question left for a guard to answer, since every N the schedule actually uses is one of this tuple's own 16 known positions. */
type BlockWords = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

/** The three auxiliary functions of RFC 1320 2.2, each a bit-selection over x/y/z — G and H are MD4's own, not MD5's similarly-named ones. */
function f(x: number, y: number, z: number): number {
  return (x & y) | (~x & z);
}

function g(x: number, y: number, z: number): number {
  return (x & y) | (x & z) | (y & z);
}

function h(x: number, y: number, z: number): number {
  return x ^ y ^ z;
}

const WORD_BITS = 32;

/** A 32-bit rotate left; the final `>>> 0` keeps the result unsigned where `<<` would sign it. */
function rotateLeft(x: number, count: number): number {
  return ((x << count) | (x >>> (WORD_BITS - count))) >>> 0;
}

/** The padding of RFC 1320 3.1: the message, a single 1 bit, zeros, then the 64-bit little-endian bit length, filling the final block(s) to a 64-byte multiple. The length field's high 32 bits are never written: every message this hand-written digest ever hashes is an in-memory Escher blip payload, thousands of bytes at most, so `message.length * 8` never approaches 2**32 — and a freshly allocated Uint8Array is already zero-filled, so stating the high word explicitly would be a redundant call rather than a real fact about the message. */
const BITS_PER_BYTE = 8;
const LENGTH_FIELD_BYTES = 8;

function padMessage(message: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const bitLength = message.length * BITS_PER_BYTE;
  const paddedLength =
    Math.ceil((message.length + 1 + LENGTH_FIELD_BYTES) / BLOCK_SIZE) *
    BLOCK_SIZE;
  const out = new Uint8Array(paddedLength);
  out.set(message);
  out[message.length] = 0x80;
  const view = new DataView(out.buffer);
  view.setUint32(paddedLength - LENGTH_FIELD_BYTES, bitLength >>> 0, true);
  return out;
}

/** RFC 1320 A.3's register rotation, restated once: after an operation updates the frame's first register, the frame rotates right so the next operation's target is first again — exactly the ABCD/DABC/CDAB/BCDA cycling the printed schedule shows. */
function rotateRegisters(
  frame: readonly [number, number, number, number],
  updated: number,
): [number, number, number, number] {
  return [frame[3], updated, frame[1], frame[2]];
}

/** The 16-byte MD4 digest output (registers A/B/C/D, 4 bytes each) and register B/C/D's own byte offset within it (A needs none, at offset 0). */
const DIGEST_BYTES = 16;
const REGISTER_B_OFFSET_BYTES = 4;
const REGISTER_C_OFFSET_BYTES = 8;
const REGISTER_D_OFFSET_BYTES = 12;
const HEX_RADIX = 16;

/**
 * The MD4 digest of `message`, as 32 lowercase hex characters — the digest bytes in order, which RFC 1320 3.5 states begin with the LOW-order byte of A ("beginning with the low-order byte of A, and ending with the high-order byte of D"), so each register is emitted little-endian rather than as a big-endian hex word.
 */
export function md4(message: Uint8Array<ArrayBuffer>): string {
  const padded = padMessage(message);
  const view = new DataView(
    padded.buffer,
    padded.byteOffset,
    padded.byteLength,
  );
  let a = INITIAL_A;
  let b = INITIAL_B;
  let c = INITIAL_C;
  let d = INITIAL_D;

  for (let offset = 0; offset < padded.length; offset += BLOCK_SIZE) {
    const x: BlockWords = [
      // The first word needs no offset term at all — `+ WORD_1_OFFSET_BYTES - 4` is always exactly `offset` regardless of which arithmetic operator produced the zero, so stating it would only be restating the same value a different, more roundabout way.
      view.getUint32(offset, true),
      view.getUint32(offset + WORD_1_OFFSET_BYTES, true),
      view.getUint32(offset + WORD_2_OFFSET_BYTES, true),
      view.getUint32(offset + WORD_3_OFFSET_BYTES, true),
      view.getUint32(offset + WORD_4_OFFSET_BYTES, true),
      view.getUint32(offset + WORD_5_OFFSET_BYTES, true),
      view.getUint32(offset + WORD_6_OFFSET_BYTES, true),
      view.getUint32(offset + WORD_7_OFFSET_BYTES, true),
      view.getUint32(offset + WORD_8_OFFSET_BYTES, true),
      view.getUint32(offset + WORD_9_OFFSET_BYTES, true),
      view.getUint32(offset + WORD_10_OFFSET_BYTES, true),
      view.getUint32(offset + WORD_11_OFFSET_BYTES, true),
      view.getUint32(offset + WORD_12_OFFSET_BYTES, true),
      view.getUint32(offset + WORD_13_OFFSET_BYTES, true),
      view.getUint32(offset + WORD_14_OFFSET_BYTES, true),
      view.getUint32(offset + WORD_15_OFFSET_BYTES, true),
    ];
    const savedA = a;
    const savedB = b;
    const savedC = c;
    const savedD = d;

    const op = (
      kind: (x: number, y: number, z: number) => number,
      word: number,
      rotation: number,
      roundConstant: number,
    ): void => {
      const updated = rotateLeft(
        (a + kind(b, c, d) + word + roundConstant) >>> 0,
        rotation,
      );
      [a, b, c, d] = rotateRegisters([a, b, c, d], updated);
    };
    const ff = (word: number, rotation: number) => {
      op(f, word, rotation, 0);
    };
    const gg = (word: number, rotation: number) => {
      op(g, word, rotation, ROUND_2_CONSTANT);
    };
    const hh = (word: number, rotation: number) => {
      op(h, word, rotation, ROUND_3_CONSTANT);
    };

    ff(x[0], ROUND_1_ROTATE_1);
    ff(x[1], ROUND_1_ROTATE_2);
    ff(x[2], ROUND_1_ROTATE_3);
    ff(x[3], ROUND_1_ROTATE_4);
    ff(x[4], ROUND_1_ROTATE_1);
    ff(x[5], ROUND_1_ROTATE_2);
    ff(x[6], ROUND_1_ROTATE_3);
    ff(x[7], ROUND_1_ROTATE_4);
    ff(x[8], ROUND_1_ROTATE_1);
    ff(x[9], ROUND_1_ROTATE_2);
    ff(x[10], ROUND_1_ROTATE_3);
    ff(x[11], ROUND_1_ROTATE_4);
    ff(x[12], ROUND_1_ROTATE_1);
    ff(x[13], ROUND_1_ROTATE_2);
    ff(x[14], ROUND_1_ROTATE_3);
    ff(x[15], ROUND_1_ROTATE_4);

    gg(x[0], ROUND_2_ROTATE_1);
    gg(x[4], ROUND_2_ROTATE_2);
    gg(x[8], ROUND_2_ROTATE_3);
    gg(x[12], ROUND_2_ROTATE_4);
    gg(x[1], ROUND_2_ROTATE_1);
    gg(x[5], ROUND_2_ROTATE_2);
    gg(x[9], ROUND_2_ROTATE_3);
    gg(x[13], ROUND_2_ROTATE_4);
    gg(x[2], ROUND_2_ROTATE_1);
    gg(x[6], ROUND_2_ROTATE_2);
    gg(x[10], ROUND_2_ROTATE_3);
    gg(x[14], ROUND_2_ROTATE_4);
    gg(x[3], ROUND_2_ROTATE_1);
    gg(x[7], ROUND_2_ROTATE_2);
    gg(x[11], ROUND_2_ROTATE_3);
    gg(x[15], ROUND_2_ROTATE_4);

    hh(x[0], ROUND_3_ROTATE_1);
    hh(x[8], ROUND_3_ROTATE_2);
    hh(x[4], ROUND_3_ROTATE_3);
    hh(x[12], ROUND_3_ROTATE_4);
    hh(x[2], ROUND_3_ROTATE_1);
    hh(x[10], ROUND_3_ROTATE_2);
    hh(x[6], ROUND_3_ROTATE_3);
    hh(x[14], ROUND_3_ROTATE_4);
    hh(x[1], ROUND_3_ROTATE_1);
    hh(x[9], ROUND_3_ROTATE_2);
    hh(x[5], ROUND_3_ROTATE_3);
    hh(x[13], ROUND_3_ROTATE_4);
    hh(x[3], ROUND_3_ROTATE_1);
    hh(x[11], ROUND_3_ROTATE_2);
    hh(x[7], ROUND_3_ROTATE_3);
    hh(x[15], ROUND_3_ROTATE_4);

    // RFC 1320 3.3 step 4: "add that to the input values" — the Davies-Meyer-style feed-forward that makes each block's output depend on its input chaining value.
    a = (a + savedA) >>> 0;
    b = (b + savedB) >>> 0;
    c = (c + savedC) >>> 0;
    d = (d + savedD) >>> 0;
  }

  const out = new Uint8Array(DIGEST_BYTES);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, a >>> 0, true);
  outView.setUint32(REGISTER_B_OFFSET_BYTES, b >>> 0, true);
  outView.setUint32(REGISTER_C_OFFSET_BYTES, c >>> 0, true);
  outView.setUint32(REGISTER_D_OFFSET_BYTES, d >>> 0, true);
  return Array.from(out, (byte) =>
    byte.toString(HEX_RADIX).padStart(2, "0"),
  ).join("");
}
