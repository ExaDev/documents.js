// The two text-escaping primitives shared by every write-*.ts helper module: escapeText turns arbitrary document text into RTF's own \uN-escaped ASCII, and bookmarkStartGroup mints the <bookstart> group a bookmark anchor opens with.
import type { AnchorDescriptor } from "document-schema.js";
import { bookmarkResidueControlWords } from "./constructs";

// The printable ASCII range escapeText passes through unescaped: space (0x20) through DEL's own predecessor (0x7e), i.e. every code point strictly below DEL (0x7f) itself.
const ASCII_PRINTABLE_MIN = 0x20;
const ASCII_DEL = 0x7f;

// "Unicode values greater than 32767 are expressed as negative numbers": a \uN escape is always a signed 16-bit value, so a code unit above this boundary folds down by one full 16-bit range to land in the negative half.
const INT16_MAX = 0x7fff;
const UINT16_RANGE = 0x10000;

export function escapeText(text: string): string {
  let out = "";
  for (const character of text) {
    switch (character) {
      case "\\":
        out += "\\\\";
        continue;
      case "{":
        out += "\\{";
        continue;
      case "}":
        out += "\\}";
        continue;
      case "\t":
        out += "\\tab ";
        continue;
      case "\n":
      case "\r":
        out += "\\line ";
        continue;
      // No default case: a switch with no matching case already falls through to the code below on its own, exactly what `default: break;` here did.
    }
    const code = character.codePointAt(0) ?? 0;
    if (code >= ASCII_PRINTABLE_MIN && code < ASCII_DEL) {
      out += character;
      continue;
    }
    // Each UTF-16 code unit becomes its own \uN, expressed as a signed 16-bit value: "Unicode values greater than 32767 are expressed as negative numbers".
    for (let unit = 0; unit < character.length; unit += 1) {
      const value = character.charCodeAt(unit);
      const signed = value > INT16_MAX ? value - UINT16_RANGE : value;
      out += `\\u${String(signed)} ?`;
    }
  }
  return out;
}

export function bookmarkStartGroup(descriptor: AnchorDescriptor): string {
  const residue = bookmarkResidueControlWords(descriptor);
  return `{\\*\\bkmkstart${residue} ${escapeText(descriptor.name)}}`;
}
