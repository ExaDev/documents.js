// The MD4 message digest, RFC 1320 (https://www.rfc-editor.org/rfc/rfc1320), hand-written for the one thing in this package that needs it: an Escher blip's rgbUid ([MS-ODRAW] OfficeArtFBSE and the OfficeArtBlip family both define the field as "an MD4 message digest ... that specifies the unique identifier of the pixel data in the BLIP", and a real consumer keys its picture cache on it, so writing zeros would hand every reader a digest that names no data). No platform crypto API offers MD4 -- WebCrypto never has, and OpenSSL 3 dropped it from its default provider -- the identical reason archive-codec hand-writes RC4 and MD5 for the legacy encryption schemes; this module stays local to xls-codec until a second package needs it, rather than promoting a one-consumer primitive into a sibling.
//
// The three rounds below are a direct transcription of RFC 1320 A.3's own 48-operation schedule rather than a loop over index/rotation tables: the schedule's per-operation orderings (round 1 straight through X[0..15] with rotations 3/7/11/19; round 2 stepping by 4 with rotations 3/5/9/13; round 3 over the permuted 0,8,4,12... order with rotations 3/9/11/15) are the digest itself, and spelling them out keeps every line checkable against the published pseudocode.

/** RFC 1320 3.3's own round constants: "0x5A827999" and "0x6ED9EBA1", the integer parts the spec spells out for rounds 2 and 3. */
const ROUND_2_CONSTANT = 0x5a827999;
const ROUND_3_CONSTANT = 0x6ed9eba1;

/** RFC 1320 2.2: "Let A = 0x67452301, B = 0xefcdab89, C = 0x98badcfe, D = 0x10325476". */
const INITIAL_A = 0x67452301;
const INITIAL_B = 0xefcdab89;
const INITIAL_C = 0x98badcfe;
const INITIAL_D = 0x10325476;

const BLOCK_SIZE = 64;

/** A block's 16 message words, one per `Uint32` of the 64-byte block. A literal-index tuple rather than `number[]` so every `x[index]` access below is typed as `number`, never `number | undefined`: `index` is itself typed as one of the 16 literal positions this tuple actually has, so there is no in-bounds/out-of-bounds question left for a guard to answer. */
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

/** The 16 literal positions a `BlockWords` tuple actually has. */
type WordIndex =
  0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15;

/** The three auxiliary functions of RFC 1320 2.2, each a bit-selection over x/y/z -- G and H are MD4's own, not MD5's similarly-named ones. */
function f(x: number, y: number, z: number): number {
  return (x & y) | (~x & z);
}

function g(x: number, y: number, z: number): number {
  return (x & y) | (x & z) | (y & z);
}

function h(x: number, y: number, z: number): number {
  return x ^ y ^ z;
}

/** A 32-bit rotate left; the final >>> 0 keeps the result unsigned where << would sign it. */
function rotateLeft(x: number, count: number): number {
  return ((x << count) | (x >>> (32 - count))) >>> 0;
}

/** The padding of RFC 1320 3.1: the message, a single 1 bit, zeros, then the 64-bit little-endian bit length, filling the final block(s) to a 64-byte multiple. The length field's high 32 bits are never written: every message this hand-written digest ever hashes is an in-memory Escher blip payload, thousands of bytes at most, so `message.length * 8` never approaches 2**32 -- and a freshly allocated Uint8Array is already zero-filled, so stating the high word explicitly would be a redundant call rather than a real fact about the message. */
function padMessage(message: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const bitLength = message.length * 8;
  const paddedLength =
    Math.ceil((message.length + 1 + 8) / BLOCK_SIZE) * BLOCK_SIZE;
  const out = new Uint8Array(paddedLength);
  out.set(message);
  out[message.length] = 0x80;
  const view = new DataView(out.buffer);
  view.setUint32(paddedLength - 8, bitLength >>> 0, true);
  return out;
}

/** RFC 1320 A.3's register rotation, restated once: after an operation updates the frame's first register, the frame rotates right so the next operation's target is first again -- exactly the ABCD/DABC/CDAB/BCDA cycling the printed schedule shows. */
function rotateRegisters(
  frame: [number, number, number, number],
  updated: number,
): [number, number, number, number] {
  return [frame[3], updated, frame[1], frame[2]];
}

/**
 * The MD4 digest of `message`, as 32 lowercase hex characters -- the digest bytes in order, which RFC 1320 3.5 states begin with the LOW-order byte of A ("beginning with the low-order byte of A, and ending with the high-order byte of D"), so each register is emitted little-endian rather than as a big-endian hex word.
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
      view.getUint32(offset + 0 * 4, true),
      view.getUint32(offset + 1 * 4, true),
      view.getUint32(offset + 2 * 4, true),
      view.getUint32(offset + 3 * 4, true),
      view.getUint32(offset + 4 * 4, true),
      view.getUint32(offset + 5 * 4, true),
      view.getUint32(offset + 6 * 4, true),
      view.getUint32(offset + 7 * 4, true),
      view.getUint32(offset + 8 * 4, true),
      view.getUint32(offset + 9 * 4, true),
      view.getUint32(offset + 10 * 4, true),
      view.getUint32(offset + 11 * 4, true),
      view.getUint32(offset + 12 * 4, true),
      view.getUint32(offset + 13 * 4, true),
      view.getUint32(offset + 14 * 4, true),
      view.getUint32(offset + 15 * 4, true),
    ];
    const savedA = a;
    const savedB = b;
    const savedC = c;
    const savedD = d;

    const op = (
      kind: (x: number, y: number, z: number) => number,
      index: WordIndex,
      rotation: number,
      roundConstant: number,
    ): void => {
      const word = x[index];
      const updated = rotateLeft(
        (a + kind(b, c, d) + word + roundConstant) >>> 0,
        rotation,
      );
      [a, b, c, d] = rotateRegisters([a, b, c, d], updated);
    };
    const ff = (index: WordIndex, rotation: number) => {
      op(f, index, rotation, 0);
    };
    const gg = (index: WordIndex, rotation: number) => {
      op(g, index, rotation, ROUND_2_CONSTANT);
    };
    const hh = (index: WordIndex, rotation: number) => {
      op(h, index, rotation, ROUND_3_CONSTANT);
    };

    ff(0, 3);
    ff(1, 7);
    ff(2, 11);
    ff(3, 19);
    ff(4, 3);
    ff(5, 7);
    ff(6, 11);
    ff(7, 19);
    ff(8, 3);
    ff(9, 7);
    ff(10, 11);
    ff(11, 19);
    ff(12, 3);
    ff(13, 7);
    ff(14, 11);
    ff(15, 19);

    gg(0, 3);
    gg(4, 5);
    gg(8, 9);
    gg(12, 13);
    gg(1, 3);
    gg(5, 5);
    gg(9, 9);
    gg(13, 13);
    gg(2, 3);
    gg(6, 5);
    gg(10, 9);
    gg(14, 13);
    gg(3, 3);
    gg(7, 5);
    gg(11, 9);
    gg(15, 13);

    hh(0, 3);
    hh(8, 9);
    hh(4, 11);
    hh(12, 15);
    hh(2, 3);
    hh(10, 9);
    hh(6, 11);
    hh(14, 15);
    hh(1, 3);
    hh(9, 9);
    hh(5, 11);
    hh(13, 15);
    hh(3, 3);
    hh(11, 9);
    hh(7, 11);
    hh(15, 15);

    // RFC 1320 3.3 step 4: "add that to the input values" -- the Davies-Meyer-style feed-forward that makes each block's output depend on its input chaining value.
    a = (a + savedA) >>> 0;
    b = (b + savedB) >>> 0;
    c = (c + savedC) >>> 0;
    d = (d + savedD) >>> 0;
  }

  const out = new Uint8Array(16);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, a >>> 0, true);
  outView.setUint32(4, b >>> 0, true);
  outView.setUint32(8, c >>> 0, true);
  outView.setUint32(12, d >>> 0, true);
  return Array.from(out, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
