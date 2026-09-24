import { describe, expect, it } from "vitest";
import { decodeWpgGraphic } from "./wpg";
import {
  dword,
  NO_TEXT,
  record,
  startWpgData,
  startWpgDataXY,
  word,
  wpg,
} from "../test-support/wpg";

describe("decodeWpgGraphic", () => {
  it("answers undefined for bytes carrying no WPG signature with the WPG file-type byte", () => {
    expect(
      decodeWpgGraphic(new Uint8Array([1, 2, 3]), NO_TEXT),
    ).toBeUndefined();
    // The WordPerfect document file shares the file ID; the file-type byte is what names a graphic.
    expect(
      decodeWpgGraphic(
        new Uint8Array([0xff, 0x57, 0x50, 0x43, ...dword(26), 1, 0x0a, 2, 0]),
        NO_TEXT,
      ),
    ).toBeUndefined();
  });

  it("refuses a WPG 1.0-major graphic rather than misparsing its record vocabulary", () => {
    const one = wpg([record(0x01, startWpgData({}))], 1);
    expect(decodeWpgGraphic(one, NO_TEXT)).toEqual({
      status: "refused",
      reason: "wpg1",
    });
  });

  it("refuses an encrypted graphic", () => {
    const encrypted = wpg([record(0x01, startWpgData({}))]);
    // The encryption key sits at prefix offset 12.
    encrypted[12] = 1;
    expect(decodeWpgGraphic(encrypted, NO_TEXT)).toEqual({
      status: "refused",
      reason: "encrypted",
    });
  });

  it("refuses a graphic whose record stream carries no walkable Start WPG record", () => {
    const bytes = wpg([
      record(0x18, [
        ...word(0),
        ...word(0),
        ...word(10),
        ...word(10),
        ...word(0),
        ...word(0),
      ]),
    ]);
    expect(decodeWpgGraphic(bytes, NO_TEXT)).toEqual({
      status: "refused",
      reason: "malformed",
    });
  });

  it("decodes a framed, filled rectangle with square corners onto the rect vector", () => {
    const graphic = wpg([
      record(0x01, startWpgData({ extent: [10, 20, 118, 92] })),
      // Pen Fore Color: red, fully opaque. Pen Size: 2 units = 2pt at 72ppi.
      record(0x25, [255, 0, 0, 0]),
      record(0x2b, [...word(2), ...word(2)]),
      // Brush Fore Color: blue. Rectangle, FRM|FIL (bits 15 and 13), corners (10,20)-(118,92), square corners.
      record(0x31, [0, 0, 255, 0]),
      record(0x18, [
        ...word(0xa000),
        ...word(10),
        ...word(20),
        ...word(118),
        ...word(92),
        ...word(0),
        ...word(0),
      ]),
      record(0x02, []),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    // Extent (10,20)-(118,92) at 72ppi: 108pt wide, 72pt tall.
    expect(decoded.sizePt).toEqual({ widthPt: 108, heightPt: 72 });
    expect(decoded.vectors).toHaveLength(1);
    const rect = decoded.vectors[0];
    if (rect?.kind !== "rect") throw new Error("expected a rect vector");
    // Y flips against the extent height: the rectangle's top edge is 92 units up, so the frame's page-top offset is 72 - 92 = -20.
    expect(rect.frame).toEqual({
      xPt: 10,
      yPt: -20,
      widthPt: 108,
      heightPt: 72,
    });
    expect(rect.fill).toEqual({ r: 0, g: 0, b: 1 });
    expect(rect.stroke).toEqual({
      color: { r: 1, g: 0, b: 0 },
      widthPt: 2,
    });
  });

  it("decodes a two-point unclosed polyline with a stroke onto the line variant, and a longer one onto a path", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x25, [0, 0, 0, 0]),
      record(0x2b, [...word(1), ...word(1)]),
      // FRM only (bit 15): a plain stroke.
      record(0x15, [
        ...word(0x8000),
        ...word(2),
        ...word(10),
        ...word(10),
        ...word(100),
        ...word(64),
      ]),
      record(0x15, [
        ...word(0x8000 | 0x4000),
        ...word(3),
        ...word(10),
        ...word(10),
        ...word(100),
        ...word(10),
        ...word(55),
        ...word(64),
      ]),
      record(0x02, []),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    expect(decoded.vectors).toHaveLength(2);
    const line = decoded.vectors[0];
    if (line?.kind !== "line") throw new Error("expected a line vector");
    expect(line.from).toEqual({ xPt: 10, yPt: 144 - 10 });
    expect(line.to).toEqual({ xPt: 100, yPt: 144 - 64 });
    const path = decoded.vectors[1];
    if (path?.kind !== "path") throw new Error("expected a path vector");
    expect(path.subpaths[0]?.closed).toBe(true);
    expect(path.subpaths[0]?.segments).toHaveLength(2);
  });

  it("decodes an Arc with identical endpoint offsets as the full ellipse the specification defines", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x19, [
        ...word(0x2000), // FIL only (bit 13)
        ...word(72), // cx
        ...word(72), // cy
        ...word(36), // horizontal radius
        ...word(24), // vertical radius
        ...word(0),
        ...word(0),
        ...word(0),
        ...word(0), // identical endpoint offsets: a full ellipse
        0, // arc flags
      ]),
      record(0x19, [
        ...word(0x2000),
        ...word(72),
        ...word(72),
        ...word(36),
        ...word(24),
        ...word(36),
        ...word(0),
        ...word(0),
        ...word(24), // different terminal offset: a partial arc, refused and named
        0,
      ]),
      record(0x02, []),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    expect(decoded.vectors).toHaveLength(1);
    const ellipse = decoded.vectors[0];
    if (ellipse?.kind !== "ellipse") {
      throw new Error("expected an ellipse vector");
    }
    expect(ellipse.frame).toEqual({
      xPt: 36,
      yPt: 144 - 96,
      widthPt: 72,
      heightPt: 48,
    });
    // The partial arc is named in the skipped-record list.
    expect(decoded.skippedRecords).toEqual(["Arc"]);
  });

  it("skips a record carrying a transformation in its characterisation flags rather than decoding it untransformed", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x18, [
        ...word(0x8010), // FRM plus ROTATE (bit 4)
        ...word(0),
        ...word(0),
        ...word(10),
        ...word(10),
        ...word(0),
        ...word(0),
      ]),
      record(0x02, []),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    expect(decoded.vectors).toHaveLength(0);
    expect(decoded.skippedRecords).toEqual(["Rectangle"]);
  });

  it("names the record types it does not decode, and swallows a skipped grouped record's members", () => {
    const bitmapData = [1, 2, 3];
    const graphic = wpg([
      record(0x01, startWpgData({})),
      // A Compound Polygon (skipped, named) whose extension member is swallowed rather than decoded as a standalone shape.
      record(
        0x1a,
        [...word(0x2000)],
        1, // one extension record follows
      ),
      record(0x15, [
        ...word(0x8000),
        ...word(2),
        ...word(0),
        ...word(0),
        ...word(10),
        ...word(10),
      ]),
      // A Polyspline (skipped, named).
      record(0x16, [
        ...word(0x8000),
        ...word(2),
        ...word(0),
        ...word(0),
        ...word(5),
        ...word(5),
      ]),
      // A Bitmap (skipped, named) whose Bitmap Data extension is swallowed with it.
      record(
        0x1b,
        [
          ...word(0),
          ...word(0),
          ...word(20),
          ...word(20),
          ...word(0),
          ...word(0),
        ],
        1,
      ),
      record(0x0e, [...word(1), ...word(1), 0, 0, ...bitmapData]),
      record(0x02, []),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    expect(decoded.vectors).toHaveLength(0);
    expect(decoded.skippedRecords).toEqual([
      "Compound Polygon",
      "Polyspline",
      "Bitmap",
    ]);
  });

  it("walks a Group's members as their own records", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x25, [0, 0, 0, 0]),
      record(0x2b, [...word(1), ...word(1)]),
      record(0x20, [...word(0)], 1),
      record(0x15, [
        ...word(0x8000),
        ...word(2),
        ...word(0),
        ...word(0),
        ...word(10),
        ...word(10),
      ]),
      record(0x02, []),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    expect(decoded.vectors).toHaveLength(1);
    expect(decoded.skippedRecords).toEqual([]);
  });

  it("folds a Text Block's Text Data through the injected WP fold and lifts it as a frame-sized shape", () => {
    const textDocumentArea = [0x48, 0x69, 0xcc]; // "Hi" and a Hard EOL
    const graphic = wpg([
      record(0x01, startWpgData({})),
      // Text Block with one extension: its Text Data.
      record(
        0x1d,
        [...word(0), ...word(10), ...word(10), ...word(60), ...word(50)],
        1,
      ),
      record(0x0f, textDocumentArea),
      record(0x02, []),
    ]);
    const decoded = decodeWpgGraphic(graphic, {
      foldTextData: (bytes) => [
        {
          kind: "paragraph",
          runs: [{ text: `folded:${bytes.length}` }],
        },
      ],
    });
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    expect(decoded.shapes).toHaveLength(1);
    const shape = decoded.shapes[0];
    if (shape === undefined) throw new Error("expected a shape");
    expect(shape.frame).toEqual({
      xPt: 10,
      yPt: 144 - 50,
      widthPt: 50,
      heightPt: 40,
    });
    expect(shape.blocks[0]).toEqual({
      kind: "paragraph",
      runs: [{ text: `folded:${textDocumentArea.length}` }],
    });
  });

  it("converts coordinates through a non-72ppi unit and a double-precision stream", () => {
    // 1200 pixels per inch: one unit is 0.06pt. Double precision: coordinates are 32-bit 16.16 fixed point.
    const fixed = (value: number): number[] =>
      dword(Math.round(value * 0x10000));
    const startData = [
      ...word(1200),
      ...word(1200),
      1, // double precision
      ...dword(0),
      ...dword(0),
      ...dword(0x7fff0000),
      ...dword(0x7fff0000), // viewport, stepped over
      ...fixed(0),
      ...fixed(0),
      ...fixed(1200),
      ...fixed(600),
    ];
    const graphic = wpg([
      record(0x01, startData),
      // DP Pen Size (0x2c): the double-precision spelling of Pen Size, attribute records carry their own DP types rather than doubling with the stream's precision, which doubles only the dagger-marked position/size fields.
      record(0x2c, [...dword(Math.round(2 * 0x10000)), ...dword(0)]),
      record(0x25, [0, 0, 0, 0]),
      record(0x18, [
        ...word(0x8000),
        ...fixed(0),
        ...fixed(0),
        ...fixed(1200),
        ...fixed(600),
        ...fixed(0),
        ...fixed(0),
      ]),
      record(0x02, []),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    // 1200 units at 1200ppi is one inch: 72pt wide, 36pt tall.
    expect(decoded.sizePt).toEqual({ widthPt: 72, heightPt: 36 });
    const rect = decoded.vectors[0];
    if (rect?.kind !== "rect") throw new Error("expected a rect vector");
    expect(rect.frame).toEqual({ xPt: 0, yPt: 0, widthPt: 72, heightPt: 36 });
    expect(rect.stroke?.widthPt).toBeCloseTo(0.12);
  });

  it("gives the vectors and shapes one shared paint order in record order", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x25, [0, 0, 0, 0]),
      record(0x2b, [...word(1), ...word(1)]),
      record(0x15, [
        ...word(0x8000),
        ...word(2),
        ...word(0),
        ...word(0),
        ...word(10),
        ...word(10),
      ]),
      record(
        0x1d,
        [...word(0), ...word(0), ...word(0), ...word(30), ...word(20)],
        1,
      ),
      record(0x0f, [0x41, 0xcc]),
      record(0x02, []),
    ]);
    const decoded = decodeWpgGraphic(graphic, {
      foldTextData: () => [{ kind: "paragraph", runs: [{ text: "A" }] }],
    });
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    expect(decoded.vectors[0]?.paintOrder).toBe(0);
    expect(decoded.shapes[0]?.paintOrder).toBe(1);
  });
});

describe("Start WPG record validation", () => {
  it("refuses a Start WPG record too short to carry its own fixed fields", () => {
    const graphic = wpg([record(0x01, [1, 2, 3, 4, 5])]);
    expect(decodeWpgGraphic(graphic, NO_TEXT)).toEqual({
      status: "refused",
      reason: "malformed",
    });
  });

  it("refuses a Start WPG record whose horizontal pixels-per-inch is zero", () => {
    const graphic = wpg([record(0x01, startWpgDataXY(0, 72))]);
    expect(decodeWpgGraphic(graphic, NO_TEXT)).toEqual({
      status: "refused",
      reason: "malformed",
    });
  });

  it("refuses a Start WPG record whose vertical pixels-per-inch is zero", () => {
    const graphic = wpg([record(0x01, startWpgDataXY(72, 0))]);
    expect(decodeWpgGraphic(graphic, NO_TEXT)).toEqual({
      status: "refused",
      reason: "malformed",
    });
  });

  it("refuses a Start WPG record whose precision byte names neither single nor double precision", () => {
    const graphic = wpg([record(0x01, startWpgDataXY(72, 72, 2))]);
    expect(decodeWpgGraphic(graphic, NO_TEXT)).toEqual({
      status: "refused",
      reason: "malformed",
    });
  });

  it("refuses a Start WPG record too short to carry its own image extent", () => {
    const truncated = startWpgDataXY(72, 72, 0).slice(0, 15);
    const graphic = wpg([record(0x01, truncated)]);
    expect(decodeWpgGraphic(graphic, NO_TEXT)).toEqual({
      status: "refused",
      reason: "malformed",
    });
  });
});

describe("pen and brush colour record dispatch", () => {
  it("dispatches DP Brush Fore Color through the double-precision reader, overwriting a prior single-precision colour", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x31, [0, 0, 255, 0]), // Brush Fore Color: blue
      record(0x32, [...word(0), ...word(65535), ...word(0), ...word(0)]), // DP Brush Fore Color: green, opaque
      record(0x18, [
        ...word(0x2000), // FIL only
        ...word(0),
        ...word(0),
        ...word(10),
        ...word(10),
        ...word(0),
        ...word(0),
      ]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    const rect = decoded.vectors[0];
    if (rect?.kind !== "rect") throw new Error("expected a rect vector");
    expect(rect.fill).toEqual({ r: 0, g: 1, b: 0 });
  });

  it("leaves the rendition state unchanged when a colour record is too short to carry its own colour", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x25, [255, 0, 0, 0]), // Pen Fore Color: red
      record(0x2b, [...word(3), ...word(3)]), // Pen Size: 3 units
      record(0x25, [1, 2]), // truncated Pen Fore Color, too short to update
      record(0x18, [
        ...word(0x8000),
        ...word(0),
        ...word(0),
        ...word(10),
        ...word(10),
        ...word(0),
        ...word(0),
      ]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    const rect = decoded.vectors[0];
    if (rect?.kind !== "rect") throw new Error("expected a rect vector");
    expect(rect.stroke?.color).toEqual({ r: 1, g: 0, b: 0 });
  });
});

describe("Pen Size thresholds", () => {
  it("does not update the pen width from a Pen Size record one byte short of its own field", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x2b, [...word(5), 0, 0].slice(0, 3)), // 3 bytes: one short of the 4 the record needs
      record(0x18, [
        ...word(0x8000),
        ...word(0),
        ...word(0),
        ...word(10),
        ...word(10),
        ...word(0),
        ...word(0),
      ]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    const rect = decoded.vectors[0];
    if (rect?.kind !== "rect") throw new Error("expected a rect vector");
    // The default hairline width (0) never produces a stroke.
    expect(rect.stroke).toBeUndefined();
  });

  it("does not update the pen width from a DP Pen Size record one byte short of its own field", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x2c, [...dword(5 * 0x10000), 0, 0, 0].slice(0, 7)), // 7 bytes: one short of the 8 the record needs
      record(0x18, [
        ...word(0x8000),
        ...word(0),
        ...word(0),
        ...word(10),
        ...word(10),
        ...word(0),
        ...word(0),
      ]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    const rect = decoded.vectors[0];
    if (rect?.kind !== "rect") throw new Error("expected a rect vector");
    expect(rect.stroke).toBeUndefined();
  });

  it("gives no stroke at all when no Pen Size record ever arrived", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x18, [
        ...word(0x8000), // FRM only, but the default hairline (0) pen width
        ...word(0),
        ...word(0),
        ...word(10),
        ...word(10),
        ...word(0),
        ...word(0),
      ]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    const rect = decoded.vectors[0];
    if (rect?.kind !== "rect") throw new Error("expected a rect vector");
    expect(rect.stroke).toBeUndefined();
  });
});

describe("Text Block frame lifecycle", () => {
  it("clears a pending Text Block frame when an unrelated record intervenes before its Text Data arrives", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(
        0x1d,
        [...word(0), ...word(0), ...word(0), ...word(30), ...word(20)],
        1,
      ),
      // A Polyline arrives instead of the Text Block's own Text Data, clearing the pending frame.
      record(0x15, [
        ...word(0x8000),
        ...word(2),
        ...word(0),
        ...word(0),
        ...word(5),
        ...word(5),
      ]),
      record(0x0f, [0x41, 0xcc]), // an orphaned Text Data: no frame to attach to
      record(0x02, []),
    ]);
    const decoded = decodeWpgGraphic(graphic, {
      foldTextData: () => [{ kind: "paragraph", runs: [{ text: "A" }] }],
    });
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    expect(decoded.shapes).toEqual([]);
    expect(decoded.skippedRecords).toEqual(["Text Data"]);
  });

  it("swallows an unreachable-frame Text Block's own Text Data member rather than decoding it as an orphan", () => {
    // The Text Block's data is too short to carry a frame at all, so it is skipped, and its Text Data extension member (declared via the extension count) is swallowed with it rather than walked as its own record.
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x1d, [0, 0], 1),
      record(0x0f, [0x41, 0xcc]),
      record(0x02, []),
    ]);
    const decoded = decodeWpgGraphic(graphic, {
      foldTextData: () => [{ kind: "paragraph", runs: [{ text: "A" }] }],
    });
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    expect(decoded.shapes).toEqual([]);
    expect(decoded.skippedRecords).toEqual(["Text Block"]);
  });
});

describe("nested group bookkeeping", () => {
  it("pops more than one closed group in the same iteration when an inner group's last member also closes its parent", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x25, [0, 0, 0, 0]),
      record(0x2b, [...word(1), ...word(1)]),
      // Outer Group: one member, which is itself a Group.
      record(0x20, [...word(0)], 1),
      // Inner Group: one member, a Polyline.
      record(0x20, [...word(0)], 1),
      record(0x15, [
        ...word(0x8000),
        ...word(2),
        ...word(0),
        ...word(0),
        ...word(10),
        ...word(10),
      ]),
      record(0x02, []),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    expect(decoded.vectors).toHaveLength(1);
    expect(decoded.skippedRecords).toEqual([]);
  });
});

describe("paint order across a text shape followed by another vector", () => {
  it("keeps incrementing paint order past a Text Data shape, not decrementing it", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x25, [0, 0, 0, 0]),
      record(0x2b, [...word(1), ...word(1)]),
      record(0x15, [
        ...word(0x8000),
        ...word(2),
        ...word(0),
        ...word(0),
        ...word(10),
        ...word(10),
      ]),
      record(
        0x1d,
        [...word(0), ...word(0), ...word(0), ...word(30), ...word(20)],
        1,
      ),
      record(0x0f, [0x41, 0xcc]),
      record(0x15, [
        ...word(0x8000),
        ...word(2),
        ...word(0),
        ...word(0),
        ...word(20),
        ...word(20),
      ]),
    ]);
    const decoded = decodeWpgGraphic(graphic, {
      foldTextData: () => [{ kind: "paragraph", runs: [{ text: "A" }] }],
    });
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    expect(decoded.vectors[0]?.paintOrder).toBe(0);
    expect(decoded.shapes[0]?.paintOrder).toBe(1);
    expect(decoded.vectors[1]?.paintOrder).toBe(2);
  });
});
