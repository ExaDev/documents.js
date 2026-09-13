// Direct tests for the corpus loader's own type guards, which a well-formed vendored spec.json never exercises the failure side of -- loadSpecExamples' own "not an array of {markdown, html, example, section} examples" throw only fires against malformed input, so pinning it means testing the guard functions themselves rather than the loader end to end.

import type * as NodeFs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  isSpecExample,
  isSpecExampleArray,
  loadSpecExamples,
} from "./spec-corpus";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFs>();
  return { ...actual, readFileSync: vi.fn() };
});

const VALID_EXAMPLE = {
  markdown: "# hi\n",
  html: "<h1>hi</h1>\n",
  example: 1,
  section: "Headings",
};

describe("isSpecExample", () => {
  it("accepts a well-formed example", () => {
    expect(isSpecExample(VALID_EXAMPLE)).toBe(true);
  });

  it("rejects a non-object", () => {
    expect(isSpecExample("not an object")).toBe(false);
    expect(isSpecExample(null)).toBe(false);
    expect(isSpecExample(42)).toBe(false);
  });

  it('rejects a function even when it carries all four fields with the right types -- typeof a function is "function", never "object"', () => {
    const fn = Object.assign(() => {}, VALID_EXAMPLE);
    expect(isSpecExample(fn)).toBe(false);
  });

  it("rejects an object missing any one of the four required fields", () => {
    expect(isSpecExample({ html: "h", example: 1, section: "s" })).toBe(false);
    expect(isSpecExample({ markdown: "m", example: 1, section: "s" })).toBe(
      false,
    );
    expect(isSpecExample({ markdown: "m", html: "h", section: "s" })).toBe(
      false,
    );
    expect(isSpecExample({ markdown: "m", html: "h", example: 1 })).toBe(false);
  });

  it("rejects an object whose fields are present but wrongly typed", () => {
    expect(isSpecExample({ ...VALID_EXAMPLE, markdown: 1 })).toBe(false);
    expect(isSpecExample({ ...VALID_EXAMPLE, html: 1 })).toBe(false);
    expect(isSpecExample({ ...VALID_EXAMPLE, example: "1" })).toBe(false);
    expect(isSpecExample({ ...VALID_EXAMPLE, section: 1 })).toBe(false);
  });
});

describe("isSpecExampleArray", () => {
  it("accepts an array of well-formed examples, including the empty array", () => {
    expect(isSpecExampleArray([VALID_EXAMPLE, VALID_EXAMPLE])).toBe(true);
    expect(isSpecExampleArray([])).toBe(true);
  });

  it("rejects a non-array", () => {
    expect(isSpecExampleArray(VALID_EXAMPLE)).toBe(false);
  });

  it("rejects an array containing even one malformed entry", () => {
    expect(isSpecExampleArray([VALID_EXAMPLE, { not: "an example" }])).toBe(
      false,
    );
  });
});

describe("loadSpecExamples", () => {
  it("reads assets/commonmark/spec.json as utf8 and returns a well-formed corpus unchanged", async () => {
    const { readFileSync } = await import("node:fs");
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify([VALID_EXAMPLE]));

    expect(loadSpecExamples()).toEqual([VALID_EXAMPLE]);

    const call = vi.mocked(readFileSync).mock.calls[0];
    expect(call).toBeDefined();
    const [urlArgument, encodingArgument] = call!;
    expect(String(urlArgument)).toContain("/assets/commonmark/spec.json");
    expect(encodingArgument).toBe("utf8");
  });

  it("throws a specific message when the vendored corpus is not an array of well-formed examples", async () => {
    const { readFileSync } = await import("node:fs");
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify([VALID_EXAMPLE, { not: "an example" }]),
    );
    expect(() => loadSpecExamples()).toThrow(
      "assets/commonmark/spec.json is not an array of {markdown, html, example, section} examples",
    );
  });
});
