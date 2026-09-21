import { describe, expect, it } from "vitest";
import { decodeText, type TextEncodingLabel } from "./decode";
import { resolveEncodingLabel } from "./labels";
import { LEGACY_SINGLE_BYTE_TABLES } from "./legacy-single-byte-tables";

const EVERY_SUPPORTED_ENCODING = [
  ...(Object.keys(LEGACY_SINGLE_BYTE_TABLES) as TextEncodingLabel[]),
  "windows-1252",
  "utf-8",
  "utf-16le",
  "utf-16be",
  "utf-32le",
  "utf-32be",
] as const satisfies readonly TextEncodingLabel[];

describe("resolveEncodingLabel", () => {
  it("resolves every supported encoding's own canonical name to itself", () => {
    for (const encoding of EVERY_SUPPORTED_ENCODING) {
      expect(resolveEncodingLabel(encoding), encoding).toBe(encoding);
    }
  });

  it("resolves ISO-8859-1 to windows-1252, as the Encoding Standard defines", () => {
    // Not an approximation: the standard maps this label onto windows-1252, which is why every browser reads a document declaring ISO-8859-1 that way. A file that says ISO-8859-1 and uses 0x93 for a curly quote decodes the way its author meant.
    for (const label of ["iso-8859-1", "ISO-8859-1", "latin1", "l1", "ascii"]) {
      expect(resolveEncodingLabel(label), label).toBe("windows-1252");
    }
  });

  it("ignores case and surrounding whitespace", () => {
    expect(resolveEncodingLabel("  UTF-8 ")).toBe("utf-8");
    expect(resolveEncodingLabel("Windows-1251")).toBe("windows-1251");
    expect(resolveEncodingLabel("\tKOI8-R\n")).toBe("koi8-r");
  });

  it("resolves the alternative spellings documents actually use", () => {
    expect(resolveEncodingLabel("cp1251")).toBe("windows-1251");
    expect(resolveEncodingLabel("greek")).toBe("iso-8859-7");
    expect(resolveEncodingLabel("cyrillic")).toBe("iso-8859-5");
    expect(resolveEncodingLabel("866")).toBe("ibm866");
    expect(resolveEncodingLabel("ucs-2")).toBe("utf-16le");
  });

  it("resolves a legacy multi-byte encoding to nothing rather than to something close", () => {
    // These are real encodings decodeText cannot decode. Returning undefined lets a caller say so precisely, where returning an approximation would corrupt the text silently.
    for (const label of [
      "shift_jis",
      "sjis",
      "gbk",
      "gb18030",
      "big5",
      "euc-jp",
      "euc-kr",
      "iso-2022-jp",
    ]) {
      expect(resolveEncodingLabel(label), label).toBe(undefined);
    }
  });

  it("resolves an unrecognised name to nothing", () => {
    expect(resolveEncodingLabel("")).toBe(undefined);
    expect(resolveEncodingLabel("not-an-encoding")).toBe(undefined);
  });

  it("hands decodeText something it can decode under", () => {
    // The point of the pair: a document declares a name, this turns it into an encoding, and decodeText uses it.
    const declared = resolveEncodingLabel("ISO-8859-1");
    expect(declared).toBeDefined();
    if (declared === undefined) {
      return;
    }
    const bytes = Uint8Array.of(0x43, 0x61, 0x66, 0xe9);
    expect(decodeText(bytes, { encoding: declared }).text).toBe("Café");
  });
});
