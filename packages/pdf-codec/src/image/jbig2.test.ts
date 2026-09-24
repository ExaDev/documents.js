import { describe, expect, it } from "vitest";
import {
  JBIG2_FIXTURES,
  jbig2FixtureBytes,
  type Jbig2Fixture,
} from "../test-support/jbig2";
import { Jbig2ParseError, Jbig2UnsupportedError } from "./jbig2-errors";
import { decodeJbig2Embedded } from "./jbig2";

function fixtureByName(name: string): Jbig2Fixture {
  const fixture = JBIG2_FIXTURES.find((candidate) => candidate.name === name);
  if (fixture === undefined) {
    throw new Error(`no JBIG2 fixture named ${name}`);
  }
  return fixture;
}

// Renders a decoded, packed 1-bit-per-pixel bitmap as one string per row so a failure shows the actual picture rather than a byte index. A 1 bit is black, JBIG2's own polarity, which is what decodeJbig2Embedded produces.
function renderRows(
  bytes: Uint8Array<ArrayBuffer>,
  width: number,
  height: number,
): string[] {
  const bytesPerRow = Math.ceil(width / 8);
  const rows: string[] = [];
  for (let y = 0; y < height; y++) {
    let row = "";
    for (let x = 0; x < width; x++) {
      row +=
        (((bytes[y * bytesPerRow + (x >> 3)] ?? 0) >> (7 - (x & 7))) & 1) === 1
          ? "#"
          : ".";
    }
    rows.push(row);
  }
  return rows;
}

// --- Hand-built segment streams, for the framing and flag paths the encoder-produced fixtures never emit. Each builder writes exactly the field order T.88 7.2 and 7.4 specify, so a test can pin one field to a chosen value and assert the decoder consumes it from where the specification puts it.

function u16Bytes(value: number): number[] {
  return [(value >> 8) & 0xff, value & 0xff];
}

function u32Bytes(value: number): number[] {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ];
}

function jbig2Stream(
  ...parts: readonly (number | readonly number[] | Uint8Array<ArrayBuffer>)[]
): Uint8Array<ArrayBuffer> {
  const out: number[] = [];
  for (const part of parts) {
    if (typeof part === "number") {
      out.push(part);
    } else {
      out.push(...part);
    }
  }
  return Uint8Array.from(out);
}

interface CraftedSegment {
  readonly number: number;
  readonly type: number;
  readonly data: readonly number[];
  // Referred-to segment numbers, each written at the width T.88 7.2.5 derives from this segment's own number.
  readonly referredTo?: readonly number[];
  // Writes the 29-bit referred-to count form of 7.2.4 instead: a count byte of 0xE0, the low three count bytes, and the single retain-flags byte a zero count needs.
  readonly longReferredCount?: boolean;
  readonly pageAssociation?: number;
  readonly longPageAssociation?: boolean;
  // Overrides the declared data length, which normally defaults to the data's own length.
  readonly dataLength?: number;
}

function segment(spec: CraftedSegment): number[] {
  const referredTo = spec.referredTo ?? [];
  const referredSize = spec.number <= 256 ? 1 : spec.number <= 65536 ? 2 : 4;
  const count =
    spec.longReferredCount === true
      ? [0xe0, 0x00, 0x00, 0x00, 0x00]
      : [referredTo.length << 5];
  const flags =
    (spec.type & 0x3f) | (spec.longPageAssociation === true ? 0x40 : 0x00);
  return [
    ...u32Bytes(spec.number),
    flags,
    ...count,
    ...referredTo.flatMap((n) =>
      referredSize === 1 ? [n] : referredSize === 2 ? u16Bytes(n) : u32Bytes(n),
    ),
    ...(spec.longPageAssociation === true
      ? u32Bytes(spec.pageAssociation ?? 1)
      : [spec.pageAssociation ?? 1]),
    ...u32Bytes(spec.dataLength ?? spec.data.length),
    ...spec.data,
  ];
}

// T.88 7.4.8: width, height, X and Y resolution (display metadata the decoder discards), flags, then the two striping bytes.
function pageInformation(width: number, height: number, flags = 0): number[] {
  return [
    ...u32Bytes(width),
    ...u32Bytes(height),
    ...u32Bytes(0),
    ...u32Bytes(0),
    flags,
    0x00,
    0x00,
  ];
}

// T.88 7.4.1: the region segment information field every region segment starts with.
function regionInfo(
  width: number,
  height: number,
  x = 0,
  y = 0,
  externalOperator = 0,
): number[] {
  return [
    ...u32Bytes(width),
    ...u32Bytes(height),
    ...u32Bytes(x),
    ...u32Bytes(y),
    externalOperator & 0x07,
  ];
}

function withPatchedByte(
  stream: Uint8Array<ArrayBuffer>,
  offset: number,
  value: number,
): Uint8Array<ArrayBuffer> {
  const patched = new Uint8Array(stream);
  patched[offset] = value;
  return patched;
}

describe("decodeJbig2Embedded: real encoder-produced streams", () => {
  for (const fixture of JBIG2_FIXTURES) {
    it(`recovers the "${fixture.name}" bitmap from its ${fixture.description}`, () => {
      const warnings: string[] = [];
      const result = decodeJbig2Embedded(jbig2FixtureBytes(fixture.stream), {
        globals:
          fixture.globals === undefined
            ? undefined
            : jbig2FixtureBytes(fixture.globals),
        onWarning: (message) => warnings.push(message),
      });
      expect(warnings).toEqual([]);
      expect({ width: result.width, height: result.height }).toEqual({
        width: fixture.width,
        height: fixture.height,
      });
      expect(result.bytes.length).toBe(
        Math.ceil(fixture.width / 8) * fixture.height,
      );
      expect(renderRows(result.bytes, fixture.width, fixture.height)).toEqual(
        fixture.expected,
      );
    });
  }

  it("covers every generic region coding mode across the fixture set", () => {
    // A guard against a regeneration quietly dropping a whole coding mode: each of these names a group the suite above would otherwise stop exercising without any test failing.
    const modes = [
      "-generic",
      "-generic-tpgdon",
      "-template1",
      "-template2",
      "-template3",
      "-template0-at",
      "-mmr",
      "-symbols",
      "refinement-region",
      "composed-regions",
      "hand-refine",
    ];
    for (const mode of modes) {
      expect(
        JBIG2_FIXTURES.filter((fixture) => fixture.name.endsWith(mode)).length,
      ).toBeGreaterThan(0);
    }
  });

  it("decodes the symbol-mode fixtures only when their globals stream is supplied", () => {
    // The symbol dictionary lives in the /JBIG2Globals stream, so the page stream alone cannot resolve the text region's symbol references at all.
    const fixture = JBIG2_FIXTURES.find(
      (candidate) => candidate.globals !== undefined,
    );
    expect(fixture).toBeDefined();
    expect(() =>
      decodeJbig2Embedded(jbig2FixtureBytes(fixture!.stream)),
    ).toThrow(Jbig2ParseError);
    expect(() =>
      decodeJbig2Embedded(jbig2FixtureBytes(fixture!.stream)),
    ).toThrow(/refers to no symbol dictionary/);
  });
});

describe("decodeJbig2Embedded: sizing", () => {
  const fixture = JBIG2_FIXTURES.find(
    (candidate) => candidate.name === "box-generic",
  )!;

  it("crops and pads to the caller's own requested size rather than the page information segment's", () => {
    const cropped = decodeJbig2Embedded(jbig2FixtureBytes(fixture.stream), {
      width: 8,
      height: 4,
    });
    expect({ width: cropped.width, height: cropped.height }).toEqual({
      width: 8,
      height: 4,
    });
    expect(renderRows(cropped.bytes, 8, 4)).toEqual(
      fixture.expected.slice(0, 4).map((row) => row.slice(0, 8)),
    );

    const padded = decodeJbig2Embedded(jbig2FixtureBytes(fixture.stream), {
      width: fixture.width,
      height: fixture.height + 2,
    });
    expect(padded.height).toBe(fixture.height + 2);
    // Rows past the decoded page read as white, matching the "outside the bitmap is 0" rule every JBIG2 procedure uses.
    expect(
      renderRows(padded.bytes, fixture.width, fixture.height + 2).slice(
        fixture.height,
      ),
    ).toEqual([".".repeat(fixture.width), ".".repeat(fixture.width)]);
  });
});

describe("decodeJbig2Embedded: refinement typical prediction", () => {
  const fixture = JBIG2_FIXTURES.find(
    (candidate) => candidate.name === "refinement-region",
  )!;

  it("refuses a refinement region that sets TPGRON rather than guessing its pseudo-context", () => {
    // Bit 1 of the refinement region segment's own flags byte, which sits past the 11-byte segment header and the 17-byte region segment information field of the third segment.
    const stream = jbig2FixtureBytes(fixture.stream);
    const flagsOffset = findRefinementFlagsOffset(stream);
    const patched = new Uint8Array(stream);
    patched[flagsOffset] = (patched[flagsOffset] ?? 0) | 0x02;
    expect(() => decodeJbig2Embedded(patched)).toThrow(/TPGRON/);
    // Without the flag the same stream decodes fine, so the refusal is about TPGRON and nothing else.
    expect(() => decodeJbig2Embedded(stream)).not.toThrow();
  });
});

// Walks the segment headers to the immediate refinement region (type 42) and returns the offset of its own generic-refinement-region flags byte.
function findRefinementFlagsOffset(stream: Uint8Array<ArrayBuffer>): number {
  let position = 0;
  while (position < stream.length) {
    const view = new DataView(
      stream.buffer,
      stream.byteOffset,
      stream.byteLength,
    );
    const flags = stream[position + 4] ?? 0;
    let cursor = position + 5;
    const referredCount = (stream[cursor] ?? 0) >> 5;
    cursor += 1 + referredCount;
    cursor += (flags & 0x40) !== 0 ? 4 : 1;
    const length = view.getUint32(cursor);
    cursor += 4;
    if ((flags & 0x3f) === 42) {
      return cursor + 17;
    }
    position = cursor + length;
  }
  throw new Error("no refinement region segment in the fixture");
}

describe("decodeJbig2Embedded: failure policy", () => {
  const fixture = JBIG2_FIXTURES.find(
    (candidate) => candidate.name === "box-generic",
  )!;

  function patchSegmentType(
    stream: Uint8Array<ArrayBuffer>,
    type: number,
  ): Uint8Array<ArrayBuffer> {
    // The page information segment is 11 header bytes plus 19 of data, so the second segment's own flags byte — which carries its type in the low six bits — sits at offset 34.
    const patched = new Uint8Array(stream);
    patched[34] = type;
    return patched;
  }

  it("names the unimplemented feature rather than producing a plausible wrong bitmap", () => {
    const stream = jbig2FixtureBytes(fixture.stream);
    expect(() => decodeJbig2Embedded(patchSegmentType(stream, 22))).toThrow(
      /halftone region or pattern dictionary/,
    );
    expect(() => decodeJbig2Embedded(patchSegmentType(stream, 36))).toThrow(
      /intermediate region/,
    );
    expect(() => decodeJbig2Embedded(patchSegmentType(stream, 53))).toThrow(
      /custom Huffman table/,
    );
    expect(() => decodeJbig2Embedded(patchSegmentType(stream, 30))).toThrow(
      /segment 1 has unrecognised type 30/,
    );
  });

  it("rejects a stream whose segment declares more data than it carries", () => {
    const stream = jbig2FixtureBytes(fixture.stream);
    const truncated = stream.subarray(0, stream.length - 4);
    expect(() => decodeJbig2Embedded(truncated)).toThrow(Jbig2ParseError);
    // The message names the declaring segment, the length it declared, and the length that was actually there, so a mis-sized read of any of the three is visible.
    expect(() => decodeJbig2Embedded(truncated)).toThrow(
      /segment 1 declares 49 bytes of data but only 45 remain/,
    );
  });

  it("rejects a region composed before any page information segment declared the page", () => {
    // Everything from the second segment onward, with the page information segment dropped.
    const stream = jbig2FixtureBytes(fixture.stream);
    expect(() => decodeJbig2Embedded(stream.subarray(30))).toThrow(
      Jbig2ParseError,
    );
    expect(() => decodeJbig2Embedded(stream.subarray(30))).toThrow(
      /composed a region before any page information/,
    );
  });
});

describe("decodeJbig2Embedded: segment framing", () => {
  // Every test in this block reuses the box-generic fixture's two segments, rebuilding only the second segment's header so the framing field under test is the sole difference from a stream that decodes.
  const fixture = fixtureByName("box-generic");
  const boxPage = () => jbig2FixtureBytes(fixture.stream).subarray(0, 30);
  const boxRegionData = () =>
    Array.from(jbig2FixtureBytes(fixture.stream).subarray(41));
  const expectBoxBitmap = (stream: Uint8Array<ArrayBuffer>): void => {
    const result = decodeJbig2Embedded(stream);
    expect(renderRows(result.bytes, result.width, result.height)).toEqual(
      fixture.expected,
    );
  };

  it("reads the long referred-to-segment count form", () => {
    // T.88 7.2.4: a count byte of 0xE0 starts a 29-bit count, followed by a retain-flag bit array of ceil((count + 1) / 8) bytes even when the count itself is zero.
    expectBoxBitmap(
      jbig2Stream(
        boxPage(),
        segment({
          number: 1,
          type: 38,
          data: boxRegionData(),
          longReferredCount: true,
        }),
      ),
    );
  });

  it("sizes each referred-to segment number by the referring segment's own number", () => {
    // T.88 7.2.5: one byte for segment numbers up to 256, two up to 65536, four beyond — with the boundaries themselves inside the ranges, not just past them.
    for (const number of [256, 300, 65536, 70000]) {
      expectBoxBitmap(
        jbig2Stream(
          boxPage(),
          segment({
            number,
            type: 38,
            data: boxRegionData(),
            referredTo: [0],
          }),
        ),
      );
    }
  });

  it("reads a four-byte page association when the header's long flag is set", () => {
    // T.88 7.2.6: bit 6 of the segment flags chooses between one-byte and four-byte page association.
    expectBoxBitmap(
      jbig2Stream(
        boxPage(),
        segment({
          number: 1,
          type: 38,
          data: boxRegionData(),
          longPageAssociation: true,
        }),
      ),
    );
  });

  it("refuses a segment that declares an unknown data length rather than scanning for a terminator", () => {
    expect(() =>
      decodeJbig2Embedded(
        jbig2Stream(
          boxPage(),
          segment({
            number: 1,
            type: 38,
            data: [0x00],
            dataLength: 0xffffffff,
          }),
        ),
      ),
    ).toThrow(Jbig2UnsupportedError);
    expect(() =>
      decodeJbig2Embedded(
        jbig2Stream(
          boxPage(),
          segment({
            number: 1,
            type: 38,
            data: [0x00],
            dataLength: 0xffffffff,
          }),
        ),
      ),
    ).toThrow(/unknown data length/);
  });

  it("reports a header that runs past the end of the stream", () => {
    const stream = jbig2FixtureBytes(fixture.stream);
    // Two trailing bytes are a segment number that never finishes, so the cursor runs off the end mid-header.
    expect(() => decodeJbig2Embedded(jbig2Stream(stream, 0x00, 0x00))).toThrow(
      /ended in the middle of a segment header/,
    );
  });

  it("skips an extension segment as framing the decoder has no use for", () => {
    // T.88 7.3: extension segments carry vendor data; the decoder must step over them without acting.
    expectBoxBitmap(
      jbig2Stream(
        jbig2FixtureBytes(fixture.stream),
        segment({ number: 2, type: 62, data: [0x01] }),
      ),
    );
  });
});

describe("decodeJbig2Embedded: page information", () => {
  it("refuses an unknown page height when the caller supplies no height of its own", () => {
    // T.88 7.4.8.5: 0xFFFFFFFF means the height is resolved by end-of-stripe segments or by the caller, never by the page segments alone.
    const stream = jbig2Stream(
      segment({ number: 0, type: 48, data: pageInformation(16, 0xffffffff) }),
    );
    expect(() => decodeJbig2Embedded(stream)).toThrow(Jbig2UnsupportedError);
    expect(() => decodeJbig2Embedded(stream)).toThrow(
      /declares an unknown height and the caller supplied none/,
    );
  });

  it("resolves an unknown page height from the caller's own height", () => {
    const stream = jbig2Stream(
      segment({ number: 0, type: 48, data: pageInformation(16, 0xffffffff) }),
    );
    const result = decodeJbig2Embedded(stream, { height: 5 });
    expect({ width: result.width, height: result.height }).toEqual({
      width: 16,
      height: 5,
    });
    // A page no region was ever composed onto reads as its default pixel value, which is white here.
    expect(renderRows(result.bytes, 16, 5)).toEqual([
      "................",
      "................",
      "................",
      "................",
      "................",
    ]);
  });

  it("refuses a page information segment whose striping bytes are missing", () => {
    // Nineteen bytes of data is the field's whole length; declaring seventeen leaves the final two-byte striping field unreadable, which is a broken stream rather than one to guess at.
    expect(() =>
      decodeJbig2Embedded(
        jbig2Stream(
          segment({
            number: 0,
            type: 48,
            data: pageInformation(16, 8).slice(0, 17),
            dataLength: 17,
          }),
        ),
      ),
    ).toThrow(/ended in the middle of a segment header/);
  });

  it("composes with the page's default operator unless the header lets each region override it", () => {
    // The composed-regions fixture draws two overlapping regions whose own external operators are OR and XOR under an override flag that bypasses them. Clearing that flag and driving the two default-operator bits through all four Table 12 values must yield four distinct compositions with the operator algebra relating them: AND against the page's all-white default leaves nothing, XOR never paints a pixel OR would leave white, and XNOR inverts XOR.
    const fixture = fixtureByName("composed-regions");
    const stream = jbig2FixtureBytes(fixture.stream);
    const composed = (pageFlags: number): string => {
      const result = decodeJbig2Embedded(
        withPatchedByte(stream, 27, pageFlags),
      );
      return renderRows(result.bytes, result.width, result.height).join("");
    };
    const or = composed((stream[27]! & ~0x40) | 0x00);
    const and = composed((stream[27]! & ~0x40) | 0x08);
    const xor = composed((stream[27]! & ~0x40) | 0x10);
    const xnor = composed((stream[27]! & ~0x40) | 0x18);
    expect(and).toBe(".".repeat(or.length));
    // XOR can only remove pixels OR would paint. XNOR is under no such relation: it turns every pixel of a region's rectangle black wherever the page and the region agree, including rectangles OR would leave white.
    for (let i = 0; i < xor.length; i++) {
      if (xor[i] === "#") {
        expect(or[i]).toBe("#");
      }
    }
    expect(new Set([or, and, xor, xnor]).size).toBe(4);

    // Setting the override flag again hands composition back to the regions' own operators, which is the fixture as jbig2enc wrote it and jbig2dec verified.
    const overridden = decodeJbig2Embedded(withPatchedByte(stream, 27, 0x48));
    expect(
      renderRows(overridden.bytes, overridden.width, overridden.height),
    ).toEqual(fixture.expected);
  });
});

describe("decodeJbig2Embedded: generic region flags", () => {
  const fixture = fixtureByName("box-generic");
  // The fixture's region segment starts at byte 30 with a twelve-byte header, so its region segment information field's flags byte sits at 57 and the generic region flags byte at 58.
  const stream = () => jbig2FixtureBytes(fixture.stream);

  it("refuses a region that sets EXTTEMPLATE rather than guessing its twelve adaptive pixels", () => {
    expect(() =>
      decodeJbig2Embedded(withPatchedByte(stream(), 58, 0x10)),
    ).toThrow(Jbig2UnsupportedError);
    expect(() =>
      decodeJbig2Embedded(withPatchedByte(stream(), 58, 0x10)),
    ).toThrow(/EXTTEMPLATE/);
  });

  it("refuses an external combination operator outside Table 12's 0-4 range", () => {
    expect(() =>
      decodeJbig2Embedded(withPatchedByte(stream(), 57, 0x05)),
    ).toThrow(Jbig2ParseError);
    expect(() =>
      decodeJbig2Embedded(withPatchedByte(stream(), 57, 0x05)),
    ).toThrow(/external combination operator 5/);
  });

  it("surfaces the fax decoder's own warnings through onWarning", () => {
    // One valid T.6 row — a single V0 mode bit — followed by end-of-facsimile-block, against a region declaring four rows: the MMR payload carries a quarter of what the region header claims, which the CCITT decoder reports as a warning while padding the rest white.
    const stream = jbig2Stream(
      segment({ number: 0, type: 48, data: pageInformation(8, 4) }),
      segment({
        number: 1,
        type: 38,
        data: [...regionInfo(8, 4), 0x01, 0x80, 0x04, 0x01, 0x00],
      }),
    );
    const warnings: string[] = [];
    const result = decodeJbig2Embedded(stream, {
      onWarning: (message) => warnings.push(message),
    });
    expect(warnings.join("\n")).toMatch(/CCITT fax data/);
    expect(renderRows(result.bytes, result.width, result.height)).toEqual([
      "........",
      "........",
      "........",
      "........",
    ]);
  });

  it("reads an adaptive pixel offset of 127 as positive rather than sign-extending it", () => {
    // A template-0 region wide enough that an AT x offset of +127 and the -129 a byte of 0x7F would mis-decode to both land inside the row above, so the two readings see genuinely different pixels and the decoded bitmap pins which one was used. The arithmetic payload is arbitrary: the MQ decoder's output from fixed bytes is deterministic, which is what makes the pin meaningful.
    const stream = jbig2Stream(
      segment({ number: 0, type: 48, data: pageInformation(300, 4) }),
      segment({
        number: 1,
        type: 38,
        data: [
          ...regionInfo(300, 4),
          0x02,
          0x7f,
          0xff,
          0xfd,
          0xff,
          0x02,
          0xfe,
          0xfe,
          0xfe,
          0xa2,
          0x9b,
          0xbc,
          0x42,
          0x63,
          0x93,
          0x88,
          0xf9,
        ],
      }),
    );
    const result = decodeJbig2Embedded(stream);
    expect(renderRows(result.bytes, result.width, result.height)).toEqual([
      "##################....######.........##....####..########....##.##...###.....##.#.##.#.##........##.#....##.#....##...##....##...##....##...##......####.###....####.....##....##.....##...#.......#####......#.##.........##....................#######..#####.##.........##....##.#.#.######..............",
      "#.##.#.####.##.#.....##.#.#.#.##....#.....#.....##.#....##.#########.##..##.........#.....##....#.#.###....#.#......##..##...###.####...###.#######.#.#.####....##.....#..#..###.##.###.#.#.#..........##.##..#..#.#.....#..#.#.................#.#.#.#.###.##..#..##..##...#.########.#.......############.",
      "..##..#.#.###..#.###.#..###.#..######....########.#.###...#..#.#.##.#.#.#.##.#..#..#.##..####.#.##.#...##...#.#.......###.#.##..#..##.####.#.#.##.##.#...#..##..##.#...#.#.####.#.#....#.#.##.#.#...#....#....#.#.#.##.##...#...#.##.....##....##.##.###.#..#.##.#..#.##...#.###.#.##.#.##..##.#..#.#.#.##.#",
      "..###..#....#....#...#...#.####..###.######.##....#.#..###...##.####.#..##.....##..###.##.##..###..####.##..#...#....##.#..#.....#..#.##.##.####...#.#....###..#.##.#.#.##.##.#.....###.###..#.##.#....##..##.###..##.######.#.#..#..###.####.#.....####...#####.###..#####.#...#.###..##.#..##.....#.####.#",
    ]);
  });
});

describe("decodeJbig2Embedded: symbol dictionary flags", () => {
  // The stripes-symbols fixture's globals stream holds a symbol dictionary as its first segment: eleven header bytes, then a two-byte flags field at offset 11.
  const fixture = fixtureByName("stripes-symbols");
  const globals = () => jbig2FixtureBytes(fixture.globals!);
  const stream = () => jbig2FixtureBytes(fixture.stream);
  const withDictionaryFlags = (
    highBits: number,
    lowBits: number,
  ): Uint8Array<ArrayBuffer> => {
    const patched = new Uint8Array(globals());
    patched[11] = (patched[11] ?? 0) | highBits;
    patched[12] = (patched[12] ?? 0) | lowBits;
    return patched;
  };

  it("refuses a Huffman-coded symbol dictionary", () => {
    expect(() =>
      decodeJbig2Embedded(stream(), {
        globals: withDictionaryFlags(0x00, 0x01),
      }),
    ).toThrow(Jbig2UnsupportedError);
    expect(() =>
      decodeJbig2Embedded(stream(), {
        globals: withDictionaryFlags(0x00, 0x01),
      }),
    ).toThrow(/symbol dictionary is Huffman-coded/);
  });

  it("refuses a dictionary that uses or retains a shared bitmap coding context, for either of the two bits", () => {
    // T.88 7.4.3.1.1 bits 8 and 9: bit 8 imports a context, bit 9 retains one for export. Either alone must be refused by name.
    for (const [highBits, lowBits] of [
      [0x01, 0x00],
      [0x02, 0x00],
    ] as const) {
      expect(() =>
        decodeJbig2Embedded(stream(), {
          globals: withDictionaryFlags(highBits, lowBits),
        }),
      ).toThrow(/shared bitmap coding context/);
    }
  });

  it("reads one adaptive pixel pair for a dictionary on any template but template 0", () => {
    // A dictionary declaring GBTEMPLATE 1 carries a single AT pair (T.88 7.4.3.2), and with no new or exported symbols its data is exactly the flags, that pair, and the two counts — nothing more, so a decoder that read template 0's four pairs would run off the end of the stream.
    const stream = jbig2Stream(
      segment({
        number: 0,
        type: 48,
        data: pageInformation(8, 4),
      }),
      segment({
        number: 1,
        type: 0,
        data: [...u16Bytes(0x0400), 0x01, 0x02, ...u32Bytes(0), ...u32Bytes(0)],
      }),
    );
    const result = decodeJbig2Embedded(stream);
    expect(renderRows(result.bytes, result.width, result.height)).toEqual([
      "........",
      "........",
      "........",
      "........",
    ]);
  });

  it("reads refinement adaptive pixels only when the dictionary aggregates and uses refinement template 0", () => {
    // With SDREFAGG set and GRTEMPLATE 1 in play, the refinement AT pairs of T.88 7.4.3.2 are not transmitted at all, so the two counts follow the dictionary's own four template-0 pairs directly. A dictionary that decodes nothing still proves the field order: reading two phantom refinement pairs instead would overrun the stream.
    const stream = jbig2Stream(
      segment({
        number: 0,
        type: 48,
        data: pageInformation(8, 4),
      }),
      segment({
        number: 1,
        type: 0,
        data: [
          ...u16Bytes(0x1002),
          0x01,
          0x02,
          0x03,
          0x04,
          0x05,
          0x06,
          0x07,
          0x08,
          ...u32Bytes(0),
          ...u32Bytes(0),
        ],
      }),
    );
    const result = decodeJbig2Embedded(stream);
    expect(renderRows(result.bytes, result.width, result.height)).toEqual([
      "........",
      "........",
      "........",
      "........",
    ]);
  });

  it("sizes the aggregate symbol ID by the input and new symbol counts together", () => {
    // A dictionary with three new symbols codes each IAID symbol index in two bits, so the aggregate reference lookup decodes symbol 1 here. With the input and new counts subtracted instead, the field would be one bit wide and the same bytes would decode symbol 0, which the pinned message distinguishes. The payload is arbitrary but fixed: the arithmetic decoder's output from fixed bytes is deterministic.
    const stream = jbig2Stream(
      segment({
        number: 0,
        type: 48,
        data: pageInformation(8, 4),
      }),
      segment({
        number: 1,
        type: 0,
        data: [
          ...u16Bytes(0x0002),
          0x03,
          0xff,
          0xfd,
          0xff,
          0x02,
          0xfe,
          0xfe,
          0xfe,
          0xff,
          0xff,
          0xff,
          0xff,
          ...u32Bytes(3),
          ...u32Bytes(3),
          0x00,
          0x00,
          0x16,
        ],
      }),
    );
    expect(() => decodeJbig2Embedded(stream)).toThrow(
      /symbol dictionary refined against symbol 1, which it has not decoded yet/,
    );
  });
});

describe("decodeJbig2Embedded: text region flags", () => {
  it("refuses a Huffman-coded text region", () => {
    // The stripes-symbols page stream holds the text region as its second segment: seventeen region information bytes after a twelve-byte header put its two-byte flags field at offset 59, of which offset 60 is the low byte carrying SBHUFF.
    const fixture = fixtureByName("stripes-symbols");
    const stream = jbig2FixtureBytes(fixture.stream);
    expect(() =>
      decodeJbig2Embedded(withPatchedByte(stream, 60, 0x01), {
        globals: jbig2FixtureBytes(fixture.globals!),
      }),
    ).toThrow(Jbig2UnsupportedError);
    expect(() =>
      decodeJbig2Embedded(withPatchedByte(stream, 60, 0x01), {
        globals: jbig2FixtureBytes(fixture.globals!),
      }),
    ).toThrow(/text region is Huffman-coded/);
  });

  it("reads refinement adaptive pixels only when the region both refines and uses refinement template 0", () => {
    // A text region declaring SBREFINE with GRTEMPLATE 1 transmits no refinement AT pairs (T.88 7.4.4.2), so its instance count follows the flags directly. Reaching the symbol gather with this stream's instance count read from the right place is what the refusal below records: a decoder that read two phantom pairs instead would run off the end of the stream before it ever got there.
    const stream = jbig2Stream(
      segment({
        number: 0,
        type: 48,
        data: pageInformation(8, 4),
      }),
      segment({
        number: 1,
        type: 6,
        data: [...regionInfo(8, 4), ...u16Bytes(0x8002), ...u32Bytes(0)],
      }),
    );
    expect(() => decodeJbig2Embedded(stream)).toThrow(
      /refers to no symbol dictionary/,
    );
  });

  it("composes symbol instances with the text region's own SBCOMBOP, in all four forms", () => {
    // The fixture's region declares SBCOMBOP OR, so OR must reproduce its jbig2dec-verified bitmap exactly. AND against the region's all-white default composes nothing. The fixture's instances never overlap, so XOR and OR coincide — but XNOR still differs, because it inverts the accumulated value inside every instance rectangle the region wrote, and the union of those rectangles is exactly the pixels any of the three operators paints. SBCOMBOP's two bits sit at text-flags bits 7 and 8: byte 60's top bit and byte 59's bottom bit.
    const fixture = fixtureByName("stripes-symbols");
    const stream = jbig2FixtureBytes(fixture.stream);
    const composed = (sbcombop: number): string => {
      const patched = new Uint8Array(stream);
      patched[59] = (patched[59]! & ~0x01) | (sbcombop >> 1);
      patched[60] = (patched[60]! & ~0x80) | ((sbcombop & 1) << 7);
      const result = decodeJbig2Embedded(patched, {
        globals: jbig2FixtureBytes(fixture.globals!),
      });
      return renderRows(result.bytes, result.width, result.height).join("");
    };
    const or = composed(0);
    const and = composed(1);
    const xor = composed(2);
    const xnor = composed(3);
    expect(or.match(/.{40}/g)).toEqual(fixture.expected);
    expect(and).toBe(".".repeat(or.length));
    expect(xor).toBe(or);
    expect(new Set([or, and, xnor]).size).toBe(3);
    for (let i = 0; i < or.length; i++) {
      if (or[i] === "#" || xor[i] === "#" || xnor[i] === "#") {
        expect(xnor[i]).toBe(xor[i] === "#" ? "." : "#");
      }
    }
  });
});
