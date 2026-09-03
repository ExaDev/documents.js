// The one string-to-bytes conversion this package accepts, and the reason every public entry point takes Uint8Array rather than string.
//
// RTF is defined over bytes, not characters: `\'hh` names a raw byte decoded through whichever codepage the document's own \ansicpgN/\fcharsetN declared (RTF 1.9.1, "Special Characters" and "Character Set"), and \binN is followed by literally N arbitrary bytes that may include braces and backslashes. A caller who has already decoded a .rtf file as UTF-8 has destroyed exactly the information the codepage layer needs, so accepting a decoded string as the primary input would silently produce mojibake for every non-ASCII document.
//
// What this helper does accept is the case where a string genuinely still holds bytes: RTF's own alphabet is 7-bit ASCII, so a file read with a latin-1/binary reader (or an RTF fixture written as a source literal) has one code unit per byte and converts back exactly. A code unit above U+00FF proves the opposite -- the caller decoded through some multi-byte encoding -- so it throws rather than truncating, per the family's no-silent-fallback convention.
import { RtfParseError } from "./diagnostics";

export function rtfBytesFromLatin1(source: string): Uint8Array {
  const out = new Uint8Array(source.length);
  for (let index = 0; index < source.length; index += 1) {
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
