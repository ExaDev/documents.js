import { describe, expect, it } from "vitest";
import { decodeEntities, encodeEntities } from "./entities";

describe("decodeEntities", () => {
  it("decodes the five standard XML entities", () => {
    expect(decodeEntities("&amp;&lt;&gt;&quot;&apos;")).toBe("&<>\"'");
  });

  it("decodes a decimal numeric character reference", () => {
    expect(decodeEntities("caf&#233; &amp; tea")).toBe("caf\u00e9 & tea");
  });

  it("decodes a hexadecimal numeric character reference, case-insensitively", () => {
    expect(decodeEntities("em&#x2014;dash and &#X2014;dash")).toBe(
      "em\u2014dash and \u2014dash",
    );
  });

  it("decodes HTML named entities beyond the five XML defines", () => {
    // \u00a0 is a real non-breaking space, not a plain U+0020 -- confirms the decode, not merely something that renders the same.
    expect(decodeEntities("a&nbsp;b")).toBe("a\u00a0b");
    expect(decodeEntities("&mdash;")).toBe("\u2014");
    expect(decodeEntities("&copy; 2026")).toBe("\u00a9 2026");
  });

  it("leaves plain text and a genuinely unrecognised entity untouched", () => {
    expect(decodeEntities("plain text &qwertyzzznonexistent; here")).toBe(
      "plain text &qwertyzzznonexistent; here",
    );
  });
});

describe("encodeEntities", () => {
  it("escapes the five standard XML entities, ampersand first", () => {
    expect(encodeEntities(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&apos;");
  });

  it("round-trips through decode", () => {
    const original = `Tom & Jerry <say> "hi" 'there'`;
    expect(decodeEntities(encodeEntities(original))).toBe(original);
  });
});
