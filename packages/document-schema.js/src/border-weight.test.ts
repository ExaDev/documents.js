import { describe, expect, it } from "vitest";

import {
  BORDER_WIDTH_PT,
  borderWeightForWidthPt,
  dashedBorderWeightForWidthPt,
  type BorderWeight,
} from "./border-weight";

const WEIGHTS: readonly BorderWeight[] = ["hair", "thin", "medium", "thick"];

describe("borderWeightForWidthPt", () => {
  it("is the exact inverse of BORDER_WIDTH_PT for every named weight", () => {
    // The property the whole table exists for: a border read as one of the four named weights, then written back out, must resolve to the identical weight rather than drifting a bucket.
    for (const weight of WEIGHTS) {
      expect(borderWeightForWidthPt(BORDER_WIDTH_PT[weight])).toBe(weight);
    }
  });

  it("buckets a width between two named weights into the lighter of the pair", () => {
    // Just under each midpoint: (hair+thin)/2 = 0.625, (thin+medium)/2 = 1.125, (medium+thick)/2 = 1.875.
    expect(borderWeightForWidthPt(0.624)).toBe("hair");
    expect(borderWeightForWidthPt(1.124)).toBe("thin");
    expect(borderWeightForWidthPt(1.874)).toBe("medium");
  });

  it("resolves a width exactly on a midpoint to the heavier bucket", () => {
    expect(borderWeightForWidthPt(0.625)).toBe("thin");
    expect(borderWeightForWidthPt(1.125)).toBe("medium");
    expect(borderWeightForWidthPt(1.875)).toBe("thick");
  });

  it("resolves a width below hair to hair and one above thick to thick", () => {
    expect(borderWeightForWidthPt(0.01)).toBe("hair");
    expect(borderWeightForWidthPt(100)).toBe("thick");
  });
});

describe("dashedBorderWeightForWidthPt", () => {
  it("splits only at the thin/medium boundary, since no format names a hair or thick dash", () => {
    expect(dashedBorderWeightForWidthPt(BORDER_WIDTH_PT.hair)).toBe("thin");
    expect(dashedBorderWeightForWidthPt(BORDER_WIDTH_PT.thin)).toBe("thin");
    expect(dashedBorderWeightForWidthPt(1.124)).toBe("thin");
    expect(dashedBorderWeightForWidthPt(1.125)).toBe("medium");
    expect(dashedBorderWeightForWidthPt(BORDER_WIDTH_PT.medium)).toBe("medium");
    expect(dashedBorderWeightForWidthPt(BORDER_WIDTH_PT.thick)).toBe("medium");
  });

  it("agrees with the four-way bucketing wherever both name the same weight", () => {
    for (const widthPt of [BORDER_WIDTH_PT.thin, 1.0, 1.125, 1.5]) {
      expect(dashedBorderWeightForWidthPt(widthPt)).toBe(
        borderWeightForWidthPt(widthPt),
      );
    }
  });
});
