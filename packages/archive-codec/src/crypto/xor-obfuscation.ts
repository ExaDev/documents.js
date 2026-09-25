// XOR obfuscation, the older, much weaker, non-cipher password scheme legacy Excel/Word binary documents fall back to when FilePass's own wEncryptionType is 0x0000 ([MS-XLS] 2.4.117) or FibBase.fObfuscated is 1 ([MS-DOC] 2.5.2) — as opposed to the MD5-based "RC4 encryption header" office-rc4.ts implements ([MS-OFFCRYPTO] 2.3.6.1/2.3.6.2), or the SHA-1-based RC4 CryptoAPI scheme office-rc4-cryptoapi.ts implements (2.3.5.1/2.3.5.2). [MS-OFFCRYPTO] 2.3.7 "XOR Obfuscation" names two variants: Method 1 (2.3.7.2/2.3.7.3), the scheme [MS-XLS]'s own FilePass record uses; Method 2 (2.3.7.5/2.3.7.6), the scheme [MS-DOC]'s own FibBase/EncryptionHeader-free obfuscation uses. Both share one password-verifier derivation (2.3.7.1 "Binary Document Password Verifier Derivation Method 1") and one 16-bit "XOR key" derivation (also named within 2.3.7.2's own text) — this module's createXorObfuscationKey/createXorObfuscationPasswordVerifier — and differ only in how the 16-byte obfuscation array is built from that key (a rotate distance: 2 for Method 1, 7 for Method 2) and in the per-byte data transform applied against it.
//
// [MS-OFFCRYPTO]'s own published pseudocode for the ARRAY CONSTRUCTION and DATA TRANSFORM steps of both methods (2.3.7.2's CreateXorArray_Method1 with its XorRor rotate-then-XOR-by-reversed-password-order construction, 2.3.7.3's EncryptData_Method1/DecryptData_Method1 rotating by 5 bits) does NOT match real Excel/Word output — confirmed directly against a genuine Excel-generated XOR-obfuscated .xls fixture (nolze/msoffcrypto-tool's own test corpus, tests/inputs/xor_password_123456789012345.xls, itself sourced from the openwall/john-samples password-cracking corpus): decrypting that file's Workbook stream under the spec's own literal pseudocode produces garbage, while decrypting it under the algorithm below (which both Apache POI's CryptoFunctions.createXorArray1/XORDecryptor and LibreOffice's MSCodec_Xor95/MSCodec_XorXLS95 independently converged on, ahead of and apparently in spite of the published spec text) recovers a readable sheet name, a CodePage record decrypting to the real value 1200, and a Dimensions record's row count matching the file's own Row-record count exactly. Apache POI's own CryptoFunctions.createXorArray1 carries the explicit comment "this code is based on the libre office implementation. The MS-OFFCRYPTO misses some infos about the various rotation sizes", and XORDecryptor.invokeCipher's own comment states "It seems that the encrypt and decrypt method is mixed up in the MS-OFFCRYPTO docs" — this is not a guess this module is making independently, it is the documented conclusion of two separate, real, actively-maintained implementations, cross-checked here a third time against genuine Excel output. The password-verifier and XOR-key derivations (createXorObfuscationKey/createXorObfuscationPasswordVerifier below) are NOT affected by this discrepancy — they match [MS-OFFCRYPTO]'s published pseudocode exactly, confirmed against both Apache POI's createXorKey1/createXorVerifier1 and the same real .xls fixture's own stored FilePass key/verificationBytes fields.
//
// Method 2 ([MS-DOC]/.doc) has no equivalent real-file cross-check available here — neither Apache POI's HWPF module nor msoffcrypto-tool implement XOR-obfuscated .doc decryption (msoffcrypto-tool's doc97.py detects fObfuscation but does not decrypt it), so there is no independently-encrypted real .doc fixture to verify against the way Method 1 was. Its ARRAY CONSTRUCTION rotate distance (7, not Method 1's 2) is taken from LibreOffice's own MSCodec_XorWord95 (mscodec.hxx: `MSCodec_Xor95(7)`, contrasted directly with MSCodec_XorXLS95's `MSCodec_Xor95(2)`) and Apache POI's own explicit comment on createXorArray1 ("rotation of key values is application dependent - Excel = 2 / Word = 7") — both real, shipped implementations, though again without a genuine-file round trip to confirm against for the Word case specifically. Its DATA TRANSFORM, by contrast, needs no such correction: [MS-OFFCRYPTO] 2.3.7.6's own plain-XOR-with-a-zero-byte-exception description (no bit rotation at all, unlike Method 1) matches LibreOffice's MSCodec_XorWord95::Decode line for line (`cChar = *pnData ^ *pnCurrKey; if (*pnData && cChar) *pnData = cChar;`), so decryptXorObfuscationMethod2 below follows the published spec text directly.

// Every table below is read through a DataView rather than plain indexed access: with noUncheckedIndexedAccess on, `arr[i]` types as possibly-undefined even where a loop bound already guarantees it is not, and DataView's own get sidesteps that without a non-null assertion at every step (matching md5.ts's own T table).

// Fixed widths and masks: Latin-1's own ceiling, a byte's own bits, and the 16-bit masks; the 2 verifier bits the password hash reads; the 2 verifier constants [MS-OFFCRYPTO] 2.3.7.2's own diagram states; and Method 2's own stream-rotation distance.
const LATIN1_MAX = 0xff;
const LATIN1_MASK = 0xff;
const BITS_PER_BYTE = 8;
const U16_MASK = 0xffff;
const BYTES_PER_U16 = 2;
const VERIFIER_HASH_BITS = 7;
const TOP_VERIFIER_BIT = 0x40;
const VERIFIER_TOP_BIT = 0x4000;
const VERIFIER_LOW_BITS = 0x7fff;
const VERIFIER_FINAL_HASH = 0xce4b;
const METHOD2_STREAM_ROTATE_DISTANCE = 3;
// One numbered entry of a published specification table, the position it occupies there alongside its value.
interface SpecConstant {
  readonly i: number;
  readonly value: number;
}
function u16Table(values: readonly number[]): DataView {
  const view = new DataView(new ArrayBuffer(values.length * 2));
  values.forEach((value, index) => {
    view.setUint16(index * 2, value);
  });
  return view;
}

function u8Table(values: readonly number[]): DataView {
  const view = new DataView(new ArrayBuffer(values.length));
  values.forEach((value, index) => {
    view.setUint8(index, value);
  });
  return view;
}

/** [MS-OFFCRYPTO] 2.3.7.2's own PadArray: the fixed 15-byte filler used once a password's own bytes are exhausted while building either method's 16-byte array. */
const PAD_ENTRIES: readonly SpecConstant[] = [
  { i: 1, value: 0xbb },
  { i: 2, value: 0xff },
  { i: 3, value: 0xff },
  { i: 4, value: 0xba },
  { i: 5, value: 0xff },
  { i: 6, value: 0xff },
  { i: 7, value: 0xb9 },
  { i: 8, value: 0x80 },
  { i: 9, value: 0x00 },
  { i: 10, value: 0xbe },
  { i: 11, value: 0x0f },
  { i: 12, value: 0x00 },
  { i: 13, value: 0xbf },
  { i: 14, value: 0x0f },
  { i: 15, value: 0x00 },
];
const PAD_ARRAY = u8Table(PAD_ENTRIES.map(({ value }) => value));
/** [MS-OFFCRYPTO] 2.3.7.2's own InitialCode table, indexed by `password.length - 1` (a 1-15 character password) to seed createXorObfuscationKey. */
const INITIAL_CODE_ENTRIES: readonly SpecConstant[] = [
  { i: 1, value: 0xe1f0 },
  { i: 2, value: 0x1d0f },
  { i: 3, value: 0xcc9c },
  { i: 4, value: 0x84c0 },
  { i: 5, value: 0x110c },
  { i: 6, value: 0x0e10 },
  { i: 7, value: 0xf1ce },
  { i: 8, value: 0x313e },
  { i: 9, value: 0x1872 },
  { i: 10, value: 0xe139 },
  { i: 11, value: 0xd40f },
  { i: 12, value: 0x84f9 },
  { i: 13, value: 0x280c },
  { i: 14, value: 0xa96a },
  { i: 15, value: 0x4ec3 },
];
const INITIAL_CODE = u16Table(INITIAL_CODE_ENTRIES.map(({ value }) => value));
/** [MS-OFFCRYPTO] 2.3.7.2's own XorMatrix: a 15x7 table of 16-bit constants (flattened here to 105 entries, row-major) createXorObfuscationKey folds into the running key for every set bit of every password character. */
const XOR_MATRIX_ENTRIES: readonly SpecConstant[] = [
  { i: 1, value: 0xaefc },
  { i: 2, value: 0x4dd9 },
  { i: 3, value: 0x9bb2 },
  { i: 4, value: 0x2745 },
  { i: 5, value: 0x4e8a },
  { i: 6, value: 0x9d14 },
  { i: 7, value: 0x2a09 },
  { i: 8, value: 0x7b61 },
  { i: 9, value: 0xf6c2 },
  { i: 10, value: 0xfda5 },
  { i: 11, value: 0xeb6b },
  { i: 12, value: 0xc6f7 },
  { i: 13, value: 0x9dcf },
  { i: 14, value: 0x2bbf },
  { i: 15, value: 0x4563 },
  { i: 16, value: 0x8ac6 },
  { i: 17, value: 0x05ad },
  { i: 18, value: 0x0b5a },
  { i: 19, value: 0x16b4 },
  { i: 20, value: 0x2d68 },
  { i: 21, value: 0x5ad0 },
  { i: 22, value: 0x0375 },
  { i: 23, value: 0x06ea },
  { i: 24, value: 0x0dd4 },
  { i: 25, value: 0x1ba8 },
  { i: 26, value: 0x3750 },
  { i: 27, value: 0x6ea0 },
  { i: 28, value: 0xdd40 },
  { i: 29, value: 0xd849 },
  { i: 30, value: 0xa0b3 },
  { i: 31, value: 0x5147 },
  { i: 32, value: 0xa28e },
  { i: 33, value: 0x553d },
  { i: 34, value: 0xaa7a },
  { i: 35, value: 0x44d5 },
  { i: 36, value: 0x6f45 },
  { i: 37, value: 0xde8a },
  { i: 38, value: 0xad35 },
  { i: 39, value: 0x4a4b },
  { i: 40, value: 0x9496 },
  { i: 41, value: 0x390d },
  { i: 42, value: 0x721a },
  { i: 43, value: 0xeb23 },
  { i: 44, value: 0xc667 },
  { i: 45, value: 0x9cef },
  { i: 46, value: 0x29ff },
  { i: 47, value: 0x53fe },
  { i: 48, value: 0xa7fc },
  { i: 49, value: 0x5fd9 },
  { i: 50, value: 0x47d3 },
  { i: 51, value: 0x8fa6 },
  { i: 52, value: 0x0f6d },
  { i: 53, value: 0x1eda },
  { i: 54, value: 0x3db4 },
  { i: 55, value: 0x7b68 },
  { i: 56, value: 0xf6d0 },
  { i: 57, value: 0xb861 },
  { i: 58, value: 0x60e3 },
  { i: 59, value: 0xc1c6 },
  { i: 60, value: 0x93ad },
  { i: 61, value: 0x377b },
  { i: 62, value: 0x6ef6 },
  { i: 63, value: 0xddec },
  { i: 64, value: 0x45a0 },
  { i: 65, value: 0x8b40 },
  { i: 66, value: 0x06a1 },
  { i: 67, value: 0x0d42 },
  { i: 68, value: 0x1a84 },
  { i: 69, value: 0x3508 },
  { i: 70, value: 0x6a10 },
  { i: 71, value: 0xaa51 },
  { i: 72, value: 0x4483 },
  { i: 73, value: 0x8906 },
  { i: 74, value: 0x022d },
  { i: 75, value: 0x045a },
  { i: 76, value: 0x08b4 },
  { i: 77, value: 0x1168 },
  { i: 78, value: 0x76b4 },
  { i: 79, value: 0xed68 },
  { i: 80, value: 0xcaf1 },
  { i: 81, value: 0x85c3 },
  { i: 82, value: 0x1ba7 },
  { i: 83, value: 0x374e },
  { i: 84, value: 0x6e9c },
  { i: 85, value: 0x3730 },
  { i: 86, value: 0x6e60 },
  { i: 87, value: 0xdcc0 },
  { i: 88, value: 0xa9a1 },
  { i: 89, value: 0x4363 },
  { i: 90, value: 0x86c6 },
  { i: 91, value: 0x1dad },
  { i: 92, value: 0x3331 },
  { i: 93, value: 0x6662 },
  { i: 94, value: 0xccc4 },
  { i: 95, value: 0x89a9 },
  { i: 96, value: 0x0373 },
  { i: 97, value: 0x06e6 },
  { i: 98, value: 0x0dcc },
  { i: 99, value: 0x1021 },
  { i: 100, value: 0x2042 },
  { i: 101, value: 0x4084 },
  { i: 102, value: 0x8108 },
  { i: 103, value: 0x1231 },
  { i: 104, value: 0x2462 },
  { i: 105, value: 0x48c4 },
];
const XOR_MATRIX = u16Table(XOR_MATRIX_ENTRIES.map(({ value }) => value));

/** The length every XOR obfuscation array (either method) has, and the period both methods' XorArrayIndex wraps at. */
export const XOR_OBFUSCATION_ARRAY_LENGTH = 16;
/** The maximum password length [MS-OFFCRYPTO] 2.3.7.2/2.3.7.5 both state ("Password MUST NOT be longer than 15 characters"), shared by both methods since both build their array from the same InitialCode/PadArray tables sized for it. */
export const XOR_OBFUSCATION_MAX_PASSWORD_LENGTH = 15;
/** [MS-XLS]'s FilePass/XORObfuscation own array-construction rotate distance — confirmed against Apache POI's `CryptoFunctions.createXorArray1` ("Excel = 2") and LibreOffice's `MSCodec_XorXLS95` (`MSCodec_Xor95(2)`); see this file's own top comment for the real-file cross-check. */
export const XOR_OBFUSCATION_ROTATE_DISTANCE_METHOD1 = 2;
/** [MS-DOC]'s own array-construction rotate distance — confirmed against Apache POI's `CryptoFunctions.createXorArray1` ("Word = 7") and LibreOffice's `MSCodec_XorWord95` (`MSCodec_Xor95(7)`); see this file's own top comment for the caveat that this one has no real-file cross-check available. */
export const XOR_OBFUSCATION_ROTATE_DISTANCE_METHOD2 = 7;

/** ASCII/Latin-1 single-byte password encoding: both XOR obfuscation methods' own pseudocode declares its password parameter an ASCII string (2.3.7.1/2.3.7.2), unlike office-rc4.ts/office-rc4-cryptoapi.ts's UTF-16LE passwords. Throws rather than silently truncating a character that does not fit in one byte or a password past the 15-character limit both methods share — a caller passing a password XOR obfuscation cannot represent has passed the wrong password, not one this module should guess at re-encoding. */
function passwordToAsciiBytes(password: string): Uint8Array<ArrayBuffer> {
  if (
    password.length === 0 ||
    password.length > XOR_OBFUSCATION_MAX_PASSWORD_LENGTH
  ) {
    throw new RangeError(
      `XOR obfuscation passwords must be 1-${XOR_OBFUSCATION_MAX_PASSWORD_LENGTH} characters, got ${password.length}`,
    );
  }
  const bytes = new Uint8Array(password.length);
  // A DataView write, not raw indexed assignment: an out-of-range DataView offset throws, where a plain `bytes[i] = …` past the array's own end silently does nothing — so a loop bound one iteration too long fails loudly here instead of leaving the same, indistinguishable output.
  const bytesView = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  );
  for (let i = 0; i < password.length; i += 1) {
    const code = password.charCodeAt(i);
    if (code > LATIN1_MAX) {
      throw new RangeError(
        `XOR obfuscation passwords must be single-byte ASCII/Latin-1 characters, got code point ${code} at index ${i}`,
      );
    }
    bytesView.setUint8(i, code);
  }
  return bytes;
}

/** [MS-OFFCRYPTO] 2.3.7.2's own CreateXorKey_Method1: a 16-bit key folded from InitialCode (seeded by password length) and XorMatrix (one row per password character, walked in reverse, one column per set bit of that character read least-significant-bit first). Despite the "_Method1" name this is genuinely shared by both methods — 2.3.7.5's own CreateXorArray_Method2 splits this exact same key's high/low bytes for its own array construction, and 2.3.7.4's CreatePasswordVerifier_Method2 uses it as the high word of Method 2's own 32-bit verifier — confirmed against Apache POI's `createXorKey1`, which is implemented as `createXorVerifier2(password) >>> 16` for exactly this reason. */
export function createXorObfuscationKey(password: string): number {
  const bytes = passwordToAsciiBytes(password);
  const bytesView = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  );
  let xorKey = INITIAL_CODE.getUint16((bytes.length - 1) * 2);
  let currentElement = 0x68;
  for (let i = bytes.length - 1; i >= 0; i -= 1) {
    let ch = bytesView.getUint8(i);
    for (let bit = 0; bit < VERIFIER_HASH_BITS; bit += 1) {
      if ((ch & TOP_VERIFIER_BIT) !== 0) {
        xorKey =
          (xorKey ^ XOR_MATRIX.getUint16(currentElement * BYTES_PER_U16)) &
          U16_MASK;
      }
      ch = (ch << 1) & LATIN1_MASK;
      currentElement -= 1;
    }
  }
  return xorKey;
}

/** [MS-OFFCRYPTO] 2.3.7.1's own CreatePasswordVerifier_Method1: a 16-bit checksum of the password's own length and bytes, folded in reverse order through a 15-bit rotating XOR, finished off with a fixed 0xCE4B mask. Shared by both methods — 2.3.7.4's CreatePasswordVerifier_Method2 uses this as the low word of Method 2's own 32-bit verifier — confirmed against Apache POI's `createXorVerifier1`. */
export function createXorObfuscationPasswordVerifier(password: string): number {
  const bytes = passwordToAsciiBytes(password);
  const bytesView = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  );
  let verifier = 0;
  for (let i = bytes.length - 1; i >= 0; i -= 1) {
    const intermediate1 = (verifier & VERIFIER_TOP_BIT) === 0 ? 0 : 1;
    const intermediate2 = (verifier * 2) & VERIFIER_LOW_BITS;
    verifier = intermediate1 ^ intermediate2 ^ bytesView.getUint8(i);
  }
  const intermediate1 = (verifier & VERIFIER_TOP_BIT) === 0 ? 0 : 1;
  const intermediate2 = (verifier * 2) & VERIFIER_LOW_BITS;
  verifier = intermediate1 ^ intermediate2 ^ bytes.length;
  return (verifier ^ VERIFIER_FINAL_HASH) & U16_MASK;
}

function rotateLeft8(byte: number, distance: number): number {
  const b = byte & LATIN1_MASK;
  return ((b << distance) | (b >>> (BITS_PER_BYTE - distance))) & LATIN1_MASK;
}

/**
 * The real, cross-validated 16-byte XOR obfuscation array (see this file's own top comment): the password's own ASCII bytes followed by PAD_ARRAY filler up to 16 bytes, each byte then XORed with the alternating low/high byte of createXorObfuscationKey's own output (even index takes the low byte, odd the high byte) and rotated left by `rotateDistance` — XOR_OBFUSCATION_ROTATE_DISTANCE_METHOD1 (2) for [MS-XLS], METHOD2 (7) for [MS-DOC].
 */
export function createXorObfuscationArray(
  password: string,
  rotateDistance: number,
): Uint8Array<ArrayBuffer> {
  const passwordBytes = passwordToAsciiBytes(password);
  const array = new Uint8Array(XOR_OBFUSCATION_ARRAY_LENGTH);
  const arrayView = new DataView(
    array.buffer,
    array.byteOffset,
    array.byteLength,
  );
  array.set(passwordBytes, 0);
  // A DataView write for the padding fill, not raw indexed assignment: an out-of-range DataView offset throws, where a plain `array[i] = …` past the array's own 16-byte end silently does nothing — so a loop bound one iteration too long fails loudly here instead of leaving the same, indistinguishable 16-byte array.
  for (let i = passwordBytes.length; i < XOR_OBFUSCATION_ARRAY_LENGTH; i += 1) {
    arrayView.setUint8(i, PAD_ARRAY.getUint8(i - passwordBytes.length));
  }
  const xorKey = createXorObfuscationKey(password);
  const keyLow = xorKey & LATIN1_MASK;
  const keyHigh = (xorKey >>> BITS_PER_BYTE) & LATIN1_MASK;
  for (let i = 0; i < XOR_OBFUSCATION_ARRAY_LENGTH; i += 1) {
    const withKey = arrayView.getUint8(i) ^ (i % 2 === 0 ? keyLow : keyHigh);
    array[i] = rotateLeft8(withKey, rotateDistance);
  }
  return array;
}

/**
 * Decrypts (and, since the transform is not self-inverse, only decrypts — see this file's own top comment on why this package implements no corresponding encrypt direction) `data` against Method 1's own per-byte transform: for each byte, rotate left 3 bits, then XOR against `array[index]`, incrementing `index` (wrapping at XOR_OBFUSCATION_ARRAY_LENGTH) after every byte. `initialIndex` is the caller's own responsibility — xls-codec's own [MS-XLS] 2.2.10 per-record `(streamOffset + recordDataLength) % 16` rule lives there, not here, since it is a BIFF-record concept this package has no knowledge of.
 */
export function decryptXorObfuscationMethod1(
  array: Uint8Array<ArrayBuffer>,
  data: Uint8Array<ArrayBuffer>,
  initialIndex: number,
): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(data.length);
  const dataView = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const arrayView = new DataView(
    array.buffer,
    array.byteOffset,
    array.byteLength,
  );
  let index = initialIndex % XOR_OBFUSCATION_ARRAY_LENGTH;
  for (let i = 0; i < data.length; i += 1) {
    const rotated = rotateLeft8(
      dataView.getUint8(i),
      METHOD2_STREAM_ROTATE_DISTANCE,
    );
    out[i] = rotated ^ arrayView.getUint8(index);
    index = (index + 1) % XOR_OBFUSCATION_ARRAY_LENGTH;
  }
  return out;
}

/**
 * Decrypts `data` against Method 2's own per-byte transform ([MS-OFFCRYPTO] 2.3.7.6, matching LibreOffice's `MSCodec_XorWord95::Decode` exactly — see this file's own top comment): for each byte, XOR against `array[index]` — unless the original byte was already 0x00, or the XOR result is 0x00, in which case the byte is left unmodified — incrementing `index` (wrapping at XOR_OBFUSCATION_ARRAY_LENGTH) after every byte regardless of whether it was modified. This transform is its own inverse (plain XOR, no rotation), so the same function also encrypts; nothing in this package uses it that way, since nothing in this family writes encrypted legacy binary documents.
 */
export function decryptXorObfuscationMethod2(
  array: Uint8Array<ArrayBuffer>,
  data: Uint8Array<ArrayBuffer>,
  initialIndex: number,
): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(data.length);
  const dataView = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const arrayView = new DataView(
    array.buffer,
    array.byteOffset,
    array.byteLength,
  );
  let index = initialIndex % XOR_OBFUSCATION_ARRAY_LENGTH;
  for (let i = 0; i < data.length; i += 1) {
    const original = dataView.getUint8(i);
    const transformed = original ^ arrayView.getUint8(index);
    out[i] = original === 0 || transformed === 0 ? original : transformed;
    index = (index + 1) % XOR_OBFUSCATION_ARRAY_LENGTH;
  }
  return out;
}
