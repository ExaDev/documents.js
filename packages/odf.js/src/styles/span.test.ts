import { describe, expect, it } from "vitest";
import type { XmlElement } from "../model/node";
import { el, txt } from "../xml/fragment";
import { ensureSpan, splitNode } from "./span";

function paragraphOf(...children: XmlElement["children"]): XmlElement {
  return el("text:p", {}, children);
}

function styleName(span: XmlElement): string | undefined {
  return span.attributes.find((a) => a.name === "text:style-name")?.value;
}

function textOf(node: XmlElement["children"][number]): string {
  if (node.type !== "text") {
    throw new Error(`expected a text node, got ${node.type}`);
  }
  return node.value;
}

describe("ensureSpan: plain text wrapping", () => {
  it("wraps a prefix of a single text node, leaving the remainder as a trailing sibling text node", () => {
    const prefix = "Hello";
    const paragraph = paragraphOf(txt(`${prefix} world`));
    const span = ensureSpan(paragraph, 0, prefix.length, "T1");
    expect(styleName(span)).toBe("T1");
    expect(paragraph.children).toHaveLength(2);
    expect(paragraph.children[0]).toBe(span);
    expect(textOf(paragraph.children[1]!)).toBe(" world");
    expect(span.children).toHaveLength(1);
    expect(textOf(span.children[0]!)).toBe(prefix);
  });

  it("wraps a range in the middle, leaving both a before and an after text node", () => {
    const before = "Hello ";
    const middle = "world";
    const paragraph = paragraphOf(txt(`${before}${middle}`));
    const span = ensureSpan(
      paragraph,
      before.length,
      before.length + middle.length,
      "T1",
    );
    expect(paragraph.children).toHaveLength(2);
    expect(textOf(paragraph.children[0]!)).toBe(before);
    expect(paragraph.children[1]).toBe(span);
    expect(textOf(span.children[0]!)).toBe(middle);
  });

  it("wraps the entire content when the range covers the whole paragraph", () => {
    const fullText = "abc";
    const paragraph = paragraphOf(txt(fullText));
    const span = ensureSpan(paragraph, 0, fullText.length, "T1");
    expect(paragraph.children).toEqual([span]);
    expect(textOf(span.children[0]!)).toBe(fullText);
  });

  it("is idempotent: calling it again on the exact same already-wrapped range updates the existing span's style rather than double-wrapping", () => {
    const prefix = "Hello";
    const paragraph = paragraphOf(txt(`${prefix} world`));
    const first = ensureSpan(paragraph, 0, prefix.length, "T1");
    const second = ensureSpan(paragraph, 0, prefix.length, "T2");
    expect(second).toBe(first); // the very same element, mutated in place
    expect(styleName(second)).toBe("T2");
    expect(paragraph.children).toHaveLength(2); // still exactly one span + one trailing text node, never nested
    expect(second.children).toHaveLength(1);
    expect(textOf(second.children[0]!)).toBe(prefix);
  });

  it("adds a text:style-name attribute (rather than updating one) when reusing an existing span that has none yet", () => {
    const prefix = "Hello";
    const bareSpan = el("text:span", {}, [txt(prefix)]);
    const paragraph = paragraphOf(bareSpan);
    const reused = ensureSpan(paragraph, 0, prefix.length, "T1");
    expect(reused).toBe(bareSpan);
    expect(reused.attributes).toEqual([
      { name: "text:style-name", value: "T1" },
    ]);
  });

  it("finds the existing text:style-name attribute by its own name, not merely the first attribute on the span, leaving an unrelated earlier attribute untouched", () => {
    const prefix = "Hello";
    const existingSpan = el("text:span", {}, [txt(prefix)]);
    existingSpan.attributes = [
      { name: "xml:id", value: "keep-me" },
      { name: "text:style-name", value: "Old" },
    ];
    const paragraph = paragraphOf(existingSpan);
    const reused = ensureSpan(paragraph, 0, prefix.length, "New");
    expect(reused).toBe(existingSpan);
    expect(reused.attributes).toEqual([
      { name: "xml:id", value: "keep-me" },
      { name: "text:style-name", value: "New" },
    ]);
  });

  it("treats a zero-width node (e.g. a comment) as occupying no character positions, carrying it through untouched on whichever side it falls", () => {
    const before = "ab";
    const after = "cd";
    const paragraph = paragraphOf(
      txt(before),
      { type: "comment", value: "marker" },
      txt(after),
    );
    const span = ensureSpan(paragraph, 0, before.length, "T1");
    // The wrapping span, the untouched comment, and the trailing text node.
    const expectedChildCount = 3;
    expect(paragraph.children).toHaveLength(expectedChildCount);
    expect(paragraph.children[0]).toBe(span);
    expect(paragraph.children[1]).toEqual({ type: "comment", value: "marker" });
    expect(textOf(paragraph.children[2]!)).toBe(after);
  });

  it("treats an unrecognised element (e.g. a bookmark) as zero-width too, contributing nothing to the character count", () => {
    // "ab" (0-1) + a zero-width bookmark + "cd" (2-3) + "ef" (4-5) — wrapping [0,4) must capture exactly "ab"+bookmark+"cd" and stop before "ef", proving the bookmark consumed none of the requested positions.
    const first = "ab";
    const second = "cd";
    const third = "ef";
    const paragraph = paragraphOf(
      txt(first),
      el("text:bookmark", { "text:name": "mark" }),
      txt(second),
      txt(third),
    );
    const span = ensureSpan(paragraph, 0, first.length + second.length, "T1");
    expect(paragraph.children).toHaveLength(2);
    expect(paragraph.children[0]).toBe(span);
    expect(textOf(paragraph.children[1]!)).toBe(third);
    expect(
      span.children.some(
        (c) => c.type === "element" && c.tag === "text:bookmark",
      ),
    ).toBe(true);
    expect(
      span.children
        .map((c) => (c.type === "text" ? c.value : undefined))
        .join(""),
    ).toBe(first + second);
  });

  it("supports an empty (zero-length) range, producing an empty span at that position", () => {
    const before = "a";
    const after = "bc";
    const paragraph = paragraphOf(txt(before + after));
    const span = ensureSpan(paragraph, before.length, before.length, "T1");
    expect(span.children).toEqual([]);
    // The before text node, the empty span, and the after text node.
    const expectedChildCount = 3;
    expect(paragraph.children).toHaveLength(expectedChildCount);
    expect(textOf(paragraph.children[0]!)).toBe(before);
    expect(paragraph.children[1]).toBe(span);
    expect(textOf(paragraph.children[2]!)).toBe(after);
  });
});

describe("ensureSpan: text:s straddling a split boundary", () => {
  it("splits a text:s that straddles the START boundary into two runs whose counts sum to the original, never merging or corrupting them", () => {
    // "abc" + a text:s run of spaceRunCount + "xyz" — mirrors the task's own example: a text:c="5" run split at position 5 becomes count=2 and count=3.
    const prefix = "abc";
    const suffix = "xyz";
    const spaceRunCount = 5;
    const splitPosition = 5;
    const paragraph = paragraphOf(
      txt(prefix),
      el("text:s", { "text:c": `${spaceRunCount}` }),
      txt(suffix),
    );
    const span = ensureSpan(
      paragraph,
      splitPosition,
      prefix.length + spaceRunCount,
      "T1",
    );

    // Before the span: the prefix + a text:s left over from the split.
    const leftoverCount = splitPosition - prefix.length;
    expect(paragraph.children[0]).toEqual({ type: "text", value: prefix });
    const leftoverBefore = paragraph.children[1]!;
    if (leftoverBefore.type !== "element" || leftoverBefore.tag !== "text:s") {
      throw new Error("expected a text:s element");
    }
    expect(leftoverBefore.attributes).toEqual([
      { name: "text:c", value: `${leftoverCount}` },
    ]);

    // The span itself: the other half of the split text:s.
    expect(paragraph.children[2]).toBe(span);
    expect(span.children).toHaveLength(1);
    const inSpan = span.children[0]!;
    if (inSpan.type !== "element" || inSpan.tag !== "text:s") {
      throw new Error("expected a text:s element");
    }
    expect(inSpan.attributes).toEqual([
      { name: "text:c", value: `${spaceRunCount - leftoverCount}` },
    ]);

    // After the span: the suffix, entirely untouched.
    expect(paragraph.children[3]).toEqual({ type: "text", value: suffix });
    const expectedChildCount = 4;
    expect(paragraph.children).toHaveLength(expectedChildCount);
  });

  it("splits a text:s that straddles the END boundary the same way", () => {
    const prefix = "abc";
    const spaceRunCount = 5;
    // Wraps exactly the first inSpanCount spaces of the run.
    const inSpanCount = 2;
    const paragraph = paragraphOf(
      txt(prefix),
      el("text:s", { "text:c": `${spaceRunCount}` }),
      txt("xyz"),
    );
    const span = ensureSpan(
      paragraph,
      prefix.length,
      prefix.length + inSpanCount,
      "T1",
    );

    expect(span.children).toEqual([
      {
        type: "element",
        tag: "text:s",
        attributes: [{ name: "text:c", value: `${inSpanCount}` }],
        children: [],
      },
    ]);

    // The remaining spaces are left as their own sibling text:s, counts summing back to the original run.
    const remainder = paragraph.children[2]!;
    if (remainder.type !== "element" || remainder.tag !== "text:s") {
      throw new Error("expected a text:s element");
    }
    expect(remainder.attributes).toEqual([
      { name: "text:c", value: `${spaceRunCount - inSpanCount}` },
    ]);
  });

  it("a text:s split exactly at its own boundary (not straddling) is left as a single, unsplit run", () => {
    const prefix = "ab";
    const spaceRunCount = 3;
    const paragraph = paragraphOf(
      txt(prefix),
      el("text:s", { "text:c": `${spaceRunCount}` }),
      txt("cd"),
    );
    // [prefix.length, prefix.length + spaceRunCount) is exactly the text:s's own span.
    const span = ensureSpan(
      paragraph,
      prefix.length,
      prefix.length + spaceRunCount,
      "T1",
    );
    expect(span.children).toEqual([
      {
        type: "element",
        tag: "text:s",
        attributes: [{ name: "text:c", value: `${spaceRunCount}` }],
        children: [],
      },
    ]);
    const expectedChildCount = 3;
    expect(paragraph.children).toHaveLength(expectedChildCount);
  });

  it("a text:s with an absent text:c defaults to a count of 1", () => {
    const prefix = "a";
    const paragraph = paragraphOf(txt(prefix), el("text:s"), txt("b"));
    const span = ensureSpan(paragraph, prefix.length, prefix.length + 1, "T1");
    expect(span.children).toEqual([
      { type: "element", tag: "text:s", attributes: [], children: [] },
    ]);
  });

  it("throws a clear error for a malformed text:c attribute", () => {
    const paragraph = paragraphOf(el("text:s", { "text:c": "not-a-number" }));
    expect(() => ensureSpan(paragraph, 0, 1, "T1")).toThrow(/malformed/);
  });

  it("splits a text:s into two count=1 halves that each omit the text:c attribute entirely, rather than writing it out explicitly for the implicit default", () => {
    const paragraph = paragraphOf(
      txt("a"),
      el("text:s", { "text:c": "2" }),
      txt("b"),
    ); // "a" (0), text:s count=2 (1-2), "b" (3)
    const span = ensureSpan(paragraph, 1, 2, "T1"); // splits the count=2 run into count=1 (inside the span) + count=1 (leftover after)

    expect(span.children).toEqual([
      { type: "element", tag: "text:s", attributes: [], children: [] },
    ]);
    const leftover = paragraph.children[2]!;
    if (leftover.type !== "element" || leftover.tag !== "text:s") {
      throw new Error("expected a text:s element");
    }
    expect(leftover.attributes).toEqual([]);
  });
});

describe("splitNode: unreachable fractional-offset branch", () => {
  it("throws for text:tab (and, symmetrically, text:line-break) given an offset that isn't exactly 0 or its own length — a shape ensureSpan's own integer-offset validation prevents any real caller from ever producing, exercised here by calling the split primitive directly", () => {
    const fractionalOffset = 0.5;
    expect(() => splitNode(el("text:tab"), fractionalOffset)).toThrow(
      /cannot split "text:tab" at a fractional offset/,
    );
    expect(() => splitNode(el("text:line-break"), fractionalOffset)).toThrow(
      /cannot split "text:line-break" at a fractional offset/,
    );
  });
});

describe("ensureSpan: text:tab and text:line-break", () => {
  it("treats text:tab and text:line-break as whole, unsplittable single-position elements", () => {
    const middle = "abc";
    const paragraph = paragraphOf(
      el("text:tab"),
      txt(middle),
      el("text:line-break"),
    );
    const span = ensureSpan(paragraph, 0, 1, "T1");
    expect(span.children).toEqual([
      { type: "element", tag: "text:tab", attributes: [], children: [] },
    ]);
    // span, the middle text, and the line-break.
    const expectedChildCount = 3;
    expect(paragraph.children).toHaveLength(expectedChildCount);

    // The line-break, now at position (1 tab + middle.length).
    const lineBreakPosition = 1 + middle.length;
    const span2 = ensureSpan(
      paragraph,
      lineBreakPosition,
      lineBreakPosition + 1,
      "T2",
    );
    expect(span2.children).toEqual([
      { type: "element", tag: "text:line-break", attributes: [], children: [] },
    ]);
  });
});

describe("ensureSpan: splitting a pre-existing text:span", () => {
  it("splits an existing span that a boundary falls strictly inside, preserving its style-name on BOTH halves independently", () => {
    const before = "AB";
    const spanText = "CDEFGH";
    const after = "IJ";
    const splitAt = 2; // splits spanText into "CD" and "EFGH"
    const existingSpan = el("text:span", { "text:style-name": "T1" }, [
      txt(spanText),
    ]);
    const paragraph = paragraphOf(txt(before), existingSpan, txt(after));

    const newSpan = ensureSpan(
      paragraph,
      before.length + splitAt,
      before.length + spanText.length + after.length,
      "T2",
    );

    // Before: the leading text + the left half of the split span, still styled T1.
    expect(textOf(paragraph.children[0]!)).toBe(before);
    const leftHalf = paragraph.children[1]!;
    if (leftHalf.type !== "element") throw new Error("expected an element");
    expect(leftHalf.tag).toBe("text:span");
    expect(styleName(leftHalf)).toBe("T1");
    expect(textOf(leftHalf.children[0]!)).toBe(spanText.slice(0, splitAt));

    // The requested range covers the split-off right half of the original span AND the trailing text node together — since that's more than one node, ensureSpan wraps them in a brand new outer span rather than reusing/renaming the split-off span in place.
    expect(newSpan).not.toBe(existingSpan);
    expect(styleName(newSpan)).toBe("T2");
    const expectedChildCount = 3;
    expect(paragraph.children).toHaveLength(expectedChildCount);
    expect(paragraph.children[2]).toBe(newSpan);
    // newSpan must wrap BOTH of the two nodes that made up "middle" (the split-off right-half span, still styled T1, and the trailing text node) — not merely reuse/rename the first of those two nodes in place and silently drop the second, which is exactly what a broken "is there exactly one middle node" check would do.
    const expectedMiddleNodeCount = 2;
    expect(newSpan.children).toHaveLength(expectedMiddleNodeCount);
    const innerSpan = newSpan.children[0]!;
    if (innerSpan.type !== "element") throw new Error("expected an element");
    expect(styleName(innerSpan)).toBe("T1");
    expect(textOf(innerSpan.children[0]!)).toBe(spanText.slice(splitAt));
    expect(textOf(newSpan.children[1]!)).toBe(after);
  });

  it("reuses (renames) an existing span in place when the requested range exactly matches it, and does not disturb a sibling split off the same original span", () => {
    const before = "AB";
    const spanText = "CDEFGH";
    const after = "IJ";
    // Splitting spanText at this position gives its own left half and its own right half; the requested range matches the right half exactly.
    const splitAt = 2;
    const existingSpan = el("text:span", { "text:style-name": "T1" }, [
      txt(spanText),
    ]);
    const paragraph = paragraphOf(txt(before), existingSpan, txt(after));

    const reused = ensureSpan(
      paragraph,
      before.length + splitAt,
      before.length + spanText.length,
      "T2",
    );

    const leftHalf = paragraph.children[1]!;
    if (leftHalf.type !== "element") throw new Error("expected an element");
    expect(styleName(leftHalf)).toBe("T1"); // untouched by the rename below
    expect(textOf(leftHalf.children[0]!)).toBe(spanText.slice(0, splitAt));

    expect(styleName(reused)).toBe("T2");
    expect(textOf(reused.children[0]!)).toBe(spanText.slice(splitAt));
    expect(paragraph.children[3]).toEqual({ type: "text", value: after });
  });
});

describe("ensureSpan: input validation", () => {
  const sourceText = "abcde";
  const paragraph = () => paragraphOf(txt(sourceText));

  it("throws for a negative start", () => {
    expect(() => ensureSpan(paragraph(), -1, 2, "T1")).toThrow(/invalid range/);
  });

  it("throws when end < start", () => {
    const start = 3;
    expect(() => ensureSpan(paragraph(), start, 1, "T1")).toThrow(
      /invalid range/,
    );
  });

  it("throws when end exceeds the container's total length", () => {
    expect(() =>
      ensureSpan(paragraph(), 0, sourceText.length + 1, "T1"),
    ).toThrow(/exceeds/);
  });

  it("throws for non-integer offsets", () => {
    const fractionalStart = 0.5;
    expect(() => ensureSpan(paragraph(), fractionalStart, 2, "T1")).toThrow(
      /invalid range/,
    );
  });
});
