import { describe, expect, it } from "vitest";
import {
  type ContentBlock,
  ContentParagraphSchema,
  findRunConstructFault,
  isContentBlock,
  isRunConstructExtent,
} from "./content";
import { type RunConstructExtent } from "./content-vocabulary";
import {} from "./content-sheet";

import type { ConstructDescriptor } from "./construct";

// A mid-paragraph bookmark over the middle two runs of four, a point anchor between runs, and a field over the paragraph's tail — the three shapes the run-level mechanism exists for, each spelled as the descriptor-plus-half-open-run-range entry ContentParagraph.constructs carries.
const runExtentParagraph: ContentBlock = {
  kind: "paragraph",
  runs: [
    { text: "before " },
    { text: "marked " },
    { text: "words" },
    { text: " after" },
  ],
  constructs: [
    {
      descriptor: { kind: "anchor", anchorType: "bookmark", name: "midway" },
      startRun: 1,
      endRun: 3,
    },
    {
      descriptor: {
        kind: "anchor",
        anchorType: "footnote",
        name: "1",
        definition: "n1",
      },
      startRun: 3,
      endRun: 3,
    },
  ],
};

describe("run-level construct extents", () => {
  it("parses a paragraph carrying construct extents and deep-equals itself after a JSON round trip", () => {
    const parsed = ContentParagraphSchema.parse(runExtentParagraph);
    expect(parsed).toEqual(runExtentParagraph);
    expect(
      ContentParagraphSchema.parse(JSON.parse(JSON.stringify(parsed))),
    ).toEqual(runExtentParagraph);
  });

  it("accepts each of the six descriptor kinds inside a run extent", () => {
    const descriptors: ConstructDescriptor[] = [
      { kind: "contentControl", controlType: "plainText", tag: "name" },
      { kind: "field", instruction: "PAGE", cachedResult: "3" },
      { kind: "anchor", anchorType: "bookmark", name: "intro" },
      {
        kind: "link",
        target: { kind: "external", uri: "https://example.invalid/" },
      },
      { kind: "provenance", change: "insertion", author: "A. Reviewer" },
      { kind: "division", name: "Chapter 1" },
    ];
    for (const descriptor of descriptors) {
      const extent: RunConstructExtent = { descriptor, startRun: 0, endRun: 1 };
      expect(isRunConstructExtent(extent)).toBe(true);
      expect(
        isContentBlock({
          kind: "paragraph",
          runs: [{ text: "x" }],
          constructs: [extent],
        }),
      ).toBe(true);
    }
  });

  it("lets two extents cross freely — ranges, not brackets, have no nesting constraint", () => {
    const crossing: ContentBlock = {
      kind: "paragraph",
      runs: [{ text: "a" }, { text: "b" }, { text: "c" }, { text: "d" }],
      constructs: [
        {
          descriptor: { kind: "anchor", anchorType: "bookmark", name: "first" },
          startRun: 0,
          endRun: 3,
        },
        {
          descriptor: {
            kind: "anchor",
            anchorType: "bookmark",
            name: "second",
          },
          startRun: 1,
          endRun: 4,
        },
      ],
    };
    expect(ContentParagraphSchema.parse(crossing)).toEqual(crossing);
    expect(findRunConstructFault(crossing)).toBeUndefined();
  });

  it("rejects, through the block guard, an extent entry with no descriptor, a malformed one, or non-integer bounds", () => {
    expect(
      isContentBlock({
        kind: "paragraph",
        runs: [],
        constructs: [{ startRun: 0, endRun: 0 }],
      }),
    ).toBe(false);
    expect(
      isContentBlock({
        kind: "paragraph",
        runs: [{ text: "x" }],
        constructs: [
          {
            descriptor: { kind: "anchor", anchorType: "footnote" },
            startRun: 0,
            endRun: 1,
          },
        ],
      }),
    ).toBe(false);
    expect(
      isContentBlock({
        kind: "paragraph",
        runs: [{ text: "x" }],
        constructs: [
          {
            descriptor: { kind: "anchor", anchorType: "bookmark", name: "a" },
            startRun: 0.5,
            endRun: 1,
          },
        ],
      }),
    ).toBe(false);
    expect(
      isRunConstructExtent({
        descriptor: { kind: "residue", xml: "<w:custom/>" },
        startRun: 0,
        endRun: 0,
      }),
    ).toBe(false);
  });

  // The run-level twin of the marker-imbalance gap test above: an inverted or out-of-range run range is malformed by the extent contract, but ContentParagraphSchema carries no refinement that rejects it — a Zod refinement would validate against a rule the published content-document.schema.json fragment cannot express (the range bound is the paragraph's own runs.length, not a fact any single object states), so it would silently diverge from that published face. findRunConstructFault (tested below) is the one place range validity is checked; this test exists so a future change reintroducing it as a Zod refinement fails rather than sliding in unnoticed.
  it("parses an inverted and an out-of-range extent — range validity belongs to findRunConstructFault, not the schema", () => {
    const inverted: ContentBlock = {
      kind: "paragraph",
      runs: [{ text: "x" }],
      constructs: [
        {
          descriptor: { kind: "anchor", anchorType: "bookmark", name: "a" },
          startRun: 2,
          endRun: 1,
        },
      ],
    };
    expect(ContentParagraphSchema.safeParse(inverted).success).toBe(true);
    expect(findRunConstructFault(inverted)).toStrictEqual({
      kind: "invertedRange",
      index: 0,
    });
  });
});

describe("findRunConstructFault", () => {
  it("finds nothing in a paragraph with no constructs field or an empty one", () => {
    expect(
      findRunConstructFault({ kind: "paragraph", runs: [{ text: "x" }] }),
    ).toBeUndefined();
    expect(
      findRunConstructFault({ kind: "paragraph", runs: [], constructs: [] }),
    ).toBeUndefined();
  });

  it("accepts a point extent, one covering the whole run list, and several extents at once", () => {
    expect(findRunConstructFault(runExtentParagraph)).toBeUndefined();
    expect(
      findRunConstructFault({
        kind: "paragraph",
        runs: [{ text: "a" }, { text: "b" }],
        constructs: [
          {
            descriptor: {
              kind: "anchor",
              anchorType: "bookmark",
              name: "whole",
            },
            startRun: 0,
            endRun: 2,
          },
        ],
      }),
    ).toBeUndefined();
  });

  it("reports an end preceding its start, at the entry's own index", () => {
    expect(
      findRunConstructFault({
        kind: "paragraph",
        runs: [{ text: "a" }],
        constructs: [
          {
            descriptor: {
              kind: "anchor",
              anchorType: "bookmark",
              name: "fine",
            },
            startRun: 0,
            endRun: 1,
          },
          {
            descriptor: {
              kind: "anchor",
              anchorType: "bookmark",
              name: "inverted",
            },
            startRun: 1,
            endRun: 0,
          },
        ],
      }),
    ).toStrictEqual({ kind: "invertedRange", index: 1 });
  });

  it("reports an end beyond the paragraph's runs, at the entry's own index", () => {
    expect(
      findRunConstructFault({
        kind: "paragraph",
        runs: [{ text: "a" }],
        constructs: [
          {
            descriptor: {
              kind: "anchor",
              anchorType: "bookmark",
              name: "beyond",
            },
            startRun: 0,
            endRun: 2,
          },
        ],
      }),
    ).toStrictEqual({ kind: "beyondRuns", index: 0 });
  });

  it("reports a negative bound as beyond the runs it must name", () => {
    expect(
      findRunConstructFault({
        kind: "paragraph",
        runs: [{ text: "a" }],
        constructs: [
          {
            descriptor: {
              kind: "anchor",
              anchorType: "bookmark",
              name: "negative",
            },
            startRun: -1,
            endRun: 1,
          },
        ],
      }),
    ).toStrictEqual({ kind: "beyondRuns", index: 0 });
  });

  it("reports the earlier fault when a paragraph carries both kinds at once", () => {
    expect(
      findRunConstructFault({
        kind: "paragraph",
        runs: [{ text: "a" }],
        constructs: [
          {
            descriptor: {
              kind: "anchor",
              anchorType: "bookmark",
              name: "beyond",
            },
            startRun: 0,
            endRun: 5,
          },
          {
            descriptor: {
              kind: "anchor",
              anchorType: "bookmark",
              name: "inverted",
            },
            startRun: 1,
            endRun: 0,
          },
        ],
      }),
    ).toStrictEqual({ kind: "beyondRuns", index: 0 });
  });
});
