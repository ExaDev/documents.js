import { describe, expect, it } from "vitest";
import { documentTreeWithSchema } from "document-schema.js";
import {
  paragraph,
  sectionGroup,
  wordprocessingPackage,
} from "../test-support/fixtures";
import {
  canonicalise,
  sha256,
  stableContentHash,
  writeBitLength,
} from "./hash";

// The SHA-256 implementation is pinned against the specification's own published digests (FIPS 180-4 example vectors): the empty string exercises the single-block padding, 'abc' a short message, and the 55-character string forces exactly two padded blocks with the length word in the second -- the padding edge a hand-rolled implementation most easily gets wrong.
describe("sha256", () => {
  const digest = (text: string): string => {
    const bytes = new TextEncoder().encode(text);
    return Array.from(sha256(bytes), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  };

  it("matches the FIPS 180-4 vectors", () => {
    expect(digest("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(digest("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(
      digest("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
    ).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  });
});

describe("writeBitLength", () => {
  // The high 32 bits only become nonzero once bitLength reaches 2^32 (a ~512 MiB message no unit test can afford to actually hash), so this is exercised directly against a synthetic bitLength rather than a real byte array reaching that size.
  it("writes the high and low 32 bits of a 64-bit big-endian bit length", () => {
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    const bitLength = 4294967296 * 3 + 123; // 3 full 2^32 wraps plus a low remainder
    writeBitLength(view, 0, bitLength);
    expect(view.getUint32(0)).toBe(3);
    expect(view.getUint32(4)).toBe(123);
  });

  it("writes zero into the high 32 bits for any realistic (sub-2^32) bit length", () => {
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    writeBitLength(view, 0, 512);
    expect(view.getUint32(0)).toBe(0);
    expect(view.getUint32(4)).toBe(512);
  });
});

describe("stableContentHash", () => {
  it("is order-insensitive over object keys at any depth", () => {
    expect(stableContentHash({ a: 1, b: { c: 2, d: 3 } })).toBe(
      stableContentHash({ b: { d: 3, c: 2 }, a: 1 }),
    );
  });

  it("excludes $schema keys at any depth: a hash names the content, not the release label", () => {
    expect(
      stableContentHash({
        $schema: "https://example.test/package-4.0.0.json",
        a: 1,
      }),
    ).toBe(stableContentHash({ a: 1 }));
    expect(
      stableContentHash({
        a: { $schema: "https://example.test/package-4.0.0.json", b: 1 },
      }),
    ).toBe(stableContentHash({ a: { b: 1 } }));
    // Only the label key is excluded -- a field merely named similarly still counts as content.
    expect(stableContentHash({ schema: "x" })).not.toBe(stableContentHash({}));
  });

  it("hashes a serialised package identically with and without its $schema envelope label", () => {
    // documentTreeWithSchema is the schema's own serialisation helper: it stamps the release-pinned $schema URI onto a package. The same package, serialised against two different schema releases, must hash equal -- the exact reserialisation case the strip exists for.
    const pkg = wordprocessingPackage([sectionGroup([paragraph("body")])]);
    expect(stableContentHash(documentTreeWithSchema(pkg))).toBe(
      stableContentHash(pkg),
    );
  });

  it("never mutates its input, $schema keys included", () => {
    const value = {
      $schema: "https://example.test/package-4.0.0.json",
      a: { $schema: "x", b: 1 },
    };
    stableContentHash(value);
    expect(value).toEqual({
      $schema: "https://example.test/package-4.0.0.json",
      a: { $schema: "x", b: 1 },
    });
  });
});

describe("canonicalise", () => {
  it("sorts keys ascending by UTF-16 code unit and preserves array order", () => {
    expect(canonicalise({ b: 2, a: 1 })).toEqual({ a: 1, b: 2 });
    const nested = { z: [{ y: 1, x: 2 }] };
    expect(canonicalise(nested)).toEqual({ z: [{ x: 2, y: 1 }] });
    expect(canonicalise([3, 1, 2])).toEqual([3, 1, 2]);
  });

  // isRecord's own `value !== null` guard: typeof null === "object", so without this guard canonicalise's isRecord branch would be taken for null and Object.keys(null) would throw. A bare null and a null nested inside a record both have to pass through untouched rather than being treated as a record.
  it("passes a bare null through untouched rather than treating it as a record", () => {
    expect(canonicalise(null)).toBeNull();
    expect(canonicalise({ a: null })).toEqual({ a: null });
  });
});
