#!/usr/bin/env python3
# Regenerates src/codepage-dbcs/cpNNNN.ts (one file per RTF double-byte code page) and src/codepage-dbcs.ts (the combined public tables built from them): the byte-to-character tables for RTF's five East Asian double-byte code pages (932 Shift-JIS, 936 GBK/GB2312, 949 UHC/Hangul, 950 Big5, 1361 Johab).
#
# Same method src/codepage.ts's own header already documents for the single-byte pages (cp1252 and friends): generated, not transcribed, by decoding every byte value through Python's standard-library codecs module (https://docs.python.org/3/library/codecs.html#standard-encodings) rather than hand-typing a mapping table, since a hand-transcribed multi-thousand-entry table is exactly where one transposed character hides until a real document decodes wrong. Python's cp932/cp936/cp949/cp950/cp1361 codecs implement the Microsoft Windows code pages of the same number named in RTF's own \ansicpgN/\cpgN, not a web-oriented substitute, which is why this script uses those four-digit "cpNNNN" names rather than aliases like "shift_jis" or "euc_kr" that name a nearby but not always identical encoding (Python's own "gbk" is registered under both "gbk" and "cp936", and "cp1361"/"johab" both resolve to the same Johab codec).
#
# Cross-checked at generation time against Node's own ICU-backed TextDecoder for the four pages WHATWG's Encoding Standard (https://encoding.spec.whatwg.org/) recognises (shift_jis, gbk, euc-kr, big5; Johab has no web encoding at all, so cp1361 has no second source to check against): 932 and 936 matched Node's decoder on every one of their two-byte sequences; 949 and 950 each had a real minority of sequences where Node's ICU-based "euc-kr"/"big5" decoders (which implement WHATWG's own index tables, a web-platform-oriented variant) disagreed with Python's cp949/cp950 in their vendor-extension regions, expected, since WHATWG's tables are a deliberately different, browser-facing lineage from Microsoft's own code page tables, and this module exists specifically to decode the Microsoft code page RTF's \ansicpgN names by that exact number, not the nearest web encoding. Python's cpNNNN codecs were kept as this module's source of truth in every case.
#
# Run with `python3 scripts/generate-dbcs-tables.py` (uses only the Python standard library) after a Python upgrade that changes any of these codecs' underlying Unicode data. Not part of `pnpm build`/`pnpm test`, the generated .ts files are committed to the repository as ordinary source files, exactly like markdown-codec's own scripts/generate-entity-table.mjs pattern (see that script's own header comment). This script's own language is Python rather than this repo's usual Node, for the same reason src/codepage.ts's single-byte tables already are: bytes([...]).decode(codec) is stdlib in Python and would otherwise mean depending on iconv-lite, which is Node-only (Buffer) and banned by this package's own eslint config for breaking Worker isomorphism, see eslint.config.ts's additionalRestrictedImportPatterns entry for iconv-lite.
#
# Split one file per code page (src/codepage-dbcs/cpNNNN.ts) rather than one combined table, because a single file holding all five pages' dense trail-byte strings exceeds this workspace's max-lines lint limit. Each page's own table is already a natural, self-contained unit (RTF names a document's code page by exactly one of these five numbers at a time), so the split follows the data's own structure rather than an arbitrary line cut. src/codepage-dbcs.ts stays the public entry point (the path src/codepage.ts already imports from) and simply combines the five per-page tables into the same two exported maps it always exported.

import json
from pathlib import Path

# RTF \ansicpgN/\cpgN value -> the exact Windows code page Python codec that implements it.
CODEPAGES = {
    932: "cp932",
    936: "cp936",
    949: "cp949",
    950: "cp950",
    1361: "cp1361",
}

REPLACEMENT = "�"
HERE = Path(__file__).resolve().parent
SRC_DIR = HERE.parent / "src"
PAGES_DIR = SRC_DIR / "codepage-dbcs"
INDEX_PATH = SRC_DIR / "codepage-dbcs.ts"


def decode_one(py_codec: str, raw: bytes) -> str | None:
    try:
        return raw.decode(py_codec)
    except UnicodeDecodeError:
        return None


def build_page(py_codec: str) -> tuple[dict[int, str], dict[int, str]]:
    single: dict[int, str] = {}
    for b in range(0x80, 0x100):
        ch = decode_one(py_codec, bytes([b]))
        if ch is not None:
            single[b] = ch

    lead_tables: dict[int, str] = {}
    for lead in range(0x80, 0x100):
        if lead in single:
            continue
        trail_chars: list[str] = []
        has_any = False
        for trail in range(0x000, 0x100):
            ch = decode_one(py_codec, bytes([lead, trail]))
            if ch is None:
                trail_chars.append(REPLACEMENT)
            else:
                assert len(ch) == 1, (
                    f"cp{lead:02x}{trail:02x} decoded to {ch!r} (length {len(ch)}), "
                    "expected exactly one character"
                )
                trail_chars.append(ch)
                has_any = True
        if has_any:
            lead_tables[lead] = "".join(trail_chars)

    return single, lead_tables


def ts_string_literal(value: str) -> str:
    # json.dumps' escaping (backslash, double quote, control characters as \\uXXXX) is a valid JS/TS double-quoted string literal, which is what src/codepage.ts's own SINGLE_BYTE_PAGES table already relies on implicitly by construction: non-ASCII characters are emitted literally rather than \\uXXXX-escaped, exactly like that table's own entries.
    return json.dumps(value, ensure_ascii=False)


def write_page_file(cp: int, single: dict[int, str], lead_tables: dict[int, str]) -> bool:
    lines: list[str] = []
    lines.append(
        "// AUTO-GENERATED by scripts/generate-dbcs-tables.py, do not hand-edit. See that "
        "script's own header comment for how and why, and ../codepage-dbcs.ts for how this "
        "page's tables are combined with the other four code pages."
    )
    lines.append("// Regenerate with: python3 scripts/generate-dbcs-tables.py")
    lines.append("//")
    lines.append(
        f"// RTF code page {cp}: lead byte -> a dense 256-character string indexed by the "
        "trail byte (0x00-0xFF), the decoded character for that lead+trail pair, or U+FFFD "
        "where the page leaves that pair undefined."
    )
    lines.append("")
    lines.append(
        "export const LEAD_BYTE_TABLE: ReadonlyMap<number, string> = new Map(["
    )
    for lead in sorted(lead_tables):
        lines.append(f"  [{lead}, {ts_string_literal(lead_tables[lead])}],")
    lines.append("]);")

    has_extras = bool(single)
    if has_extras:
        dense = "".join(single.get(b, REPLACEMENT) for b in range(0x80, 0x100))
        lines.append("")
        lines.append(
            f"// Bytes in 0x80-0xFF that stand alone rather than leading a pair for code page "
            f"{cp} (932's halfwidth katakana range and a handful of others), a dense "
            "128-character string indexed by byte-0x80, U+FFFD where that byte is instead a "
            "lead byte or genuinely undefined."
        )
        lines.append(f"export const SINGLE_BYTE_EXTRAS: string = {ts_string_literal(dense)};")
    lines.append("")

    PAGES_DIR.mkdir(parents=True, exist_ok=True)
    (PAGES_DIR / f"cp{cp}.ts").write_text("\n".join(lines), encoding="utf-8")
    return has_extras


def write_index_file(pages_with_extras: list[int]) -> None:
    lines: list[str] = []
    lines.append(
        "// AUTO-GENERATED by scripts/generate-dbcs-tables.py, do not hand-edit. See that "
        "script's own header comment for how and why."
    )
    lines.append("// Regenerate with: python3 scripts/generate-dbcs-tables.py")
    lines.append("//")
    lines.append(
        "// Two maps, both keyed by RTF code page number (932/936/949/950/1361), built from "
        "this package's own per-code-page tables under ./codepage-dbcs/:"
    )
    lines.append(
        "//  - DBCS_LEAD_BYTE_TABLES: lead byte -> a dense 256-character string indexed by the "
        "trail byte (0x00-0xFF), the decoded character for that lead+trail pair, or U+FFFD where "
        "the page leaves that pair undefined."
    )
    lines.append(
        "//  - DBCS_SINGLE_BYTE_EXTRAS: for pages with bytes in 0x80-0xFF that stand alone rather "
        "than leading a pair (932's halfwidth katakana range and a handful of others), a dense "
        "128-character string indexed by byte-0x80, U+FFFD where that byte is instead a lead byte "
        "or genuinely undefined. Absent entirely for a page with no such bytes."
    )
    lines.append("")
    for cp in CODEPAGES:
        extras_import = f", SINGLE_BYTE_EXTRAS as SINGLE_{cp} " if cp in pages_with_extras else " "
        lines.append(
            f'import {{ LEAD_BYTE_TABLE as LEAD_{cp}{extras_import}}} from "./codepage-dbcs/cp{cp}";'
        )
    lines.append("")
    lines.append(
        "export const DBCS_LEAD_BYTE_TABLES: ReadonlyMap<number, ReadonlyMap<number, string>> = new Map(["
    )
    for cp in CODEPAGES:
        lines.append(f"  [{cp}, LEAD_{cp}],")
    lines.append("]);")
    lines.append("")
    lines.append(
        "export const DBCS_SINGLE_BYTE_EXTRAS: ReadonlyMap<number, string> = new Map(["
    )
    for cp in pages_with_extras:
        lines.append(f"  [{cp}, SINGLE_{cp}],")
    lines.append("]);")
    lines.append("")

    INDEX_PATH.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    pages: dict[int, tuple[dict[int, str], dict[int, str]]] = {
        cp: build_page(py_codec) for cp, py_codec in CODEPAGES.items()
    }

    pages_with_extras: list[int] = []
    for cp, (single, lead_tables) in pages.items():
        has_extras = write_page_file(cp, single, lead_tables)
        if has_extras:
            pages_with_extras.append(cp)

    write_index_file(pages_with_extras)
    print(f"Wrote {INDEX_PATH} and {len(CODEPAGES)} page files under {PAGES_DIR}")


if __name__ == "__main__":
    main()
