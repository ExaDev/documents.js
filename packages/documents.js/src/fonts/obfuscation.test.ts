import { describe, expect, it } from "vitest";
import { parseSfnt } from "pdf-codec/sfnt";
import {
  caladeaRegularBytes,
  obfuscateFontBytes,
  SPEC_FONT_KEY_BYTES,
  SPEC_FONT_KEY_GUID,
} from "../test-support/fonts";
import {
  deobfuscateEmbeddedFont,
  deriveFontKey,
  FontDeobfuscationError,
  looksLikeSfnt,
} from "./obfuscation";

// The sfnt version tags parseSfnt accepts, as the four leading bytes each one writes.
const SFNT_SIGNATURES: Readonly<Record<string, readonly number[]>> = {
  truetype: [0x00, 0x01, 0x00, 0x00],
  true: [0x74, 0x72, 0x75, 0x65],
  typ1: [0x74, 0x79, 0x70, 0x31],
  OTTO: [0x4f, 0x54, 0x54, 0x4f],
};

// A TrueType Collection, which looksLikeSfnt deliberately does NOT accept -- see its own comment for why the accepted set is exactly what pdf-codec can build a face from rather than every tag the sfnt container permits.
const TTCF_SIGNATURE: readonly number[] = [0x74, 0x74, 0x63, 0x66];

// A 12-byte sfnt table directory header with zero tables, prefixed by the given signature -- the smallest thing parseSfnt accepts, for exercising the signature sniff without dragging a real font in.
function sfntHeader(signature: readonly number[]): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(64);
  bytes.set(signature, 0);
  return bytes;
}

describe("deriveFontKey", () => {
  // The one genuinely non-obvious step in ECMA-376 Part 4, 2.8.1, and the only part of this module with an authoritative worked example to check against: the 32 hex digits are read as byte pairs in REVERSE order, so the key's first byte is the GUID string's LAST hex pair.
  it("reproduces the ECMA-376 Part 4 2.8.1 worked example exactly", () => {
    expect([...deriveFontKey(SPEC_FONT_KEY_GUID)]).toEqual([
      ...SPEC_FONT_KEY_BYTES,
    ]);
  });

  it("accepts the same GUID without braces", () => {
    expect([...deriveFontKey("001B70DC-AA60-4AD5-90EC-18A0948E1EAE")]).toEqual([
      ...SPEC_FONT_KEY_BYTES,
    ]);
  });

  it("accepts lowercase hex digits", () => {
    expect([
      ...deriveFontKey("{001b70dc-aa60-4ad5-90ec-18a0948e1eae}"),
    ]).toEqual([...SPEC_FONT_KEY_BYTES]);
  });

  // The reverse-pair rule is the whole point: a straight forward-order read of the same GUID gives a completely different key, so a test that only checked "16 bytes came back" would pass on a wrong implementation.
  it("does not produce the GUID hex digits in written order", () => {
    const forwardOrder = [
      0x00, 0x1b, 0x70, 0xdc, 0xaa, 0x60, 0x4a, 0xd5, 0x90, 0xec, 0x18, 0xa0,
      0x94, 0x8e, 0x1e, 0xae,
    ];
    expect([...deriveFontKey(SPEC_FONT_KEY_GUID)]).not.toEqual(forwardOrder);
  });

  it("throws for a GUID with the wrong number of hex digits", () => {
    expect(() => deriveFontKey("{001B70DC-AA60-4AD5-90EC-18A0948E1E}")).toThrow(
      FontDeobfuscationError,
    );
  });

  it("throws for a GUID containing a non-hexadecimal pair", () => {
    expect(() =>
      deriveFontKey("{001B70DC-AA60-4AD5-90EC-18A0948E1EAZ}"),
    ).toThrow(FontDeobfuscationError);
  });
});

describe("looksLikeSfnt", () => {
  it.each(Object.entries(SFNT_SIGNATURES))(
    "accepts the %s signature",
    (_name, signature) => {
      expect(looksLikeSfnt(sfntHeader(signature))).toBe(true);
    },
  );

  it("rejects a TrueType Collection, which pdf-codec cannot build a face from", () => {
    expect(looksLikeSfnt(sfntHeader(TTCF_SIGNATURE))).toBe(false);
  });

  it("accepts a real font", () => {
    expect(looksLikeSfnt(caladeaRegularBytes())).toBe(true);
  });

  it("rejects an obfuscated font", () => {
    expect(
      looksLikeSfnt(
        obfuscateFontBytes(caladeaRegularBytes(), SPEC_FONT_KEY_BYTES),
      ),
    ).toBe(false);
  });

  it("rejects bytes too short to carry a table directory header", () => {
    expect(looksLikeSfnt(new Uint8Array([0x00, 0x01, 0x00, 0x00]))).toBe(false);
  });
});

describe("deobfuscateEmbeddedFont", () => {
  // The end-to-end claim this module exists to make: bytes obfuscated with the specification's own literal key bytes come back byte-identical when deobfuscated with the GUID those bytes were quoted for. The fixture never calls deriveFontKey, so this fails outright if the derivation is wrong -- the recovered prefix would be noise and the sfnt check would reject it.
  it("recovers a real font from bytes obfuscated with the specification worked-example key", () => {
    const original = caladeaRegularBytes();
    const recovered = deobfuscateEmbeddedFont(
      obfuscateFontBytes(original, SPEC_FONT_KEY_BYTES),
      SPEC_FONT_KEY_GUID,
    );
    expect([...recovered.subarray(0, 4)]).toEqual([0x00, 0x01, 0x00, 0x00]);
    expect(parseSfnt(recovered)?.tables.has("glyf")).toBe(true);
    expect(recovered).toEqual(original);
  });

  it("leaves every byte past the 32-byte obfuscated prefix untouched", () => {
    const original = caladeaRegularBytes();
    const obfuscated = obfuscateFontBytes(original, SPEC_FONT_KEY_BYTES);
    expect(obfuscated.subarray(32)).toEqual(original.subarray(32));
    expect(obfuscated.subarray(0, 32)).not.toEqual(original.subarray(0, 32));
  });

  // The pptx half of the sniff: an unobfuscated part with no font key at all is returned as-is rather than treated as an error.
  it("returns already-clear bytes unchanged when no font key is given", () => {
    const original = caladeaRegularBytes();
    expect(deobfuscateEmbeddedFont(original, undefined)).toBe(original);
  });

  // A docx producer that stored a clear part while still writing a font key must not have that key applied to bytes that were never obfuscated.
  it("returns already-clear bytes unchanged even when a font key is given", () => {
    const original = caladeaRegularBytes();
    expect(deobfuscateEmbeddedFont(original, SPEC_FONT_KEY_GUID)).toBe(
      original,
    );
  });

  it("does not mutate the input bytes", () => {
    const obfuscated = obfuscateFontBytes(
      caladeaRegularBytes(),
      SPEC_FONT_KEY_BYTES,
    );
    const before = new Uint8Array(obfuscated);
    deobfuscateEmbeddedFont(obfuscated, SPEC_FONT_KEY_GUID);
    expect(obfuscated).toEqual(before);
  });

  it("throws for obfuscated bytes with no font key to undo them with", () => {
    expect(() =>
      deobfuscateEmbeddedFont(
        obfuscateFontBytes(caladeaRegularBytes(), SPEC_FONT_KEY_BYTES),
        undefined,
      ),
    ).toThrow(FontDeobfuscationError);
  });

  // The wrong-key case is what makes the whole scheme self-checking: a key that does not belong to these bytes cannot produce a valid signature, so it is caught rather than handed back as 32 bytes of noise followed by real font data.
  it("throws when deobfuscating with the wrong key", () => {
    const obfuscated = obfuscateFontBytes(
      caladeaRegularBytes(),
      SPEC_FONT_KEY_BYTES,
    );
    expect(() =>
      deobfuscateEmbeddedFont(
        obfuscated,
        "{FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF}",
      ),
    ).toThrow(FontDeobfuscationError);
  });

  it("throws for a part shorter than the 32-byte obfuscated prefix", () => {
    expect(() =>
      deobfuscateEmbeddedFont(new Uint8Array(16), SPEC_FONT_KEY_GUID),
    ).toThrow(FontDeobfuscationError);
  });
});
