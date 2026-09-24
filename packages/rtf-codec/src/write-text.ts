// The two text-escaping primitives shared by every write-*.ts helper module: escapeText turns arbitrary document text into RTF's own \uN-escaped ASCII, and bookmarkStartGroup mints the <bookstart> group a bookmark anchor opens with.
import type { AnchorDescriptor } from "document-schema.js";
import { bookmarkResidueControlWords } from "./constructs";

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
    if (code >= 0x20 && code < 0x7f) {
      out += character;
      continue;
    }
    // Each UTF-16 code unit becomes its own \uN, expressed as a signed 16-bit value: "Unicode values greater than 32767 are expressed as negative numbers".
    for (let unit = 0; unit < character.length; unit += 1) {
      const value = character.charCodeAt(unit);
      const signed = value > 0x7f_ff ? value - 0x1_00_00 : value;
      out += `\\u${String(signed)} ?`;
    }
  }
  return out;
}

export function bookmarkStartGroup(descriptor: AnchorDescriptor): string {
  const residue = bookmarkResidueControlWords(descriptor);
  return `{\\*\\bkmkstart${residue} ${escapeText(descriptor.name)}}`;
}
