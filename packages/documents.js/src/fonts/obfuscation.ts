// ECMA-376 Part 4, 2.8.1 (Font Embedding / "obfuscated" font parts). A docx never stores an embedded font as a plain .ttf/.otf: the part is a .odttf whose FIRST 32 BYTES are XORed against a 16-byte key derived from the w:fontKey GUID carried on the same w:embedRegular/w:embedBold/w:embedItalic/w:embedBoldItalic element, with every byte from index 32 onwards stored verbatim. The transformation is its own inverse (XOR), so the same code deobfuscates on read and would obfuscate on write.
//
// pptx is the same file format for the part itself but, in practice, NOT the same convention for the bytes: p:embeddedFont's own p:regular/p:bold/p:italic/p:boldItalic carry only an r:id and no font-key attribute at all, and the referenced .fntdata part is stored unobfuscated. Rather than branching on the source format at the call site -- which would make a docx with a clear part, or a pptx that did obfuscate, an unreadable file for no good reason -- deobfuscateEmbeddedFont sniffs the leading sfnt signature FIRST and only deobfuscates when the bytes are not already a recognisable font. One function, both formats, decided by what the bytes actually are.
import { parseSfnt } from "pdf-codec/sfnt";

// The 16 hexadecimal-digit pairs of a GUID, once its braces and hyphens are stripped.
const FONT_KEY_HEX_LENGTH = 32;
const FONT_KEY_BYTE_LENGTH = 16;
// The obfuscated region: the key applied twice back to back, per 2.8.1's own "the first 32 bytes" wording.
const OBFUSCATED_PREFIX_LENGTH = FONT_KEY_BYTE_LENGTH * 2;
// The sfnt table directory a signature check needs to be meaningful at all -- 4-byte version tag, numTables, searchRange, entrySelector, rangeShift.
const SFNT_HEADER_LENGTH = 12;

const HEX_PAIR_PATTERN = /^[0-9A-Fa-f]{2}$/;

export class FontDeobfuscationError extends Error {
  constructor(detail: string) {
    super(`deobfuscateEmbeddedFont: ${detail}`);
    this.name = "FontDeobfuscationError";
  }
}

// The 16-byte XOR key for a w:fontKey GUID. The non-obvious part of 2.8.1, and the reason this is a named, separately-tested function rather than three lines inlined below: the key is NOT the GUID's bytes in written order, nor its little-endian in-memory Windows GUID layout -- it is the 32 hex digits read as byte pairs in REVERSE order, so key[0] is the LAST hex pair of the GUID string and key[15] the first. Verified against ECMA-376's own worked example: {001B70DC-AA60-4AD5-90EC-18A0948E1EAE} yields AE 1E 8E 94 A0 18 EC 90 D5 4A 60 AA DC 70 1B 00 (see obfuscation.test.ts).
export function deriveFontKey(fontKey: string): Uint8Array<ArrayBuffer> {
  const hex = fontKey.replace(/[{}-]/g, "");
  if (hex.length !== FONT_KEY_HEX_LENGTH) {
    throw new FontDeobfuscationError(
      `w:fontKey ${JSON.stringify(fontKey)} has ${String(hex.length)} hex digit(s) after stripping braces and hyphens, expected ${String(FONT_KEY_HEX_LENGTH)}`,
    );
  }
  const key = new Uint8Array(FONT_KEY_BYTE_LENGTH);
  for (let i = 0; i < FONT_KEY_BYTE_LENGTH; i++) {
    const start = FONT_KEY_HEX_LENGTH - 2 - i * 2;
    const pair = hex.slice(start, start + 2);
    if (!HEX_PAIR_PATTERN.test(pair)) {
      throw new FontDeobfuscationError(
        `w:fontKey ${JSON.stringify(fontKey)} contains the non-hexadecimal pair ${JSON.stringify(pair)}`,
      );
    }
    key[i] = Number.parseInt(pair, 16);
  }
  return key;
}

// True when `bytes` open with an sfnt version tag AND carry a table directory that parses. Deliberately delegated whole to pdf-codec's own parseSfnt rather than comparing the first four bytes here: a four-byte match alone would call an obfuscated part "already clear" whenever its ciphertext happened to collide with a signature, and the whole point of sniffing is to decide correctly between two mutually exclusive readings of the same bytes.
//
// Delegating also pins the accepted set to exactly what the downstream consumer can actually use, which is 0x00010000, 'true', 'typ1', and 'OTTO' -- notably NOT 'ttcf', a TrueType Collection. That exclusion is deliberate rather than an oversight: pdf-codec builds an EmbeddedFace from a single face's table directory and cannot load a collection at all, so accepting one here would only move the failure to a later point where it reads as "this font produced no glyphs" instead of "this part is not a font this package can embed". Word converts a collection-sourced font to a single face when it embeds one, so no real .odttf part carries a collection to begin with.
export function looksLikeSfnt(bytes: Uint8Array<ArrayBuffer>): boolean {
  return bytes.length >= SFNT_HEADER_LENGTH && parseSfnt(bytes) !== undefined;
}

// Recovers the real font bytes from an embedded font part. Sniff-first: bytes that already parse as an sfnt are returned unchanged (pptx's own .fntdata parts, and any docx producer that stored a clear part), otherwise the 32-byte obfuscated prefix is XORed back with `fontKey`'s derived key.
//
// Throws rather than degrading, in both failure directions: a part that is neither a recognisable font nor accompanied by a font key cannot be read at all, and a part that still does not parse AFTER deobfuscation means the key and the bytes genuinely do not belong together. Both are defects in the source package, and silently handing back 32 bytes of noise followed by real font data would produce a font that loads, measures wrong, and renders garbage -- strictly worse than a visible failure.
export function deobfuscateEmbeddedFont(
  bytes: Uint8Array<ArrayBuffer>,
  fontKey: string | undefined,
): Uint8Array<ArrayBuffer> {
  if (looksLikeSfnt(bytes)) {
    return bytes;
  }
  if (fontKey === undefined) {
    throw new FontDeobfuscationError(
      "the part does not begin with an sfnt signature and carries no font key to deobfuscate it with",
    );
  }
  if (bytes.length < OBFUSCATED_PREFIX_LENGTH) {
    throw new FontDeobfuscationError(
      `an obfuscated part must be at least ${String(OBFUSCATED_PREFIX_LENGTH)} bytes long, got ${String(bytes.length)}`,
    );
  }
  const key = deriveFontKey(fontKey);
  const clear = new Uint8Array(bytes.length);
  clear.set(bytes);
  for (let i = 0; i < OBFUSCATED_PREFIX_LENGTH; i++) {
    const keyByte = key[i % FONT_KEY_BYTE_LENGTH];
    const cipherByte = clear[i];
    if (keyByte === undefined || cipherByte === undefined) {
      throw new FontDeobfuscationError(
        `byte ${String(i)} of the obfuscated prefix is out of range`,
      );
    }
    clear[i] = cipherByte ^ keyByte;
  }
  if (!looksLikeSfnt(clear)) {
    throw new FontDeobfuscationError(
      `deobfuscating with font key ${JSON.stringify(fontKey)} did not produce a recognisable sfnt font`,
    );
  }
  return clear;
}
