// The one string-to-bytes conversion this package accepts, and the reason every public entry point takes Uint8Array rather than string.
//
// RTF is defined over bytes, not characters: `\'hh` names a raw byte decoded through whichever codepage the document's own \ansicpgN/\fcharsetN declared (RTF 1.9.1, "Special Characters" and "Character Set"), and \binN is followed by literally N arbitrary bytes that may include braces and backslashes. A caller who has already decoded a .rtf file as UTF-8 has destroyed exactly the information the codepage layer needs, so accepting a decoded string as the primary input would silently produce mojibake for every non-ASCII document.
//
// What this helper does accept is the case where a string genuinely still holds bytes: RTF's own alphabet is 7-bit ASCII, so a file read with a latin-1/binary reader (or an RTF fixture written as a source literal) has one code unit per byte and converts back exactly. A code unit above U+00FF proves the opposite -- the caller decoded through some multi-byte encoding -- so it throws rather than truncating, per the family's no-silent-fallback convention.
import { RtfParseError } from "./diagnostics";

// The inverse, for the one place a reader genuinely needs a byte run as a string rather than as decoded text: a \pict destination's #SDATA payload, which is ASCII hex digits and must not go through a code page at all.
//
// Chunked rather than a single String.fromCharCode(...bytes) spread, and appended rather than spread into an array, because the spread form is a real failure on real input: a function call's argument count is bounded (V8 throws RangeError somewhere around 65k-125k arguments), and a picture payload runs to megabytes. The same reasoning applies to every byte-run append in this package -- appendBytes below is the shared helper for that -- and it is the kind of limit that never shows up on a small test fixture and always shows up on a real document.
const ASCII_CHUNK_SIZE = 8192;

export function asciiStringFromBytes(input: Uint8Array): string {
  let out = "";
  let start = 0;
  // Stops on the first empty chunk rather than comparing `start` against `input.length` directly: Uint8Array.subarray already clamps a past-the-end range to empty on its own, so this is the one condition that actually distinguishes "more bytes remain" from "done", regardless of whether input.length happens to be an exact multiple of ASCII_CHUNK_SIZE.
  for (;;) {
    const chunk = input.subarray(start, start + ASCII_CHUNK_SIZE);
    if (chunk.length === 0) {
      break;
    }
    out += String.fromCharCode(...chunk);
    start += ASCII_CHUNK_SIZE;
  }
  return out;
}

// Appends every byte of `input` to `target` without spreading it into an argument list, for the same argument-count reason as asciiStringFromBytes above.
export function appendBytes(target: number[], input: Uint8Array): void {
  for (const byte of input) {
    target.push(byte);
  }
}

export function rtfBytesFromLatin1(source: string): Uint8Array {
  const out = new Uint8Array(source.length);
  // index increments by exactly 1 every iteration, so it can never skip past source.length -- !== is exactly equivalent to < here, and unlike <, an off-by-one mutation of it (=== in place of !==) stops the loop from running at all instead of surviving unobserved.
  for (let index = 0; index !== source.length; index += 1) {
    const code = source.charCodeAt(index);
    if (code > 0xff) {
      throw new RtfParseError(
        "rtf/not-byte-preserving-string",
        `character at index ${String(index)} is U+${code.toString(16).toUpperCase().padStart(4, "0")}, above U+00FF: this string was decoded through a multi-byte encoding and no longer holds the file's bytes. Read the .rtf file as bytes and pass the Uint8Array directly.`,
      );
    }
    out[index] = code;
  }
  return out;
}
