import { describe, expect, it } from "vitest";
import {
  decodeCodepageBytes,
  isSupportedCodepage,
  UTF8_CODEPAGE,
} from "./codepage";
import { NOOP_RTF_DIAGNOSTIC_SINK, RtfDiagnosticCodes } from "./diagnostics";
import { readRtfContent } from "./read";
import { bytes } from "./test-support/bytes";

// Each byte sequence below is a real word in the language its code page is for, produced by scripts/generate-dbcs-tables.py's own generation method (`text.encode(py_codec)` -- the encode direction of the same Python codec the table's own decode direction was built from) rather than hand-picked bytes, so a round trip here is checking the generated table against an independent encode pass through the same primary source cited in that script's header comment, not merely asserting the table is self-consistent.
describe("decodeCodepageBytes: East Asian DBCS pages", () => {
  it("932 Shift-JIS decodes 日本語 (Japanese)", () => {
    expect(
      decodeCodepageBytes(
        Uint8Array.from([0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea]),
        932,
        NOOP_RTF_DIAGNOSTIC_SINK,
      ),
    ).toBe("日本語");
  });

  it("932 Shift-JIS decodes a halfwidth katakana single-byte extension alongside a two-byte run", () => {
    // 0xb1 is halfwidth ｱ (U+FF71) on its own, not a lead byte -- DBCS_SINGLE_BYTE_EXTRAS, not DBCS_LEAD_BYTE_TABLES.
    expect(
      decodeCodepageBytes(
        Uint8Array.from([0xb1, 0x93, 0xfa]),
        932,
        NOOP_RTF_DIAGNOSTIC_SINK,
      ),
    ).toBe("ｱ日");
  });

  it("936 GBK decodes 中文 (Chinese)", () => {
    expect(
      decodeCodepageBytes(
        Uint8Array.from([0xd6, 0xd0, 0xce, 0xc4]),
        936,
        NOOP_RTF_DIAGNOSTIC_SINK,
      ),
    ).toBe("中文");
  });

  it("949 UHC decodes 한국어 (Korean)", () => {
    expect(
      decodeCodepageBytes(
        Uint8Array.from([0xc7, 0xd1, 0xb1, 0xb9, 0xbe, 0xee]),
        949,
        NOOP_RTF_DIAGNOSTIC_SINK,
      ),
    ).toBe("한국어");
  });

  it("950 Big5 decodes 繁體中文 (Traditional Chinese)", () => {
    expect(
      decodeCodepageBytes(
        Uint8Array.from([0xc1, 0x63, 0xc5, 0xe9, 0xa4, 0xa4, 0xa4, 0xe5]),
        950,
        NOOP_RTF_DIAGNOSTIC_SINK,
      ),
    ).toBe("繁體中文");
  });

  it("1361 Johab decodes 한글 (Hangul, the name of the Korean script)", () => {
    expect(
      decodeCodepageBytes(
        Uint8Array.from([0xd0, 0x65, 0x8b, 0x69]),
        1361,
        NOOP_RTF_DIAGNOSTIC_SINK,
      ),
    ).toBe("한글");
  });

  it("decodes ASCII either side of a DBCS run within the same byte run", () => {
    // "AB中文CD" -- proves the lead-byte state machine advances past a two-byte character by exactly two bytes and resumes ASCII passthrough at the right offset either side of it.
    expect(
      decodeCodepageBytes(
        Uint8Array.from([0x41, 0x42, 0xd6, 0xd0, 0xce, 0xc4, 0x43, 0x44]),
        936,
        NOOP_RTF_DIAGNOSTIC_SINK,
      ),
    ).toBe("AB中文CD");
  });

  it("decodes a lead byte truncated at the end of a run as U+FFFD rather than throwing", () => {
    expect(
      decodeCodepageBytes(
        Uint8Array.from([0x41, 0xd6]),
        936,
        NOOP_RTF_DIAGNOSTIC_SINK,
      ),
    ).toBe("A�");
  });

  it("reports no diagnostic for any of the five DBCS pages, unlike a genuinely unsupported page", () => {
    const observed: string[] = [];
    for (const codepage of [932, 936, 949, 950, 1361]) {
      decodeCodepageBytes(Uint8Array.from([0x41]), codepage, (diagnostic) => {
        observed.push(diagnostic.code);
      });
    }
    expect(observed).toEqual([]);
  });

  it("isSupportedCodepage is true for all five DBCS pages and UTF-8, false for an unlisted page", () => {
    for (const codepage of [932, 936, 949, 950, 1361, UTF8_CODEPAGE]) {
      expect(isSupportedCodepage(codepage)).toBe(true);
    }
    expect(isSupportedCodepage(42)).toBe(false);
  });
});

describe("readRtfContent: East Asian DBCS pages end to end", () => {
  it("decodes a Shift-JIS document declared via \\ansicpg932 with no unsupported-codepage diagnostic", () => {
    const { document, diagnostics } = readRtfContent(
      bytes(
        "{\\rtf1\\ansi\\ansicpg932\\deff0{\\fonttbl{\\f0\\froman\\fcharset128 MS Mincho;}}" +
          "\\pard \\'93\\'fa\\'96\\'7b\\'8c\\'ea\\par}",
      ),
    );
    const blocks =
      document.kind === "wordprocessing"
        ? (document.sections[0]?.blocks ?? [])
        : [];
    const body = blocks[0];
    const text =
      body?.kind === "paragraph"
        ? body.runs.map((run) => run.text).join("")
        : undefined;
    expect(text).toBe("日本語");
    expect(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.code === RtfDiagnosticCodes.UNSUPPORTED_CODEPAGE,
      ),
    ).toBe(false);
  });

  it("decodes a Big5 font run selected by \\fcharset136, overriding the document's own \\ansicpg1252", () => {
    const { document } = readRtfContent(
      bytes(
        "{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0\\froman\\fcharset0 Times New Roman;}{\\f1\\fnil\\fcharset136 PMingLiU;}}" +
          "\\pard\\f1 \\'c1\\'63\\'c5\\'e9\\par}",
      ),
    );
    const blocks =
      document.kind === "wordprocessing"
        ? (document.sections[0]?.blocks ?? [])
        : [];
    const body = blocks[0];
    const text =
      body?.kind === "paragraph"
        ? body.runs.map((run) => run.text).join("")
        : undefined;
    expect(text).toBe("繁體");
  });
});
