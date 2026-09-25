import { describe, expect, it } from "vitest";
import {
  assertNeverLayoutItem,
  attachCaptions,
  horizontallyOverlaps,
  verticalGap,
  type PdfRegion,
} from "./pdf-regions";
import {
  PRECISION_DIGITS,
  textItem,
} from "../test-support/pdf-region-fixtures";

describe("attachCaptions", () => {
  // Mirrors pdf-regions.ts's own private CAPTION_MAX_CHARS.
  const CAPTION_MAX_CHARS = 160;

  const figureRegion: PdfRegion = {
    bounds: { xPt: 100, yPt: 400, widthPt: 100, heightPt: 100 },
    items: [],
    classification: "figure",
    confidence: 0.9,
  };

  const captionWidthPt = 10;

  function textRegion(
    bounds: PdfRegion["bounds"],
    text: string,
    classification: PdfRegion["classification"] = "column",
  ): PdfRegion {
    return {
      bounds,
      items: [
        { ...textItem(bounds.xPt, captionWidthPt), text, yPt: bounds.yPt },
      ],
      classification,
      confidence: 0.5,
    };
  }

  it("attaches a short, vertically-adjacent, horizontally-overlapping column region as a caption", () => {
    const caption = textRegion(
      { xPt: 100, yPt: 385, widthPt: 100, heightPt: 10 },
      "Figure 1.",
    );
    const [region] = attachCaptions([figureRegion, caption]);
    // The figure itself is no longer untouched: it now carries the matched caption's text on its own `caption` field, in addition to the caption staying its own 'caption'-classified region below.
    expect(region).toEqual({ ...figureRegion, caption: "Figure 1." });
    const result = attachCaptions([figureRegion, caption])[1]!;
    expect(result.classification).toBe("caption");
  });

  it("does not attach a caption whose own text exceeds the caption length cap", () => {
    const longText = "x".repeat(CAPTION_MAX_CHARS + 1);
    const tooLong = textRegion(
      { xPt: 100, yPt: 385, widthPt: 100, heightPt: 10 },
      longText,
    );
    const result = attachCaptions([figureRegion, tooLong])[1]!;
    expect(result.classification).not.toBe("caption");
  });

  it("does not attach a caption to a figure it does not horizontally overlap", () => {
    const farRight = textRegion(
      { xPt: 500, yPt: 385, widthPt: 50, heightPt: 10 },
      "Nearby but not overlapping.",
    );
    const result = attachCaptions([figureRegion, farRight])[1]!;
    expect(result.classification).not.toBe("caption");
  });

  it("only leaves a non-column/unknown classification (e.g. table) untouched, never reclassifying it", () => {
    const tableRegion = textRegion(
      { xPt: 100, yPt: 385, widthPt: 100, heightPt: 10 },
      "Short.",
      "table",
    );
    const result = attachCaptions([figureRegion, tableRegion])[1]!;
    expect(result.classification).toBe("table");
  });

  it("picks the nearest of two candidate figures by vertical gap, not the first one checked", () => {
    const closeFigure: PdfRegion = {
      ...figureRegion,
      bounds: { xPt: 100, yPt: 300, widthPt: 100, heightPt: 50 },
    };
    const farFigure: PdfRegion = {
      ...figureRegion,
      bounds: { xPt: 100, yPt: 500, widthPt: 100, heightPt: 100 },
    };
    // Caption sits just above closeFigure (gap ~5) and far below farFigure's own bottom.
    const caption = textRegion(
      { xPt: 100, yPt: 355, widthPt: 100, heightPt: 10 },
      "Figure caption.",
    );
    const results = attachCaptions([farFigure, closeFigure, caption]);
    const result = results[2]!;
    expect(result.classification).toBe("caption");
    // Confidence derived from the CLOSE figure's small gap should be high, not the far figure's (which wouldn't even qualify within CAPTION_GAP_PT).
    const confidenceFloor = 0.5;
    expect(result.confidence).toBeGreaterThan(confidenceFloor);
  });

  it("only considers genuine figure regions as caption candidates, not every region", () => {
    const nonFigure: PdfRegion = {
      bounds: { xPt: 100, yPt: 400, widthPt: 100, heightPt: 100 },
      items: [],
      classification: "table",
      confidence: 0.9,
    };
    const caption = textRegion(
      { xPt: 100, yPt: 385, widthPt: 100, heightPt: 10 },
      "Figure 1.",
    );
    const result = attachCaptions([nonFigure, caption])[1]!;
    expect(result.classification).not.toBe("caption");
  });

  it("joins a region's own multiple text items with a space before measuring caption length", () => {
    const wordOneX = 100;
    const wordTwoX = 140;
    const glyphWidth = 5;
    const twoWordCaption: PdfRegion = {
      bounds: { xPt: 100, yPt: 385, widthPt: 100, heightPt: 10 },
      items: [
        { ...textItem(wordOneX, glyphWidth), text: "Figure", yPt: 385 },
        { ...textItem(wordTwoX, glyphWidth), text: "1.", yPt: 385 },
      ],
      classification: "column",
      confidence: 0.5,
    };
    const result = attachCaptions([figureRegion, twoWordCaption])[1]!;
    expect(result.classification).toBe("caption");
  });

  it("still attaches at exactly the caption length cap, only rejecting one character past it", () => {
    const atCap = textRegion(
      { xPt: 100, yPt: 385, widthPt: 100, heightPt: 10 },
      "x".repeat(CAPTION_MAX_CHARS),
    );
    const result = attachCaptions([figureRegion, atCap])[1]!;
    expect(result.classification).toBe("caption");
  });

  it("still attaches at exactly the caption gap cap, not only strictly inside it", () => {
    // figureRegion spans y=[400,500]; a caption whose own top (yPt + heightPt) sits exactly CAPTION_GAP_PT (24) below that (bottom 400) must still qualify: top = 400 - 24 = 376, so yPt = 376 - 10 = 366.
    const atGapCap = textRegion(
      { xPt: 100, yPt: 366, widthPt: 100, heightPt: 10 },
      "Figure 1.",
    );
    const result = attachCaptions([figureRegion, atGapCap])[1]!;
    expect(result.classification).toBe("caption");
  });

  it("treats a non-text item mixed into a candidate caption region's items as contributing no text at all", () => {
    const wordOneX = 100;
    const graphicX = 140;
    const wordTwoX = 150;
    const glyphWidth = 5;
    const wordLength = 77;
    const withGraphic: PdfRegion = {
      bounds: { xPt: 100, yPt: 385, widthPt: 100, heightPt: 10 },
      items: [
        {
          ...textItem(wordOneX, glyphWidth),
          text: "x".repeat(wordLength),
          yPt: 385,
        },
        {
          kind: "rect",
          xPt: graphicX,
          yPt: 385,
          widthPt: glyphWidth,
          heightPt: glyphWidth,
        },
        {
          ...textItem(wordTwoX, glyphWidth),
          text: "x".repeat(wordLength),
          yPt: 385,
        },
      ],
      classification: "column",
      confidence: 0.5,
    };
    // Joined length is wordLength + 1 + 0 + 1 + wordLength = 156 if the rect contributes "" as it should — comfortably under CAPTION_MAX_CHARS. If it instead contributed a placeholder string in its place, the joined length would jump past the cap and this would no longer qualify as a caption.
    const result = attachCaptions([figureRegion, withGraphic])[1]!;
    expect(result.classification).toBe("caption");
  });

  it("trims surrounding whitespace before measuring caption length, not just joining", () => {
    const paddedAtCap = textRegion(
      { xPt: 100, yPt: 385, widthPt: 100, heightPt: 10 },
      `  ${"x".repeat(CAPTION_MAX_CHARS)}  `, // untrimmed length 164, but trims down to exactly the caption cap
    );
    const result = attachCaptions([figureRegion, paddedAtCap])[1]!;
    expect(result.classification).toBe("caption");
  });

  it("counts the space between joined text items toward the caption length cap", () => {
    const wordOneX = 100;
    const wordTwoX = 200;
    const glyphWidth = 5;
    const halfCapWordLength = CAPTION_MAX_CHARS / 2;
    const longTwoWordCaption: PdfRegion = {
      bounds: { xPt: 100, yPt: 385, widthPt: 100, heightPt: 10 },
      items: [
        {
          ...textItem(wordOneX, glyphWidth),
          text: "a".repeat(halfCapWordLength),
          yPt: 385,
        },
        {
          ...textItem(wordTwoX, glyphWidth),
          text: "a".repeat(halfCapWordLength),
          yPt: 385,
        },
      ],
      classification: "column",
      confidence: 0.5,
    };
    // Joined with the real " " separator this is CAPTION_MAX_CHARS + 1 characters (halfCapWordLength + 1 + halfCapWordLength), one past the cap; joined with no separator at all it would be exactly at the cap, wrongly still qualifying.
    const result = attachCaptions([figureRegion, longTwoWordCaption])[1]!;
    expect(result.classification).not.toBe("caption");
  });

  it("does not attach a whitespace-only text region as a caption", () => {
    const blank = textRegion(
      { xPt: 100, yPt: 385, widthPt: 100, heightPt: 10 },
      "   ",
    );
    const result = attachCaptions([figureRegion, blank])[1]!;
    expect(result.classification).not.toBe("caption");
  });

  it("never lets a later-checked qualifying figure override an already-found nearer one", () => {
    const nearFigure: PdfRegion = {
      ...figureRegion,
      bounds: { xPt: 100, yPt: 370, widthPt: 100, heightPt: 50 },
    };
    const farFigure: PdfRegion = {
      ...figureRegion,
      bounds: { xPt: 100, yPt: 385, widthPt: 100, heightPt: 50 },
    };
    const caption = textRegion(
      { xPt: 100, yPt: 355, widthPt: 100, heightPt: 10 },
      "Figure 1.",
    );
    // nearFigure (gap 5) is checked before farFigure (gap 20); a correct "strictly closer" comparison must keep nearFigure as nearest, not let farFigure unconditionally overwrite it.
    const result = attachCaptions([nearFigure, farFigure, caption])[2]!;
    expect(result.classification).toBe("caption");
    const nearGap = 5;
    const captionGapPt = 24; // Mirrors pdf-regions.ts's own private CAPTION_GAP_PT.
    expect(result.confidence).toBeCloseTo(
      1 - nearGap / captionGapPt,
      PRECISION_DIGITS,
    );
  });

  it("gives a figure the nearer of two caption candidates even when the nearer one is checked second", () => {
    // Candidates are visited in array order, so this is the arrangement where keeping the first-seen candidate and replacing it with a strictly nearer later one give different answers. The far run is 20pt above figureRegion (top 500) and the near run 5pt below it (bottom 400).
    const far = textRegion(
      { xPt: 100, yPt: 520, widthPt: 100, heightPt: 10 },
      "The farther run.",
    );
    const near = textRegion(
      { xPt: 100, yPt: 385, widthPt: 100, heightPt: 10 },
      "The nearer run.",
    );
    const [figure] = attachCaptions([figureRegion, far, near]);
    expect(figure?.caption).toBe("The nearer run.");
  });

  it("keeps the first of two caption candidates that are exactly as near as each other", () => {
    // 15pt above and 15pt below figureRegion: an exact tie, which the strictly-closer comparison resolves in favour of the candidate seen first, so a later run never displaces an equally near one.
    const first = textRegion(
      { xPt: 100, yPt: 515, widthPt: 100, heightPt: 10 },
      "The first run.",
    );
    const second = textRegion(
      { xPt: 100, yPt: 375, widthPt: 100, heightPt: 10 },
      "The second run.",
    );
    const [figure] = attachCaptions([figureRegion, first, second]);
    expect(figure?.caption).toBe("The first run.");
  });

  it("claims a run for the first of two figures that are exactly as near as each other", () => {
    // One run sits 15pt above figureRegion (top 500) and 15pt below a second figure (bottom 540): an exact tie between the two figures, resolved in favour of the figure seen first, so only that one carries the run's text.
    const upperFigure: PdfRegion = {
      ...figureRegion,
      bounds: { xPt: 100, yPt: 540, widthPt: 100, heightPt: 100 },
    };
    const between = textRegion(
      { xPt: 100, yPt: 515, widthPt: 100, heightPt: 10 },
      "Between two figures.",
    );
    const [lower, upper] = attachCaptions([figureRegion, upperFigure, between]);
    expect(lower?.caption).toBe("Between two figures.");
    expect(upper?.caption).toBeUndefined();
  });
});

describe("horizontallyOverlaps", () => {
  it("is true when the two spans genuinely overlap", () => {
    expect(
      horizontallyOverlaps(
        { xPt: 0, yPt: 0, widthPt: 10, heightPt: 1 },
        { xPt: 5, yPt: 0, widthPt: 10, heightPt: 1 },
      ),
    ).toBe(true);
  });

  it("is false when one span ends exactly where the other begins", () => {
    expect(
      horizontallyOverlaps(
        { xPt: 0, yPt: 0, widthPt: 10, heightPt: 1 },
        { xPt: 10, yPt: 0, widthPt: 10, heightPt: 1 },
      ),
    ).toBe(false);
  });

  it("is false when the FIRST span's own start exactly touches the second span's end (the mirrored boundary)", () => {
    expect(
      horizontallyOverlaps(
        { xPt: 10, yPt: 0, widthPt: 10, heightPt: 1 },
        { xPt: 0, yPt: 0, widthPt: 10, heightPt: 1 },
      ),
    ).toBe(false);
  });

  it("is false when the spans are far apart in either direction", () => {
    expect(
      horizontallyOverlaps(
        { xPt: 0, yPt: 0, widthPt: 10, heightPt: 1 },
        { xPt: 100, yPt: 0, widthPt: 10, heightPt: 1 },
      ),
    ).toBe(false);
    expect(
      horizontallyOverlaps(
        { xPt: 100, yPt: 0, widthPt: 10, heightPt: 1 },
        { xPt: 0, yPt: 0, widthPt: 10, heightPt: 1 },
      ),
    ).toBe(false);
  });
});

describe("verticalGap", () => {
  it("computes the gap when a sits above b", () => {
    const aTop = 100;
    const aHeight = 10;
    const bTop = 50;
    const bHeight = 20;
    // a spans [aTop, aTop+aHeight]; b spans [bTop, bTop+bHeight]. a's bottom sits above b's top by the gap below.
    expect(
      verticalGap(
        { xPt: 0, yPt: aTop, widthPt: 1, heightPt: aHeight },
        { xPt: 0, yPt: bTop, widthPt: 1, heightPt: bHeight },
      ),
    ).toBe(aTop - (bTop + bHeight));
  });

  it("computes the gap when b sits above a", () => {
    const aTop = 100;
    const aHeight = 10;
    const bTop = 50;
    const bHeight = 20;
    expect(
      verticalGap(
        { xPt: 0, yPt: bTop, widthPt: 1, heightPt: bHeight },
        { xPt: 0, yPt: aTop, widthPt: 1, heightPt: aHeight },
      ),
    ).toBe(aTop - (bTop + bHeight));
  });

  it("returns undefined when the two spans overlap on the y-axis", () => {
    expect(
      verticalGap(
        { xPt: 0, yPt: 0, widthPt: 1, heightPt: 20 },
        { xPt: 0, yPt: 10, widthPt: 1, heightPt: 20 },
      ),
    ).toBeUndefined();
  });

  it("computes a zero gap, not undefined, when the two spans exactly touch", () => {
    // a spans [100,110]; b spans [50,100] — a's bottom (100) exactly equals b's top (100), touching with no overlap and no room between them.
    expect(
      verticalGap(
        { xPt: 0, yPt: 100, widthPt: 1, heightPt: 10 },
        { xPt: 0, yPt: 50, widthPt: 1, heightPt: 50 },
      ),
    ).toBe(0);
    expect(
      verticalGap(
        { xPt: 0, yPt: 50, widthPt: 1, heightPt: 50 },
        { xPt: 0, yPt: 100, widthPt: 1, heightPt: 10 },
      ),
    ).toBe(0);
  });
});

describe("assertNeverLayoutItem", () => {
  it("throws naming the unhandled item, proving layoutItemBounds' own exhaustiveness guard fires at runtime", () => {
    expect(() => {
      assertNeverLayoutItem({ kind: "bogus" } as never);
    }).toThrow('layoutItemBounds: unhandled layout item {"kind":"bogus"}');
  });
});
