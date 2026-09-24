import { describe, expect, it } from "vitest";

import {
  BORDER_WIDTH_PT,
  borderWeightForWidthPt,
  dashedBorderWeightForWidthPt,
  type BorderWeight,
} from "./border-weight";

const WEIGHTS: readonly BorderWeight[] = ["hair", "thin", "medium", "thick"];

// The width-bucket midpoints, derived the same way border-weight.ts's own (private) BORDER_WEIGHT_UPPER_PT is, so a change to BORDER_WIDTH_PT keeps these boundary tests honest rather than silently drifting from the values under test.
const HAIR_THIN_MIDPOINT_PT = (BORDER_WIDTH_PT.hair + BORDER_WIDTH_PT.thin) / 2;
const THIN_MEDIUM_MIDPOINT_PT =
  (BORDER_WIDTH_PT.thin + BORDER_WIDTH_PT.medium) / 2;
const MEDIUM_THICK_MIDPOINT_PT =
  (BORDER_WIDTH_PT.medium + BORDER_WIDTH_PT.thick) / 2;
// Small enough to land strictly below any midpoint above without crossing the next one down.
const JUST_UNDER_EPSILON_PT = 0.001;

describe("borderWeightForWidthPt", () => {
  it("is the exact inverse of BORDER_WIDTH_PT for every named weight", () => {
    // The property the whole table exists for: a border read as one of the four named weights, then written back out, must resolve to the identical weight rather than drifting a bucket.
    for (const weight of WEIGHTS) {
      expect(borderWeightForWidthPt(BORDER_WIDTH_PT[weight])).toBe(weight);
    }
  });

  it("buckets a width between two named weights into the lighter of the pair", () => {
    expect(
      borderWeightForWidthPt(HAIR_THIN_MIDPOINT_PT - JUST_UNDER_EPSILON_PT),
    ).toBe("hair");
    expect(
      borderWeightForWidthPt(THIN_MEDIUM_MIDPOINT_PT - JUST_UNDER_EPSILON_PT),
    ).toBe("thin");
    expect(
      borderWeightForWidthPt(MEDIUM_THICK_MIDPOINT_PT - JUST_UNDER_EPSILON_PT),
    ).toBe("medium");
  });

  it("resolves a width exactly on a midpoint to the heavier bucket", () => {
    expect(borderWeightForWidthPt(HAIR_THIN_MIDPOINT_PT)).toBe("thin");
    expect(borderWeightForWidthPt(THIN_MEDIUM_MIDPOINT_PT)).toBe("medium");
    expect(borderWeightForWidthPt(MEDIUM_THICK_MIDPOINT_PT)).toBe("thick");
  });

  it("resolves a width below hair to hair and one above thick to thick", () => {
    const wellBelowHairPt = 0.01;
    const wellAboveThickPt = 100;
    expect(borderWeightForWidthPt(wellBelowHairPt)).toBe("hair");
    expect(borderWeightForWidthPt(wellAboveThickPt)).toBe("thick");
  });
});

describe("dashedBorderWeightForWidthPt", () => {
  it("splits only at the thin/medium boundary, since no format names a hair or thick dash", () => {
    expect(dashedBorderWeightForWidthPt(BORDER_WIDTH_PT.hair)).toBe("thin");
    expect(dashedBorderWeightForWidthPt(BORDER_WIDTH_PT.thin)).toBe("thin");
    expect(
      dashedBorderWeightForWidthPt(
        THIN_MEDIUM_MIDPOINT_PT - JUST_UNDER_EPSILON_PT,
      ),
    ).toBe("thin");
    expect(dashedBorderWeightForWidthPt(THIN_MEDIUM_MIDPOINT_PT)).toBe(
      "medium",
    );
    expect(dashedBorderWeightForWidthPt(BORDER_WIDTH_PT.medium)).toBe("medium");
    expect(dashedBorderWeightForWidthPt(BORDER_WIDTH_PT.thick)).toBe("medium");
  });

  it("agrees with the four-way bucketing wherever both name the same weight", () => {
    for (const widthPt of [
      BORDER_WIDTH_PT.thin,
      1.0,
      THIN_MEDIUM_MIDPOINT_PT,
      BORDER_WIDTH_PT.medium,
    ]) {
      expect(dashedBorderWeightForWidthPt(widthPt)).toBe(
        borderWeightForWidthPt(widthPt),
      );
    }
  });
});
