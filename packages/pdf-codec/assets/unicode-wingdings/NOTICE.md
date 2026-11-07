# Third-party data: Unicode's Wingdings and Webdings source references

`source-references.txt` is the source-reference list of "Status of encoding of Wingdings and Webdings Symbols" (ISO/IEC JTC1/SC2/WG2 N4384, UTC L2/12-368, 2012-11-06, authored for Unicode by Michel Suignard), section 7, which gives the UCS code point of every Webdings, Wingdings, Wingdings 2 and Wingdings 3 glyph the document encodes against the glyph's decimal identifier (the font's 8-bit code, plus 1000 for Wingdings, 2000 for Wingdings 2 and 3000 for Wingdings 3).

- Source: https://www.unicode.org/wg2/docs/n4384.pdf, archived at https://web.archive.org/web/20261010172215/http://www.unicode.org/wg2/docs/n4384.pdf
- The comment header is copied verbatim. The document lays the entries out in four columns per page; they are listed here one per line, ordered by code point, each entry's fields unchanged.

`src/wingdings-characters.ts` (Wingdings) and `src/dingbat-characters.ts` (Wingdings 2, Wingdings 3 and Webdings) hold the tables `symbol-font-private-use.ts` reads, and `src/wingdings-characters.test.ts` checks every entry of them against this list.
