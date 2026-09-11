import { byteAt } from "../bytes/view";
import { WpdFormatError, WpdWrongPasswordError } from "../errors";
import { WPD_PREFIX_HEADER_SIZE, type WpdFileHeader } from "./header";

// -- WordPerfect's "original" (standard) file encryption, the one the header's encryption word names --
//
// Corel's SDK documents only that the header word exists ("If this word value is non-zero, the file is encrypted and nothing beyond the file header will be intelligible to an application program" -- WPFF Document Structure, "Encryption field"); it publishes no cipher. The algorithm here comes from the two independent community sources that do document it, which agree with each other:
//
// 1. libwpd's WPXEncryption (src/lib/WPXEncryption.cpp, Strba/Fojtik 2007, MPL 2.0/LGPLv2.1+), the reference open-source implementation LibreOffice and AbiWord ship: uppercase-normalise the password, then transform each byte at or beyond a start offset as `plain = cipher ^ password[(pos - start) % len] ^ ((len + 1 + pos - start) & 0xFF)`. Its getCheckSum() derives the 16-bit password checksum the header word carries: `checkSum = rotateRight16(checkSum, 1) ^ (char << 8)` over the normalised password.
// 2. The Unix-AG Kaiserslautern cryptanalysis "Die WordPerfect-Kodierung" / wpbreak (Conrad, unix-ag.uni-kl.de/~conrad/krypto/misc/wpbreak.html), which reverse-engineered the identical scheme from WordPerfect 4.2 and 5.0 files: a Vigenère XOR with the repeating password over a first-pass XOR with an ascending byte sequence "02 03 ... FF 00 01 02 ..." whose starting point is the key length plus one, and whose bytes 12-13 carry the key checksum. The ascending sequence starting at len+1 and wrapping mod 256 is exactly libwpd's mask arithmetic.
//
// The wpbreak paper also pins the 5.0 start offset ("The encryption of the file starts at byte number 16" -- beyond WP 5's sixteen-byte header), and libwpd's WP5 wiring confirms it (new WPXEncryption(password, 16)). WordPerfect 6.x-X6 carries the same cipher forward as its "standard"/"original" mode -- commercial recovery tools catalogue the modes as "Ver 5.x, Original ver 6.0(a), Enhanced from 6.x to X9", and the 6.x "original" one is the backward-compatible scheme -- with the boundary following the same structural rule: everything beyond this format's own fixed header, i.e. from WPD_PREFIX_HEADER_SIZE (512) on. That boundary is what the SDK's own sentence states ("nothing beyond the file header"), read against this format's own header size the way wpbreak's finding reads against WP 5's.
//
// What is NOT covered, stated outright: libwpd itself refuses WP 6 encrypted files outright (WP6Header.cpp: "FIXME: we do not handle encrypted documents"), so no open-source reference implementation of the 6.x wiring exists to cross-check the 512 boundary or the checksum verification against a real WordPerfect-produced encrypted file -- this module's round-trip tests validate the cipher and the pipeline wiring, not the 6.x specifics against ground truth. The 9-and-later "enhanced encryption" mode is a different, unpublished cipher and stays refused (see WpdWrongPasswordError's own comment for how a non-matching checksum is reported).

// libwpd uppercases ASCII lowercase only (`if (password[i] >= 'a' && password[i] <= 'z')`), leaving every other byte verbatim. A JavaScript string is UTF-16, not a C byte string: code units beyond Latin-1 have no byte this cipher can key with, and silently truncating them would decrypt to garbage while appearing to work, so they throw instead.
export function normaliseWpdPassword(password: string): number[] {
  const normalised: number[] = [];
  for (let i = 0; i < password.length; i++) {
    const unit = password.charCodeAt(i);
    if (unit > 0xff) {
      throw new WpdFormatError(
        `A password with characters outside Latin-1 cannot be encoded into the byte-keyed WordPerfect cipher (code unit U+${unit.toString(16).toUpperCase().padStart(4, "0")} at position ${i}).`,
      );
    }
    normalised.push(unit >= 0x61 && unit <= 0x7a ? unit - 0x61 + 0x41 : unit);
  }
  return normalised;
}

// The 16-bit password checksum the header's encryption word carries: a rotate-right-by-one XOR fold of each normalised character shifted into the high byte, per libwpd's getCheckSum() (and wpbreak's "key checksum" finding for the header word). 0 for the empty password, matching libwpd.
export function wpdPasswordChecksum16(normalised: readonly number[]): number {
  let checksum = 0;
  for (const unit of normalised) {
    checksum = ((checksum >>> 1) | (checksum << 15)) ^ (unit << 8);
    checksum &= 0xffff;
  }
  return checksum;
}

// The cipher itself. A pure XOR keyed by position (password byte + ascending mask), so the same transform encrypts and decrypts -- wpbreak's paper relies on exactly this symmetry for its known-plaintext attack. Returns a new buffer (bytes at and after startOffset transformed, bytes before it verbatim); the input is never mutated, so an encrypted buffer stays available for a retry with a different password.
export function applyWpdStandardEncryption(
  bytes: Uint8Array,
  normalised: readonly number[],
  startOffset: number,
): Uint8Array<ArrayBuffer> {
  if (normalised.length === 0) {
    throw new WpdFormatError(
      "The WordPerfect cipher is keyed by the password's own bytes, so an empty password decrypts nothing.",
    );
  }
  const maskBase = (normalised.length + 1) & 0xff;
  const output = new Uint8Array(bytes.length);
  output.set(bytes.subarray(0, startOffset));
  for (let pos = startOffset; pos < bytes.length; pos++) {
    const relative = pos - startOffset;
    const passwordByte = normalised[relative % normalised.length];
    if (passwordByte === undefined) {
      // Unreachable: the empty-password throw above guarantees a non-empty array, so a modulo of its length always indexes in bounds. This is the noUncheckedIndexedAccess narrowing, not a fallback.
      throw new WpdFormatError(
        // Stryker disable next-line StringLiteral: no test can ever reach this branch to observe its message -- see the comment above.
        "The password normalised to no bytes, which the cipher cannot key with.",
      );
    }
    const mask = (maskBase + relative) & 0xff;
    output[pos] = byteAt(bytes, pos) ^ passwordByte ^ mask;
  }
  return output;
}

// The read-side gate for an encrypted document: verifies the password against the header word's checksum and answers the decrypted buffer, or throws. Called only for a header whose encryption word is non-zero AND a non-empty password the caller actually supplied -- readFileHeader throws WpdEncryptedDocumentError for the no-password case, and an explicit password on an unencrypted document is harmlessly ignored by the caller, mirroring how every other codec here treats its password option. A password whose checksum does not match the header word throws WpdWrongPasswordError rather than decrypting to garbage.
export function decryptWpdDocument(
  bytes: Uint8Array<ArrayBuffer>,
  header: WpdFileHeader,
  password: string,
): Uint8Array<ArrayBuffer> {
  const normalised = normaliseWpdPassword(password);
  if (normalised.length === 0) {
    throw new WpdWrongPasswordError(header.encryption, 0);
  }
  const checksum = wpdPasswordChecksum16(normalised);
  if (checksum !== header.encryption) {
    throw new WpdWrongPasswordError(header.encryption, checksum);
  }
  return applyWpdStandardEncryption(bytes, normalised, WPD_PREFIX_HEADER_SIZE);
}

// The test-fixture inverse: encrypts an unencrypted document's bytes beyond the fixed header and stamps the header word with the password's checksum, producing exactly the shape a WordPerfect "original"-mode encrypted file presents. Exported for this package's own tests and fixture tooling only -- deliberately not re-exported from the package index, since no write path here encrypts documents and an unconsumed public encrypt API would be surface nothing calls.
export function encryptWpdDocumentForTests(
  bytes: Uint8Array,
  password: string,
): Uint8Array<ArrayBuffer> {
  const normalised = normaliseWpdPassword(password);
  const checksum = wpdPasswordChecksum16(normalised);
  const encrypted = applyWpdStandardEncryption(
    bytes,
    normalised,
    WPD_PREFIX_HEADER_SIZE,
  );
  const output = new Uint8Array(encrypted.length);
  output.set(encrypted);
  output[12] = checksum & 0xff;
  output[13] = (checksum >>> 8) & 0xff;
  return output;
}
