import { describe, expect, it } from "vitest";
import type { Box } from "document-schema.js";
import { flipY } from "./geometry";

// Box/Margins/PageSize/PAGE_SIZE_A4/PAGE_SIZE_LETTER/SLIDE_SIZE_STANDARD/SLIDE_SIZE_WIDESCREEN are now pure re-exports from document-schema.js, with their own coverage there -- flipY is the one piece of local logic left in this file (PDF-specific, out of document-schema.js's scope), so it is the only thing still tested here.

describe("geometry", () => {
  it("flipY is its own exact inverse", () => {
    const containerHeightPt = 540;
    const box: Box = { xPt: 10, yPt: 20, widthPt: 100, heightPt: 50 };
    expect(flipY(flipY(box, containerHeightPt), containerHeightPt)).toEqual(
      box,
    );
  });

  it("flipY maps a box flush with the top edge to one flush with the bottom edge", () => {
    const containerHeightPt = 540;
    const box: Box = { xPt: 0, yPt: 0, widthPt: 100, heightPt: 50 };
    expect(flipY(box, containerHeightPt)).toEqual({
      xPt: 0,
      yPt: 490,
      widthPt: 100,
      heightPt: 50,
    });
  });
});
