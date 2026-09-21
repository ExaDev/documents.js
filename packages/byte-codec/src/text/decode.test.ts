import { describe, expect, it } from "vitest";
import type { DecodeTextOptions } from "./decode";
import {
  decodeText,
  detectByteOrderMark,
  isProbablyText,
  TEXT_DECODE_CHUNK_CODE_UNITS,
  tryDecodeText,
  UndecodableTextError,
} from "./decode";

const UTF8_BOM = [0xef, 0xbb, 0xbf];
const UTF16LE_BOM = [0xff, 0xfe];
const UTF16BE_BOM = [0xfe, 0xff];
const UTF32LE_BOM = [0xff, 0xfe, 0x00, 0x00];
const UTF32BE_BOM = [0x00, 0x00, 0xfe, 0xff];

function bytesOf(...parts: readonly (readonly number[])[]): Uint8Array {
  return Uint8Array.from(parts.flat());
}

function utf8(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

function utf16(text: string, littleEndian: boolean): number[] {
  // Indexed by code unit rather than by code point, so a surrogate pair contributes both of its halves.
  return Array.from({ length: text.length }, (_unused, index) => {
    const unit = text.charCodeAt(index);
    const high = unit >> 8;
    const low = unit & 0xff;
    return littleEndian ? [low, high] : [high, low];
  }).flat();
}

function utf32(codePoints: readonly number[], littleEndian: boolean): number[] {
  return codePoints
    .map((codePoint) => {
      const octets = [
        (codePoint >>> 24) & 0xff,
        (codePoint >>> 16) & 0xff,
        (codePoint >>> 8) & 0xff,
        codePoint & 0xff,
      ];
      return littleEndian ? octets.reverse() : octets;
    })
    .flat();
}

/** windows-1252 bytes for the accented letters these fixtures use. Every other character in them is ASCII, which windows-1252 encodes as its own code point. */
const WINDOWS_1252_ACCENTS: ReadonlyMap<string, number> = new Map([
  ["é", 0xe9],
  ["è", 0xe8],
  ["ç", 0xe7],
  ["à", 0xe0],
  ["ü", 0xfc],
  ["ö", 0xf6],
  ["ä", 0xe4],
  ["ß", 0xdf],
]);

function windows1252(text: string): number[] {
  return Array.from(text, (character) => {
    return WINDOWS_1252_ACCENTS.get(character) ?? character.charCodeAt(0);
  });
}

/** Runs decodeText expecting it to refuse, and hands back the error so the test can state which refusal it was. */
function refusal(
  bytes: Uint8Array,
  options?: DecodeTextOptions,
): UndecodableTextError {
  try {
    decodeText(bytes, options);
  } catch (error) {
    if (error instanceof UndecodableTextError) {
      return error;
    }
    throw error;
  }
  return expect.unreachable("decodeText accepted bytes it should have refused");
}

describe("decodeText byte order marks", () => {
  it("decodes UTF-8 behind its own mark and reports the mark as the source", () => {
    const result = decodeText(bytesOf(UTF8_BOM, utf8("café")));
    expect(result).toEqual({
      text: "café",
      encoding: "utf-8",
      source: "bom",
      confidence: "certain",
      warnings: [],
    });
  });

  it("decodes UTF-16LE behind its own mark", () => {
    const result = decodeText(bytesOf(UTF16LE_BOM, utf16("café", true)));
    expect(result.text).toBe("café");
    expect(result.encoding).toBe("utf-16le");
    expect(result.source).toBe("bom");
    expect(result.confidence).toBe("certain");
    expect(result.warnings).toEqual([]);
  });

  it("decodes UTF-16BE behind its own mark", () => {
    const result = decodeText(bytesOf(UTF16BE_BOM, utf16("café", false)));
    expect(result.text).toBe("café");
    expect(result.encoding).toBe("utf-16be");
    expect(result.source).toBe("bom");
  });

  it("decodes UTF-32LE behind its own mark rather than reading it as UTF-16LE", () => {
    const codePoints = [0x63, 0x61, 0x66, 0xe9];
    const result = decodeText(bytesOf(UTF32LE_BOM, utf32(codePoints, true)));
    expect(result.text).toBe("café");
    expect(result.encoding).toBe("utf-32le");
    expect(result.source).toBe("bom");
  });

  it("decodes UTF-32BE behind its own mark", () => {
    const codePoints = [0x63, 0x61, 0x66, 0xe9];
    const result = decodeText(bytesOf(UTF32BE_BOM, utf32(codePoints, false)));
    expect(result.text).toBe("café");
    expect(result.encoding).toBe("utf-32be");
  });

  it("removes only the mark itself, leaving a second one in the content", () => {
    const result = decodeText(bytesOf(UTF8_BOM, UTF8_BOM));
    expect(result.text).toBe("\ufeff");
    expect(result.encoding).toBe("utf-8");
    expect(result.source).toBe("bom");
  });

  it("refuses binary that happens to begin with a UTF-16 mark", () => {
    // A mark says which encoding, not that what follows is text. Under the previous UTF-8-only boundary these bytes were refused for not being UTF-8 at all; they must still be refused, rather than decoding into a page of control characters.
    const bytes = bytesOf(
      UTF16LE_BOM,
      Array.from({ length: 80 }, (_unused, index) =>
        index % 2 === 0 ? 0x07 : 0x00,
      ),
    );
    expect(refusal(bytes).reason).toBe("binary");
  });

  it("does not take a partial match for a mark", () => {
    const result = decodeText(bytesOf([0xef, 0x41, 0x42]));
    expect(result.text).toBe("ïAB");
    expect(result.encoding).toBe("windows-1252");
    expect(result.source).toBe("detected");
  });
});

describe("decodeText UTF-8", () => {
  it("reports pure ASCII as certain, since every supported encoding agrees on it", () => {
    const result = decodeText(bytesOf(utf8("name,total\r\nwidget,3\r\n")));
    expect(result).toEqual({
      text: "name,total\r\nwidget,3\r\n",
      encoding: "utf-8",
      source: "utf8",
      confidence: "certain",
      warnings: [],
    });
  });

  it("reports multi-byte UTF-8 as high rather than certain", () => {
    const result = decodeText(bytesOf(utf8("café 你好")));
    expect(result.text).toBe("café 你好");
    expect(result.encoding).toBe("utf-8");
    expect(result.source).toBe("utf8");
    expect(result.confidence).toBe("high");
    expect(result.warnings).toEqual([]);
  });

  it("decodes empty input as empty UTF-8 text", () => {
    expect(decodeText(new Uint8Array(0))).toEqual({
      text: "",
      encoding: "utf-8",
      source: "utf8",
      confidence: "certain",
      warnings: [],
    });
  });

  it("decodes a csv whose line endings outnumber one per 64 bytes", () => {
    const rows = Array.from({ length: 40 }, (_unused, row) => `r${row},${row}`);
    const csv = `${rows.join("\n")}\n`;
    const result = decodeText(bytesOf(utf8(csv)));
    expect(result.text).toBe(csv);
    expect(result.encoding).toBe("utf-8");
  });
});

describe("decodeText windows-1252", () => {
  it("decodes the four bytes of a windows-1252 cafe as a guess, with a warning", () => {
    const result = decodeText(bytesOf(windows1252("café")));
    expect(result).toEqual({
      text: "café",
      encoding: "windows-1252",
      source: "detected",
      confidence: "low",
      warnings: [
        "encoding was guessed as windows-1252: the bytes carry no byte order mark, are not well-formed UTF-8, and read as Western text. Pass an explicit encoding if that is wrong.",
      ],
    });
  });

  it("decodes a French staff list", () => {
    const list = "Nom,Rôle\nBenoît,Gérant\nCécile,Assistante\n";
    const bytes = bytesOf(
      Array.from(list, (character) => {
        const accents: ReadonlyMap<string, number> = new Map([
          ["ô", 0xf4],
          ["î", 0xee],
          ["é", 0xe9],
        ]);
        return accents.get(character) ?? character.charCodeAt(0);
      }),
    );
    const result = decodeText(bytes);
    expect(result.text).toBe(list);
    expect(result.encoding).toBe("windows-1252");
  });

  it("decodes a column of German surnames", () => {
    const column = "Müller\nSchäfer\nGötz\nWeiß\n";
    const result = decodeText(bytesOf(windows1252(column)));
    expect(result.text).toBe(column);
    expect(result.encoding).toBe("windows-1252");
    expect(result.confidence).toBe("low");
  });

  it("decodes the 0x80 to 0x9F range as windows-1252 rather than as Latin-1 controls", () => {
    const result = decodeText(bytesOf([0x41, 0x80, 0x42, 0x92, 0x43, 0x9f]));
    expect(result.text).toBe("A€B’CŸ");
    expect(result.encoding).toBe("windows-1252");
  });

  it("decodes every byte exactly as a platform windows-1252 decoder does", () => {
    const platform = new TextDecoder("windows-1252");
    for (let byte = 0x00; byte <= 0xff; byte += 1) {
      const bytes = Uint8Array.of(byte);
      expect(
        decodeText(bytes, { encoding: "windows-1252" }).text,
        `byte 0x${byte.toString(16)}`,
      ).toBe(platform.decode(bytes));
    }
  });

  it("refuses bytes windows-1252 leaves without a character", () => {
    for (const undefinedByte of [0x81, 0x8d, 0x8f, 0x90, 0x9d]) {
      const error = refusal(bytesOf([0x41, undefinedByte, 0x42]));
      expect(error.reason).toBe("unrecognised");
    }
  });

  it("accepts a run of four bytes above ASCII but refuses five", () => {
    expect(decodeText(bytesOf([0x41, 0xe9, 0xe8, 0xe7, 0xe0, 0x42])).text).toBe(
      "AéèçàB",
    );
    const error = refusal(bytesOf([0x41, 0xe9, 0xe8, 0xe7, 0xe0, 0xe4, 0x42]));
    expect(error.reason).toBe("unrecognised");
    expect(error.message).toBe(
      "bytes are text but match none of the supported encodings: not UTF-8, and not plausible as windows-1252",
    );
  });

  it("refuses a run of bytes at the very start of the high range", () => {
    expect(refusal(bytesOf([0x80, 0x80, 0x80, 0x80, 0x80])).reason).toBe(
      "unrecognised",
    );
  });

  it("guesses windows-1252 for a truncated UTF-8 sequence, which is indistinguishable from it", () => {
    const result = decodeText(bytesOf(utf8("Hello"), [0xe2, 0x82]));
    expect(result.text).toBe("Helloâ‚");
    expect(result.encoding).toBe("windows-1252");
    expect(result.confidence).toBe("low");
    expect(result.warnings).toHaveLength(1);
  });
});

describe("decodeText UTF-16 without a byte order mark", () => {
  it("detects UTF-16LE from the NUL interleave, as a guess", () => {
    const result = decodeText(bytesOf(utf16("name,total\n", true)));
    expect(result).toEqual({
      text: "name,total\n",
      encoding: "utf-16le",
      source: "detected",
      confidence: "low",
      warnings: [
        "encoding was guessed as utf-16le: the bytes carry no byte order mark, but interleave NUL bytes in the pattern UTF-16 gives Latin-script text. Pass an explicit encoding if that is wrong.",
      ],
    });
  });

  it("detects UTF-16BE from the mirrored interleave", () => {
    const result = decodeText(bytesOf(utf16("name,total\n", false)));
    expect(result.text).toBe("name,total\n");
    expect(result.encoding).toBe("utf-16be");
    expect(result.source).toBe("detected");
    expect(result.warnings).toEqual([
      "encoding was guessed as utf-16be: the bytes carry no byte order mark, but interleave NUL bytes in the pattern UTF-16 gives Latin-script text. Pass an explicit encoding if that is wrong.",
    ]);
  });

  it("refuses binary whose NUL interleave imitates Latin-script UTF-16", () => {
    // A compound-file document ([MS-CFB], which is what a .doc, .xls or .ppt is) spells its directory entry names in UTF-16 and pads with NULs, so its bytes carry the same odd-versus-even NUL imbalance real UTF-16 text does. Reading it as UTF-16 succeeds and yields a run of C0 control characters, which is what tells the two apart: the guess is judged on the characters it produced, not on the bytes it came from.
    const units = Array.from({ length: 64 }, (_unused, unit) =>
      unit % 16 === 0 ? [0x61, 0x00] : [0x01, 0x00],
    ).flat();
    const bytes = bytesOf(units);
    const asUtf16 = decodeText(bytes, { encoding: "utf-16le" });
    expect(asUtf16.text.startsWith("a\u0001")).toBe(true);
    expect(refusal(bytes).reason).toBe("binary");
  });

  it("refuses bytes whose NUL interleave is there but which do not decode as UTF-16 at all", () => {
    // Three quarters of the units are ASCII with a NUL high byte, enough for the interleave to fire, and the rest are lone high surrogates, which makes the UTF-16 reading malformed rather than merely unconvincing. The answer is still that these bytes are binary, since the NULs that produced the guess are exactly what the byte-level check refuses.
    const units = Array.from({ length: 40 }, (_unused, unit) =>
      unit % 4 === 3 ? [0x00, 0xd8] : [0x61, 0x00],
    ).flat();
    expect(refusal(bytesOf(units)).reason).toBe("binary");
  });

  it("refuses bytes whose NUL interleave covers only half the code units", () => {
    const halfAscii = bytesOf([0x61, 0x00, 0x62, 0x00, 0x42, 0x30, 0x44, 0x30]);
    expect(refusal(halfAscii).reason).toBe("binary");
  });

  it("refuses mirrored bytes whose NUL interleave covers only half the code units", () => {
    const halfAscii = bytesOf([0x00, 0x61, 0x00, 0x62, 0x30, 0x42, 0x30, 0x44]);
    expect(refusal(halfAscii).reason).toBe("binary");
  });

  it("refuses bytes carrying NULs on both sides of the unit boundary", () => {
    expect(refusal(new Uint8Array(16)).reason).toBe("binary");
  });

  it("does not read an odd number of bytes as UTF-16, refusing them as binary instead", () => {
    expect(refusal(bytesOf([0x61, 0x00, 0x62, 0x00, 0x63])).reason).toBe(
      "binary",
    );
  });
});

describe("decodeText binary refusal", () => {
  it("refuses a PNG header", () => {
    const error = refusal(
      bytesOf([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(error.reason).toBe("binary");
    expect(error.message).toBe(
      "bytes are not text: they carry a NUL byte, or too many other C0 control bytes for any text encoding",
    );
  });

  it("refuses a zip local file header", () => {
    expect(
      refusal(bytesOf([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x08, 0x00])).reason,
    ).toBe("binary");
  });

  it("refuses a PDF whose header is followed by stream bytes", () => {
    const pdf = bytesOf(
      utf8("%PDF-1.7\n"),
      [0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a],
      utf8("1 0 obj\n<< /Length 6 >>\nstream\n"),
      [0x78, 0x9c, 0x00, 0x03, 0x01, 0x00],
      utf8("\nendstream\n"),
    );
    expect(refusal(pdf).reason).toBe("binary");
  });

  it("refuses a run of NUL bytes", () => {
    expect(refusal(bytesOf(utf8("hello"), [0x00, 0x00, 0x00])).reason).toBe(
      "binary",
    );
  });

  it("refuses bytes carrying more than one stray control byte per 64", () => {
    const filler = Array.from({ length: 62 }, () => 0x41);
    expect(refusal(bytesOf([0x1b, 0x1b], filler)).reason).toBe("binary");
  });

  it("accepts bytes carrying exactly one stray control byte per 64", () => {
    const filler = Array.from({ length: 63 }, () => 0x41);
    const result = decodeText(bytesOf([0x1b], filler));
    expect(result.encoding).toBe("utf-8");
    expect(result.text.startsWith("\u001b")).toBe(true);
  });

  it("refuses a single NUL among otherwise ordinary text, below the control-byte density", () => {
    const filler = Array.from({ length: 63 }, () => 0x41);
    const withOneNul = bytesOf(filler.slice(0, 31), [0x00], filler.slice(31));
    expect(withOneNul.length).toBe(64);
    expect(refusal(withOneNul).reason).toBe("binary");
  });

  it("refuses pseudo-random bytes", () => {
    // A fixed linear congruential sequence rather than Math.random, so the same bytes are judged on every run.
    let state = 1;
    const random = Array.from({ length: 512 }, () => {
      state = (state * 25173 + 13849) % 65536;
      return (state >> 8) % 256;
    });
    expect(refusal(bytesOf(random)).reason).toBe("binary");
  });
});

describe("decodeText with a declared encoding", () => {
  it("decodes under the declared encoding without consulting detection", () => {
    const result = decodeText(bytesOf(windows1252("café")), {
      encoding: "windows-1252",
    });
    expect(result).toEqual({
      text: "café",
      encoding: "windows-1252",
      source: "declared",
      confidence: "certain",
      warnings: [],
    });
  });

  it("reads UTF-8 bytes under a declared windows-1252 exactly as asked", () => {
    const result = decodeText(bytesOf(utf8("café")), {
      encoding: "windows-1252",
    });
    expect(result.text).toBe("cafÃ©");
    expect(result.source).toBe("declared");
  });

  it("overrides a detection that would otherwise have guessed UTF-16LE", () => {
    const result = decodeText(bytesOf(utf16("ab", true)), {
      encoding: "windows-1252",
    });
    expect(result.text).toBe("a\u0000b\u0000");
    expect(result.encoding).toBe("windows-1252");
  });

  it("removes a mark belonging to the declared encoding", () => {
    const result = decodeText(bytesOf(UTF16LE_BOM, utf16("hi", true)), {
      encoding: "utf-16le",
    });
    expect(result.text).toBe("hi");
  });

  it("keeps a mark belonging to a different encoding as content", () => {
    const result = decodeText(bytesOf(UTF8_BOM, utf8("hi")), {
      encoding: "windows-1252",
    });
    expect(result.text).toBe("ï»¿hi");
  });

  it("refuses bytes that contradict a declared UTF-8", () => {
    const error = refusal(bytesOf(windows1252("café")), {
      encoding: "utf-8",
    });
    expect(error.reason).toBe("malformed");
    expect(error.message).toBe(
      "UTF-8 text must hold only well-formed byte sequences",
    );
  });

  it("refuses an odd byte count under a declared UTF-16", () => {
    const error = refusal(bytesOf([0x61, 0x00, 0x62]), {
      encoding: "utf-16le",
    });
    expect(error.reason).toBe("malformed");
    expect(error.message).toBe(
      "UTF-16 text must hold a whole number of 16-bit code units",
    );
  });

  it("refuses a byte count that is not a whole number of UTF-32 code units", () => {
    const error = refusal(bytesOf([0x61, 0x00, 0x00]), {
      encoding: "utf-32le",
    });
    expect(error.reason).toBe("malformed");
    expect(error.message).toBe(
      "UTF-32 text must hold a whole number of 32-bit code units",
    );
  });
});

describe("decodeText surrogates", () => {
  it.each<[string, number]>([
    ["the first supplementary code point", 0x10000],
    ["a code point whose low half sits at the end of its range", 0x103ff],
    ["the last code point Unicode defines", 0x10ffff],
  ])("round-trips %s through UTF-16", (_name, codePoint) => {
    const text = String.fromCodePoint(codePoint);
    expect(decodeText(bytesOf(UTF16LE_BOM, utf16(text, true))).text).toBe(text);
    expect(decodeText(bytesOf(UTF16BE_BOM, utf16(text, false))).text).toBe(
      text,
    );
  });

  it("decodes a code unit just above the surrogate range as an ordinary character", () => {
    const text = "a\ue000b\uffff";
    expect(decodeText(bytesOf(UTF16LE_BOM, utf16(text, true))).text).toBe(text);
  });

  it("refuses a high surrogate whose partner never arrives", () => {
    const error = refusal(bytesOf(UTF16LE_BOM, [0x3d, 0xd8, 0x61, 0x00]));
    expect(error.reason).toBe("malformed");
    expect(error.message).toBe(
      "UTF-16 text must pair every surrogate half with its partner",
    );
  });

  it("refuses a low surrogate with nothing before it", () => {
    expect(
      refusal(bytesOf(UTF16LE_BOM, [0x00, 0xdc, 0x61, 0x00])).message,
    ).toBe("UTF-16 text must pair every surrogate half with its partner");
  });

  it("refuses a high surrogate at the very end of the text", () => {
    const error = refusal(bytesOf(UTF16LE_BOM, [0x61, 0x00, 0x3d, 0xd8]));
    expect(error.reason).toBe("malformed");
    expect(error.message).toBe(
      "UTF-16 text must pair every surrogate half with its partner",
    );
  });

  it.each<[string, number]>([
    ["a high surrogate", 0xd800],
    ["a low surrogate", 0xdfff],
    ["a value above the last code point", 0x110000],
  ])("refuses %s as a UTF-32 code unit", (_name, value) => {
    const error = refusal(bytesOf(UTF32LE_BOM, utf32([value], true)));
    expect(error.reason).toBe("malformed");
    expect(error.message).toBe(
      "UTF-32 text must hold only Unicode scalar values",
    );
  });

  it.each<[string, number]>([
    ["the last code point below the supplementary planes", 0xffff],
    ["the first supplementary code point", 0x10000],
    ["the last code point Unicode defines", 0x10ffff],
  ])("round-trips %s through UTF-32", (_name, codePoint) => {
    const text = String.fromCodePoint(codePoint);
    expect(
      decodeText(bytesOf(UTF32LE_BOM, utf32([codePoint], true))).text,
    ).toBe(text);
    expect(
      decodeText(bytesOf(UTF32BE_BOM, utf32([codePoint], false))).text,
    ).toBe(text);
  });
});

describe("decodeText over long input", () => {
  it("decodes text longer than one conversion chunk", () => {
    const text = "a".repeat(TEXT_DECODE_CHUNK_CODE_UNITS * 2 + 7);
    const result = decodeText(bytesOf(UTF16LE_BOM, utf16(text, true)));
    expect(result.text).toBe(text);
  });
});

describe("decodeText round trip across every supported encoding", () => {
  const westernSamples = [
    "",
    "plain ascii, 123",
    "café",
    "Müller;Schäfer;Weiß",
    "line one\nline two\r\n",
  ];

  it.each(westernSamples)(
    "round-trips %j through windows-1252 when declared",
    (sample) => {
      const result = decodeText(bytesOf(windows1252(sample)), {
        encoding: "windows-1252",
      });
      expect(result.text).toBe(sample);
    },
  );

  it.each(westernSamples)("round-trips %j through marked UTF-8", (sample) => {
    expect(decodeText(bytesOf(UTF8_BOM, utf8(sample))).text).toBe(sample);
  });

  it.each(westernSamples)("round-trips %j through marked UTF-16", (sample) => {
    expect(decodeText(bytesOf(UTF16LE_BOM, utf16(sample, true))).text).toBe(
      sample,
    );
    expect(decodeText(bytesOf(UTF16BE_BOM, utf16(sample, false))).text).toBe(
      sample,
    );
  });

  it.each(westernSamples)(
    "detects the encoding of %j without a mark and recovers the same text",
    (sample) => {
      for (const bytes of [
        bytesOf(utf8(sample)),
        bytesOf(windows1252(sample)),
      ]) {
        const result = decodeText(bytes);
        expect(result.text).toBe(sample);
        expect(result.warnings.length).toBe(
          result.confidence === "low" ? 1 : 0,
        );
      }
    },
  );
});

describe("isProbablyText", () => {
  it("accepts ordinary text and its own line endings", () => {
    expect(isProbablyText(bytesOf(utf8("a\tb\r\nc\u000cd")))).toBe(true);
  });

  it("accepts empty input", () => {
    expect(isProbablyText(new Uint8Array(0))).toBe(true);
  });

  it("rejects a NUL byte anywhere", () => {
    expect(isProbablyText(bytesOf(utf8("hello"), [0x00]))).toBe(false);
  });

  it("rejects a single NUL even where the control-byte density alone would pass", () => {
    const filler = Array.from({ length: 63 }, () => 0x41);
    expect(isProbablyText(bytesOf([0x00], filler))).toBe(false);
  });

  it("rejects a density of other C0 control bytes", () => {
    expect(isProbablyText(bytesOf([0x1b, 0x1b, 0x41, 0x41]))).toBe(false);
  });

  it("is not consulted for a mark-less UTF-16 guess, whose own bytes it always rejects", () => {
    const markless = bytesOf(utf16("hello", true));
    expect(isProbablyText(markless)).toBe(false);
    expect(decodeText(markless).encoding).toBe("utf-16le");
  });

  it("accepts bytes above ASCII, which say nothing about whether the content is text", () => {
    expect(isProbablyText(bytesOf([0xe9, 0xff, 0x80]))).toBe(true);
  });
});

describe("tryDecodeText", () => {
  it("returns what decodeText returns for bytes it accepts", () => {
    expect(tryDecodeText(bytesOf(utf8("hello")))).toEqual(
      decodeText(bytesOf(utf8("hello"))),
    );
  });

  it("returns undefined instead of throwing for bytes it refuses", () => {
    expect(tryDecodeText(bytesOf([0x89, 0x50, 0x4e, 0x47, 0x00]))).toBe(
      undefined,
    );
  });

  it("passes a declared encoding through", () => {
    expect(
      tryDecodeText(bytesOf(windows1252("café")), {
        encoding: "windows-1252",
      })?.encoding,
    ).toBe("windows-1252");
  });
});

describe("UndecodableTextError", () => {
  it("carries its own name and the reason it was thrown", () => {
    const error = refusal(bytesOf([0x00]));
    expect(error.name).toBe("UndecodableTextError");
    expect(error).toBeInstanceOf(Error);
    expect(error.reason).toBe("binary");
  });
});

describe("detectByteOrderMark", () => {
  it("reports each of the five marks decodeText itself recognises, with its own length", () => {
    expect(
      detectByteOrderMark(bytesOf(UTF32BE_BOM, utf32([0x41], false))),
    ).toEqual({ encoding: "utf-32be", length: 4 });
    expect(
      detectByteOrderMark(bytesOf(UTF32LE_BOM, utf32([0x41], true))),
    ).toEqual({ encoding: "utf-32le", length: 4 });
    expect(detectByteOrderMark(bytesOf(UTF8_BOM, utf8("a")))).toEqual({
      encoding: "utf-8",
      length: 3,
    });
    expect(
      detectByteOrderMark(bytesOf(UTF16BE_BOM, utf16("a", false))),
    ).toEqual({ encoding: "utf-16be", length: 2 });
    expect(detectByteOrderMark(bytesOf(UTF16LE_BOM, utf16("a", true)))).toEqual(
      { encoding: "utf-16le", length: 2 },
    );
  });

  it("returns undefined for bytes carrying no mark", () => {
    expect(detectByteOrderMark(bytesOf(utf8("hello")))).toBe(undefined);
    expect(detectByteOrderMark(new Uint8Array())).toBe(undefined);
  });

  it("prefers the four-byte UTF-32LE mark over the UTF-16LE mark it begins with, exactly as decodeText's own detection does", () => {
    expect(detectByteOrderMark(bytesOf(UTF32LE_BOM))?.encoding).toBe(
      "utf-32le",
    );
  });
});
