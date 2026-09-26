import { describe, expect, it } from "vitest";
import type {
  Jpeg2000CodingStyle,
  Jpeg2000ImageSize,
  Jpeg2000Quantization,
  Jpeg2000StepSize,
} from "./jpeg2000-codestream";
import { Jpeg2000ParseError } from "./jpeg2000-errors";
import {
  buildTileGeometry,
  tileHasSubdividedPrecincts,
  type Jpeg2000CodeBlock,
  type Jpeg2000Precinct,
  type Jpeg2000Resolution,
  type Jpeg2000Subband,
  type Jpeg2000TileGeometry,
} from "./jpeg2000-t2";

// The whole-file fixtures in jpeg2000.test.ts pin this module against real encoder output end to end, but only along the paths OpenJPEG emits. What follows pins the pieces those fixtures cannot isolate, built from hand-constructed geometry and hand-laid packet-header bits: every progression order against a multi-component tile, the precinct and code-block partitions of odd origins, the derived-quantization exponent decay, every coding-pass prefix-code range of B.10.6 Table B.4, and the SOP/EPH and truncation guards of B.10.5.

function imageSize(
  overrides: Partial<Jpeg2000ImageSize> = {},
): Jpeg2000ImageSize {
  return {
    xsiz: 8,
    ysiz: 8,
    xosiz: 0,
    yosiz: 0,
    xtsiz: 8,
    ytsiz: 8,
    xtosiz: 0,
    ytosiz: 0,
    components: [{ signed: false, bitDepth: 8, dx: 1, dy: 1 }],
    ...overrides,
  };
}

function codingStyle(
  overrides: Partial<Jpeg2000CodingStyle> = {},
): Jpeg2000CodingStyle {
  return {
    decompositionLevels: 0,
    codeBlockWidthExp: 6,
    codeBlockHeightExp: 6,
    codeBlockStyle: 0,
    transform: "reversible-5-3",
    precinctSizes: [{ ppx: 15, ppy: 15 }],
    ...overrides,
  };
}

// Distinct exponents (descending) and mantissas (ascending), so a test reading a subband's step size can tell exactly which entry of the array it came from.
function stepSizes(count: number): Jpeg2000StepSize[] {
  return Array.from({ length: count }, (_, i) => ({
    exponent: 20 - i,
    mantissa: i,
  }));
}

function quantization(
  overrides: Partial<Jpeg2000Quantization> = {},
): Jpeg2000Quantization {
  return {
    style: "expounded",
    guardBits: 2,
    stepSizes: stepSizes(1),
    ...overrides,
  };
}

function resolutionOf(
  geometry: Jpeg2000TileGeometry,
  component: number,
  resolution: number,
): Jpeg2000Resolution {
  const found = geometry.components[component]?.resolutions[resolution];
  if (found === undefined) {
    throw new Error("the fixture geometry holds no such resolution");
  }
  return found;
}

function subbandOf(
  geometry: Jpeg2000TileGeometry,
  component: number,
  resolution: number,
  subband: number,
): Jpeg2000Subband {
  const found =
    geometry.components[component]?.resolutions[resolution]?.subbands[subband];
  if (found === undefined) {
    throw new Error("the fixture geometry holds no such subband");
  }
  return found;
}

function precinctOf(
  geometry: Jpeg2000TileGeometry,
  component: number,
  resolution: number,
  subband: number,
  precinct: number,
): Jpeg2000Precinct {
  const found =
    geometry.components[component]?.resolutions[resolution]?.subbands[subband]
      ?.precincts[precinct];
  if (found === undefined) {
    throw new Error("the fixture geometry holds no such precinct");
  }
  return found;
}

function codeBlockOf(
  geometry: Jpeg2000TileGeometry,
  component: number,
  resolution: number,
  subband: number,
  precinct: number,
  block: number,
): Jpeg2000CodeBlock {
  const found =
    geometry.components[component]?.resolutions[resolution]?.subbands[subband]
      ?.precincts[precinct]?.codeBlocks[block];
  if (found === undefined) {
    throw new Error("the fixture geometry holds no such code-block");
  }
  return found;
}

describe("buildTileGeometry", () => {
  it("builds one LL subband at resolution 0 and HL, LH and HH above it, with B.7 band coordinates", () => {
    // A 7x5 component (origin 2,2) with two decomposition levels: every band's coordinate range below is derived from equation B-15 by hand.
    const geometry = buildTileGeometry(
      imageSize({ xsiz: 9, ysiz: 7, xosiz: 2, yosiz: 2, xtsiz: 9, ytsiz: 7 }),
      0,
      0,
      [
        codingStyle({
          decompositionLevels: 2,
          precinctSizes: [
            { ppx: 15, ppy: 15 },
            { ppx: 15, ppy: 15 },
            { ppx: 15, ppy: 15 },
          ],
        }),
      ],
      [quantization({ stepSizes: stepSizes(7) })],
    );
    const component = geometry.components[0];
    expect(component?.resolutions).toHaveLength(3);
    // Resolution 0 covers the component scaled down by both remaining decompositions.
    expect(resolutionOf(geometry, 0, 0)).toMatchObject({
      index: 0,
      x0: 1,
      y0: 1,
      x1: 3,
      y1: 2,
      precinctsWide: 1,
      precinctsHigh: 1,
    });
    expect(subbandOf(geometry, 0, 0, 0)).toMatchObject({
      type: "LL",
      x0: 1,
      y0: 1,
      x1: 3,
      y1: 2,
      stepSize: { exponent: 20, mantissa: 0 },
      maxBitPlanes: 20 + 2 - 1,
    });
    // Resolution 1 and 2 each contribute the three higher bands, in the order the codestream lists them.
    expect(
      resolutionOf(geometry, 0, 1).subbands.map((band) => band.type),
    ).toEqual(["HL", "LH", "HH"]);
    expect(
      resolutionOf(geometry, 0, 2).subbands.map((band) => band.type),
    ).toEqual(["HL", "LH", "HH"]);
    expect(subbandOf(geometry, 0, 1, 0)).toMatchObject({
      x0: 0,
      y0: 1,
      x1: 2,
      y1: 2,
    });
    expect(subbandOf(geometry, 0, 1, 1)).toMatchObject({
      x0: 1,
      y0: 0,
      x1: 3,
      y1: 2,
    });
    expect(subbandOf(geometry, 0, 1, 2)).toMatchObject({
      x0: 0,
      y0: 0,
      x1: 2,
      y1: 2,
    });
    // Resolution 2's bands are one decomposition from the samples, so the orientation halves the coordinate.
    expect(subbandOf(geometry, 0, 2, 0)).toMatchObject({
      x0: 1,
      y0: 1,
      x1: 4,
      y1: 4,
    });
    expect(subbandOf(geometry, 0, 2, 1)).toMatchObject({
      x0: 1,
      y0: 1,
      x1: 5,
      y1: 3,
    });
    expect(subbandOf(geometry, 0, 2, 2)).toMatchObject({
      x0: 1,
      y0: 1,
      x1: 4,
      y1: 3,
      // The last subband of the last resolution is the last entry of the step-size array, and Mb is its exponent plus the guard bits less one (E.1 equation E-2).
      stepSize: { exponent: 14, mantissa: 6 },
      maxBitPlanes: 15,
    });
  });

  it("counts a precinct grid from the band's own origin, and builds exactly as many precincts as it counts", () => {
    // An 8x8 component at origin (5,5) partitioned at 4x4: three precincts each way, because the grid is counted from ceil of the far edge less floor of the near edge, not from a bare quotient. Both axes' origins sit off a precinct boundary, so the floor term is live in both.
    const geometry = buildTileGeometry(
      imageSize({
        xsiz: 13,
        ysiz: 13,
        xosiz: 5,
        yosiz: 5,
        xtsiz: 13,
        ytsiz: 13,
      }),
      0,
      0,
      [codingStyle({ precinctSizes: [{ ppx: 2, ppy: 2 }] })],
      [quantization()],
    );
    expect(resolutionOf(geometry, 0, 0)).toMatchObject({
      precinctsWide: 3,
      precinctsHigh: 3,
    });
    expect(subbandOf(geometry, 0, 0, 0).precincts).toHaveLength(9);
    // The first precinct's own area is clipped to the band at both edges, and its one code-block carries the clipped coordinates.
    const first = codeBlockOf(geometry, 0, 0, 0, 0, 0);
    expect(first).toMatchObject({
      x0: 5,
      y0: 5,
      x1: 8,
      y1: 8,
      gridX: 0,
      gridY: 0,
    });
    expect(codeBlockOf(geometry, 0, 0, 0, 4, 0)).toMatchObject({
      x0: 8,
      y0: 8,
      x1: 12,
      y1: 12,
    });
  });

  it("holds no precincts at all for a resolution level with no area, in either axis", () => {
    // A component one sample wide (origin 9) under one decomposition: resolution 0 scales it to ceil(9/2) .. ceil(10/2), which is 5..5, an empty range. An empty level holds no precincts rather than one empty one, which the guard on each axis is what distinguishes from the bare ceil-less-floor count (a bare count would say one, since 5 is not a multiple of the precinct size).
    const emptyInX = buildTileGeometry(
      imageSize({ xsiz: 10, ysiz: 4, xosiz: 9, xtsiz: 10, ytsiz: 4 }),
      0,
      0,
      [
        codingStyle({
          decompositionLevels: 1,
          precinctSizes: [
            { ppx: 2, ppy: 2 },
            { ppx: 2, ppy: 2 },
          ],
        }),
      ],
      [quantization({ stepSizes: stepSizes(4) })],
    );
    expect(resolutionOf(emptyInX, 0, 0).precinctsWide).toBe(0);
    expect(subbandOf(emptyInX, 0, 0, 0).precincts).toHaveLength(0);
    expect(resolutionOf(emptyInX, 0, 1).precinctsWide).toBe(1);

    const emptyInY = buildTileGeometry(
      imageSize({ xsiz: 4, ysiz: 10, yosiz: 9, xtsiz: 4, ytsiz: 10 }),
      0,
      0,
      [
        codingStyle({
          decompositionLevels: 1,
          precinctSizes: [
            { ppx: 2, ppy: 2 },
            { ppx: 2, ppy: 2 },
          ],
        }),
      ],
      [quantization({ stepSizes: stepSizes(4) })],
    );
    expect(resolutionOf(emptyInY, 0, 0).precinctsHigh).toBe(0);
    expect(subbandOf(emptyInY, 0, 0, 0).precincts).toHaveLength(0);
  });

  it("holds no code-blocks for a precinct whose slice of the band is empty, in either axis", () => {
    // A component one sample wide (origin 10) under one decomposition: the r1 HL band spans ceil((10-1)/2) .. ceil((11-1)/2), which is 5..5. The resolution still holds a precinct, and that precinct intersects the empty band, so its code-block grid must collapse to nothing in x even though the band's origin (5) is not on a code-block boundary (a bare ceil of 5 over 4 would claim one block where the guarded grid claims none).
    const emptyBandInX = buildTileGeometry(
      imageSize({ xsiz: 11, ysiz: 4, xosiz: 10, xtsiz: 11, ytsiz: 4 }),
      0,
      0,
      [
        codingStyle({
          decompositionLevels: 1,
          precinctSizes: [
            { ppx: 3, ppy: 3 },
            { ppx: 3, ppy: 3 },
          ],
        }),
      ],
      [quantization({ stepSizes: stepSizes(4) })],
    );
    expect(subbandOf(emptyBandInX, 0, 1, 0)).toMatchObject({
      x0: 5,
      x1: 5,
    });
    expect(precinctOf(emptyBandInX, 0, 1, 0, 0).codeBlocks).toHaveLength(0);

    // The mirror in y: the r1 LH band spans the same empty 5..5 range vertically while its x range is live.
    const emptyBandInY = buildTileGeometry(
      imageSize({ xsiz: 4, ysiz: 11, yosiz: 10, xtsiz: 4, ytsiz: 11 }),
      0,
      0,
      [
        codingStyle({
          decompositionLevels: 1,
          precinctSizes: [
            { ppx: 3, ppy: 3 },
            { ppx: 3, ppy: 3 },
          ],
        }),
      ],
      [quantization({ stepSizes: stepSizes(4) })],
    );
    expect(subbandOf(emptyBandInY, 0, 1, 1)).toMatchObject({
      y0: 5,
      y1: 5,
    });
    expect(precinctOf(emptyBandInY, 0, 1, 1, 0).codeBlocks).toHaveLength(0);
  });

  it("partitions code-blocks at the finer of the code-block and precinct sizes, in both axes", () => {
    // A 4x8 component, one 8x8 precinct, code-blocks declared at 4x4 (below the precinct size, so the code-block partition governs): two rows of one block.
    const geometry = buildTileGeometry(
      imageSize({ xsiz: 4, ysiz: 8, xtsiz: 4, ytsiz: 8 }),
      0,
      0,
      [
        codingStyle({
          codeBlockWidthExp: 2,
          codeBlockHeightExp: 2,
          precinctSizes: [{ ppx: 3, ppy: 3 }],
        }),
      ],
      [quantization()],
    );
    const blocks = precinctOf(geometry, 0, 0, 0, 0).codeBlocks;
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ x0: 0, y0: 0, x1: 4, y1: 4, gridY: 0 });
    // The second row's cell starts one block height down from the first, not one up.
    expect(blocks[1]).toMatchObject({ x0: 0, y0: 4, x1: 4, y1: 8, gridY: 1 });
  });

  it("keeps resolution 0's precincts at their full declared size, halving only above resolution 0", () => {
    // A 4x6 component at resolution 0 with a 2^2 precinct height: the second precinct's row of the band starts at y 4, not at the halved 2 that a higher resolution's mapping would give.
    const geometry = buildTileGeometry(
      imageSize({ xsiz: 4, ysiz: 6, xtsiz: 4, ytsiz: 6 }),
      0,
      0,
      [codingStyle({ precinctSizes: [{ ppx: 2, ppy: 2 }] })],
      [quantization()],
    );
    expect(resolutionOf(geometry, 0, 0).precinctsHigh).toBe(2);
    expect(codeBlockOf(geometry, 0, 0, 0, 1, 0)).toMatchObject({
      y0: 4,
      y1: 6,
    });
  });

  it("refuses a component with no coding style or quantization", () => {
    expect(() => buildTileGeometry(imageSize(), 0, 0, [], [])).toThrow(
      Jpeg2000ParseError,
    );
    expect(() => buildTileGeometry(imageSize(), 0, 0, [], [])).toThrow(
      /no coding style or quantization is defined for component 0/,
    );
  });

  it("refuses coding that declares more decomposition levels than it carries precinct sizes", () => {
    expect(() =>
      buildTileGeometry(
        imageSize(),
        0,
        0,
        [
          codingStyle({
            decompositionLevels: 2,
            precinctSizes: [{ ppx: 15, ppy: 15 }],
          }),
        ],
        [quantization({ stepSizes: stepSizes(7) })],
      ),
    ).toThrow(/no precinct size for resolution 1/);
  });

  it("refuses a precinct exponent of zero above resolution 0, in either axis, but accepts it at resolution 0", () => {
    for (const zeroAxis of [
      { ppx: 0, ppy: 15 },
      { ppx: 15, ppy: 0 },
    ] satisfies { ppx: number; ppy: number }[]) {
      expect(() =>
        buildTileGeometry(
          imageSize(),
          0,
          0,
          [
            codingStyle({
              decompositionLevels: 1,
              precinctSizes: [{ ppx: 15, ppy: 15 }, zeroAxis],
            }),
          ],
          [quantization({ stepSizes: stepSizes(4) })],
        ),
      ).toThrow(Jpeg2000ParseError);
      expect(() =>
        buildTileGeometry(
          imageSize(),
          0,
          0,
          [
            codingStyle({
              decompositionLevels: 1,
              precinctSizes: [{ ppx: 15, ppy: 15 }, zeroAxis],
            }),
          ],
          [quantization({ stepSizes: stepSizes(4) })],
        ),
      ).toThrow(/precinct exponent of zero/);
    }
    // Resolution 0 is the one level B.6 permits it at, so the same exponent is fine there.
    expect(() =>
      buildTileGeometry(
        imageSize(),
        0,
        0,
        [codingStyle({ precinctSizes: [{ ppx: 0, ppy: 0 }] })],
        [quantization()],
      ),
    ).not.toThrow();
  });

  it("refuses expounded quantization that carries no step size for a subband its own decomposition count requires", () => {
    expect(() =>
      buildTileGeometry(
        imageSize(),
        0,
        0,
        [
          codingStyle({
            decompositionLevels: 1,
            precinctSizes: [
              { ppx: 15, ppy: 15 },
              { ppx: 15, ppy: 15 },
            ],
          }),
        ],
        [quantization({ stepSizes: stepSizes(1) })],
      ),
    ).toThrow(Jpeg2000ParseError);
    expect(() =>
      buildTileGeometry(
        imageSize(),
        0,
        0,
        [
          codingStyle({
            decompositionLevels: 1,
            precinctSizes: [
              { ppx: 15, ppy: 15 },
              { ppx: 15, ppy: 15 },
            ],
          }),
        ],
        [quantization({ stepSizes: stepSizes(1) })],
      ),
    ).toThrow(/carries no step size for subband 1/);
  });

  it("derives every band's step size from the LL band's alone under derived quantization", () => {
    const geometry = buildTileGeometry(
      imageSize({ xsiz: 9, ysiz: 7, xosiz: 2, yosiz: 2, xtsiz: 9, ytsiz: 7 }),
      0,
      0,
      [
        codingStyle({
          decompositionLevels: 2,
          precinctSizes: [
            { ppx: 15, ppy: 15 },
            { ppx: 15, ppy: 15 },
            { ppx: 15, ppy: 15 },
          ],
        }),
      ],
      [
        quantization({
          style: "derived",
          stepSizes: [{ exponent: 5, mantissa: 123 }],
        }),
      ],
    );
    // E.1.1 equation E-5: resolution 1 keeps the LL entry's exponent, each resolution above it steps down by one, and every band shares the entry's mantissa.
    expect(subbandOf(geometry, 0, 0, 0).stepSize).toEqual({
      exponent: 5,
      mantissa: 123,
    });
    for (const band of resolutionOf(geometry, 0, 1).subbands) {
      expect(band.stepSize).toEqual({ exponent: 5, mantissa: 123 });
    }
    for (const band of resolutionOf(geometry, 0, 2).subbands) {
      expect(band.stepSize).toEqual({ exponent: 4, mantissa: 123 });
    }
  });

  it("clamps a derived step size's exponent at zero when the resolutions outrun it", () => {
    const geometry = buildTileGeometry(
      imageSize({ xsiz: 9, ysiz: 7, xosiz: 2, yosiz: 2, xtsiz: 9, ytsiz: 7 }),
      0,
      0,
      [
        codingStyle({
          decompositionLevels: 3,
          precinctSizes: [
            { ppx: 15, ppy: 15 },
            { ppx: 15, ppy: 15 },
            { ppx: 15, ppy: 15 },
            { ppx: 15, ppy: 15 },
          ],
        }),
      ],
      [
        quantization({
          style: "derived",
          stepSizes: [{ exponent: 1, mantissa: 7 }],
        }),
      ],
    );
    // Resolution 3 would step the exponent down to -1; the clamp holds it at zero instead.
    expect(subbandOf(geometry, 0, 0, 0).stepSize.exponent).toBe(1);
    for (const band of resolutionOf(geometry, 0, 1).subbands) {
      expect(band.stepSize.exponent).toBe(1);
    }
    for (const band of resolutionOf(geometry, 0, 2).subbands) {
      expect(band.stepSize.exponent).toBe(0);
    }
    for (const band of resolutionOf(geometry, 0, 3).subbands) {
      expect(band.stepSize.exponent).toBe(0);
    }
  });

  it("refuses derived quantization that carries no step size at all", () => {
    expect(() =>
      buildTileGeometry(
        imageSize(),
        0,
        0,
        [codingStyle()],
        [quantization({ style: "derived", stepSizes: [] })],
      ),
    ).toThrow(Jpeg2000ParseError);
    expect(() =>
      buildTileGeometry(
        imageSize(),
        0,
        0,
        [codingStyle()],
        [quantization({ style: "derived", stepSizes: [] })],
      ),
    ).toThrow(/declares derived quantization but carries no step size/);
  });
});

describe("tileHasSubdividedPrecincts", () => {
  const subdivided = codingStyle({
    decompositionLevels: 1,
    precinctSizes: [
      { ppx: 15, ppy: 15 },
      { ppx: 1, ppy: 1 },
    ],
  });

  it("finds a subdivision that only the highest resolution level carries", () => {
    // Resolution 0 of a 9x9 component under one decomposition scales down to 5x5, one maximal precinct; resolution 1 at 2x2 precincts is 5x5 precincts. Only the top level subdivides, so a walk that stopped one level short of decompositionLevels would miss it.
    expect(
      tileHasSubdividedPrecincts(
        imageSize({ xsiz: 9, ysiz: 9, xtsiz: 9, ytsiz: 9 }),
        0,
        0,
        [subdivided],
      ),
    ).toBe(true);
  });

  it("finds a subdivision at resolution 0 as well", () => {
    expect(
      tileHasSubdividedPrecincts(
        imageSize({ xsiz: 9, ysiz: 9, xtsiz: 9, ytsiz: 9 }),
        0,
        0,
        [
          codingStyle({
            decompositionLevels: 1,
            precinctSizes: [
              { ppx: 1, ppy: 1 },
              { ppx: 15, ppy: 15 },
            ],
          }),
        ],
      ),
    ).toBe(true);
  });

  it("counts a precinct grid that subdivides in one axis only", () => {
    // 4x5 at a 2^2 precinct height: one precinct wide, two high. The condition is on the product, so a grid dividing the two counts would miss it.
    expect(
      tileHasSubdividedPrecincts(
        imageSize({ xsiz: 4, ysiz: 5, xtsiz: 4, ytsiz: 5 }),
        0,
        0,
        [codingStyle({ precinctSizes: [{ ppx: 15, ppy: 2 }] })],
      ),
    ).toBe(true);
    expect(
      tileHasSubdividedPrecincts(
        imageSize({ xsiz: 5, ysiz: 4, xtsiz: 5, ytsiz: 4 }),
        0,
        0,
        [codingStyle({ precinctSizes: [{ ppx: 2, ppy: 15 }] })],
      ),
    ).toBe(true);
  });

  it("reports no subdivision when every level holds exactly one precinct", () => {
    expect(
      tileHasSubdividedPrecincts(
        imageSize({ xsiz: 8, ysiz: 8, xtsiz: 8, ytsiz: 8 }),
        0,
        0,
        [codingStyle({ precinctSizes: [{ ppx: 3, ppy: 3 }] })],
      ),
    ).toBe(false);
  });

  it("skips a component whose coding style is missing rather than deciding from it", () => {
    // Two declared components, one coding style: the second component is not this call's business, and a subdivision in the first is still found.
    expect(
      tileHasSubdividedPrecincts(
        imageSize({
          xsiz: 9,
          ysiz: 9,
          xtsiz: 9,
          ytsiz: 9,
          components: [
            { signed: false, bitDepth: 8, dx: 1, dy: 1 },
            { signed: false, bitDepth: 8, dx: 1, dy: 1 },
          ],
        }),
        0,
        0,
        [subdivided],
      ),
    ).toBe(true);
    expect(
      tileHasSubdividedPrecincts(
        imageSize({
          xsiz: 8,
          ysiz: 8,
          xtsiz: 8,
          ytsiz: 8,
          components: [
            { signed: false, bitDepth: 8, dx: 1, dy: 1 },
            { signed: false, bitDepth: 8, dx: 1, dy: 1 },
          ],
        }),
        0,
        0,
        [codingStyle()],
      ),
    ).toBe(false);
  });
});

// Packs bits MSB-first into bytes, the way a packet header is laid out (B.10.1). Deliberately refuses to produce an 0xFF byte: the byte after 0xFF carries a stuffed zero as its top bit, so a builder that silently emitted one would encode a different bit sequence than the one written, and the two fixtures below that genuinely need an 0xFF byte build their bytes by hand instead.
