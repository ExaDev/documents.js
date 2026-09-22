// Direct tests for delimiter-run flanking classification. The conformance suite exercises this through whole documents, which is the right end-to-end check but a poor diagnostic: a flanking bug there surfaces as a wrong emphasis nesting several steps downstream. These pin the classification itself, using the exact runs the spec's own "Here are some examples of delimiter runs" list gives.

import { describe, expect, it } from "vitest";
import type { Delimiter } from "./delimiter";
import {
  DelimiterStack,
  closerSignature,
  processEmphasis,
  scanDelimiterRun,
} from "./delimiter";
import { InlineNode } from "./node";

function delimiter(fields: {
  char: "*" | "_" | "~";
  origCount: number;
  canOpen: boolean;
}): Delimiter {
  return {
    char: fields.char,
    count: fields.origCount,
    origCount: fields.origCount,
    canOpen: fields.canOpen,
    canClose: true,
    node: new InlineNode("text"),
    previous: undefined,
    next: undefined,
  };
}

function classify(text: string, start: number, char: "*" | "_" | "~"): string {
  const run = scanDelimiterRun(text, start, char);
  if (run === undefined) {
    return "none";
  }
  if (run.canOpen && run.canClose) {
    return "both";
  }
  if (run.canOpen) {
    return "open";
  }
  return run.canClose ? "close" : "neither";
}

describe("scanDelimiterRun", () => {
  it("measures the run length", () => {
    expect(scanDelimiterRun("***abc", 0, "*")?.count).toBe(3);
  });

  it("returns undefined when the position does not actually open with the given delimiter character", () => {
    expect(scanDelimiterRun("abc", 0, "*")).toBeUndefined();
  });

  // spec 0.31.2's own "left-flanking but not right-flanking" examples.
  it.each([
    ["***abc", 0, "*"],
    ["  _abc", 2, "_"],
    ['**"abc"', 0, "*"],
    [' _"abc"', 1, "_"],
  ] as const)("classifies %s at %i as an opener only", (text, start, char) => {
    expect(classify(text, start, char)).toBe("open");
  });

  // spec 0.31.2's own "right-flanking but not left-flanking" examples.
  it.each([
    [" abc***", 4, "*"],
    [" abc_", 4, "_"],
    ['"abc"**', 5, "*"],
    ['"abc"_', 5, "_"],
  ] as const)("classifies %s at %i as a closer only", (text, start, char) => {
    expect(classify(text, start, char)).toBe("close");
  });

  // spec 0.31.2's own "both left and right-flanking" examples — note `_` is deliberately NOT both here: an underscore run between two word characters can neither open nor close, which is the whole intraword-emphasis restriction.
  it("classifies an asterisk run between two word characters as both an opener and a closer", () => {
    expect(classify(" abc***def", 4, "*")).toBe("both");
  });

  it("classifies an underscore run between two word characters as neither", () => {
    expect(classify("abc_def", 3, "_")).toBe("neither");
  });

  it("classifies an underscore run between two punctuation characters as both", () => {
    expect(classify('"abc"_"def"', 5, "_")).toBe("both");
  });

  // spec 0.31.2's own "neither left nor right-flanking" examples.
  it.each([
    ["abc *** def", 4, "*"],
    ["a _ b", 2, "_"],
  ] as const)("classifies %s at %i as neither", (text, start, char) => {
    expect(classify(text, start, char)).toBe("neither");
  });

  it("treats the start and end of the block as whitespace", () => {
    expect(classify("*abc", 0, "*")).toBe("open");
    expect(classify("abc*", 3, "*")).toBe("close");
  });

  it("classifies an astral symbol adjacent to a run as punctuation, not as a lone surrogate", () => {
    // U+1F600 is in the Unicode `So` category, which spec 0.31.2 counts as a punctuation character for flanking purposes — so this run is followed by punctuation and preceded by whitespace, making it an opener.
    expect(classify(" *\u{1F600}", 1, "*")).toBe("open");
  });

  it("rejects a tilde run longer than the two-tilde maximum GFM allows", () => {
    expect(classify("~~~a", 0, "~")).toBe("none");
    expect(classify("~~a", 0, "~")).toBe("open");
  });
});

describe("closerSignature", () => {
  it("encodes the delimiter character, whether it can open, and origCount % 3 — distinctly for each", () => {
    expect(
      closerSignature(delimiter({ char: "*", origCount: 1, canOpen: true })),
    ).toBe("*11");
    expect(
      closerSignature(delimiter({ char: "*", origCount: 1, canOpen: false })),
    ).toBe("*01");
    // origCount 4 falls in the same modulo-3 bucket as 1 — same signature.
    expect(
      closerSignature(delimiter({ char: "*", origCount: 4, canOpen: true })),
    ).toBe("*11");
    expect(
      closerSignature(delimiter({ char: "*", origCount: 2, canOpen: true })),
    ).toBe("*12");
    expect(
      closerSignature(delimiter({ char: "_", origCount: 1, canOpen: true })),
    ).toBe("_11");
  });
});

describe("processEmphasis", () => {
  it("applies the rule-of-three carve-out: a match is allowed when both run lengths are themselves multiples of three, even though their sum also is", () => {
    const stack = new DelimiterStack();
    const opener = delimiter({ char: "*", origCount: 3, canOpen: true });
    opener.node.literal = "***";
    stack.push("*", { count: 3, canOpen: true, canClose: true }, opener.node);
    const closer = delimiter({ char: "*", origCount: 3, canOpen: true });
    closer.node.literal = "***";
    stack.push("*", { count: 3, canOpen: true, canClose: true }, closer.node);

    processEmphasis(stack, undefined, (kind) => new InlineNode(kind));

    // A blocked match would leave both runs' literal text untouched.
    expect(opener.node.literal).toBe("");
  });

  it("keeps a delimiter search bounded by the openers floor rather than re-walking the whole stack for every same-signature closer", () => {
    const stack = new DelimiterStack();
    // A long run of inert, never-removed, never-matching delimiters of a different character sits below a batch of same-signature closers that can never match anything either — without the floor, each of those closers re-walks the entire inert run from scratch, making the whole pass quadratic in its length.
    const inertCount = 50_000;
    for (let i = 0; i < inertCount; i++) {
      const node = new InlineNode("text");
      node.literal = "_";
      stack.push("_", { count: 1, canOpen: true, canClose: false }, node);
    }
    const closerCount = 500;
    for (let i = 0; i < closerCount; i++) {
      const node = new InlineNode("text");
      node.literal = "*";
      stack.push("*", { count: 1, canOpen: false, canClose: true }, node);
    }

    const start = performance.now();
    processEmphasis(stack, undefined, (kind) => new InlineNode(kind));
    const elapsed = performance.now() - start;

    // The bounded-search version finishes in well under a second for this input on any reasonable machine; without the floor it takes upward of ten seconds (measured locally at roughly 14s for these same sizes), so this margin is not close either way.
    expect(elapsed).toBeLessThan(5000);
  }, 20_000);
});
