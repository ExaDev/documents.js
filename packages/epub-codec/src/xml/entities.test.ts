import { describe, expect, it } from "vitest";
import { decodeEntities, encodeEntities } from "./entities";

describe("decodeEntities", () => {
  it("decodes the five standard XML entities", () => {
    expect(decodeEntities("&amp;&lt;&gt;&quot;&apos;")).toBe("&<>\"'");
  });

  it("leaves unrecognised entities and plain text untouched", () => {
    expect(decodeEntities("caf&#233; &amp; tea")).toBe("caf&#233; & tea");
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
