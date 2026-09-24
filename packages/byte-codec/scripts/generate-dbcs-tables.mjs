#!/usr/bin/env node
// Regenerates src/text/dbcs-tables.ts from the vendored assets/whatwg-encoding/indexes.json.
//
// Node rather than rtf-codec's own scripts/generate-dbcs-tables.py: that script's whole reason for being Python is decoding raw bytes through Python's stdlib codecs module (bytes([...]).decode(codec)), since it derives its tables by actually running Microsoft's cpNNNN codecs byte by byte — see that script's own header comment. This script derives nothing by decoding anything; it is a pure JSON-to-TypeScript transform of index tables the WHATWG Encoding Standard already publishes pre-computed (https://encoding.spec.whatwg.org/#indexes), so it has the same shape as markdown-codec's own scripts/generate-entity-table.mjs (vendored WHATWG JSON in, generated .ts out) and uses that script's language for the same reason.
//
// Each of jis0208, jis0212, big5, euc-kr and gb18030 becomes a `DbcsTable`: a `codeUnits` string holding exactly one UTF-16 code unit per pointer (0 to the table's own length minus one), plus an `astral` map for the rare pointer whose real code point does not fit in one UTF-16 code unit. A string literal rather than rtf-codec's own dense `readonly number[]` (the format this file used before): Prettier never inserts a line break inside a string literal, so a whole table collapses to one source line regardless of how many entries it holds, exactly the property rtf-codec's own string-keyed codepage-dbcs.ts already relies on for the same reason (see that file's own header comment). `codeUnits.charCodeAt(pointer)` gives the code point directly for anything in the Basic Multilingual Plane. U+FFFD stands in both for a pointer the Encoding Standard's own index leaves undefined and for a pointer whose real code point is astral (needs two UTF-16 code units, so cannot itself occupy the one code unit `codeUnits` gives every pointer); the `astral` map disambiguates the two, holding the real code point for the second case only, keyed by that same pointer, so a genuinely undefined pointer is exactly the one whose sentinel has no corresponding `astral` entry. Only big5 currently has any astral entries, and not a handful: over 1700 CJK Compatibility Ideographs Supplement code points its WHATWG index maps beyond the Basic Multilingual Plane. This generator throws if a future Encoding Standard update ever makes a table map a pointer to U+FFFD itself, since that would make the sentinel ambiguous. `astral` and `GB18030_RANGES` (gb18030's own separate ranges index for its algorithmic four-byte form: [pointer, codePointOffset] pairs, sorted ascending by pointer exactly as the source JSON already orders them, which decode-dbcs.ts's decodeGb18030RangesCodePoint binary-searches) both use the same `pairs()` helper, a `JSON.parse` of a single-line JSON string rather than a TS tuple-literal array, precisely because big5's own astral count makes a one-tuple-per-line array literal blow straight through max-lines (ExaDev/documents.js#1275) on its own.
//
// Run with `node scripts/generate-dbcs-tables.mjs` after replacing the vendored indexes.json (e.g. a WHATWG Living Standard update). Not part of `pnpm build`/`pnpm test` — the generated .ts file is committed to the repository as an ordinary source file, exactly like markdown-codec's own scripts/generate-entity-table.mjs pattern (see that script's own header comment).
//
// This script is deliberately outside tsconfig.json's "include" and eslint.config.ts's linted set, matching the existing precedent other packages' own generator scripts already set (see, for instance, markdown-codec's scripts/generate-entity-table.mjs header comment): a standalone maintenance utility, not part of the shipped src/ program.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sourcePath = join(
  here,
  "..",
  "assets",
  "whatwg-encoding",
  "indexes.json",
);
const outputPath = join(here, "..", "src", "text", "dbcs-tables.ts");

/** @type {Record<string, ReadonlyArray<number | null> | ReadonlyArray<[number, number]>>} */
const indexes = JSON.parse(readFileSync(sourcePath, "utf8"));

/** The code unit a table's own generated `codeUnits` string holds at a pointer that is either genuinely undefined or needs the `astral` overflow map — see this script's own header comment and the emitted file's. */
const REPLACEMENT_CHARACTER_CODE_POINT = 0xfffd;

/**
 * Builds one WHATWG pointer-keyed index (an array of code points, with `null` for an undefined pointer) into the `{ codeUnits, astral }` shape `DbcsTable` holds — see this script's own header comment for what each field means.
 * @param {ReadonlyArray<number | null>} table
 * @param {string} label - The index's own name, for the error thrown when an entry collides with the sentinel.
 * @returns {{ codeUnits: string, astral: ReadonlyArray<readonly [number, number]> }}
 */
function buildDbcsTable(table, label) {
  const units = [];
  const astral = [];
  for (let pointer = 0; pointer < table.length; pointer += 1) {
    const codePoint = table[pointer];
    if (codePoint === null) {
      units.push(REPLACEMENT_CHARACTER_CODE_POINT);
      continue;
    }
    if (codePoint === REPLACEMENT_CHARACTER_CODE_POINT) {
      throw new Error(
        `${label} pointer ${String(pointer)} maps to U+FFFD itself, which pointerCodePoint's sentinel scheme relies on no real WHATWG index entry ever doing — see dbcs-tables.ts's own header comment.`,
      );
    }
    if (codePoint >= 0x10000) {
      astral.push([pointer, codePoint]);
      units.push(REPLACEMENT_CHARACTER_CODE_POINT);
      continue;
    }
    units.push(codePoint);
  }
  let codeUnits = "";
  for (const unit of units) {
    codeUnits += String.fromCharCode(unit);
  }
  return { codeUnits, astral };
}

/**
 * A table's `codeUnits` string as a TS double-quoted string literal. `JSON.stringify`'s own escaping (backslash, double quote, control characters as \uXXXX) is a valid JS/TS string literal and leaves non-ASCII characters literal rather than \uXXXX-escaping them, matching rtf-codec's own generate-dbcs-tables.py's `ts_string_literal` (see that script's own comment) and this file's own previous convention for JIS0208 and friends' emitted numeric literals.
 * @param {string} value
 */
function tsStringLiteral(value) {
  return JSON.stringify(value);
}

/**
 * An array of `[pointer, codePoint]` pairs as a call to the emitted file's own `pairs()` helper, given a single-line JSON string literal rather than a TS tuple-literal array. Big5's own astral overflow runs to over 1700 pairs (CJK Compatibility Ideographs Supplement code points its WHATWG index maps beyond the Basic Multilingual Plane, not "a handful" as this file once assumed when every other table's astral map was empty), and a one-tuple-per-line array literal at that size blows straight through max-lines on its own. A JSON string collapses to one source line exactly the way `codeUnits`' own string literal already does above, for the identical reason: Prettier never breaks a line inside a string literal, so this is immune to reformatting, unlike packing several tuples onto each line would be. This is not the flat-array-plus-zip-function this file used at one point and reverted (dead defensive code, roundabout reconstruction). `pairs()` is one `JSON.parse` call producing exactly the `[K, V][]` shape `new Map(...)` already wants, with nothing to validate because the generator always emits well-formed JSON; the single `as` this needs (JSON.parse itself returns `any`) lives in that one helper rather than at every call site.
 * @param {ReadonlyArray<readonly [number, number]>} pairs
 */
function pairsArrayLiteral(pairs) {
  return `pairs(${tsStringLiteral(JSON.stringify(pairs))})`;
}

const jis0208 = buildDbcsTable(indexes.jis0208, "jis0208");
const jis0212 = buildDbcsTable(indexes.jis0212, "jis0212");
const big5 = buildDbcsTable(indexes.big5, "big5");
const eucKr = buildDbcsTable(indexes["euc-kr"], "euc-kr");
const gb18030 = buildDbcsTable(indexes.gb18030, "gb18030");
const gb18030Ranges = indexes["gb18030-ranges"];

/**
 * @param {{ codeUnits: string, astral: ReadonlyArray<readonly [number, number]> }} built
 */
function dbcsTableLiteral(built) {
  return `{\n  codeUnits: ${tsStringLiteral(built.codeUnits)},\n  astral: new Map(${pairsArrayLiteral(built.astral)}),\n}`;
}

const header = `// AUTO-GENERATED by scripts/generate-dbcs-tables.mjs from assets/whatwg-encoding/indexes.json — do not hand-edit.
// Regenerate with: node scripts/generate-dbcs-tables.mjs
//
// One \`DbcsTable\` per WHATWG Encoding Standard pointer-keyed index (https://encoding.spec.whatwg.org/#indexes). \`codeUnits\` holds one UTF-16 code unit per pointer (0 to the string's own length minus one): the Unicode code point itself for anything in the Basic Multilingual Plane, or U+FFFD where that pointer is either undefined or holds a code point needing more than one UTF-16 code unit. \`astral\` gives the real code point for the second case only, keyed by pointer, built directly by \`new Map\` from a \`[pointer, codePoint]\` pair-tuple array (the same shape \`GB18030_RANGES\` below already uses). decode-dbcs.ts's own pointerCodePoint reads \`codeUnits.charCodeAt(pointer)\` first and only consults \`astral\` when that comes back U+FFFD, so a pointer with no \`astral\` entry of its own is exactly the pointers the index leaves genuinely undefined. See this script's own header comment for why U+FFFD is safe as a sentinel here. \`GB18030_RANGES\` is gb18030's own separate ranges index for its algorithmic four-byte form: [pointer, codePointOffset] pairs, sorted ascending by pointer exactly as the source JSON already orders them, which decode-dbcs.ts's decodeGb18030RangesCodePoint binary-searches.
export interface DbcsTable {
  readonly codeUnits: string;
  readonly astral: ReadonlyMap<number, number>;
}

/** Parses a single-line JSON string of \`[pointer, value]\` pairs into the tuple-array shape \`new Map(...)\` wants. \`JSON.parse\` itself returns \`any\`; the generator always emits well-formed JSON for this shape, so there is nothing to validate, and this is the one place that trusted assumption is asserted rather than repeated at every call site below. */
function pairs(json: string): readonly (readonly [number, number])[] {
  return JSON.parse(json) as readonly (readonly [number, number])[];
}

export const JIS0208: DbcsTable = ${dbcsTableLiteral(jis0208)};

export const JIS0212: DbcsTable = ${dbcsTableLiteral(jis0212)};

export const BIG5: DbcsTable = ${dbcsTableLiteral(big5)};

export const EUC_KR: DbcsTable = ${dbcsTableLiteral(eucKr)};

export const GB18030: DbcsTable = ${dbcsTableLiteral(gb18030)};

export const GB18030_RANGES: readonly (readonly [number, number])[] = ${pairsArrayLiteral(gb18030Ranges)};
`;

writeFileSync(outputPath, header, "utf8");
console.log(
  `Wrote ${outputPath} (jis0208=${String(jis0208.astral.length)} astral, jis0212=${String(jis0212.astral.length)} astral, big5=${String(big5.astral.length)} astral, euc-kr=${String(eucKr.astral.length)} astral, gb18030=${String(gb18030.astral.length)} astral, gb18030-ranges=${String(gb18030Ranges.length)})`,
);
