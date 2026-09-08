import { concatBytes } from "./bytes/writer";
import { AES_BLOCK_BYTES, aesCbcEncrypt } from "./crypto/aes";
import { md5 } from "./crypto/md5";
import { randomBytes } from "./crypto/random";
import { rc4 } from "./crypto/rc4";
import type { CipherMethod } from "./encrypt";
import {
  AESV2_KEY_BYTES,
  AESV3_KEY_BYTES,
  AESV3_SALT_BYTES,
  LEGACY_KEY_ITERATIONS,
  PASSWORD_PADDING,
  RC4_40_KEY_BYTES,
  RC4_OBFUSCATION_ROUNDS,
  ZERO_IV,
  computeLegacyFileKeyFromPaddedPassword,
  hardenedHash,
  legacyUserValueCore,
  objectKey,
  padOrTruncatePassword,
  permissionsBytes,
} from "./encrypt";
import type { PdfDict, PdfObject } from "./objects";
import {
  pdfArray,
  pdfBool,
  pdfDict,
  pdfHexString,
  pdfName,
  pdfNum,
} from "./objects";

// PDF encryption on the write side: the exact inverse of encrypt.ts's read-side standard security handler, producing an /Encrypt dictionary (and the encrypted string/stream bytes that go with it) for one of the same four schemes encrypt.ts already reads -- RC4-40 (/V 1 /R 2), RC4-128 (/V 2 /R 3), AES-128 (/V 4 /R 4, /CFM /AESV2), and AES-256 (/V 5 /R 6, /CFM /AESV3). ISO 32000-2 7.6.4.4's Algorithms 3, 8, 9, and 10 are what this module adds on top of encrypt.ts's own primitives (MD5/RC4/AES via src/crypto/, the per-object key derivation of Algorithm 1, and the revision-6 hardened hash of Algorithm 2.B) -- see each function's own citation below.
//
// Unlike encrypt.ts's read side, this module accepts a genuine, non-empty user password: nothing here is scoped to "the empty user password" the way reading is (see encrypt.ts's own header on why that scope exists for reading specifically -- it does not apply to writing, which never has to guess). What IS scoped, deliberately: a revision 2-4 password must be plain printable ASCII (see legacyPasswordBytes below) rather than full PDFDocEncoding, and a revision 6 password is normalised with NFKC rather than full SASLPrep/stringprep (see r6PasswordBytes below). Both boundaries throw PdfEncryptionError loudly rather than silently mis-encoding a password into one that will not open the file it was meant to protect.

export class PdfEncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfEncryptionError";
  }
}

export type PdfEncryptionScheme = "rc4-40" | "rc4-128" | "aes-128" | "aes-256";

// ISO 32000-2 7.6.4.2, Table 22: the seven access-permission bits a caller can meaningfully withhold. (Bit 10, a revision 3+ accessibility-extraction flag ISO 32000-2 deprecated, is not exposed here -- writers are required to always set it to 1, the same as the genuinely reserved bits.) Every field defaults to permitted; a security handler of revision 2 (the rc4-40 scheme) only ever consults print/modifyContents/copy/annotate, but the other three are still encoded (as permitted) for forward compatibility with a reader that upgrades the file to a later revision, exactly as ISO 32000-2's own note on the P entry describes.
export interface PdfEncryptionPermissions {
  readonly print?: boolean;
  readonly modifyContents?: boolean;
  readonly copy?: boolean;
  readonly annotate?: boolean;
  readonly fillForms?: boolean;
  readonly assemble?: boolean;
  readonly printHighRes?: boolean;
}

export interface PdfEncryptionOptions {
  // Default: "" (empty). An empty user password is the common "permissions-only" document this codec's own reader already opens transparently -- see this module's header and encrypt-write.test.ts's round-trip tests.
  readonly userPassword?: string;
  // Default: the user password's own value, matching Algorithm 3 step (a)'s "if there is no owner password, use the user password instead" -- the legacy schemes' own documented convention for what an absent owner password means, applied uniformly to revision 6 too for one consistent default across all four schemes.
  readonly ownerPassword?: string;
  // Default: "aes-256", the only non-deprecated scheme ISO 32000-2 defines.
  readonly scheme?: PdfEncryptionScheme;
  readonly permissions?: PdfEncryptionPermissions;
  // Default: true. Meaningful only for aes-128 (/V 4) and aes-256 (/V 5); rc4-40/rc4-128 have no crypt-filter machinery to carry this flag on and always encrypt document metadata along with everything else.
  readonly encryptMetadata?: boolean;
}

export interface PdfEncryptor {
  readonly encryptDict: PdfDict;
  encryptString(
    bytes: Uint8Array<ArrayBuffer>,
    num: number,
    gen: number,
  ): Uint8Array<ArrayBuffer>;
  encryptStream(
    bytes: Uint8Array<ArrayBuffer>,
    dict: PdfDict,
    num: number,
    gen: number,
  ): Uint8Array<ArrayBuffer>;
}

const RC4_128_KEY_BYTES = 16;
const R6_PASSWORD_MAX_BYTES = 127; // ISO 32000-2 7.6.4.3.1: a revision-6 password's UTF-8 form is truncated to 127 bytes.
const RESERVED_BIT_7_AND_8 = (1 << 6) | (1 << 7);
const DEPRECATED_ALWAYS_ONE_BIT_10 = 1 << 9;

interface SchemeSpec {
  readonly v: number;
  readonly r: number;
  readonly keyBytes: number;
  readonly method: Extract<CipherMethod, "rc4" | "aes">;
}

const SCHEME_SPECS: Record<PdfEncryptionScheme, SchemeSpec> = {
  "rc4-40": { v: 1, r: 2, keyBytes: RC4_40_KEY_BYTES, method: "rc4" },
  "rc4-128": { v: 2, r: 3, keyBytes: RC4_128_KEY_BYTES, method: "rc4" },
  "aes-128": { v: 4, r: 4, keyBytes: AESV2_KEY_BYTES, method: "aes" },
  "aes-256": { v: 5, r: 6, keyBytes: AESV3_KEY_BYTES, method: "aes" },
};

// ISO 32000-2 7.6.4.3.2 step (a): a legacy (revision <=4) password is PDFDocEncoding bytes. PDFDocEncoding agrees with plain ASCII byte-for-byte across the printable-ASCII range (0x00-0x7F) and diverges only above it (a handful of remapped punctuation/typographic glyphs in 0x80-0x9F, and several substituted characters above 0xA0) -- rather than transcribe that whole encoding for a boundary the overwhelming majority of real passwords never reach, a password outside plain ASCII is rejected loudly here. Silently reinterpreting it as Latin-1 (a tempting shortcut, since Latin-1 and PDFDocEncoding agree over most of the upper range too) would risk the one thing worse than an unsupported password: a password that LOOKS like it was accepted but produces a file the same password, correctly PDFDocEncoded by another reader, cannot open.
function legacyPasswordBytes(password: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(password.length);
  for (let i = 0; i < password.length; i++) {
    const code = password.charCodeAt(i);
    if (code > 0x7f) {
      throw new PdfEncryptionError(
        `password contains character code ${String(code)}, outside the printable-ASCII range this writer supports for the rc4-40/rc4-128/aes-128 schemes; use a plain-ASCII password, or the aes-256 scheme, whose revision-6 passwords are Unicode`,
      );
    }
    bytes[i] = code;
  }
  return bytes;
}

// ISO 32000-2 7.6.4.3.1 and 7.6.4.3.3 steps (a)-(b): a revision-6 password is normalised, converted to UTF-8, and truncated to 127 bytes. The full rule normalises with the SASLPrep (RFC 4013) profile of stringprep (RFC 3454), which additionally rejects a fixed table of prohibited code points and applies a bidirectional-text rule; this writer applies Unicode NFKC normalisation only (SASLPrep's own Normalize step, and -- for a password with no prohibited characters or mixed-direction text, which is effectively every real password -- behaviourally identical to the full profile) rather than implement stringprep's prohibited-character tables and bidi rule for a boundary case this real-world scope essentially never reaches.
function r6PasswordBytes(password: string): Uint8Array<ArrayBuffer> {
  const utf8 = new TextEncoder().encode(password.normalize("NFKC"));
  return utf8.subarray(0, R6_PASSWORD_MAX_BYTES);
}

// ISO 32000-2 7.6.4.2, Table 22. Bits are 1-indexed from the low-order bit; JS's `<<`/`|` operate on signed 32-bit integers already, so no unsigned/signed conversion step is needed -- `1 << 31` alone already yields the correctly negative two's-complement value for the sign bit.
function permissionsToP(
  permissions: PdfEncryptionPermissions | undefined,
): number {
  let p = 0;
  if (permissions?.print ?? true) {
    p |= 1 << 2; // bit 3
  }
  if (permissions?.modifyContents ?? true) {
    p |= 1 << 3; // bit 4
  }
  if (permissions?.copy ?? true) {
    p |= 1 << 4; // bit 5
  }
  if (permissions?.annotate ?? true) {
    p |= 1 << 5; // bit 6
  }
  p |= RESERVED_BIT_7_AND_8;
  if (permissions?.fillForms ?? true) {
    p |= 1 << 8; // bit 9
  }
  p |= DEPRECATED_ALWAYS_ONE_BIT_10;
  if (permissions?.assemble ?? true) {
    p |= 1 << 10; // bit 11
  }
  if (permissions?.printHighRes ?? true) {
    p |= 1 << 11; // bit 12
  }
  for (let bit = 13; bit <= 32; bit++) {
    p |= 1 << (bit - 1); // bits 13-32: reserved, must be 1
  }
  return p;
}

// ISO 32000-2 7.6.4.4.2, Algorithm 3: computing the encryption dictionary's O value (revision 4 and earlier). Step (a)'s "if there is no owner password, use the user password instead" is handled by the caller (createStandardEncryptor defaults ownerPassword to userPassword), not here -- by the time this runs, both passwords are already the real bytes to use.
function computeLegacyOwnerValue(
  ownerPassword: Uint8Array<ArrayBuffer>,
  userPassword: Uint8Array<ArrayBuffer>,
  revision: number,
  keyBytes: number,
): Uint8Array<ArrayBuffer> {
  let digest = md5(padOrTruncatePassword(ownerPassword));
  if (revision >= 3) {
    for (let i = 0; i < LEGACY_KEY_ITERATIONS; i++) {
      digest = md5(digest);
    }
  }
  const ownerKey = digest.subarray(0, keyBytes);
  let value = rc4(ownerKey, padOrTruncatePassword(userPassword));
  if (revision >= 3) {
    for (let i = 1; i <= RC4_OBFUSCATION_ROUNDS; i++) {
      const roundKey = Uint8Array.from(ownerKey, (byte) => byte ^ i);
      value = rc4(roundKey, value);
    }
  }
  return value;
}

// The legacy schemes' /U: Algorithm 4 (revision 2) IS its own 32-byte result; Algorithm 5 (revision 3+) appends 16 bytes of "arbitrary" padding after its 16 meaningful bytes (ISO 32000-2 7.6.4.4.4 step (f)) -- never compared by any reader (including this codec's own, which only ever checks the first 16 -- see encrypt.ts's legacyUserPasswordVerifies), so filled with fresh random bytes rather than a fixed pattern.
function computeLegacyUserValue(
  fileKey: Uint8Array<ArrayBuffer>,
  fileId: Uint8Array<ArrayBuffer>,
  revision: number,
): Uint8Array<ArrayBuffer> {
  const core = legacyUserValueCore(fileKey, fileId, revision);
  if (revision === 2) {
    return core;
  }
  return concatBytes([
    core,
    randomBytes(PASSWORD_PADDING.length - core.length),
  ]);
}

// ISO 32000-1 7.6.2, Algorithm 1 / ISO 32000-2 7.6.3.3, Algorithm 1.A: pad with PKCS#7 to a whole number of 16-byte blocks, encrypt under a fresh random initialisation vector, and prepend that IV -- the exact inverse of encrypt.ts's decryptAes, which strips both back off.
function encryptAes(
  key: Uint8Array<ArrayBuffer>,
  data: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  const iv = randomBytes(AES_BLOCK_BYTES);
  const padLength = AES_BLOCK_BYTES - (data.length % AES_BLOCK_BYTES);
  const padded = new Uint8Array(data.length + padLength);
  padded.set(data);
  padded.fill(padLength, data.length);
  return concatBytes([iv, aesCbcEncrypt(key, iv, padded)]);
}

function applyEncryptMethod(
  method: CipherMethod,
  fileKey: Uint8Array<ArrayBuffer>,
  perObjectKeys: boolean,
  bytes: Uint8Array<ArrayBuffer>,
  num: number,
  gen: number,
): Uint8Array<ArrayBuffer> {
  if (method === "identity") {
    return bytes;
  }
  const key = perObjectKeys ? objectKey(fileKey, num, gen, method) : fileKey;
  return method === "rc4" ? rc4(key, bytes) : encryptAes(key, bytes);
}

function buildEncryptor(
  encryptDict: PdfDict,
  fileKey: Uint8Array<ArrayBuffer>,
  method: Extract<CipherMethod, "rc4" | "aes">,
  perObjectKeys: boolean,
  encryptMetadata: boolean,
): PdfEncryptor {
  return {
    encryptDict,
    encryptString(bytes, num, gen) {
      return applyEncryptMethod(
        method,
        fileKey,
        perObjectKeys,
        bytes,
        num,
        gen,
      );
    },
    encryptStream(bytes, dict, num, gen) {
      // The mirror of encrypt.ts's own /EncryptMetadata false carve-out: a /Type /Metadata stream stays in the clear so a reader that never sees the password can still read basic document metadata.
      const type = dict.entries.get("Type");
      if (
        !encryptMetadata &&
        type?.kind === "name" &&
        type.name === "Metadata"
      ) {
        return bytes;
      }
      return applyEncryptMethod(
        method,
        fileKey,
        perObjectKeys,
        bytes,
        num,
        gen,
      );
    },
  };
}

function buildLegacyEncryptor(
  spec: SchemeSpec,
  options: PdfEncryptionOptions,
  fileId: Uint8Array<ArrayBuffer>,
): PdfEncryptor {
  const userPassword = legacyPasswordBytes(options.userPassword ?? "");
  const ownerPassword = legacyPasswordBytes(
    options.ownerPassword ?? options.userPassword ?? "",
  );
  const encryptMetadata = options.encryptMetadata ?? true;
  const p = permissionsToP(options.permissions);

  const owner = computeLegacyOwnerValue(
    ownerPassword,
    userPassword,
    spec.r,
    spec.keyBytes,
  );
  const fileKey = computeLegacyFileKeyFromPaddedPassword(
    padOrTruncatePassword(userPassword),
    owner,
    p,
    fileId,
    spec.r,
    spec.keyBytes,
    encryptMetadata,
  );
  const user = computeLegacyUserValue(fileKey, fileId, spec.r);

  const entries = new Map<string, PdfObject>([
    ["Filter", pdfName("Standard")],
    ["V", pdfNum(spec.v)],
    ["R", pdfNum(spec.r)],
    ["O", pdfHexString(owner)],
    ["U", pdfHexString(user)],
    ["P", pdfNum(p)],
    ["Length", pdfNum(spec.keyBytes * 8)],
  ]);
  if (spec.v === 4) {
    // /V 4's crypt-filter machinery: one StdCF filter, named by both /StmF and /StrF, carrying the AESV2 method. /CF's own /Length is in bytes, matching real-world producers and this codec's own reader (which ignores it for AESV2 regardless -- see encrypt.ts's cryptFilterKeyBytes).
    entries.set(
      "CF",
      pdfDict({
        StdCF: pdfDict({
          AuthEvent: pdfName("DocOpen"),
          CFM: pdfName("AESV2"),
          Length: pdfNum(spec.keyBytes),
        }),
      }),
    );
    entries.set("StmF", pdfName("StdCF"));
    entries.set("StrF", pdfName("StdCF"));
    entries.set("EncryptMetadata", pdfBool(encryptMetadata));
  }

  // Every legacy revision (2-4) derives a distinct per-object key (Algorithm 1); only aes-256's own Algorithm 1.A skips that step, in buildAes256Encryptor below.
  return buildEncryptor(
    pdfDict(entries),
    fileKey,
    spec.method,
    true,
    encryptMetadata,
  );
}

// ISO 32000-2 7.6.4.4.7-9, Algorithms 8, 9, and 10: revision 6's /U+/UE and /O+/OE (each a random validation salt, a random key salt, and the Algorithm 2.B hash and AES-256-wrapped file key those salts produce), and /Perms (the permissions bitmask, redundantly re-encrypted so a reader can detect tampering without decrypting anything else first).
function buildAes256Encryptor(
  spec: SchemeSpec,
  options: PdfEncryptionOptions,
): PdfEncryptor {
  const userPassword = r6PasswordBytes(options.userPassword ?? "");
  const ownerPassword = r6PasswordBytes(
    options.ownerPassword ?? options.userPassword ?? "",
  );
  const encryptMetadata = options.encryptMetadata ?? true;
  const p = permissionsToP(options.permissions);
  const fileKey = randomBytes(AESV3_KEY_BYTES);

  const userValidationSalt = randomBytes(AESV3_SALT_BYTES);
  const userKeySalt = randomBytes(AESV3_SALT_BYTES);
  const empty = new Uint8Array(0);
  const userHash = hardenedHash(
    userPassword,
    userValidationSalt,
    empty,
    spec.r,
  );
  const u = concatBytes([userHash, userValidationSalt, userKeySalt]);
  const userIntermediateKey = hardenedHash(
    userPassword,
    userKeySalt,
    empty,
    spec.r,
  );
  const ue = aesCbcEncrypt(userIntermediateKey, ZERO_IV, fileKey);

  const ownerValidationSalt = randomBytes(AESV3_SALT_BYTES);
  const ownerKeySalt = randomBytes(AESV3_SALT_BYTES);
  const ownerHash = hardenedHash(ownerPassword, ownerValidationSalt, u, spec.r);
  const o = concatBytes([ownerHash, ownerValidationSalt, ownerKeySalt]);
  const ownerIntermediateKey = hardenedHash(
    ownerPassword,
    ownerKeySalt,
    u,
    spec.r,
  );
  const oe = aesCbcEncrypt(ownerIntermediateKey, ZERO_IV, fileKey);

  // Algorithm 10: a 16-byte block carrying P sign-extended to 64 bits (upper 32 bits forced to all-1s regardless of P's own sign, per step (a)), the /EncryptMetadata flag as an ASCII 'T'/'F', the fixed ASCII marker "adb", and 4 ignored random bytes -- encrypted as a single AES-256 block under the file key with a zero IV (CBC over exactly one block with a zero IV is the same transform ECB would give that one block, so aesCbcEncrypt is reused rather than adding a distinct ECB primitive for this one caller).
  const permsBlock = new Uint8Array(16);
  permsBlock.set(permissionsBytes(p), 0);
  permsBlock.set([0xff, 0xff, 0xff, 0xff], 4);
  permsBlock[8] = encryptMetadata ? 0x54 : 0x46; // 'T' / 'F'
  permsBlock.set([0x61, 0x64, 0x62], 9); // "adb"
  permsBlock.set(randomBytes(4), 12);
  const perms = aesCbcEncrypt(fileKey, ZERO_IV, permsBlock);

  const entries = new Map<string, PdfObject>([
    ["Filter", pdfName("Standard")],
    ["V", pdfNum(spec.v)],
    ["R", pdfNum(spec.r)],
    ["O", pdfHexString(o)],
    ["U", pdfHexString(u)],
    ["OE", pdfHexString(oe)],
    ["UE", pdfHexString(ue)],
    ["P", pdfNum(p)],
    ["Perms", pdfHexString(perms)],
    ["Length", pdfNum(spec.keyBytes * 8)],
    [
      "CF",
      pdfDict({
        StdCF: pdfDict({
          AuthEvent: pdfName("DocOpen"),
          CFM: pdfName("AESV3"),
          Length: pdfNum(spec.keyBytes),
        }),
      }),
    ],
    ["StmF", pdfName("StdCF")],
    ["StrF", pdfName("StdCF")],
    ["EncryptMetadata", pdfBool(encryptMetadata)],
  ]);

  return buildEncryptor(
    pdfDict(entries),
    fileKey,
    spec.method,
    false,
    encryptMetadata,
  );
}

// Builds a write-side standard-security-handler encryptor for one of the four schemes encrypt.ts's own reader understands. `fileId` is only consumed by the rc4-40/rc4-128/aes-128 schemes (ISO 32000-2 7.6.4.3.2 step (e)); aes-256's Algorithm 2.A/8/9/10 never reference it (the spec's own note recommends this: an ID mixed into the key derivation complicates incremental updates), but the caller still supplies one so the trailer's own /ID entry -- expected regardless of encryption -- has a single source of truth.
export function createStandardEncryptor(
  options: PdfEncryptionOptions,
  fileId: Uint8Array<ArrayBuffer>,
): PdfEncryptor {
  const scheme = options.scheme ?? "aes-256";
  const spec = SCHEME_SPECS[scheme];
  return spec.v === 5
    ? buildAes256Encryptor(spec, options)
    : buildLegacyEncryptor(spec, options, fileId);
}

// Walks one about-to-be-written indirect object, encrypting every string and stream inside it -- the write-side mirror of document.ts's own decryptDict/decryptObject. Never called on the /Encrypt dictionary object itself: ISO 32000-2 7.6.1 requires its own strings to stay in the clear (a reader has to read O/U/OE/UE before it has a file key to decrypt anything with), and write.ts enforces that by allocating the /Encrypt object and appending it to the object list only after this walk has already run over everything else.
export function encryptIndirectObject(
  value: PdfObject,
  num: number,
  gen: number,
  encryptor: PdfEncryptor,
): PdfObject {
  if (value.kind === "string") {
    return {
      kind: "string",
      bytes: encryptor.encryptString(value.bytes, num, gen),
      hex: value.hex,
    };
  }
  if (value.kind === "array") {
    return pdfArray(
      value.items.map((item) =>
        encryptIndirectObject(item, num, gen, encryptor),
      ),
    );
  }
  if (value.kind === "dict") {
    return encryptDictEntries(value, num, gen, encryptor);
  }
  if (value.kind === "stream") {
    return {
      kind: "stream",
      dict: encryptDictEntries(value.dict, num, gen, encryptor),
      raw: encryptor.encryptStream(value.raw, value.dict, num, gen),
    };
  }
  return value;
}

function encryptDictEntries(
  dict: PdfDict,
  num: number,
  gen: number,
  encryptor: PdfEncryptor,
): PdfDict {
  return pdfDict(
    new Map(
      Array.from(dict.entries, ([key, entry]) => [
        key,
        encryptIndirectObject(entry, num, gen, encryptor),
      ]),
    ),
  );
}
