import { describe, expect, it } from "vitest";
import type { RawImage } from "byte-codec";
import type {
  RasterDrawOp,
  RasterImageOp,
  RasterMatrix,
  RasterPathOp,
  RasterPathSegment,
  RasterSubpath,
} from "pdf-codec/raster";
import { CpuRasteriser } from "./rasteriser";
import { pageGeometry, pngBytes } from "./test-support/pixel-fixtures";
import { ReferenceRasteriser } from "./test-support/reference-rasteriser";
import { seededRandom } from "./test-support/seeded-random";

// CpuRasteriser against ReferenceRasteriser, the same passes with the clear and the walk as they were before the mask recorded the pixels it marks (ExaDev/documents.js#1720). Every page here is rendered by both and must come out as byte-identical PNGs, and the new single readback (a walk that clears as it goes) must cost exactly the pixels each pass covers: so the change is pinned as a pure reduction in work, with the work counted in cells rather than timed.

interface BothRenders {
  readonly candidate: Uint8Array<ArrayBuffer>;
  readonly reference: Uint8Array<ArrayBuffer>;
  // Cells CpuRasteriser's mask read back and cleared over the page.
  readonly candidateCells: number;
  // Cells the old algorithm cleared and walked over the same page.
  readonly referenceCells: number;
  // Pixels covered, summed over every coverage pass of the page.
  readonly coveredCells: number;
}

function renderBoth(
  widthPx: number,
  heightPx: number,
  ops: readonly RasterDrawOp[],
): BothRenders {
  const candidate = new CpuRasteriser();
  const reference = new ReferenceRasteriser();
  candidate.beginPage(pageGeometry(widthPx, heightPx));
  reference.beginPage(pageGeometry(widthPx, heightPx));
  for (const op of ops) {
    candidate.draw(op);
    reference.draw(op);
  }
  const candidateCells = candidate.maskCellsVisitedForTesting();
  return {
    candidate: candidate.finish(),
    reference: reference.finish(),
    candidateCells,
    referenceCells: reference.cellsVisited,
    coveredCells: reference.coveredCells,
  };
}

function expectIdenticalAndProportional(
  widthPx: number,
  heightPx: number,
  ops: readonly RasterDrawOp[],
): BothRenders {
  const renders = renderBoth(widthPx, heightPx, ops);
  expect(renders.candidate).toEqual(renders.reference);
  expect(renders.candidateCells).toBe(renders.coveredCells);
  return renders;
}

const BLACK_UNIT = { r: 0, g: 0, b: 0 };
const RED_UNIT = { r: 1, g: 0, b: 0 };
const BLUE_UNIT = { r: 0, g: 0, b: 1 };

function polyline(
  points: readonly (readonly [number, number])[],
  closed: boolean,
): RasterSubpath {
  const [start, ...rest] = points;
  if (start === undefined) {
    throw new Error("polyline needs a start point");
  }
  return {
    startXPx: start[0],
    startYPx: start[1],
    segments: rest.map(([xPx, yPx]) => ({ kind: "line", xPx, yPx })),
    closed,
  };
}

function rectangle(
  left: number,
  top: number,
  right: number,
  bottom: number,
): RasterSubpath {
  return polyline(
    [
      [left, top],
      [right, top],
      [right, bottom],
      [left, bottom],
    ],
    true,
  );
}

function stroke(
  subpaths: readonly RasterSubpath[],
  widthPx: number,
  color = BLACK_UNIT,
  dashPx?: readonly number[],
): RasterPathOp {
  return {
    kind: "path",
    subpaths,
    stroke:
      dashPx === undefined ? { color, widthPx } : { color, widthPx, dashPx },
  };
}

function fill(
  subpaths: readonly RasterSubpath[],
  fillRule: "nonzero" | "evenodd" = "nonzero",
  color = BLACK_UNIT,
): RasterPathOp {
  return { kind: "path", subpaths, fill: { color, fillRule } };
}

// A two-by-two source with a distinct colour and alpha per texel, so a placement's bilinear sampling differs from pixel to pixel and a misplaced or skipped pixel shows.
const SOURCE_SIDE = 2;
const SOURCE_TEXELS = [
  [255, 0, 0],
  [0, 255, 0],
  [0, 0, 255],
  [255, 255, 0],
].flat();
const SOURCE_ALPHA = [255, 192, 128, 64];
const TEXTURED_SOURCE: RawImage = {
  width: SOURCE_SIDE,
  height: SOURCE_SIDE,
  channels: 3,
  data: new Uint8Array(SOURCE_TEXELS),
  alpha: new Uint8Array(SOURCE_ALPHA),
};

// One byte channel's 256 levels, which a generated source texel or alpha is drawn from.
const SOURCE_CHANNEL_LEVELS = 256;

function image(matrix: RasterMatrix, source = TEXTURED_SOURCE): RasterImageOp {
  return {
    kind: "image",
    format: "png",
    bytes: pngBytes(source),
    sourceWidthPx: source.width,
    sourceHeightPx: source.height,
    matrix,
  };
}

describe("CpuRasteriser against the pre-#1720 reference: adversarial shapes", () => {
  const width = 40;
  const height = 30;

  it("renders a diagonal hairline across the whole canvas identically", () => {
    const hairline = 0.1;
    const unit = 1;
    expectIdenticalAndProportional(width, height, [
      stroke(
        [
          polyline(
            [
              [0, 0],
              [width, height],
            ],
            false,
          ),
        ],
        hairline,
      ),
      stroke(
        [
          polyline(
            [
              [width, 0],
              [0, height],
            ],
            false,
          ),
        ],
        unit,
        RED_UNIT,
      ),
    ]);
  });

  it("renders a fill far larger than the canvas identically", () => {
    const far = 10_000;
    expectIdenticalAndProportional(width, height, [
      fill([rectangle(-far, -far, far, far)], "nonzero", RED_UNIT),
      fill(
        [
          polyline(
            [
              [-far, far],
              [far, -far],
              [far, far],
            ],
            true,
          ),
        ],
        "evenodd",
      ),
    ]);
  });

  it("renders shapes wholly off each edge of the canvas identically, marking nothing", () => {
    const gap = 5;
    const size = 8;
    const renders = expectIdenticalAndProportional(width, height, [
      fill([rectangle(-gap - size, 0, -gap, size)]),
      fill([rectangle(width + gap, 0, width + gap + size, size)]),
      fill([rectangle(0, -gap - size, size, -gap)]),
      fill([rectangle(0, height + gap, size, height + gap + size)]),
      stroke(
        [
          polyline(
            [
              [width + gap, 0],
              [width + gap, height],
            ],
            false,
          ),
        ],
        2,
      ),
    ]);
    expect(renders.coveredCells).toBe(0);
  });

  it("renders paths clipped by every edge identically", () => {
    const overhang = 7;
    const strokeWidth = 3;
    const control = 2;
    const loop: RasterSubpath = {
      startXPx: -overhang,
      startYPx: height / 2,
      segments: [
        {
          kind: "cubic",
          c1xPx: width / 2,
          c1yPx: -height * control,
          c2xPx: width * control,
          c2yPx: height * control,
          xPx: width + overhang,
          yPx: height / 2,
        },
      ],
      closed: false,
    };
    expectIdenticalAndProportional(width, height, [
      fill(
        [rectangle(-overhang, -overhang, width + overhang, height / 2)],
        "nonzero",
        BLUE_UNIT,
      ),
      fill([loop], "evenodd", RED_UNIT),
      stroke([loop], strokeWidth),
    ]);
  });

  it("renders the same path stroked over itself repeatedly identically", () => {
    const zigzag = polyline(
      [
        [2, 2],
        [width - 2, height / 3],
        [2, (2 * height) / 3],
        [width - 2, height - 2],
      ],
      false,
    );
    const widths = [0.5, 1, 2.5, 4];
    const dash = [3, 1.5];
    expectIdenticalAndProportional(
      width,
      height,
      widths.map((strokeWidth, index) =>
        stroke(
          [zigzag],
          strokeWidth,
          index % 2 === 0 ? RED_UNIT : BLUE_UNIT,
          index === 1 ? dash : undefined,
        ),
      ),
    );
  });

  it("renders a hollow page frame and an evenodd ring identically, walking only their edges", () => {
    const inset = 0.5;
    const ringOuter = 4;
    const ringInner = 6;
    const renders = expectIdenticalAndProportional(width, height, [
      stroke([rectangle(inset, inset, width - inset, height - inset)], 1),
      fill(
        [
          rectangle(
            ringOuter,
            ringOuter,
            width - ringOuter,
            height - ringOuter,
          ),
          rectangle(
            ringInner,
            ringInner,
            width - ringInner,
            height - ringInner,
          ),
        ],
        "evenodd",
        RED_UNIT,
      ),
    ]);
    // A frame's interior is never walked: the work for both passes together is below one visit of every pixel on the canvas.
    expect(renders.candidateCells).toBeLessThan(width * height);
  });

  it("renders slivers narrower than one subsample spacing identically", () => {
    const sliver = 0.1;
    const left = 3.3;
    expectIdenticalAndProportional(width, height, [
      fill([rectangle(left, 0, left + sliver, height)]),
      fill([
        polyline(
          [
            [0, 1],
            [width, 1 + sliver],
            [width, 1],
          ],
          true,
        ),
      ]),
    ]);
  });

  it("renders image placements, rotated, straddling a corner, larger than the canvas and tiny, identically", () => {
    const quarterTurn = Math.SQRT1_2;
    const placed = 20;
    const tiny = 0.4;
    const larger = 3;
    expectIdenticalAndProportional(width, height, [
      image([
        placed * quarterTurn,
        placed * quarterTurn,
        -placed * quarterTurn,
        placed * quarterTurn,
        width / 2,
        -placed / 2,
      ]),
      image([placed, 0, 0, placed, width - placed / 2, height - placed / 2]),
      image([width * larger, 0, 0, height * larger, -width, -height]),
      image([tiny, 0, 0, tiny, width / 2, height / 2]),
    ]);
  });

  it("renders a singular placement, whose quad has no area, as no paint at all", () => {
    const renders = expectIdenticalAndProportional(width, height, [
      image([0, 0, 0, 0, width / 2, height / 2]),
    ]);
    expect(renders.coveredCells).toBe(0);
  });

  it("renders one-pixel-wide and one-pixel-high canvases identically", () => {
    const length = 25;
    const diagonal = stroke(
      [
        polyline(
          [
            [0, 0],
            [length, length],
          ],
          false,
        ),
      ],
      1,
    );
    const covering = fill(
      [rectangle(-1, -1, length + 1, length + 1)],
      "nonzero",
      RED_UNIT,
    );
    expectIdenticalAndProportional(1, length, [covering, diagonal]);
    expectIdenticalAndProportional(length, 1, [covering, diagonal]);
    expectIdenticalAndProportional(1, 1, [covering, diagonal]);
  });
});

describe("CpuRasteriser against the pre-#1720 reference: generated pages", () => {
  const SEED = 1720;
  const GENERATED_PAGES = 300;
  const MAX_CANVAS_SIDE = 48;
  const MAX_OPS = 8;
  const MAX_SUBPATHS = 3;
  const MAX_SEGMENTS = 5;
  const MAX_STROKE_WIDTH = 6;
  const MAX_DASH = 4;
  const MAX_SOURCE_SIDE = 4;
  // Shapes reach past every edge by this fraction of the canvas, so clipping on all four sides is generated as often as a shape inside it.
  const OVERHANG_FRACTION = 0.5;
  // A placement whose matrix determinant is below this maps the unit square to (nearly) a line; the adversarial case above covers the exactly singular one, and this keeps the generated ones to quads with area.
  const MIN_DETERMINANT = 0.25;
  const IMAGE_OP_SHARE = 0.25;
  const CUBIC_SHARE = 0.3;
  const SMALL_SHAPE_SHARE = 0.4;
  const SMALL_SHAPE_RADIUS = 3;
  const HALF = 0.5;

  it("paints byte-identical pages, at exactly the covered pixels in mask work", () => {
    const random = seededRandom(SEED);
    const between = (low: number, high: number): number =>
      low + random() * (high - low);
    const chance = (share: number): boolean => random() < share;
    const count = (max: number): number => 1 + Math.floor(random() * max);
    const colour = (): { r: number; g: number; b: number } => ({
      r: random(),
      g: random(),
      b: random(),
    });

    let referenceCells = 0;
    let candidateCells = 0;
    for (let page = 0; page < GENERATED_PAGES; page++) {
      const width = count(MAX_CANVAS_SIDE);
      const height = count(MAX_CANVAS_SIDE);
      const point = (
        centre: readonly [number, number] | undefined,
      ): [number, number] =>
        centre === undefined
          ? [
              between(
                -width * OVERHANG_FRACTION,
                width * (1 + OVERHANG_FRACTION),
              ),
              between(
                -height * OVERHANG_FRACTION,
                height * (1 + OVERHANG_FRACTION),
              ),
            ]
          : [
              centre[0] + between(-SMALL_SHAPE_RADIUS, SMALL_SHAPE_RADIUS),
              centre[1] + between(-SMALL_SHAPE_RADIUS, SMALL_SHAPE_RADIUS),
            ];
      const subpath = (): RasterSubpath => {
        const centre = chance(SMALL_SHAPE_SHARE) ? point(undefined) : undefined;
        const [startXPx, startYPx] = point(centre);
        const segments: RasterPathSegment[] = [];
        const segmentCount = count(MAX_SEGMENTS);
        for (let s = 0; s < segmentCount; s++) {
          const [xPx, yPx] = point(centre);
          if (chance(CUBIC_SHARE)) {
            const [c1xPx, c1yPx] = point(centre);
            const [c2xPx, c2yPx] = point(centre);
            segments.push({
              kind: "cubic",
              c1xPx,
              c1yPx,
              c2xPx,
              c2yPx,
              xPx,
              yPx,
            });
          } else {
            segments.push({ kind: "line", xPx, yPx });
          }
        }
        return { startXPx, startYPx, segments, closed: chance(HALF) };
      };
      const pathOp = (): RasterPathOp => {
        const subpaths = Array.from({ length: count(MAX_SUBPATHS) }, subpath);
        const filled = chance(HALF);
        const fillSpec = {
          color: colour(),
          fillRule: chance(HALF) ? ("evenodd" as const) : ("nonzero" as const),
        };
        const widthPx = between(0, MAX_STROKE_WIDTH);
        const strokeSpec = chance(HALF)
          ? {
              color: colour(),
              widthPx,
              dashPx: [between(HALF, MAX_DASH), between(HALF, MAX_DASH)],
            }
          : { color: colour(), widthPx };
        // At least one of fill and stroke, as the port promises.
        if (!filled) {
          return { kind: "path", subpaths, stroke: strokeSpec };
        }
        return chance(HALF)
          ? { kind: "path", subpaths, fill: fillSpec }
          : { kind: "path", subpaths, fill: fillSpec, stroke: strokeSpec };
      };
      const imageOp = (): RasterImageOp => {
        const sourceWidth = count(MAX_SOURCE_SIDE);
        const sourceHeight = count(MAX_SOURCE_SIDE);
        const channels = chance(HALF) ? 1 : 3;
        const source: RawImage = {
          width: sourceWidth,
          height: sourceHeight,
          channels,
          data: Uint8Array.from(
            { length: sourceWidth * sourceHeight * channels },
            () => Math.floor(random() * SOURCE_CHANNEL_LEVELS),
          ),
          ...(chance(HALF)
            ? {
                alpha: Uint8Array.from(
                  { length: sourceWidth * sourceHeight },
                  () => Math.floor(random() * SOURCE_CHANNEL_LEVELS),
                ),
              }
            : {}),
        };
        const span = Math.max(width, height);
        let matrix: RasterMatrix;
        do {
          const [e, f] = point(undefined);
          matrix = [
            between(-span, span),
            between(-span, span),
            between(-span, span),
            between(-span, span),
            e,
            f,
          ];
        } while (
          Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]) <
          MIN_DETERMINANT
        );
        return image(matrix, source);
      };
      const ops = Array.from({ length: count(MAX_OPS) }, () =>
        chance(IMAGE_OP_SHARE) ? imageOp() : pathOp(),
      );
      const renders = expectIdenticalAndProportional(width, height, ops);
      referenceCells += renders.referenceCells;
      candidateCells += renders.candidateCells;
    }
    // Across every generated page, the old clear and walk did strictly more work than the new readback: equality would mean the generator never produced a pass that leaves part of the canvas uncovered, so the comparison above would prove nothing about skipping it.
    expect(candidateCells).toBeLessThan(referenceCells);
  });
});

describe("CpuRasteriser mask work: proportional to the pixels a shape covers, not to the canvas", () => {
  // A unit-width 45-degree hairline crossing `rows` pixel rows, starting a few pixels in from the top-left corner so its butt-capped ends stay on the canvas.
  const MARGIN = 4;
  const STROKE_WIDTH = 1;
  function diagonal(rows: number): RasterPathOp {
    return stroke(
      [
        polyline(
          [
            [MARGIN, MARGIN],
            [MARGIN + rows, MARGIN + rows],
          ],
          false,
        ),
      ],
      STROKE_WIDTH,
    );
  }
  // A span of length L touches at most ceil(L) + 1 pixels. On one pixel row a 45-degree stroke of width w spans the row's own height of travel (1) plus its width measured horizontally (w * sqrt 2).
  const CELLS_PER_ROW = Math.ceil(1 + STROKE_WIDTH * Math.SQRT2) + 1;
  // The rows the stroke can touch: its own travel, plus at most one partial row past each butt-capped end (the cap's corners reach w / (2 * sqrt 2) beyond the end point, under a pixel).
  const rowsTouched = (rows: number): number => rows + 2;

  // CpuRasteriser's own mask work for a page, without the reference: on the large canvases below the old algorithm's whole-canvas clear and walk would dominate the suite (and the instrumented mutation run) while proving nothing the small-canvas comparisons above do not already.
  function candidateCells(
    widthPx: number,
    heightPx: number,
    ops: readonly RasterDrawOp[],
  ): number {
    const rasteriser = new CpuRasteriser();
    rasteriser.beginPage(pageGeometry(widthPx, heightPx));
    for (const op of ops) {
      rasteriser.draw(op);
    }
    return rasteriser.maskCellsVisitedForTesting();
  }

  it("costs the same cells however large the canvas the shape sits on", () => {
    const rows = 64;
    const side = rows + 2 * MARGIN;
    const { coveredCells } = expectIdenticalAndProportional(side, side, [
      diagonal(rows),
    ]);
    const largerCanvases = [
      [4 * rows, side],
      [16 * rows, 4 * rows],
    ] as const;
    for (const [w, h] of largerCanvases) {
      expect(candidateCells(w, h, [diagonal(rows)])).toBe(coveredCells);
    }
  });

  it("grows with the rows a diagonal covers, bounded per row by the stroke's own width", () => {
    const rowCounts = [16, 64, 256];
    for (const rows of rowCounts) {
      const side = rows + 2 * MARGIN;
      const renders = expectIdenticalAndProportional(side, side, [
        diagonal(rows),
      ]);
      expect(renders.coveredCells).toBeGreaterThanOrEqual(rows);
      expect(renders.coveredCells).toBeLessThanOrEqual(
        rowsTouched(rows) * CELLS_PER_ROW,
      );
    }
  });

  it("visits only a page-spanning diagonal's own pixels on a large drawing-sized canvas, where the old clear alone visited every pixel", () => {
    // A 1568 by 1108 canvas: an A0-proportioned sheet rendered at a 1568-pixel long edge, where a vector-dense page issues tens of thousands of path ops.
    const sheetWidth = 1568;
    const sheetHeight = 1108;
    const cells = candidateCells(sheetWidth, sheetHeight, [
      stroke(
        [
          polyline(
            [
              [0, 0],
              [sheetWidth, sheetHeight],
            ],
            false,
          ),
        ],
        STROKE_WIDTH,
      ),
    ]);
    // The line's horizontal travel per row is sheetWidth / sheetHeight, so its per-row span is that plus its width measured horizontally.
    const slope = sheetWidth / sheetHeight;
    const cellsPerRow =
      Math.ceil(slope + STROKE_WIDTH * Math.hypot(1, slope)) + 1;
    expect(cells).toBeGreaterThanOrEqual(sheetHeight);
    expect(cells).toBeLessThanOrEqual(rowsTouched(sheetHeight) * cellsPerRow);
  });
});
