import { describe, expect, it } from "vitest";
import { canonicalise, canonicalKey } from "./canonicalise";

describe("canonicalise", () => {
  it("rebuilds a plain object with its keys sorted ascending", () => {
    const input = { c: 1, a: 2, b: 3 };
    expect(canonicalise(input)).toStrictEqual({ a: 2, b: 3, c: 1 });
    expect(Object.keys(canonicalise(input) as object)).toStrictEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("recurses into nested object values, sorting their keys too", () => {
    const input = { z: { y: 1, x: 2 } };
    expect(Object.keys((canonicalise(input) as { z: object }).z)).toStrictEqual(
      ["x", "y"],
    );
  });

  it("maps over arrays in order without sorting elements", () => {
    const input = [{ b: 1, a: 2 }, 3, "text"];
    expect(canonicalise(input)).toStrictEqual([{ a: 2, b: 1 }, 3, "text"]);
  });

  it("does not treat an array as a record -- array elements are mapped, never treated as object keys", () => {
    const input = [1, 2, 3];
    const result = canonicalise(input);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toStrictEqual([1, 2, 3]);
  });

  it("returns null as-is rather than as an empty sorted object", () => {
    expect(canonicalise(null)).toBeNull();
  });

  it("returns primitives unchanged", () => {
    expect(canonicalise(42)).toBe(42);
    expect(canonicalise("hello")).toBe("hello");
    expect(canonicalise(true)).toBe(true);
    expect(canonicalise(undefined)).toBeUndefined();
  });

  it("produces a fresh structure, never the same object reference", () => {
    const input = { a: 1 };
    expect(canonicalise(input)).not.toBe(input);
  });
});

describe("canonicalKey", () => {
  it("is insensitive to the input object's own key construction order", () => {
    const first = { a: 1, b: 2 };
    const second = { b: 2, a: 1 };
    expect(canonicalKey(first)).toBe(canonicalKey(second));
  });

  it("distinguishes values that actually differ", () => {
    expect(canonicalKey({ a: 1 })).not.toBe(canonicalKey({ a: 2 }));
  });

  it("treats an absent optional key and an explicit undefined value as identical", () => {
    const absent: { a: number; b?: number } = { a: 1 };
    const explicitUndefined: { a: number; b?: number } = { a: 1, b: undefined };
    expect(canonicalKey(absent)).toBe(canonicalKey(explicitUndefined));
  });

  it("round-trips through JSON.stringify of the canonicalised value", () => {
    const value = { z: 1, a: [3, 2, 1] };
    expect(canonicalKey(value)).toBe(JSON.stringify(canonicalise(value)));
  });
});
