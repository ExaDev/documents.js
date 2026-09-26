import { describe, expect, it } from "vitest";
import {
  ContentBlockSchema,
  ContentParagraphSchema,
  clampHeadingLevel,
} from "./content";
import { ContentRunSchema } from "./content-vocabulary";
import {
  ContentSheetCellSchema,
  ContentSheetColumnSchema,
  ContentSheetRowSchema,
} from "./content-sheet";
import { ContentShapeSchema } from "./content-drawing";

import { LayoutFrameSchema } from "./geometry";
import { LayoutMetadataSchema } from "./metadata";

// Deliberately deep nesting: a table whose cell contains a table whose cell contains a table — the highest-risk case for the hand-written recursive isContentBlock guard. Typed as ContentTable (not the broader ContentBlock union) at each level so the nested `.rows`/`.cells` access below needs no narrowing or assertion.

describe("LayoutMetadata publication and provenance fields", () => {
  it("parses the full set of newly added fields", () => {
    const parsed = LayoutMetadataSchema.parse({
      publisher: "Acme Press",
      contributor: "J. Editor",
      rights: "CC-BY-4.0",
      identifier: "urn:isbn:0000000000",
      comments: "Draft for review",
      lastPrintedIso: "2026-01-01T00:00:00Z",
      company: "Acme Corp",
      manager: "A. Manager",
      direction: "rtl",
    });
    expect(parsed).toMatchObject({
      publisher: "Acme Press",
      contributor: "J. Editor",
      rights: "CC-BY-4.0",
      identifier: "urn:isbn:0000000000",
      comments: "Draft for review",
      lastPrintedIso: "2026-01-01T00:00:00Z",
      company: "Acme Corp",
      manager: "A. Manager",
      direction: "rtl",
    });
  });

  it("keeps every new field optional, so metadata carrying none of them parses exactly as before", () => {
    expect(LayoutMetadataSchema.parse({ title: "Plain" })).toEqual({
      title: "Plain",
    });
  });
});

describe("ContentParagraph codeLanguage", () => {
  it("parses a code-styled paragraph carrying a source-format language identifier, the markdown fence's info word", () => {
    const parsed = ContentParagraphSchema.parse({
      kind: "paragraph",
      runs: [{ text: "console.log(1);" }],
      styleId: "CodeBlock",
      codeLanguage: "js",
    });
    expect(parsed.codeLanguage).toBe("js");
  });

  it("leaves the field optional, so an ordinary paragraph and a language-less code block parse exactly as before", () => {
    const plain = ContentParagraphSchema.parse({
      kind: "paragraph",
      runs: [{ text: "text" }],
    });
    expect("codeLanguage" in plain).toBe(false);
    const bare = ContentParagraphSchema.parse({
      kind: "paragraph",
      runs: [],
      styleId: "CodeBlock",
    });
    expect("codeLanguage" in bare).toBe(false);
  });

  it("refuses a non-string, so the language word cannot arrive as a structured value this field never promised to hold", () => {
    expect(
      ContentParagraphSchema.safeParse({
        kind: "paragraph",
        runs: [],
        codeLanguage: { name: "js" },
      }).success,
    ).toBe(false);
  });
});

describe("ContentParagraph preformatted", () => {
  it("parses a paragraph whose whitespace must survive verbatim, independent of codeLanguage", () => {
    const parsed = ContentParagraphSchema.parse({
      kind: "paragraph",
      runs: [{ text: "line one\nline two" }],
      preformatted: true,
    });
    expect(parsed.preformatted).toBe(true);
    expect("codeLanguage" in parsed).toBe(false);
  });

  it("leaves the field optional, so an ordinary paragraph parses exactly as before", () => {
    const plain = ContentParagraphSchema.parse({
      kind: "paragraph",
      runs: [{ text: "text" }],
    });
    expect("preformatted" in plain).toBe(false);
  });

  it("refuses a non-boolean, so the flag cannot arrive as a structured or string value this field never promised to hold", () => {
    expect(
      ContentParagraphSchema.safeParse({
        kind: "paragraph",
        runs: [],
        preformatted: "true",
      }).success,
    ).toBe(false);
  });
});

describe("clampHeadingLevel", () => {
  // The clamp's own bound, mirrored here rather than imported since content.ts keeps it private.
  const MAX_HEADING_LEVEL = 6;

  it("leaves a level already within 1-6 untouched", () => {
    const midRangeLevel = 3;
    expect(clampHeadingLevel(1)).toBe(1);
    expect(clampHeadingLevel(midRangeLevel)).toBe(midRangeLevel);
    expect(clampHeadingLevel(MAX_HEADING_LEVEL)).toBe(MAX_HEADING_LEVEL);
  });

  it("clamps a level above 6 down to 6", () => {
    const justAboveMax = 7;
    const wellAboveMax = 10;
    const farAboveMax = 999;
    expect(clampHeadingLevel(justAboveMax)).toBe(MAX_HEADING_LEVEL);
    expect(clampHeadingLevel(wellAboveMax)).toBe(MAX_HEADING_LEVEL);
    expect(clampHeadingLevel(farAboveMax)).toBe(MAX_HEADING_LEVEL);
  });

  it("clamps a level below 1 up to 1", () => {
    const wellBelowMin = -5;
    expect(clampHeadingLevel(0)).toBe(1);
    expect(clampHeadingLevel(wellBelowMin)).toBe(1);
  });

  it("rounds a fractional level to the nearest integer before clamping", () => {
    const roundsDown = 2.4;
    const roundsUp = 2.6;
    const roundedUpLevel = 3;
    expect(clampHeadingLevel(roundsDown)).toBe(2);
    expect(clampHeadingLevel(roundsUp)).toBe(roundedUpLevel);
  });
});

describe("frames (the FusedNode pattern)", () => {
  it("accepts a LayoutFrame array on every content-kind leaf that carries one", () => {
    const frame = {
      pageIndex: 0,
      xPt: 10,
      yPt: 700,
      widthPt: 100,
      heightPt: 12,
    };

    expect(
      ContentRunSchema.parse({ text: "Fused", frames: [frame] }).frames,
    ).toEqual([frame]);
    expect(
      ContentParagraphSchema.parse({
        kind: "paragraph",
        runs: [],
        frames: [frame],
      }).frames,
    ).toEqual([frame]);
    expect(
      ContentBlockSchema.parse({
        kind: "image",
        format: "png",
        base64: "AA==",
        widthPt: 1,
        heightPt: 1,
        frames: [frame],
      }),
    ).toMatchObject({ frames: [frame] });
    expect(
      ContentBlockSchema.parse({ kind: "pageBreak", frames: [frame] }),
    ).toMatchObject({ frames: [frame] });

    const shape = ContentShapeSchema.parse({
      frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
      insetLeftPt: 0,
      insetTopPt: 0,
      insetRightPt: 0,
      insetBottomPt: 0,
      blocks: [],
      frames: [frame],
    });
    expect(shape.frames).toEqual([frame]);

    const cell = ContentSheetCellSchema.parse({
      row: 0,
      column: 0,
      value: { kind: "string", value: "x" },
      displayText: "x",
      frames: [frame],
    });
    expect(cell.frames).toEqual([frame]);
  });

  it("accepts a node with multiple frames — one node appearing at more than one rendered position", () => {
    const frames = [
      { pageIndex: 0, xPt: 72, yPt: 60, widthPt: 468, heightPt: 24 },
      { pageIndex: 1, xPt: 72, yPt: 720, widthPt: 200, heightPt: 12 },
    ];
    const parsed = ContentParagraphSchema.parse({
      kind: "paragraph",
      runs: [],
      frames,
    });
    expect(parsed.frames).toHaveLength(2);
    expect(parsed.frames?.map((f) => f.pageIndex)).toEqual([0, 1]);
  });

  it("parses correctly when frames is omitted, matching every other optional field", () => {
    expect(
      ContentRunSchema.parse({ text: "No frames" }).frames,
    ).toBeUndefined();
  });

  it("rejects a malformed frame (negative pageIndex, missing fields)", () => {
    expect(
      LayoutFrameSchema.safeParse({
        pageIndex: -1,
        xPt: 0,
        yPt: 0,
        widthPt: 1,
        heightPt: 1,
      }).success,
    ).toBe(false);
    expect(
      LayoutFrameSchema.safeParse({ pageIndex: 0, xPt: 0, yPt: 0 }).success,
    ).toBe(false);
    expect(
      ContentRunSchema.safeParse({
        text: "Bad",
        frames: [{ pageIndex: -1, xPt: 0, yPt: 0, widthPt: 1, heightPt: 1 }],
      }).success,
    ).toBe(false);
  });
});

describe("ContentSheetCell comment", () => {
  it("accepts a legacy-style note — text alone, or with author and createdAt, no replies", () => {
    const bare = ContentSheetCellSchema.parse({
      row: 0,
      column: 0,
      value: { kind: "string", value: "x" },
      displayText: "x",
      comment: { text: "Check this figure." },
    });
    expect(bare.comment).toEqual({ text: "Check this figure." });

    const attributed = ContentSheetCellSchema.parse({
      row: 0,
      column: 0,
      value: { kind: "string", value: "x" },
      displayText: "x",
      comment: {
        text: "Check this figure.",
        author: "Robin Achebe",
        createdAt: "2026-08-17T09:30:00Z",
      },
    });
    expect(attributed.comment?.replies).toBeUndefined();
  });

  it("accepts a threaded comment and preserves reply order", () => {
    const parsed = ContentSheetCellSchema.parse({
      row: 3,
      column: 7,
      value: { kind: "number", value: 42 },
      displayText: "42",
      comment: {
        text: "Excludes the late Q4 bookings.",
        author: "Joseph Mearman",
        replies: [
          { text: "Confirmed against the ledger.", author: "Robin Achebe" },
          { text: "Noted.", author: "Joseph Mearman" },
        ],
      },
    });
    expect(parsed.comment?.replies?.map((reply) => reply.text)).toEqual([
      "Confirmed against the ledger.",
      "Noted.",
    ]);
  });

  it("parses correctly when comment is omitted, matching every other optional field", () => {
    expect(
      ContentSheetCellSchema.parse({
        row: 0,
        column: 0,
        value: { kind: "empty" },
        displayText: "",
      }).comment,
    ).toBeUndefined();
  });

  it("rejects a comment with no text, and a reply with no text", () => {
    expect(
      ContentSheetCellSchema.safeParse({
        row: 0,
        column: 0,
        value: { kind: "empty" },
        displayText: "",
        comment: { author: "Robin Achebe" },
      }).success,
    ).toBe(false);
    expect(
      ContentSheetCellSchema.safeParse({
        row: 0,
        column: 0,
        value: { kind: "empty" },
        displayText: "",
        comment: { text: "Root", replies: [{ author: "Robin Achebe" }] },
      }).success,
    ).toBe(false);
  });
});

describe("ContentSheetColumn/ContentSheetRow sizes", () => {
  it('accepts an entry with no declared size, meaning "use the application default"', () => {
    expect(ContentSheetColumnSchema.parse({ index: 3 })).toEqual({ index: 3 });
    expect(ContentSheetRowSchema.parse({ index: 3, hidden: true })).toEqual({
      index: 3,
      hidden: true,
    });
  });

  it("rejects an explicit zero size, which previously parsed and was then treated as authoritative", () => {
    expect(
      ContentSheetColumnSchema.safeParse({ index: 0, widthPt: 0 }).success,
    ).toBe(false);
    expect(
      ContentSheetRowSchema.safeParse({ index: 0, heightPt: 0 }).success,
    ).toBe(false);
  });
});
