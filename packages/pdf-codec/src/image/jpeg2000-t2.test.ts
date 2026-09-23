import { describe, expect, it } from "vitest";
import type {
  Jpeg2000CodingStyle,
  Jpeg2000ImageSize,
  Jpeg2000Quantization,
  Jpeg2000StepSize,
} from "./jpeg2000-codestream";
import {
  Jpeg2000ParseError,
  Jpeg2000UnsupportedError,
} from "./jpeg2000-errors";
import {
  buildPacketSequence,
  buildTileGeometry,
  readTilePackets,
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
class PacketHeaderWriter {
  private readonly bits: (0 | 1)[] = [];

  bit(value: 0 | 1): this {
    this.bits.push(value);
    return this;
  }

  field(value: number, count: number): this {
    for (let i = count - 1; i >= 0; i--) {
      this.bit(((value >> i) & 1) as 0 | 1);
    }
    return this;
  }

  get byteLength(): number {
    return Math.ceil(this.bits.length / 8);
  }

  toBytes(): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(this.byteLength);
    for (let i = 0; i < this.bits.length; i++) {
      bytes[i >> 3] =
        (bytes[i >> 3] ?? 0) | ((this.bits[i] ?? 0) << (7 - (i & 7)));
    }
    for (const byte of bytes) {
      if (byte === 0xff) {
        throw new Error(
          "the packet header fixture crossed an 0xFF byte; pick bit values that avoid it",
        );
      }
    }
    return bytes;
  }
}

describe("buildPacketSequence", () => {
  // Two components with different decomposition levels (two resolutions for the first, one for the second), so the component-major and resolution-major orders genuinely differ and the resolution count is a max rather than a common value.
  function twoComponentGeometry(): Jpeg2000TileGeometry {
    return buildTileGeometry(
      imageSize({
        components: [
          { signed: false, bitDepth: 8, dx: 1, dy: 1 },
          { signed: false, bitDepth: 8, dx: 1, dy: 1 },
        ],
      }),
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
        codingStyle(),
      ],
      [quantization({ stepSizes: stepSizes(4) }), quantization()],
    );
  }

  it("nests LRCP layer-major, resolution next, every component of each", () => {
    const packets = buildPacketSequence(twoComponentGeometry(), "LRCP", 2);
    expect(packets).toEqual([
      { layer: 0, resolution: 0, component: 0, precinct: 0 },
      { layer: 0, resolution: 0, component: 1, precinct: 0 },
      { layer: 0, resolution: 1, component: 0, precinct: 0 },
      { layer: 1, resolution: 0, component: 0, precinct: 0 },
      { layer: 1, resolution: 0, component: 1, precinct: 0 },
      { layer: 1, resolution: 1, component: 0, precinct: 0 },
    ]);
  });

  it("nests RLCP resolution-major, layer next, which is a different order as soon as a component lacks the top resolution", () => {
    const packets = buildPacketSequence(twoComponentGeometry(), "RLCP", 2);
    expect(packets).toEqual([
      { layer: 0, resolution: 0, component: 0, precinct: 0 },
      { layer: 0, resolution: 0, component: 1, precinct: 0 },
      { layer: 1, resolution: 0, component: 0, precinct: 0 },
      { layer: 1, resolution: 0, component: 1, precinct: 0 },
      { layer: 0, resolution: 1, component: 0, precinct: 0 },
      { layer: 1, resolution: 1, component: 0, precinct: 0 },
    ]);
  });

  it("nests RPCL resolution-major with components and layers inside", () => {
    const packets = buildPacketSequence(twoComponentGeometry(), "RPCL", 2);
    expect(packets).toEqual([
      { layer: 0, resolution: 0, component: 0, precinct: 0 },
      { layer: 1, resolution: 0, component: 0, precinct: 0 },
      { layer: 0, resolution: 0, component: 1, precinct: 0 },
      { layer: 1, resolution: 0, component: 1, precinct: 0 },
      { layer: 0, resolution: 1, component: 0, precinct: 0 },
      { layer: 1, resolution: 1, component: 0, precinct: 0 },
    ]);
  });

  it("collapses PCRL and CPRL to the same component-major nesting once every resolution holds one precinct", () => {
    // B.12 iterates both by reference-grid position rather than precinct index; with one precinct per resolution that position contributes no ordering of its own, so the two orders' loops are the same ones.
    const expected = [
      { layer: 0, resolution: 0, component: 0, precinct: 0 },
      { layer: 1, resolution: 0, component: 0, precinct: 0 },
      { layer: 0, resolution: 1, component: 0, precinct: 0 },
      { layer: 1, resolution: 1, component: 0, precinct: 0 },
      { layer: 0, resolution: 0, component: 1, precinct: 0 },
      { layer: 1, resolution: 0, component: 1, precinct: 0 },
    ];
    expect(buildPacketSequence(twoComponentGeometry(), "PCRL", 2)).toEqual(
      expected,
    );
    expect(buildPacketSequence(twoComponentGeometry(), "CPRL", 2)).toEqual(
      expected,
    );
  });

  it("emits no packet for a resolution level that holds no precincts", () => {
    // A component one sample wide (origin 9) under one decomposition: resolution 0 is an empty range and holds no precincts (see the buildTileGeometry tests above), so only resolution 1's packet appears.
    const geometry = buildTileGeometry(
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
    for (const order of ["LRCP", "RLCP", "RPCL", "PCRL", "CPRL"] as const) {
      expect(buildPacketSequence(geometry, order, 2)).toEqual([
        { layer: 0, resolution: 1, component: 0, precinct: 0 },
        { layer: 1, resolution: 1, component: 0, precinct: 0 },
      ]);
    }
  });

  it("refuses the position-driven orders when any resolution subdivides its precincts, and keeps serving LRCP and RLCP", () => {
    const geometry = buildTileGeometry(
      imageSize({ xsiz: 9, ysiz: 9, xtsiz: 9, ytsiz: 9 }),
      0,
      0,
      [codingStyle({ precinctSizes: [{ ppx: 1, ppy: 1 }] })],
      [quantization()],
    );
    for (const order of ["RPCL", "PCRL", "CPRL"] as const) {
      expect(() => buildPacketSequence(geometry, order, 1)).toThrow(
        Jpeg2000UnsupportedError,
      );
      expect(() => buildPacketSequence(geometry, order, 1)).toThrow(
        /single precinct/,
      );
    }
    // The index-driven orders genuinely traverse every precinct rather than refusing.
    expect(buildPacketSequence(geometry, "LRCP", 1)).toHaveLength(25);
  });
});

describe("readTilePackets", () => {
  // The smallest geometry whose packet headers a test can lay out bit by bit: one sample, one resolution, one precinct, one code-block.
  function singleBlockGeometry(): Jpeg2000TileGeometry {
    return buildTileGeometry(
      imageSize({ xsiz: 1, ysiz: 1, xtsiz: 1, ytsiz: 1 }),
      0,
      0,
      [codingStyle()],
      [quantization()],
    );
  }

  // One 8x1 component under one 8-wide precinct with 4-wide code-blocks: two code-blocks in one precinct, so a single packet can include two bodies back to back.
  function twoBlockGeometry(): Jpeg2000TileGeometry {
    return buildTileGeometry(
      imageSize({ xsiz: 8, ysiz: 1, xtsiz: 8, ytsiz: 1 }),
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
  }

  function run(
    data: Uint8Array<ArrayBuffer>,
    end: number,
    geometry: Jpeg2000TileGeometry,
    sequence: readonly {
      layer: number;
      resolution: number;
      component: number;
      precinct: number;
    }[],
    options: { useSop?: boolean; useEph?: boolean } = {},
  ): { position: number; warnings: string[] } {
    const warnings: string[] = [];
    const position = readTilePackets(data, 0, end, geometry, sequence, {
      useSop: false,
      useEph: false,
      ...options,
      onWarning: (message) => {
        warnings.push(message);
      },
    });
    return { position, warnings };
  }

  // Lays out one first-layer packet header for the single-block geometry: non-empty, the block included at inclusion value 0 (layer index 0), `zeroBitPlanes` zero bit-planes, the given coding-pass prefix bits, `lblockGrowths` lblock increments, then a length field of the width B.10.7 derives from those (Lblock plus the pass count's own bit width).
  function singleBlockHeader(
    zeroBitPlanes: number,
    passBits: readonly (0 | 1)[],
    passesForLengthWidth: number,
    lblockGrowths: number,
    length: number,
  ): PacketHeaderWriter {
    const writer = new PacketHeaderWriter();
    writer.bit(1); // non-empty packet
    writer.bit(1); // inclusion tag tree settles immediately: value 0 < threshold 1
    for (let i = 0; i < zeroBitPlanes; i++) {
      writer.bit(0); // the zero-bit-plane tree climbs one threshold at a time
    }
    writer.bit(1); // and settles at exactly `zeroBitPlanes`
    for (const bit of passBits) {
      writer.bit(bit);
    }
    for (let i = 0; i < lblockGrowths; i++) {
      writer.bit(1);
    }
    writer.bit(0); // lblock growth ends
    writer.field(
      length,
      3 + lblockGrowths + Math.floor(Math.log2(passesForLengthWidth)),
    );
    return writer;
  }

  function withBody(
    header: PacketHeaderWriter,
    bodyLength: number,
  ): Uint8Array<ArrayBuffer> {
    const headerBytes = header.toBytes();
    return new Uint8Array([...headerBytes, ...new Uint8Array(bodyLength)]);
  }

  it("decodes every coding-pass prefix-code range of B.10.6 Table B.4", () => {
    // The five ranges: 1 pass (a 0 bit), 2 (10), 3 to 5 (11 plus two bits), 6 to 36 (11, 11, plus five bits) and 37 to 164 (11, 11, 31, plus seven bits). The 37-plus case needs the five-bit field at its own boundary value of 31, which is what decides between "6 + fiveBit" and reading a further seven-bit field.
    const cases: readonly {
      passes: number;
      bits: readonly (0 | 1)[];
      zeroBitPlanes: number;
      length: number;
    }[] = [
      { passes: 1, bits: [0], zeroBitPlanes: 0, length: 5 },
      { passes: 2, bits: [1, 0], zeroBitPlanes: 0, length: 9 },
      { passes: 5, bits: [1, 1, 1, 0], zeroBitPlanes: 0, length: 17 },
      {
        passes: 11,
        bits: [1, 1, 1, 1, 0, 0, 1, 0, 1],
        zeroBitPlanes: 1,
        length: 33,
      },
      {
        passes: 37,
        bits: [1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0],
        zeroBitPlanes: 1,
        length: 200,
      },
      {
        passes: 42,
        bits: [1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 0, 1],
        zeroBitPlanes: 1,
        length: 200,
      },
    ];
    for (const { passes, bits, zeroBitPlanes, length } of cases) {
      const geometry = singleBlockGeometry();
      const data = withBody(
        singleBlockHeader(zeroBitPlanes, bits, passes, 0, length),
        length,
      );
      const sequence = buildPacketSequence(geometry, "LRCP", 1);
      const result = run(data, data.length, geometry, sequence);
      const block = codeBlockOf(geometry, 0, 0, 0, 0, 0);
      expect(block.passes).toBe(passes);
      expect(block.zeroBitPlanes).toBe(zeroBitPlanes);
      expect(block.lblock).toBe(3);
      expect(block.chunks).toEqual([
        { start: data.length - length, end: data.length },
      ]);
      expect(result).toMatchObject({ position: data.length, warnings: [] });
    }
  });

  it("resumes an already-included code-block with one bit, grows its length field, and accumulates chunks across layers", () => {
    const geometry = singleBlockGeometry();
    // Layer 0: included through the tag trees, one pass, lblock grown once, a 3-byte body. Layer 1: re-included with a single 1 bit (no tag tree, and no zero-bit-plane read either), one pass again, lblock unchanged, a 2-byte body.
    const layer0 = singleBlockHeader(0, [0], 1, 1, 3);
    const layer1 = new PacketHeaderWriter()
      .bit(1) // non-empty packet
      .bit(1) // the block is already included: one bit says it contributes to this layer too
      .bit(0) // one coding pass
      .bit(0) // lblock unchanged
      .field(2, 4 + Math.floor(Math.log2(1)));
    const header0 = layer0.toBytes();
    const header1 = layer1.toBytes();
    const data = new Uint8Array([
      ...header0,
      ...new Uint8Array(3),
      ...header1,
      ...new Uint8Array(2),
    ]);
    const sequence = buildPacketSequence(geometry, "LRCP", 2);
    const result = run(data, data.length, geometry, sequence);
    const block = codeBlockOf(geometry, 0, 0, 0, 0, 0);
    expect(block.included).toBe(true);
    expect(block.passes).toBe(2);
    expect(block.zeroBitPlanes).toBe(0);
    expect(block.lblock).toBe(4);
    expect(block.chunks).toEqual([
      { start: header0.length, end: header0.length + 3 },
      { start: header0.length + 3 + header1.length, end: data.length },
    ]);
    expect(result).toMatchObject({ position: data.length, warnings: [] });
  });

  it("warns and stops when the coded data runs out before the sequence does", () => {
    const geometry = singleBlockGeometry();
    // One empty packet (a single 0 bit) is all the data holds; the second packet's header would start at or past the end.
    const data = Uint8Array.from([0x00]);
    const sequence = buildPacketSequence(geometry, "LRCP", 2);
    const result = run(data, data.length, geometry, sequence);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/ended after 1 of 2 packets/);
    expect(result.position).toBe(1);
    expect(codeBlockOf(geometry, 0, 0, 0, 0, 0).included).toBe(false);
  });

  it("throws when the progression sequence names a resolution or component the tile does not have", () => {
    const geometry = singleBlockGeometry();
    const data = Uint8Array.from([0x00]);
    expect(() =>
      run(data, data.length, geometry, [
        { layer: 0, resolution: 3, component: 0, precinct: 0 },
      ]),
    ).toThrow(Jpeg2000ParseError);
    expect(() =>
      run(data, data.length, geometry, [
        { layer: 0, resolution: 3, component: 0, precinct: 0 },
      ]),
    ).toThrow(/progression sequence names a resolution level/);
    expect(() =>
      run(data, data.length, geometry, [
        { layer: 0, resolution: 0, component: 2, precinct: 0 },
      ]),
    ).toThrow(/progression sequence names a resolution level/);
  });

  it("skips a well-formed SOP segment before the packet header when the tile says it uses them", () => {
    const geometry = singleBlockGeometry();
    const header = singleBlockHeader(0, [0], 1, 0, 5);
    const headerBytes = header.toBytes();
    const data = new Uint8Array([
      0xff,
      0x91,
      0,
      0,
      0,
      0, // SOP: marker plus a four-byte sequence number
      ...headerBytes,
      ...new Uint8Array(5),
    ]);
    const sequence = buildPacketSequence(geometry, "LRCP", 1);
    const result = run(data, data.length, geometry, sequence, { useSop: true });
    expect(codeBlockOf(geometry, 0, 0, 0, 0, 0).chunks).toEqual([
      { start: 6 + headerBytes.length, end: data.length },
    ]);
    expect(result).toMatchObject({ position: data.length, warnings: [] });
  });

  it("does not treat bytes as SOP when the marker does not match, in either byte", () => {
    const geometry = singleBlockGeometry();
    const header = singleBlockHeader(0, [0], 1, 0, 5);
    const headerBytes = header.toBytes();
    const sequence = buildPacketSequence(geometry, "LRCP", 1);
    // High byte wrong: 0x12 is a valid packet-header start (an empty packet's 0 bit is its first bit), and the low byte matching 0x91 must not make the reader skip it.
    const highWrong = new Uint8Array([
      0x12,
      0x91,
      0,
      0,
      0,
      0,
      ...headerBytes,
      ...new Uint8Array(5),
    ]);
    expect(
      run(highWrong, highWrong.length, geometry, sequence, { useSop: true }),
    ).toMatchObject({ position: 1, warnings: [] });
    expect(codeBlockOf(geometry, 0, 0, 0, 0, 0).included).toBe(false);
    // Low byte wrong: 0xFF followed by 0x00 is a non-empty packet header in stuffed-bit form (the parse below is worked through in the assertion that follows), and the reader must read it as one rather than skipping six bytes.
    const lowWrong = Uint8Array.from([
      0xff,
      0x00,
      ...headerBytes,
      ...new Uint8Array(28),
    ]);
    const geometry2 = singleBlockGeometry();
    const sequence2 = buildPacketSequence(geometry2, "LRCP", 1);
    const result = run(lowWrong, lowWrong.length, geometry2, sequence2, {
      useSop: true,
    });
    // 0xFF's eight 1 bits: non-empty, included, zero bit-planes 0, into the 6-to-36 pass range with five-bit value 16 (22 passes); the stuffed 0x00 ends lblock growth at 0; the 7-bit length field reads 28 (0x00's last two bits are 0, then 11100 from the header byte); the body starts on the next byte boundary.
    expect(codeBlockOf(geometry2, 0, 0, 0, 0, 0).passes).toBe(22);
    expect(codeBlockOf(geometry2, 0, 0, 0, 0, 0).chunks).toEqual([
      { start: 3, end: 31 },
    ]);
    expect(result).toMatchObject({ position: 31, warnings: [] });
  });

  it("does not treat bytes as SOP when the tile says it does not use them", () => {
    const header = singleBlockHeader(0, [0], 1, 0, 5);
    const headerBytes = header.toBytes();
    // A genuine FF 91 pair that is packet-header bytes here, because SOP markers are off: 0x91 following 0xFF has its stuffed bit set, which B.10.1 forbids inside a header, so reading the pair as a header is a parse error rather than a packet. Skipping the six bytes as an SOP segment instead would hide exactly that. A fresh geometry per call, since the first call's throw leaves the block's inclusion state half-updated.
    const data = Uint8Array.from([
      0xff,
      0x91,
      ...headerBytes,
      ...new Uint8Array(60),
    ]);
    const attempt = (): void => {
      const geometry = singleBlockGeometry();
      run(
        data,
        data.length,
        geometry,
        buildPacketSequence(geometry, "LRCP", 1),
      );
    };
    expect(attempt).toThrow(Jpeg2000ParseError);
    expect(attempt).toThrow(/stuffed bit/);
  });

  it("does not treat a truncated tail as SOP, however it starts", () => {
    const geometry = singleBlockGeometry();
    const sequence = buildPacketSequence(geometry, "LRCP", 1);
    // Only two bytes of data remain, both of an SOP marker's shape: the six-byte bound fails, so the two bytes are read as packet-header bits, and the stuffed-bit rule rejects the second one exactly as above rather than the reader reaching past the end for the other four.
    const shortTail = Uint8Array.from([0xff, 0x91]);
    expect(() =>
      run(shortTail, shortTail.length, geometry, sequence, { useSop: true }),
    ).toThrow(/stuffed bit/);

    // Exactly six bytes of SOP shape: the bound holds this time, the segment is skipped, and the packet header that follows starts at the end of the data, so nothing is included at all.
    const exactTail = Uint8Array.from([0xff, 0x91, 0, 0, 0, 0]);
    const exactGeometry = singleBlockGeometry();
    const exactResult = run(
      exactTail,
      exactTail.length,
      exactGeometry,
      buildPacketSequence(exactGeometry, "LRCP", 1),
      { useSop: true },
    );
    expect(codeBlockOf(exactGeometry, 0, 0, 0, 0, 0).chunks).toEqual([]);
    expect(exactResult).toMatchObject({ position: 6, warnings: [] });
  });

  it("skips a well-formed EPH marker after the packet header when the tile says it uses them", () => {
    const geometry = singleBlockGeometry();
    const header = singleBlockHeader(0, [0], 1, 0, 5);
    const headerBytes = header.toBytes();
    const data = new Uint8Array([
      ...headerBytes,
      0xff,
      0x92,
      ...new Uint8Array(5),
    ]);
    const sequence = buildPacketSequence(geometry, "LRCP", 1);
    const result = run(data, data.length, geometry, sequence, { useEph: true });
    expect(codeBlockOf(geometry, 0, 0, 0, 0, 0).chunks).toEqual([
      { start: headerBytes.length + 2, end: data.length },
    ]);
    expect(result).toMatchObject({ position: data.length, warnings: [] });
  });

  it("does not treat bytes as EPH when the marker does not match, in either byte, or when the tile says it does not use them", () => {
    const header = singleBlockHeader(0, [0], 1, 0, 5);
    const headerBytes = header.toBytes();
    for (const [marker, useEph] of [
      [[0x12, 0x92], true],
      [[0xff, 0x34], true],
      [[0xff, 0x92], false],
    ] as const) {
      const geometry = singleBlockGeometry();
      const data = new Uint8Array([
        ...headerBytes,
        ...marker,
        ...new Uint8Array(5),
      ]);
      const sequence = buildPacketSequence(geometry, "LRCP", 1);
      const result = run(data, data.length, geometry, sequence, { useEph });
      // No skip happens, so the body starts straight after the header, the marker bytes are the body's first two bytes, and the five-byte body ends before the data does.
      expect(codeBlockOf(geometry, 0, 0, 0, 0, 0).chunks).toEqual([
        { start: headerBytes.length, end: headerBytes.length + 5 },
      ]);
      expect(result).toMatchObject({
        position: headerBytes.length + 5,
        warnings: [],
      });
    }
  });

  it("does not treat bytes past the tile's own end as EPH, however they continue", () => {
    const header = singleBlockHeader(0, [0], 1, 0, 5);
    const headerBytes = header.toBytes();
    // The FF 92 pair sits beyond this tile's end (a second tile's data in the same buffer): the two-byte bound is measured against `end`, so no skip happens and the body is clamped to the end instead.
    const data = new Uint8Array([...headerBytes, 0xff, 0x92, 0, 0, 0, 0, 0]);
    const geometry = singleBlockGeometry();
    const result = run(
      data,
      1,
      geometry,
      [{ layer: 0, resolution: 0, component: 0, precinct: 0 }],
      { useEph: true },
    );
    expect(codeBlockOf(geometry, 0, 0, 0, 0, 0).chunks).toEqual([
      { start: 1, end: 1 },
    ]);
    expect(result.warnings[0]).toMatch(/more coded bytes/);
    expect(result.position).toBe(1);
  });

  it("does not treat a two-byte tail as EPH when the bound is an exact fit, but does when one byte short", () => {
    const header = singleBlockHeader(0, [0], 1, 0, 5);
    const headerBytes = header.toBytes();
    const base = new Uint8Array([...headerBytes, 0xff, 0x92]);
    // One byte short of the marker: no skip, the body clamps to the end and overruns it.
    const shortGeometry = singleBlockGeometry();
    const shortResult = run(
      base,
      2,
      shortGeometry,
      [{ layer: 0, resolution: 0, component: 0, precinct: 0 }],
      { useEph: true },
    );
    expect(codeBlockOf(shortGeometry, 0, 0, 0, 0, 0).chunks).toEqual([
      { start: 1, end: 2 },
    ]);
    expect(shortResult.position).toBe(2);

    // Exactly the marker: skipped, and the (empty) body starts at the end.
    const exactGeometry = singleBlockGeometry();
    const exactResult = run(
      base,
      3,
      exactGeometry,
      [{ layer: 0, resolution: 0, component: 0, precinct: 0 }],
      { useEph: true },
    );
    expect(codeBlockOf(exactGeometry, 0, 0, 0, 0, 0).chunks).toEqual([
      { start: 3, end: 3 },
    ]);
    expect(exactResult.position).toBe(3);
  });

  it("reads two code-blocks of one precinct back to back, each with its own length", () => {
    // Both blocks included (the 2x1 inclusion tag tree costs 11 then 1), zero bit-planes 0 (11 then 1), one pass each (a 0 bit), no lblock growth, then each one's 3-bit length.
    const geometry = twoBlockGeometry();
    const writer = new PacketHeaderWriter()
      .bit(1)
      .bit(1)
      .bit(1) // block 0 inclusion: root, leaf
      .bit(1)
      .bit(1) // block 0 zero bit-planes: root, leaf
      .bit(0) // block 0 passes: 1
      .bit(0) // block 0 lblock
      .field(2, 3) // block 0 length
      .bit(1) // block 1 inclusion: leaf only
      .bit(1) // block 1 zero bit-planes: leaf only
      .bit(0)
      .bit(0)
      .field(3, 3);
    const headerBytes = writer.toBytes();
    const data = new Uint8Array([...headerBytes, ...new Uint8Array(5)]);
    const sequence = buildPacketSequence(geometry, "LRCP", 1);
    const result = run(data, data.length, geometry, sequence);
    expect(codeBlockOf(geometry, 0, 0, 0, 0, 0).chunks).toEqual([
      { start: headerBytes.length, end: headerBytes.length + 2 },
    ]);
    expect(codeBlockOf(geometry, 0, 0, 0, 0, 1).chunks).toEqual([
      { start: headerBytes.length + 2, end: data.length },
    ]);
    expect(result).toMatchObject({ position: data.length, warnings: [] });
  });

  it("warns and clamps when a code-block declares more bytes than the tile carries, and stops at the tile's end", () => {
    const writer = new PacketHeaderWriter()
      .bit(1)
      .bit(1)
      .bit(1)
      .bit(1)
      .bit(1)
      .bit(0)
      .bit(0)
      .field(5, 3) // block 0: a 5-byte body that consumes exactly the bytes left
      .bit(1)
      .bit(1)
      .bit(0)
      .bit(0)
      .field(3, 3); // block 1: a further 3-byte body the tile cannot honour
    const headerBytes = writer.toBytes();
    // Five body bytes: block 0 ends exactly at the data's end, and block 1 still follows in the same packet, so its chunk degenerates to the end offset and warns rather than being silently dropped.
    const exactEnd = new Uint8Array([...headerBytes, ...new Uint8Array(5)]);
    const exactGeometry = twoBlockGeometry();
    const exactResult = run(
      exactEnd,
      exactEnd.length,
      exactGeometry,
      buildPacketSequence(exactGeometry, "LRCP", 1),
    );
    expect(codeBlockOf(exactGeometry, 0, 0, 0, 0, 0).chunks).toEqual([
      { start: headerBytes.length, end: exactEnd.length },
    ]);
    expect(codeBlockOf(exactGeometry, 0, 0, 0, 0, 1).chunks).toEqual([
      { start: exactEnd.length, end: exactEnd.length },
    ]);
    expect(exactResult.warnings).toHaveLength(1);
    expect(exactResult.warnings[0]).toMatch(/more coded bytes/);
    expect(exactResult.position).toBe(exactEnd.length);

    // Four body bytes: block 0's own 5-byte body already overruns, so its chunk clamps to the end and the read stops there, leaving block 1 with no chunk at all.
    const overrun = new Uint8Array([...headerBytes, ...new Uint8Array(4)]);
    const overrunGeometry = twoBlockGeometry();
    const overrunResult = run(
      overrun,
      overrun.length,
      overrunGeometry,
      buildPacketSequence(overrunGeometry, "LRCP", 1),
    );
    expect(codeBlockOf(overrunGeometry, 0, 0, 0, 0, 0).chunks).toEqual([
      { start: headerBytes.length, end: overrun.length },
    ]);
    expect(codeBlockOf(overrunGeometry, 0, 0, 0, 0, 1).chunks).toEqual([]);
    expect(overrunResult.warnings).toHaveLength(1);
    expect(overrunResult.position).toBe(overrun.length);
  });

  it("discards the stuffed byte after a packet header ending in 0xFF before the body starts", () => {
    // Hand-built bytes, because the header genuinely must end in 0xFF for this: bits are 1 (non-empty), 1 (inclusion), 1 (zero bit-planes 0), 11 00 (three passes), 111111 0 (lblock grown six times, to 9), then a 10-bit all-ones length of 1023. That makes byte 2 all ones (0xFF), and B.10.1 puts the following byte's stuffed zero inside the header, so the body starts after it at offset 4, clamped here to a zero-length chunk at the end.
    const data = Uint8Array.from([0xf9, 0xfb, 0xff, 0x01]);
    const geometry = singleBlockGeometry();
    const sequence = buildPacketSequence(geometry, "LRCP", 1);
    const result = run(data, data.length, geometry, sequence);
    const block = codeBlockOf(geometry, 0, 0, 0, 0, 0);
    expect(block.passes).toBe(3);
    expect(block.lblock).toBe(9);
    expect(block.chunks).toEqual([{ start: 4, end: 4 }]);
    expect(result.warnings[0]).toMatch(/more coded bytes/);
    expect(result.position).toBe(4);
  });
});
