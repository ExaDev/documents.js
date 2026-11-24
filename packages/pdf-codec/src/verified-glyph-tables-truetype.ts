// The verified glyph tables for the Type 1C subsets converted from TrueType symbol faces, which name each glyph G and a number (the glyph's id in the face) and carry no /ToUnicode; see verified-glyph-tables.ts for how a table is keyed and read.

import type { VerifiedGlyphTableSource } from "./verified-glyph-tables";

export const TRUETYPE_SOURCES: readonly (readonly [
  string,
  VerifiedGlyphTableSource,
])[] = [
  [
    "988c6d2ea90959baf5ed8f013f6dd21b6e4137145a2e2f75c117591aeca44927",
    {
      family: "Symbol092",
      glyphs: {
        G149: "\u00b0",
        G156: "\u2022",
        G181: "\u2220",
        G187: "\u221a",
        G203: "\u239b",
        G204: "\u239c",
        G205: "\u239d",
        G215: "\u222b",
        G219: "\u239e",
        G220: "\u239f",
        G221: "\u23a0",
        G32: " ",
        G40: "(",
        G41: ")",
        G43: "+",
        G45: "\u2212",
        G61: "=",
        G65: "A",
        G87: "\u03a9",
      },
    },
  ],
];
