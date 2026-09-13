import { describe, expect, it } from "vitest";
import { decodeWpgGraphic } from "./wpg";

// Every fixture below is assembled directly from the specification's own field tables: the 26-byte prefix, the Class/Type/Extension/Length record header, and each record's documented field order -- so each expectation is checkable against the page it cites without a real graphic to hand. Single precision (16-bit coordinates) throughout unless a test states otherwise; ppi of 72 makes one coordinate unit one point, keeping the arithmetic the assertions describe transparent.
const PPI = 72;

function word(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff];
}

function dword(value: number): number[] {
  return [...word(value & 0xffff), ...word((value >>> 16) & 0xffff)];
}

// One record header: Class (0x0F, the value every drawing object in these fixtures carries -- the class byte selects which of a shadow/extrusion/cap layer a record renders into, and this decoder, like the reference decoders, dispatches on type alone), Type, Extension count, Length.
function record(
  type: number,
  data: readonly number[],
  extensionCount = 0,
): number[] {
  return [0x0f, type, extensionCount, data.length, ...data];
}

// The Start WPG record's data at single precision: [h units/inch][v units/inch]<precision>[viewport x 4][extent x 4].
function startWpgData(options: {
  readonly ppi?: number;
  readonly extent?: readonly [number, number, number, number];
  readonly precision?: number;
}): number[] {
  const ppi = options.ppi ?? PPI;
  const [left, bottom, right, top] = options.extent ?? [0, 0, 288, 144];
  return [
    ...word(ppi),
    ...word(ppi),
    options.precision ?? 0,
    ...word(0),
    ...word(0),
    ...word(0x7fff),
    ...word(0x7fff), // the viewport, stepped over by the record's own length
    ...word(left),
    ...word(bottom),
    ...word(right),
    ...word(top),
  ];
}

// The same Start WPG layout as startWpgData, but with the two axes' pixels-per-inch and the precision byte given independently, for fixtures that need an invalid axis or precision the paired helper cannot produce.
function startWpgDataXY(
  xPpi: number,
  yPpi: number,
  precision = 0,
  extent: readonly [number, number, number, number] = [0, 0, 288, 144],
): number[] {
  const [left, bottom, right, top] = extent;
  return [
    ...word(xPpi),
    ...word(yPpi),
    precision,
    ...word(0),
    ...word(0),
    ...word(0x7fff),
    ...word(0x7fff),
    ...word(left),
    ...word(bottom),
    ...word(right),
    ...word(top),
  ];
}

// A WPG 2.x graphic: the 26-byte prefix, then the records, with {start of document} pointing past the prefix.
function wpg(
  records: readonly (readonly number[])[],
  majorVersion = 2,
): Uint8Array {
  const flattened = records.flat();
  const head = [
    0xff,
    0x57,
    0x50,
    0x43,
    ...dword(26),
    1, // product type: always 1 for WPG files
    0x16, // file type: always 22 for WPG files
    majorVersion,
    0, // minor version
    ...word(0), // encryption key: zero when not encrypted
    ...word(26), // start of packet data
    0, // entry count
    0, // resource complete
    ...word(0), // start encryption
    ...dword(26 + flattened.length),
    ...word(0), // encryption version
  ];
  return new Uint8Array([...head, ...flattened]);
}

const NO_TEXT = { foldTextData: () => [] };

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
      // DP Pen Size (0x2c): the double-precision spelling of Pen Size -- attribute records carry their own DP types rather than doubling with the stream's precision, which doubles only the dagger-marked position/size fields.
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

describe("readCountField's 1/3/5-byte spellings", () => {
  it("reads a record whose own Length field uses the 3-byte count spelling", () => {
    const filler = new Array<number>(300).fill(0);
    const oversizedRecord = [0x0f, 0x99, 0, 0xff, ...word(300), ...filler];
    const graphic = wpg([
      record(0x01, startWpgData({})),
      oversizedRecord,
      record(0x02, []),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    expect(decoded.skippedRecords).toEqual(["record type 0x99"]);
    expect(decoded.sizePt).toEqual({ widthPt: 288, heightPt: 144 });
  });

  it("reads a record whose own Length field uses the 5-byte count spelling", () => {
    const filler = new Array<number>(40).fill(0);
    // shortValue = 0x8000 (top bit set, low 15 bits zero) then lowHalf = 40 -> value = ((0x8000 & 0x7fff) << 16) + 40 = 40.
    const oversizedRecord = [
      0x0f,
      0x99,
      0,
      0xff,
      ...word(0x8000),
      ...word(40),
      ...filler,
    ];
    const graphic = wpg([
      record(0x01, startWpgData({})),
      oversizedRecord,
      record(0x02, []),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    expect(decoded.skippedRecords).toEqual(["record type 0x99"]);
  });

  it("reads a zero-length record at the exact 3-byte spelling boundary rather than treating it as truncated", () => {
    // The 3-byte marker plus a zero value: cursor + 3 lands exactly on the buffer's own end, with no data bytes following.
    const raw = [0x0f, 0x99, 0, 0xff, ...word(0)];
    const graphic = wpg([record(0x01, startWpgData({})), raw]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    expect(decoded.skippedRecords).toEqual(["record type 0x99"]);
  });

  it("reads a zero-length record at the exact 5-byte spelling boundary rather than treating it as truncated", () => {
    const raw = [0x0f, 0x99, 0, 0xff, ...word(0x8000), ...word(0)];
    const graphic = wpg([record(0x01, startWpgData({})), raw]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    expect(decoded.skippedRecords).toEqual(["record type 0x99"]);
  });

  it("reads a Length field of exactly 0xFE as the plain single-byte spelling, not the extended one", () => {
    // 0xFE is the top of the single-byte range ("a byte 0-0xFE is the value"); only 0xFF introduces the extended spelling.
    const filler = new Array<number>(0xfe).fill(0);
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x99, filler),
      record(0x02, []),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    expect(decoded.skippedRecords).toEqual(["record type 0x99"]);
  });

  it("stops the walk rather than reading past the buffer when a Length field's 3-byte marker has no room for its own short value", () => {
    // 0xff with nothing after it: cursor + 3 runs past the buffer's own end.
    const raw = [0x0f, 0x99, 0, 0xff];
    const graphic = wpg([record(0x01, startWpgData({})), raw]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    expect(decoded.skippedRecords).toEqual([]);
    expect(decoded.vectors).toEqual([]);
  });

  it("stops the walk rather than reading past the buffer when a Length field's 5-byte marker has no room for its low half", () => {
    const raw = [0x0f, 0x99, 0, 0xff, ...word(0x8000)];
    const graphic = wpg([record(0x01, startWpgData({})), raw]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    expect(decoded.skippedRecords).toEqual([]);
    expect(decoded.vectors).toEqual([]);
  });
});

describe("readCharacterization's edit-lock and Object ID walks", () => {
  it("steps past a 4-byte edit-lock descriptor to reach the geometry", () => {
    const flags = 0x0080; // FLAG_EDIT_LOCK only
    const data = [
      ...word(flags),
      0xaa,
      0xbb,
      0xcc,
      0xdd, // the edit-lock descriptor, never read as coordinates
      ...word(0), // xll
      ...word(0), // yll
      ...word(10), // xur
      ...word(10), // yur
      ...word(0), // rx
      ...word(0), // ry
    ];
    const graphic = wpg([record(0x01, startWpgData({})), record(0x18, data)]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    const rect = decoded.vectors[0];
    if (rect?.kind !== "rect") throw new Error("expected a rect vector");
    expect(rect.frame).toEqual({ xPt: 0, yPt: 134, widthPt: 10, heightPt: 10 });
  });

  it("steps past a short-spelling Object ID (high bit clear) to reach the geometry", () => {
    const flags = 0x0020; // FLAG_OBJECT_ID only
    const data = [
      ...word(flags),
      ...word(0x1234), // Object ID, short spelling
      ...word(0), // xll
      ...word(0), // yll
      ...word(10), // xur
      ...word(10), // yur
      ...word(0), // rx
      ...word(0), // ry
    ];
    const graphic = wpg([record(0x01, startWpgData({})), record(0x18, data)]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    const rect = decoded.vectors[0];
    if (rect?.kind !== "rect") throw new Error("expected a rect vector");
    expect(rect.frame).toEqual({ xPt: 0, yPt: 134, widthPt: 10, heightPt: 10 });
  });

  it("reads the characterization flags from a record whose data is exactly the 2-byte flags word, with nothing to spare", () => {
    const flags = 0; // no special bits
    const data = [...word(flags)]; // exactly 2 bytes: cursor + 2 lands exactly on the record's own end
    const graphic = wpg([record(0x01, startWpgData({})), record(0x18, data)]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    // Characterization itself succeeds exactly at this boundary; the geometry read that follows it has nothing left to read and refuses on its own account.
    expect(decoded.vectors).toEqual([]);
    expect(decoded.skippedRecords).toEqual(["Rectangle"]);
  });

  it("refuses a record whose Object ID field itself has no room before the record ends", () => {
    const flags = 0x0020; // FLAG_OBJECT_ID
    const data = [...word(flags), 0xaa]; // only one byte where the 2-byte id needs to fit
    const graphic = wpg([record(0x01, startWpgData({})), record(0x18, data)]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    expect(decoded.vectors).toEqual([]);
    expect(decoded.skippedRecords).toEqual(["Rectangle"]);
  });

  it("refuses a record whose long-spelling Object ID (high bit set) pushes the geometry past the record's own end", () => {
    const flags = 0x0020; // FLAG_OBJECT_ID
    // The id field itself has exactly the 2 bytes readCharacterization checked for, but its high bit forces the long, 4-byte spelling, which runs 2 bytes past the record.
    const data = [...word(flags), ...word(0x8000)];
    const graphic = wpg([record(0x01, startWpgData({})), record(0x18, data)]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    expect(decoded.vectors).toEqual([]);
    expect(decoded.skippedRecords).toEqual(["Rectangle"]);
  });

  // Unlike Object ID's own overflow (guarded by its own room check before the +2/+4 step is ever taken), the edit-lock descriptor's blind +4 step has no such guard of its own -- readCharacterization's own final `geometryAt > recordEnd` check is the ONLY thing standing between a too-short record and treating the very next record's own bytes as this one's geometry.
  it("refuses a Rectangle whose edit-lock descriptor alone pushes geometryAt past the record, rather than reading the next record's own bytes as geometry", () => {
    const flags = 0x0080; // FLAG_EDIT_LOCK only
    const data = [...word(flags)]; // no room at all for the 4-byte edit-lock descriptor, let alone any geometry
    // Exactly the bytes geometryAt would land on and misread as xll/yll/xur/yur/rx/ry if the overrun were allowed through.
    const siblingBytes = [
      ...word(100),
      ...word(200),
      ...word(300),
      ...word(400),
      ...word(0),
      ...word(0),
    ];
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x18, data),
      record(0x99, siblingBytes),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    expect(decoded.vectors).toEqual([]);
    expect(decoded.skippedRecords).toEqual(["Rectangle", "record type 0x99"]);
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
      record(0x25, [1, 2]), // truncated Pen Fore Color -- too short to update
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
    // The Text Block's data is too short to carry a frame at all, so it is skipped -- and its Text Data extension member (declared via the extension count) is swallowed with it rather than walked as its own record.
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

describe("readPolyline boundaries and branching", () => {
  it("refuses a Polyline with no room for its own point count", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x15, [...word(0x8000)]), // flags only, no count field
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    expect(decoded.skippedRecords).toEqual(["Polyline"]);
  });

  it("refuses a zero-point Polyline", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x15, [...word(0x8000), ...word(0)]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    expect(decoded.skippedRecords).toEqual(["Polyline"]);
  });

  it("refuses a Polyline truncated partway through its own point list", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x15, [
        ...word(0x8000),
        ...word(3), // declares 3 points
        ...word(0),
        ...word(0), // only the first point's bytes are present
      ]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    expect(decoded.skippedRecords).toEqual(["Polyline"]);
  });

  it("keeps a single point as a one-segment path rather than the two-point line variant", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x15, [...word(0x8000), ...word(1), ...word(10), ...word(20)]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    const path = decoded.vectors[0];
    if (path?.kind !== "path") throw new Error("expected a path vector");
    expect(path.subpaths[0]?.segments).toEqual([]);
  });

  it("keeps a closed two-point Polyline as a path rather than the line variant", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x25, [0, 0, 0, 0]),
      record(0x2b, [...word(1), ...word(1)]),
      record(0x15, [
        ...word(0x8000 | 0x4000), // FRM|CLOSE
        ...word(2),
        ...word(0),
        ...word(0),
        ...word(10),
        ...word(10),
      ]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    const path = decoded.vectors[0];
    if (path?.kind !== "path") throw new Error("expected a path vector");
    expect(path.subpaths[0]?.closed).toBe(true);
  });

  it("keeps a two-point unclosed Polyline with no resolved stroke as a path rather than the line variant", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      // No FRM bit, so no stroke resolves even though there are exactly two points.
      record(0x15, [
        ...word(0),
        ...word(2),
        ...word(0),
        ...word(0),
        ...word(10),
        ...word(10),
      ]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    const path = decoded.vectors[0];
    if (path?.kind !== "path") throw new Error("expected a path vector");
    expect(path.subpaths[0]?.closed).toBe(false);
  });

  it("computes a multi-point path's bounding frame from each point's own extreme, not just the first or last", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x15, [
        ...word(0),
        ...word(4),
        ...word(10),
        ...word(50),
        ...word(90),
        ...word(80),
        ...word(50),
        ...word(10),
        ...word(30),
        ...word(90),
      ]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    const path = decoded.vectors[0];
    if (path?.kind !== "path") throw new Error("expected a path vector");
    expect(path.frame).toEqual({
      xPt: 10,
      yPt: 54,
      widthPt: 80,
      heightPt: 80,
    });
  });

  it("applies the nonzero winding-rule fill only when both FIL and the winding flag are set", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x31, [0, 255, 0, 0]), // Brush Fore Color: green, fully opaque
      record(0x15, [
        ...word(0x2000 | 0x1000), // FIL and the path-winding bit (bit 12)
        ...word(3),
        ...word(0),
        ...word(0),
        ...word(10),
        ...word(0),
        ...word(10),
        ...word(10),
      ]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    const path = decoded.vectors[0];
    if (path?.kind !== "path") throw new Error("expected a path vector");
    expect(path.fillRule).toBe("nonzero");
  });

  it("omits fillRule for a filled path when the winding bit is not set", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x31, [0, 255, 0, 0]),
      record(0x15, [
        ...word(0x2000), // FIL only
        ...word(3),
        ...word(0),
        ...word(0),
        ...word(10),
        ...word(0),
        ...word(10),
        ...word(10),
      ]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    const path = decoded.vectors[0];
    if (path?.kind !== "path") throw new Error("expected a path vector");
    expect(path.fillRule).toBeUndefined();
  });

  it("includes fillOpacity for a translucent fill and omits it for a fully opaque one", () => {
    const translucent = wpg([
      record(0x01, startWpgData({})),
      record(0x31, [0, 255, 0, 128]), // green, alpha (transparency) 128/255
      record(0x15, [
        ...word(0x2000),
        ...word(3),
        ...word(0),
        ...word(0),
        ...word(10),
        ...word(0),
        ...word(10),
        ...word(10),
      ]),
    ]);
    const opaque = wpg([
      record(0x01, startWpgData({})),
      record(0x31, [0, 255, 0, 0]), // green, fully opaque
      record(0x15, [
        ...word(0x2000),
        ...word(3),
        ...word(0),
        ...word(0),
        ...word(10),
        ...word(0),
        ...word(10),
        ...word(10),
      ]),
    ]);
    const decodedTranslucent = decodeWpgGraphic(translucent, NO_TEXT);
    const decodedOpaque = decodeWpgGraphic(opaque, NO_TEXT);
    if (
      decodedTranslucent?.status !== "decoded" ||
      decodedOpaque?.status !== "decoded"
    ) {
      throw new Error("expected decoded graphics");
    }
    const translucentPath = decodedTranslucent.vectors[0];
    const opaquePath = decodedOpaque.vectors[0];
    if (translucentPath?.kind !== "path" || opaquePath?.kind !== "path") {
      throw new Error("expected path vectors");
    }
    expect(translucentPath.fillOpacity).toBeCloseTo(1 - 128 / 255);
    expect(opaquePath.fillOpacity).toBeUndefined();
  });
});

describe("readWpgRectangle's rounded-corner path", () => {
  // rx and ry are checked independently ("if EITHER... is less than or equal to zero"), so each boundary needs its own isolated test with the other axis held well clear of zero -- otherwise a wrong comparison on one axis hides behind the other axis' own, correct, square-corner trigger.
  it("treats rx of exactly zero as a square corner even with a real, positive ry", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x18, [
        ...word(0x8000), // FRM only
        ...word(0),
        ...word(0),
        ...word(100),
        ...word(60),
        ...word(0), // rx: exactly zero
        ...word(6), // ry: a real, positive radius
      ]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    const rect = decoded.vectors[0];
    if (rect?.kind !== "rect") throw new Error("expected a rect vector");
  });

  it("treats ry of exactly zero as a square corner even with a real, positive rx", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x18, [
        ...word(0x8000), // FRM only
        ...word(0),
        ...word(0),
        ...word(100),
        ...word(60),
        ...word(10), // rx: a real, positive radius
        ...word(0), // ry: exactly zero
      ]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    const rect = decoded.vectors[0];
    if (rect?.kind !== "rect") throw new Error("expected a rect vector");
  });

  it("keeps each axis' own corner radius unclamped when neither exceeds half its side", () => {
    const kappa = (4 / 3) * (Math.SQRT2 - 1);
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x18, [
        ...word(0x8000), // FRM only
        ...word(0),
        ...word(0), // xll, yll (raw)
        ...word(100),
        ...word(60), // xur, yur (raw) -- so raw width 100, raw height 60
        ...word(10), // rx
        ...word(6), // ry
      ]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    const path = decoded.vectors[0];
    if (path?.kind !== "path") throw new Error("expected a path vector");
    const width = path.frame.widthPt;
    const height = path.frame.heightPt;
    const cornerRxPt = 10;
    const cornerRyPt = 6;
    const kx = cornerRxPt * kappa;
    const ky = cornerRyPt * kappa;
    const subpath = path.subpaths[0];
    if (subpath === undefined) throw new Error("expected a subpath");
    expect(subpath.start).toEqual({ xPt: 0, yPt: height / 2 });
    const [line1, cubic1, line2, cubic2, line3, cubic3, line4, cubic4, line5] =
      subpath.segments;
    if (
      line1?.kind !== "line" ||
      cubic1?.kind !== "cubic" ||
      line2?.kind !== "line" ||
      cubic2?.kind !== "cubic" ||
      line3?.kind !== "line" ||
      cubic3?.kind !== "cubic" ||
      line4?.kind !== "line" ||
      cubic4?.kind !== "cubic" ||
      line5?.kind !== "line"
    ) {
      throw new Error("expected the rounded-rectangle's nine segments");
    }
    expect(line1.to).toEqual({ xPt: cornerRxPt, yPt: 0 });
    expect(cubic1.control1.xPt).toBeCloseTo(cornerRxPt - kx);
    expect(cubic1.control1.yPt).toBe(0);
    expect(cubic1.control2.xPt).toBe(width);
    expect(cubic1.control2.yPt).toBeCloseTo(cornerRyPt - ky);
    expect(cubic1.to).toEqual({ xPt: width, yPt: cornerRyPt });
    expect(line2.to).toEqual({ xPt: width, yPt: height - cornerRyPt });
    expect(cubic2.control1.xPt).toBe(width);
    expect(cubic2.control1.yPt).toBeCloseTo(height - cornerRyPt + ky);
    expect(cubic2.control2.xPt).toBeCloseTo(width - cornerRxPt + kx);
    expect(cubic2.control2.yPt).toBe(height);
    expect(cubic2.to).toEqual({ xPt: width - cornerRxPt, yPt: height });
    expect(line3.to).toEqual({ xPt: cornerRxPt, yPt: height });
    expect(cubic3.control1.xPt).toBeCloseTo(cornerRxPt - kx);
    expect(cubic3.control1.yPt).toBe(height);
    expect(cubic3.control2.xPt).toBe(0);
    expect(cubic3.control2.yPt).toBeCloseTo(height - cornerRyPt + ky);
    expect(cubic3.to).toEqual({ xPt: 0, yPt: height - cornerRyPt });
    expect(line4.to).toEqual({ xPt: 0, yPt: cornerRyPt });
    expect(cubic4.control1.xPt).toBe(0);
    expect(cubic4.control1.yPt).toBeCloseTo(cornerRyPt - ky);
    expect(cubic4.control2.xPt).toBeCloseTo(cornerRxPt - kx);
    expect(cubic4.control2.yPt).toBe(0);
    expect(cubic4.to).toEqual({ xPt: cornerRxPt, yPt: 0 });
    expect(line5.to).toEqual({ xPt: 0, yPt: height / 2 });
    expect(subpath.closed).toBe(true);
    expect(Object.hasOwn(path, "stroke")).toBe(false);
  });

  it("clamps each axis' own corner radius to half its side when the declared radius is larger", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x18, [
        ...word(0x8000),
        ...word(0),
        ...word(0),
        ...word(100),
        ...word(60),
        ...word(1000), // rx, far larger than half the 100pt width
        ...word(1000), // ry, far larger than half the 60pt height
      ]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    const path = decoded.vectors[0];
    if (path?.kind !== "path") throw new Error("expected a path vector");
    const subpath = path.subpaths[0];
    const [firstLine, firstCubic] = subpath?.segments ?? [];
    if (firstLine?.kind !== "line") throw new Error("expected a line segment");
    if (firstCubic?.kind !== "cubic")
      throw new Error("expected a cubic segment");
    // Clamped to half the width (50) and half the height (30) -- not the declared 1000. cornerRyPt (the height's own clamp) surfaces only in the first cubic's own endpoint, never in the first line, which always ends at y=0 regardless of either axis' radius.
    expect(firstLine.to).toEqual({ xPt: 50, yPt: 0 });
    expect(firstCubic.to).toEqual({ xPt: 100, yPt: 30 });
    expect(Object.hasOwn(path, "stroke")).toBe(false);
  });

  it("carries a real stroke on a rounded rectangle, not just a square one", () => {
    // Every other rounded-rectangle fixture in this file has no active pen width, so its own stroke is always absent regardless -- proving the rounded path's own stroke spread actually fires needs one with a real, active pen width behind it.
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x25, [255, 0, 0, 0]), // Pen Fore Color: red, opaque
      record(0x2b, [...word(2), ...word(2)]), // Pen Size: 2 units
      record(0x18, [
        ...word(0x8000), // FRM only
        ...word(0),
        ...word(0),
        ...word(100),
        ...word(60),
        ...word(10), // rx
        ...word(6), // ry
      ]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    const path = decoded.vectors[0];
    if (path?.kind !== "path") throw new Error("expected a path vector");
    expect(path.stroke).toEqual({ color: { r: 1, g: 0, b: 0 }, widthPt: 2 });
  });

  it("refuses a Rectangle with no room for its own six coordinates", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x18, [
        ...word(0x8000),
        ...word(0),
        ...word(0),
        ...word(10),
        ...word(10),
        ...word(0),
        // ry's own two bytes are missing
      ]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    expect(decoded.skippedRecords).toEqual(["Rectangle"]);
  });

  it("includes fillOpacity for a translucent rectangle fill", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x31, [255, 0, 0, 64]), // red, alpha (transparency) 64/255
      record(0x18, [
        ...word(0x2000),
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
    expect(rect.fillOpacity).toBeCloseTo(1 - 64 / 255);
  });

  it("omits fillOpacity for a fully opaque rectangle fill", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x31, [255, 0, 0, 0]), // red, fully opaque
      record(0x18, [
        ...word(0x2000),
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
    expect(Object.hasOwn(rect, "fillOpacity")).toBe(false);
  });

  it("gives a rectangle no fill field at all when FIL is not set", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x18, [
        ...word(0x8000), // FRM only, no FIL, and no pen size record so no stroke either
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
    expect(Object.hasOwn(rect, "fill")).toBe(false);
    expect(Object.hasOwn(rect, "stroke")).toBe(false);
  });
});

describe("readWpgFullEllipse's boundaries and endpoint check", () => {
  it("refuses an Arc one byte short of its own eight coordinates plus flags byte", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x19, [
        ...word(0x2000),
        ...word(72),
        ...word(72),
        ...word(36),
        ...word(24),
        ...word(0),
        ...word(0),
        ...word(0),
        // ey's own two bytes and the trailing arc-flags byte are missing
      ]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    expect(decoded.skippedRecords).toEqual(["Arc"]);
  });

  it("refuses an Arc with all eight of its own coordinates present but not its trailing arc-flags byte", () => {
    // Exactly the 8 real coordinates, no more: the +1 the check requires for the (never-read) arc-flags byte is the one byte genuinely missing here.
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x19, [
        ...word(0x2000),
        ...word(72),
        ...word(72),
        ...word(36),
        ...word(24),
        ...word(0),
        ...word(0),
        ...word(0),
        ...word(0),
        // no trailing arc-flags byte
      ]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    expect(decoded.skippedRecords).toEqual(["Arc"]);
  });

  it("refuses an Arc whose initial and terminal X offsets differ alone", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x19, [
        ...word(0x2000),
        ...word(72),
        ...word(72),
        ...word(36),
        ...word(24),
        ...word(10),
        ...word(5), // ix, iy
        ...word(20),
        ...word(5), // ex, ey -- x differs, y matches
        0,
      ]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    expect(decoded.skippedRecords).toEqual(["Arc"]);
  });

  it("refuses an Arc whose initial and terminal Y offsets differ alone", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x19, [
        ...word(0x2000),
        ...word(72),
        ...word(72),
        ...word(36),
        ...word(24),
        ...word(10),
        ...word(5), // ix, iy
        ...word(10),
        ...word(9), // ex, ey -- y differs, x matches
        0,
      ]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    expect(decoded.skippedRecords).toEqual(["Arc"]);
  });

  it("gives an unfilled ellipse no fill field at all", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x19, [
        ...word(0), // no FIL, no FRM
        ...word(72),
        ...word(72),
        ...word(36),
        ...word(24),
        ...word(0),
        ...word(0),
        ...word(0),
        ...word(0),
        0,
      ]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    const ellipse = decoded.vectors[0];
    if (ellipse?.kind !== "ellipse") throw new Error("expected an ellipse");
    expect(Object.hasOwn(ellipse, "fill")).toBe(false);
    expect(Object.hasOwn(ellipse, "stroke")).toBe(false);
  });

  it("omits fillOpacity for a fully opaque, filled ellipse", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x31, [255, 0, 0, 0]), // red, fully opaque
      record(0x19, [
        ...word(0x2000), // FIL only
        ...word(72),
        ...word(72),
        ...word(36),
        ...word(24),
        ...word(0),
        ...word(0),
        ...word(0),
        ...word(0),
        0,
      ]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    const ellipse = decoded.vectors[0];
    if (ellipse?.kind !== "ellipse") throw new Error("expected an ellipse");
    expect(ellipse.fill).toEqual({ r: 1, g: 0, b: 0 });
    expect(Object.hasOwn(ellipse, "fillOpacity")).toBe(false);
  });

  it("includes fillOpacity for a translucent ellipse fill and a stroke for a framed one", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x25, [0, 0, 255, 0]), // blue pen, fully opaque
      record(0x2b, [...word(1), ...word(1)]),
      record(0x31, [255, 0, 0, 128]), // red brush, alpha (transparency) 128/255
      record(0x19, [
        ...word(0x2000 | 0x8000), // FIL and FRM
        ...word(72),
        ...word(72),
        ...word(36),
        ...word(24),
        ...word(0),
        ...word(0),
        ...word(0),
        ...word(0),
        0,
      ]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    const ellipse = decoded.vectors[0];
    if (ellipse?.kind !== "ellipse") throw new Error("expected an ellipse");
    expect(ellipse.fillOpacity).toBeCloseTo(1 - 128 / 255);
    expect(ellipse.stroke?.color).toEqual({ r: 0, g: 0, b: 1 });
  });
});

describe("readSingleColor and readDoubleColor arithmetic", () => {
  it("divides every single-precision colour channel by 255, not multiplies", () => {
    // Every channel a distinct, non-zero, non-255 value so a /255 vs *255 flip anywhere shows up.
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x25, [51, 102, 153, 204]), // Pen Fore Color: r=51,g=102,b=153,a=204
      record(0x2b, [...word(1), ...word(1)]),
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
    expect(rect.stroke?.color.r).toBeCloseTo(51 / 255);
    expect(rect.stroke?.color.g).toBeCloseTo(102 / 255);
    expect(rect.stroke?.color.b).toBeCloseTo(153 / 255);
    expect(rect.stroke?.opacity).toBeCloseTo(1 - 204 / 255);
  });

  it("divides every double-precision colour channel by 65535, not multiplies", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x26, [
        ...word(4096),
        ...word(8192),
        ...word(16384),
        ...word(32768),
      ]), // DP Pen Fore Color
      record(0x2b, [...word(1), ...word(1)]),
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
    expect(rect.stroke?.color.r).toBeCloseTo(4096 / 65535);
    expect(rect.stroke?.color.g).toBeCloseTo(8192 / 65535);
    expect(rect.stroke?.color.b).toBeCloseTo(16384 / 65535);
    expect(rect.stroke?.opacity).toBeCloseTo(1 - 32768 / 65535);
  });

  it("leaves the pen colour unchanged when a DP Pen Fore Color record is one byte short of its own 8 bytes", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x25, [10, 20, 30, 0]), // Pen Fore Color: a real colour first
      record(0x2b, [...word(1), ...word(1)]),
      record(0x26, [...word(1), ...word(1), ...word(1), 0]), // DP Pen Fore Color, 7 bytes: one short
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
    expect(rect.stroke?.color).toEqual({
      r: 10 / 255,
      g: 20 / 255,
      b: 30 / 255,
    });
  });
});

describe("the WPG signature scan", () => {
  it("advances past leading garbage bytes one at a time to find the real signature", () => {
    // The record-start bounds check (recordStart < start + WPG_PREFIX_HEAD_SIZE) is measured from wherever the signature is actually found, so a signature embedded 3 bytes in needs its own {start of document} field large enough to clear that offset too -- 3 padding bytes between the prefix and the real records supply exactly that room.
    const garbageLength = 3;
    const recordsStart = garbageLength + 26 + garbageLength;
    const records = [record(0x01, startWpgData({})), record(0x02, [])].flat();
    const head = [
      0xff,
      0x57,
      0x50,
      0x43,
      ...dword(recordsStart - garbageLength), // {start of document}, relative to the signature itself
      1,
      0x16,
      2, // major version 2
      0,
      ...word(0),
      ...word(26),
      0,
      0,
      ...word(0),
      ...dword(recordsStart + records.length),
      ...word(0),
    ];
    const withGarbage = new Uint8Array([
      ...new Array<number>(garbageLength).fill(9),
      ...head,
      ...new Array<number>(garbageLength).fill(0), // padding so recordStart clears start + WPG_PREFIX_HEAD_SIZE
      ...records,
    ]);
    const decoded = decodeWpgGraphic(withGarbage, NO_TEXT);
    expect(decoded?.status).toBe("decoded");
  });

  it.each([
    [0, 0x00], // byte 0 of the file ID wrong
    [1, 0x00], // byte 1
    [2, 0x00], // byte 2
    [3, 0x00], // byte 3
  ])(
    "does not match a signature with file-ID byte %i corrupted",
    (offset, value) => {
      const graphic = wpg([record(0x01, startWpgData({})), record(0x02, [])]);
      graphic[offset] = value;
      expect(decodeWpgGraphic(graphic, NO_TEXT)).toBeUndefined();
    },
  );

  it("does not match a signature with the right file ID but the wrong product type", () => {
    const graphic = wpg([record(0x01, startWpgData({})), record(0x02, [])]);
    graphic[8] = 2; // product type: not 1
    expect(decodeWpgGraphic(graphic, NO_TEXT)).toBeUndefined();
  });

  it("does not match a signature with the right file ID but the wrong file type", () => {
    const graphic = wpg([record(0x01, startWpgData({})), record(0x02, [])]);
    graphic[9] = 0x0a; // file type: not 0x16
    expect(decodeWpgGraphic(graphic, NO_TEXT)).toBeUndefined();
  });
});

describe("major version and record-start validation", () => {
  it("refuses a major version that is neither 1 nor 2", () => {
    const graphic = wpg([record(0x01, startWpgData({}))], 3);
    expect(decodeWpgGraphic(graphic, NO_TEXT)).toEqual({
      status: "refused",
      reason: "malformed",
    });
  });

  it("refuses a record start pointing back inside the prefix itself", () => {
    const graphic = wpg([record(0x01, startWpgData({}))]);
    // {start of document} sits at prefix offset 4; point it at byte 4, well inside the 26-byte prefix.
    graphic[4] = 4;
    graphic[5] = 0;
    graphic[6] = 0;
    graphic[7] = 0;
    expect(decodeWpgGraphic(graphic, NO_TEXT)).toEqual({
      status: "refused",
      reason: "malformed",
    });
  });

  it("refuses a record start at or past the buffer's own end", () => {
    const graphic = wpg([record(0x01, startWpgData({}))]);
    const bytesLength = graphic.length;
    graphic[4] = bytesLength & 0xff;
    graphic[5] = (bytesLength >>> 8) & 0xff;
    graphic[6] = (bytesLength >>> 16) & 0xff;
    graphic[7] = (bytesLength >>> 24) & 0xff;
    expect(decodeWpgGraphic(graphic, NO_TEXT)).toEqual({
      status: "refused",
      reason: "malformed",
    });
  });
});

describe("the record-walk loop's own boundaries", () => {
  it("discards a single stray trailing byte, one short of a full record header, rather than reading past the buffer", () => {
    const base = wpg([record(0x01, startWpgData({}))]);
    const withStray = new Uint8Array([...base, 0xaa]);
    const decoded = decodeWpgGraphic(withStray, NO_TEXT);
    expect(decoded?.status).toBe("decoded");
  });

  it("stops the walk, keeping the geometry already decoded, when a record declares a Length running past the buffer", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
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
    // The Rectangle record's own Length byte sits right after Class/Type/Extension (indices 0,1,2 of that record); patch it to claim far more data than the buffer actually holds. The record starts right after the Start WPG record: 26 (prefix) + 4 (Start WPG header) + 21 (Start WPG data) = 51.
    const rectangleRecordStart = 26 + 4 + 21;
    graphic[rectangleRecordStart + 3] = 200; // Length byte: claims 200 bytes of data
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    // The lying Rectangle itself never decodes -- the walk stopped before reaching it.
    expect(decoded.vectors).toEqual([]);
    expect(decoded.skippedRecords).toEqual([]);
    expect(decoded.sizePt).toEqual({ widthPt: 288, heightPt: 144 });
  });

  it("skips (rather than misreading) an undersized Start WPG record, without producing a spurious refusal from its truncated fields", () => {
    // ppi and precision look valid, but the record is 10 bytes -- under the 13 the fixed fields need -- so decoding it further would misread the (absent) extent, not just the (present) ppi/precision.
    const undersized = [...word(72), ...word(72), 0, 0, 0, 0];
    const graphic = wpg([
      record(0x01, undersized),
      record(0x01, startWpgData({})),
      record(0x02, []),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    expect(decoded.skippedRecords).toEqual(["Start WPG"]);
    expect(decoded.sizePt).toEqual({ widthPt: 288, heightPt: 144 });
  });

  // Exactly 13 bytes: room for ppi/ppi/precision/viewport (the fixed fields this check exists to protect), but genuinely nothing left for the extent that follows -- proving the skip-vs-refuse boundary sits at < 13, not <= 13. A record this size is NOT skipped (data.length < 13 is false): it proceeds to read ppi/precision, then refuses the WHOLE graphic outright once the separate, later extent-room check finds nothing left -- a categorically different outcome (refused vs skipped-and-continue) than an off-by-one here would produce.
  it("proceeds past a Start WPG record of exactly 13 bytes rather than skipping it, then refuses for its missing extent", () => {
    // A genuinely valid Start WPG follows the 13-byte one: the correct code returns refused immediately from inside the first record's own extent check (a whole-function return, not merely a skip), so the second, valid one is never reached at all -- proving that directly needs a record after the boundary one that would, wrongly, produce a real decoded result if the first were skipped instead of refused.
    const exactlyThirteen = [
      ...word(72),
      ...word(72),
      0,
      ...new Array<number>(8).fill(0),
    ];
    const graphic = wpg([
      record(0x01, exactlyThirteen),
      record(0x01, startWpgData({})),
      record(0x02, []),
    ]);
    expect(decodeWpgGraphic(graphic, NO_TEXT)).toEqual({
      status: "refused",
      reason: "malformed",
    });
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

describe("readCharacterization's callers converge on refusal past their own boundary", () => {
  // readCharacterization's only two callers (readTextBlockFrame, readPrimitiveVector) always need a positive number of further bytes after a successful characterization, so whenever geometryAt runs past recordEnd, the caller's own downstream boundary check refuses identically -- there is no primitive this decoder reads that needs zero further bytes.
  it("still refuses a Rectangle whose Object ID pushes geometryAt past the record, via the primitive's own downstream check", () => {
    const flags = 0x0020; // FLAG_OBJECT_ID
    const data = [...word(flags), ...word(0x8000)];
    const graphic = wpg([record(0x01, startWpgData({})), record(0x18, data)]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    expect(decoded.skippedRecords).toEqual(["Rectangle"]);
  });

  it("resolves the long-spelling Object ID's own +4 step, not the short spelling's +2, even though both fit the record's own initial bounds", () => {
    // With the long (+4) step, the coordinates correctly start 2 bytes later than the short (+2) step would put them -- reading the wrong offset would misread the id's own trailing bytes as the first coordinate instead.
    const flags = 0x8020; // FLAG_OBJECT_ID | FLAG_FRAME
    const data = [
      ...word(flags),
      ...word(0x8000), // Object ID, long spelling (high bit set)
      ...word(0x1234), // the long spelling's own extra 2 bytes -- must be skipped, not read as a coordinate
      ...word(0), // xll
      ...word(0), // yll
      ...word(10), // xur
      ...word(10), // yur
      ...word(0), // rx
      ...word(0), // ry
    ];
    const graphic = wpg([record(0x01, startWpgData({})), record(0x18, data)]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    const rect = decoded.vectors[0];
    if (rect?.kind !== "rect") throw new Error("expected a rect vector");
    expect(rect.frame).toEqual({ xPt: 0, yPt: 134, widthPt: 10, heightPt: 10 });
  });
});

describe("readTextBlockFrame's own boundary", () => {
  it("refuses a Text Block one byte short of its own four coordinates", () => {
    const data = [
      ...word(0), // flags
      ...word(0),
      ...word(0),
      ...word(30),
      // yur's own second byte is missing
    ];
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x1d, data, 1),
      record(0x0f, [0x41, 0xcc]),
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

describe("readPolyline's own point-local-to-frame arithmetic and stroke", () => {
  it("shifts every path point by subtracting the frame's own origin, not adding it", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x15, [
        ...word(0),
        ...word(4),
        ...word(10),
        ...word(50),
        ...word(90),
        ...word(80),
        ...word(50),
        ...word(10),
        ...word(30),
        ...word(90),
      ]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    const path = decoded.vectors[0];
    if (path?.kind !== "path") throw new Error("expected a path vector");
    // Frame is {xPt:10, yPt:54}; the raw points convert to (10,94),(90,64),(50,134),(30,54).
    expect(path.subpaths[0]?.start).toEqual({ xPt: 0, yPt: 40 });
    expect(path.subpaths[0]?.segments).toEqual([
      { kind: "line", to: { xPt: 80, yPt: 10 } },
      { kind: "line", to: { xPt: 40, yPt: 80 } },
      { kind: "line", to: { xPt: 20, yPt: 0 } },
    ]);
    // FIL is not set: the path must carry no fill at all.
    expect(Object.hasOwn(path, "fill")).toBe(false);
  });

  it("carries a stroke onto a multi-point (non-two-point-line) path when a stroke resolves", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x25, [255, 0, 0, 0]), // red pen
      record(0x2b, [...word(3), ...word(3)]), // width 3
      record(0x15, [
        ...word(0x8000), // FRM
        ...word(3),
        ...word(0),
        ...word(0),
        ...word(10),
        ...word(0),
        ...word(10),
        ...word(10),
      ]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    const path = decoded.vectors[0];
    if (path?.kind !== "path") throw new Error("expected a path vector");
    expect(path.stroke).toEqual({ color: { r: 1, g: 0, b: 0 }, widthPt: 3 });
  });

  it("gives a Polyline no stroke when FRM is not set, even with a real pen width already active", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x25, [255, 0, 0, 0]),
      record(0x2b, [...word(3), ...word(3)]),
      // No FRM bit: a stroke must not resolve regardless of the active pen width.
      record(0x15, [
        ...word(0),
        ...word(3),
        ...word(0),
        ...word(0),
        ...word(10),
        ...word(0),
        ...word(10),
        ...word(10),
      ]),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    const path = decoded.vectors[0];
    if (path?.kind !== "path") throw new Error("expected a path vector");
    // Not just an undefined value: the key itself must be absent, since toEqual/toBeUndefined can't tell "no stroke key at all" from "a stroke key holding undefined" -- and only the former is what an absent stroke should actually produce.
    expect(path).not.toHaveProperty("stroke");
  });

  it("refuses a Polyline whose weakened per-point bounds check would otherwise read a coordinate past the buffer", () => {
    // count = 2; the first point's own 4 bytes are present in full, but the second point has only its own X, not its Y.
    const data = [
      ...word(0x8000), // flags
      ...word(2), // count
      ...word(5),
      ...word(5), // point 1: full
      ...word(7), // point 2: X only, no Y
    ];
    const graphic = wpg([record(0x01, startWpgData({})), record(0x15, data)]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    expect(decoded.skippedRecords).toEqual(["Polyline"]);
  });
});

describe("a swallowed group's second-of-two members stays swallowed", () => {
  it("swallows both members of a two-member Compound Polygon, not just the first", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      record(0x1a, [...word(0x2000)], 2), // Compound Polygon, swallowed, declares 2 members
      record(0x15, [
        ...word(0x8000),
        ...word(2),
        ...word(0),
        ...word(0),
        ...word(10),
        ...word(10),
      ]),
      record(0x15, [
        ...word(0x8000),
        ...word(2),
        ...word(20),
        ...word(20),
        ...word(30),
        ...word(30),
      ]),
      record(0x02, []),
    ]);
    const decoded = decodeWpgGraphic(graphic, NO_TEXT);
    if (decoded?.status !== "decoded") {
      throw new Error("expected a decoded graphic");
    }
    expect(decoded.vectors).toEqual([]);
    expect(decoded.skippedRecords).toEqual(["Compound Polygon"]);
  });
});

describe("a Text Block whose own frame failed to resolve swallows its declared members too", () => {
  it("swallows a Polyline declared as a failed Text Block's own member, not walking it as real content", () => {
    const graphic = wpg([
      record(0x01, startWpgData({})),
      // A Text Block with no data at all: readTextBlockFrame fails (readCharacterization can't even read its own flags word), leaving pendingTextBlockFrame undefined -- but it still declares one member.
      record(0x1d, [], 1),
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
    expect(decoded.vectors).toEqual([]);
    expect(decoded.skippedRecords).toEqual(["Text Block"]);
  });
});
