import { describe, expect, it } from "vitest";
import { ContentParagraphSchema } from "./content";
import {
  ContentImageBlockSchema,
  ContentRunSchema,
} from "./content-vocabulary";
import {} from "./content-sheet";

// Deliberately deep nesting: a table whose cell contains a table whose cell contains a table — the highest-risk case for the hand-written recursive isContentBlock guard. Typed as ContentTable (not the broader ContentBlock union) at each level so the nested `.rows`/`.cells` access below needs no narrowing or assertion.

describe("ContentParagraphSchema headingLevel", () => {
  it("accepts an explicit heading level, independent of styleId", () => {
    const parsed = ContentParagraphSchema.parse({
      kind: "paragraph",
      runs: [{ text: "A heading" }],
      styleId: "Heading2",
      headingLevel: 2,
    });
    expect(parsed.headingLevel).toBe(2);
    expect(parsed.styleId).toBe("Heading2");
  });

  it("accepts a heading level beyond 6, since the canonical field is not itself clamped (ODF permits ten levels)", () => {
    const headingLevelBeyondTypicalMax = 9;
    expect(
      ContentParagraphSchema.parse({
        kind: "paragraph",
        runs: [],
        headingLevel: headingLevelBeyondTypicalMax,
      }).headingLevel,
    ).toBe(headingLevelBeyondTypicalMax);
  });

  it("parses with headingLevel omitted, matching every other optional field", () => {
    const parsed = ContentParagraphSchema.parse({
      kind: "paragraph",
      runs: [{ text: "Body text" }],
    });
    expect(parsed.headingLevel).toBeUndefined();
  });

  it("rejects a zero, negative, or non-integer headingLevel", () => {
    expect(
      ContentParagraphSchema.safeParse({
        kind: "paragraph",
        runs: [],
        headingLevel: 0,
      }).success,
    ).toBe(false);
    expect(
      ContentParagraphSchema.safeParse({
        kind: "paragraph",
        runs: [],
        headingLevel: -1,
      }).success,
    ).toBe(false);
    expect(
      ContentParagraphSchema.safeParse({
        kind: "paragraph",
        runs: [],
        headingLevel: 1.5,
      }).success,
    ).toBe(false);
  });

  it("survives a JSON round trip", () => {
    const original = ContentParagraphSchema.parse({
      kind: "paragraph",
      runs: [{ text: "Heading" }],
      headingLevel: 3,
    });
    const roundTripped: unknown = JSON.parse(JSON.stringify(original));
    expect(ContentParagraphSchema.parse(roundTripped)).toEqual(original);
  });
});

describe("ContentParagraph pageBreakBefore/pageBreakAfter", () => {
  it("parses both page-break flags, the canonical spelling of a paragraph style that forces a page boundary", () => {
    const parsed = ContentParagraphSchema.parse({
      kind: "paragraph",
      runs: [{ text: "Starts a new page" }],
      pageBreakBefore: true,
      pageBreakAfter: true,
    });
    expect(parsed.pageBreakBefore).toBe(true);
    expect(parsed.pageBreakAfter).toBe(true);
  });

  it("parses with both omitted, matching every other optional field", () => {
    const parsed = ContentParagraphSchema.parse({
      kind: "paragraph",
      runs: [{ text: "Body" }],
    });
    expect(parsed.pageBreakBefore).toBeUndefined();
    expect(parsed.pageBreakAfter).toBeUndefined();
  });

  it("rejects a non-boolean value for either flag", () => {
    expect(
      ContentParagraphSchema.safeParse({
        kind: "paragraph",
        runs: [],
        pageBreakBefore: "page",
      }).success,
    ).toBe(false);
    expect(
      ContentParagraphSchema.safeParse({
        kind: "paragraph",
        runs: [],
        pageBreakAfter: 1,
      }).success,
    ).toBe(false);
  });
});

describe("ContentListMembership numId", () => {
  it("parses a level-only membership, the shape a format with depth but no numbering identity produces (OOXML drawing paragraphs carry only a:pPr/@lvl)", () => {
    const parsed = ContentParagraphSchema.parse({
      kind: "paragraph",
      runs: [{ text: "Bullet text" }],
      list: { level: 1 },
    });
    expect(parsed.list).toEqual({ level: 1 });
  });

  it("still parses a numId+level membership, the shape a format with a shared numbering definition produces (docx w:numId, ODF minted identity)", () => {
    const parsed = ContentParagraphSchema.parse({
      kind: "paragraph",
      runs: [{ text: "Item one" }],
      list: { numId: "1", level: 0 },
    });
    expect(parsed.list).toEqual({ numId: "1", level: 0 });
  });

  it("keeps level required, so a membership without one does not parse", () => {
    expect(
      ContentParagraphSchema.safeParse({
        kind: "paragraph",
        runs: [],
        list: { numId: "1" },
      }).success,
    ).toBe(false);
    expect(
      ContentParagraphSchema.safeParse({
        kind: "paragraph",
        runs: [],
        list: {},
      }).success,
    ).toBe(false);
  });
});

describe("ContentListMembership checked and itemId", () => {
  it("parses a checked membership, the GFM task-list-item state a markdown fence's checkbox carries", () => {
    const parsed = ContentParagraphSchema.parse({
      kind: "paragraph",
      runs: [{ text: "done" }],
      list: { numId: "md1:bullet+task", level: 0, checked: true },
    });
    expect(parsed.list).toEqual({
      numId: "md1:bullet+task",
      level: 0,
      checked: true,
    });
  });

  it("parses an itemId membership, the identity distinguishing one multi-block list item from several single-block siblings sharing a numId and level", () => {
    const parsed = ContentParagraphSchema.parse({
      kind: "paragraph",
      runs: [{ text: "second block of one item" }],
      list: { numId: "md1:bullet", level: 0, itemId: "md-i1" },
    });
    expect(parsed.list).toEqual({
      numId: "md1:bullet",
      level: 0,
      itemId: "md-i1",
    });
  });

  it("keeps both fields optional, so a membership carrying neither parses exactly as before", () => {
    const parsed = ContentParagraphSchema.parse({
      kind: "paragraph",
      runs: [{ text: "Item one" }],
      list: { numId: "1", level: 0 },
    });
    expect(parsed.list).toEqual({ numId: "1", level: 0 });
  });

  it("refuses a checked that is not a boolean, so the checkbox state cannot silently degrade to a truthy string", () => {
    expect(
      ContentParagraphSchema.safeParse({
        kind: "paragraph",
        runs: [],
        list: { level: 0, checked: "yes" },
      }).success,
    ).toBe(false);
  });

  it("refuses an itemId that is not a string, keeping the item identity an opaque producer-minted key", () => {
    expect(
      ContentParagraphSchema.safeParse({
        kind: "paragraph",
        runs: [],
        list: { level: 0, itemId: 1 },
      }).success,
    ).toBe(false);
  });

  it("parses a numbering format, distinguishing an ordered list from a bulleted one", () => {
    const parsed = ContentParagraphSchema.parse({
      kind: "paragraph",
      runs: [{ text: "First" }],
      list: { level: 0, format: "decimal" },
    });
    expect(parsed.list).toEqual({ level: 0, format: "decimal" });
  });

  it("refuses a format outside the closed numbering-format vocabulary", () => {
    expect(
      ContentParagraphSchema.safeParse({
        kind: "paragraph",
        runs: [],
        list: { level: 0, format: "hebrew" },
      }).success,
    ).toBe(false);
  });
});

describe("ContentRun verticalAlign and direction", () => {
  it("parses a superscript run", () => {
    expect(
      ContentRunSchema.parse({ text: "x", verticalAlign: "superscript" })
        .verticalAlign,
    ).toBe("superscript");
  });

  it("parses a subscript run", () => {
    expect(
      ContentRunSchema.parse({ text: "x", verticalAlign: "subscript" })
        .verticalAlign,
    ).toBe("subscript");
  });

  it("refuses a verticalAlign outside superscript/subscript", () => {
    expect(
      ContentRunSchema.safeParse({ text: "x", verticalAlign: "baseline" })
        .success,
    ).toBe(false);
  });

  it("parses an rtl run, RTF's own \\rtlch scope", () => {
    expect(
      ContentRunSchema.parse({ text: "x", direction: "rtl" }).direction,
    ).toBe("rtl");
  });

  it("keeps both fields optional, so a run carrying neither parses exactly as before", () => {
    const parsed = ContentRunSchema.parse({ text: "plain" });
    expect(parsed.verticalAlign).toBeUndefined();
    expect(parsed.direction).toBeUndefined();
  });
});

describe("ContentParagraph indentRightPt and direction", () => {
  it("parses a right indent alongside the existing left/first-line indents", () => {
    const indentRightPt = 18;
    const parsed = ContentParagraphSchema.parse({
      kind: "paragraph",
      runs: [],
      indentLeftPt: 36,
      indentRightPt,
    });
    expect(parsed.indentRightPt).toBe(indentRightPt);
  });

  it("parses an rtl paragraph, RTF's own \\rtlpar scope", () => {
    const parsed = ContentParagraphSchema.parse({
      kind: "paragraph",
      runs: [],
      direction: "rtl",
    });
    expect(parsed.direction).toBe("rtl");
  });
});

describe("ContentImageBlock format", () => {
  it.each(["png", "jpeg", "svg", "gif"] as const)("accepts %s", (format) => {
    expect(
      ContentImageBlockSchema.parse({
        kind: "image",
        format,
        base64: "",
        widthPt: 10,
        heightPt: 10,
      }).format,
    ).toBe(format);
  });

  it("refuses a format outside the closed vocabulary", () => {
    expect(
      ContentImageBlockSchema.safeParse({
        kind: "image",
        format: "webp",
        base64: "",
        widthPt: 10,
        heightPt: 10,
      }).success,
    ).toBe(false);
  });
});

describe("ContentImageBlock floatPosition", () => {
  function buildFloatingImage(floatPosition?: unknown) {
    return {
      kind: "image",
      format: "png",
      base64: "",
      widthPt: 10,
      heightPt: 10,
      ...(floatPosition === undefined ? {} : { floatPosition }),
    };
  }

  it("accepts an offset-based position on both axes — the shape ODF's draw:frame always takes, and docx's wp:anchor takes when wp:posOffset is used", () => {
    const result = ContentImageBlockSchema.parse(
      buildFloatingImage({
        horizontal: { relativeTo: "page", offsetPt: 36 },
        vertical: { relativeTo: "paragraph", offsetPt: -12 },
      }),
    );
    expect(result.floatPosition).toEqual({
      horizontal: { relativeTo: "page", offsetPt: 36 },
      vertical: { relativeTo: "paragraph", offsetPt: -12 },
    });
  });

  it("accepts an align-based position on both axes — the shape docx's wp:anchor takes when wp:align is used instead of wp:posOffset", () => {
    const result = ContentImageBlockSchema.parse(
      buildFloatingImage({
        horizontal: { relativeTo: "margin", align: "right" },
        vertical: { relativeTo: "margin", align: "top" },
      }),
    );
    expect(result.floatPosition).toEqual({
      horizontal: { relativeTo: "margin", align: "right" },
      vertical: { relativeTo: "margin", align: "top" },
    });
  });

  it("accepts one axis offset-based and the other align-based — docx's own wp:positionH/wp:positionV choose independently per axis", () => {
    expect(
      ContentImageBlockSchema.safeParse(
        buildFloatingImage({
          horizontal: { relativeTo: "column", offsetPt: 18 },
          vertical: { relativeTo: "line", align: "bottom" },
        }),
      ).success,
    ).toBe(true);
  });

  it("refuses an axis carrying both offsetPt and align at once — a state neither docx's wp:positionH/wp:positionV nor ODF's draw:frame can actually produce", () => {
    expect(
      ContentImageBlockSchema.safeParse(
        buildFloatingImage({
          horizontal: { relativeTo: "page", offsetPt: 36, align: "left" },
          vertical: { relativeTo: "page", offsetPt: 0 },
        }),
      ).success,
    ).toBe(false);
  });

  it("refuses an axis carrying neither offsetPt nor align", () => {
    expect(
      ContentImageBlockSchema.safeParse(
        buildFloatingImage({
          horizontal: { relativeTo: "page" },
          vertical: { relativeTo: "page", offsetPt: 0 },
        }),
      ).success,
    ).toBe(false);
  });

  it("refuses an origin outside the closed vocabulary", () => {
    expect(
      ContentImageBlockSchema.safeParse(
        buildFloatingImage({
          horizontal: { relativeTo: "bogus", offsetPt: 0 },
          vertical: { relativeTo: "page", offsetPt: 0 },
        }),
      ).success,
    ).toBe(false);
  });

  it("is absent by default — an inline image has no anchored position of its own to record", () => {
    expect(
      ContentImageBlockSchema.parse(buildFloatingImage()).floatPosition,
    ).toBeUndefined();
  });
});
