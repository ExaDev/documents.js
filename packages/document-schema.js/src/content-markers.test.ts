import { describe, expect, it } from "vitest";
import {
  type ContentBlock,
  ContentBlockSchema,
  ContentConstructEndSchema,
  ContentConstructStartSchema,
  type ContentDocument,
  ContentDocumentSchema,
  findConstructMarkerImbalance,
  isContentBlock,
  isContentConstructEnd,
  isContentConstructStart,
} from "./content";
import {} from "./content-vocabulary";
import {} from "./content-sheet";

import type { ConstructDescriptor } from "./construct";
const paragraph: ContentBlock = {
  kind: "paragraph",
  runs: [
    { text: "Hello " },
    {
      text: "world",
      bold: true,
      italic: true,
      color: { r: 0.2, g: 0.4, b: 0.6 },
    },
  ],
  styleId: "Heading1",
  alignment: "center",
  spacingBeforePt: 12,
  spacingAfterPt: 6,
};

const image: ContentBlock = {
  kind: "image",
  format: "png",
  base64: "AA==",
  widthPt: 100,
  heightPt: 50,
  altText: "a placeholder image",
};

const pageBreak: ContentBlock = { kind: "pageBreak" };

function constructStart(descriptor: ConstructDescriptor): ContentBlock {
  return { kind: "constructStart", descriptor };
}

const constructEnd: ContentBlock = { kind: "constructEnd" };

// A tracked insertion inside a docx content control, with a footnote anchor beside it — one region nested inside another, which is the case a pairing key would have existed to handle and bracket matching handles for free.
const nestedConstructBlocks: ContentBlock[] = [
  constructStart({
    kind: "contentControl",
    controlType: "richText",
    tag: "ClientBlock",
    lock: "container",
  }),
  { kind: "paragraph", runs: [{ text: "Before the tracked change." }] },
  constructStart({
    kind: "provenance",
    change: "insertion",
    author: "A. Reviewer",
    dateIso: "2026-08-18T09:00:00Z",
  }),
  { kind: "paragraph", runs: [{ text: "Inserted sentence." }] },
  constructEnd,
  constructStart({
    kind: "anchor",
    anchorType: "footnote",
    name: "1",
    definition: "n1",
  }),
  constructEnd,
  constructEnd,
];

describe("construct boundary markers", () => {
  it("accepts an open marker carrying each of the six descriptor kinds", () => {
    const descriptors: ConstructDescriptor[] = [
      { kind: "contentControl", controlType: "checkbox", checked: true },
      { kind: "field", instruction: "PAGE \\* MERGEFORMAT", cachedResult: "3" },
      { kind: "anchor", anchorType: "bookmark", name: "intro" },
      {
        kind: "link",
        target: { kind: "internal", anchor: "intro" },
        title: "Back to the introduction",
      },
      { kind: "provenance", change: "deletion", author: "A. Reviewer" },
      {
        kind: "division",
        name: "Chapter 1",
        columnCount: 2,
        linked: { href: "chapter-1.odt" },
      },
    ];
    for (const descriptor of descriptors) {
      const marker = constructStart(descriptor);
      expect(ContentConstructStartSchema.safeParse(marker).success).toBe(true);
      expect(isContentConstructStart(marker)).toBe(true);
      expect(isContentBlock(marker)).toBe(true);
    }
  });

  it("accepts a close marker whose kind is its whole payload", () => {
    expect(ContentConstructEndSchema.safeParse(constructEnd).success).toBe(
      true,
    );
    expect(isContentConstructEnd(constructEnd)).toBe(true);
    expect(isContentBlock(constructEnd)).toBe(true);
  });

  it("rejects an open marker with no descriptor, a malformed one, or a descriptor kind the vocabulary does not carry", () => {
    expect(isContentBlock({ kind: "constructStart" })).toBe(false);
    expect(
      isContentBlock({
        kind: "constructStart",
        descriptor: { kind: "anchor", anchorType: "footnote" },
      }),
    ).toBe(false);
    expect(
      isContentBlock({
        kind: "constructStart",
        descriptor: { kind: "residue", xml: "<w:custom/>" },
      }),
    ).toBe(false);
    expect(isContentConstructStart({ kind: "constructEnd" })).toBe(false);
    expect(
      isContentConstructEnd({
        kind: "constructStart",
        descriptor: { kind: "field", instruction: "PAGE" },
      }),
    ).toBe(false);
  });

  it("carries no position of its own: a frames array smuggled onto a marker does not survive a parse", () => {
    const parsed = ContentConstructEndSchema.parse({
      kind: "constructEnd",
      frames: [{ pageIndex: 0, xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }],
    });
    expect(parsed).toStrictEqual({ kind: "constructEnd" });
  });

  it("nests inside a wordprocessing document and deep-equals itself after a JSON round trip", () => {
    const original: ContentDocument = {
      kind: "wordprocessing",
      metadata: { title: "Constructs" },
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: nestedConstructBlocks,
        },
      ],
    };
    const parsed = ContentDocumentSchema.parse(original);
    const roundTripped: unknown = JSON.parse(JSON.stringify(parsed));
    expect(ContentDocumentSchema.parse(roundTripped)).toEqual(original);
  });

  it("brackets a region inside a table cell, the only place a construct inside a table is expressible", () => {
    const cellTable: ContentBlock = {
      kind: "table",
      rows: [
        {
          cells: [
            {
              blocks: [
                constructStart({
                  kind: "field",
                  instruction: "DOCPROPERTY Title",
                }),
                { kind: "paragraph", runs: [{ text: "Constructs" }] },
                constructEnd,
              ],
            },
          ],
        },
      ],
      columns: [{ widthPt: 200 }],
    };
    expect(isContentBlock(cellTable)).toBe(true);
    expect(ContentBlockSchema.safeParse(cellTable).success).toBe(true);
  });

  // Pins a deliberate schema-level gap: an unmatched constructEnd is malformed input by the bracket-matching contract above, but ContentDocumentSchema carries no refinement that rejects it. findConstructMarkerImbalance (tested below) is the one place balance is actually checked — decompose calls it and throws on what this schema accepts. A Zod-only refinement here would validate against a rule the published content-document.schema.json fragment cannot express (JSON Schema has no way to state "these array members pair up"), so adding one would silently diverge from that published face — the exact guard-versus-published-face misalignment the TreeBlockLeaf JSON Schema fragment exists to avoid on the tree side. This test exists so a future change reintroducing balance as a Zod refinement fails it rather than sliding in unnoticed.
  it("parses a section whose blocks carry an unmatched constructEnd — balance belongs to findConstructMarkerImbalance, not the schema", () => {
    const blocks: ContentBlock[] = [
      {
        kind: "paragraph",
        runs: [{ text: "No open marker precedes this close." }],
      },
      constructEnd,
    ];
    const unbalanced: ContentDocument = {
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks,
        },
      ],
    };
    expect(ContentDocumentSchema.safeParse(unbalanced).success).toBe(true);
    expect(findConstructMarkerImbalance(blocks)).toStrictEqual({
      kind: "unmatchedEnd",
      index: 1,
    });
  });
});

describe("findConstructMarkerImbalance", () => {
  it("finds nothing in a balanced list, however deeply the regions nest", () => {
    expect(findConstructMarkerImbalance(nestedConstructBlocks)).toBeUndefined();
  });

  it("finds nothing in a list with no markers at all, empty or otherwise", () => {
    expect(findConstructMarkerImbalance([])).toBeUndefined();
    expect(
      findConstructMarkerImbalance([paragraph, image, pageBreak]),
    ).toBeUndefined();
  });

  it("finds nothing across two sibling regions that open and close in turn", () => {
    expect(
      findConstructMarkerImbalance([
        constructStart({ kind: "anchor", anchorType: "bookmark", name: "a" }),
        constructEnd,
        constructStart({ kind: "anchor", anchorType: "bookmark", name: "b" }),
        constructEnd,
      ]),
    ).toBeUndefined();
  });

  it("reports the close that had nothing open, at its own index", () => {
    expect(
      findConstructMarkerImbalance([paragraph, constructEnd]),
    ).toStrictEqual({ kind: "unmatchedEnd", index: 1 });
    expect(
      findConstructMarkerImbalance([
        constructStart({ kind: "anchor", anchorType: "bookmark", name: "a" }),
        constructEnd,
        constructEnd,
      ]),
    ).toStrictEqual({ kind: "unmatchedEnd", index: 2 });
  });

  it("reports the outermost still-open start, not the innermost, when the list ends mid-region", () => {
    expect(
      findConstructMarkerImbalance([
        constructStart({ kind: "division", name: "Chapter 1" }),
        constructStart({ kind: "provenance", change: "insertion" }),
        { kind: "paragraph", runs: [{ text: "Never closed." }] },
        constructEnd,
      ]),
    ).toStrictEqual({ kind: "unclosedStart", index: 0 });
  });

  it("reports the earlier fault when a list is unbalanced in both directions", () => {
    expect(
      findConstructMarkerImbalance([
        constructEnd,
        constructStart({ kind: "anchor", anchorType: "bookmark", name: "a" }),
      ]),
    ).toStrictEqual({ kind: "unmatchedEnd", index: 0 });
  });
});

// — Run-level construct extents (the flat form's encoding of a construct whose extent is a sub-sequence of one paragraph's runs) --

// A mid-paragraph bookmark over the middle two runs of four, a point anchor between runs, and a field over the paragraph's tail — the three shapes the run-level mechanism exists for, each spelled as the descriptor-plus-half-open-run-range entry ContentParagraph.constructs carries.
