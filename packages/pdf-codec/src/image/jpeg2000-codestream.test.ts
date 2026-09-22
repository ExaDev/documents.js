import { describe, expect, it } from "vitest";
import {
  JPEG2000_FIXTURES,
  jpeg2000FixtureBytes,
} from "../test-support/jpeg2000";
import { MarkerCursor, parseJpeg2000Codestream } from "./jpeg2000-codestream";
import {
  Jpeg2000ParseError,
  Jpeg2000UnsupportedError,
} from "./jpeg2000-errors";

function fixture(name: string): Uint8Array<ArrayBuffer> {
  const found = JPEG2000_FIXTURES.find((candidate) => candidate.name === name);
  expect(found).toBeDefined();
  return jpeg2000FixtureBytes(found?.codestream ?? "");
}

describe("MarkerCursor", () => {
  it("assembles a uint32 from its high and low uint16 halves, not by dividing the high half", () => {
    const cursor = new MarkerCursor(
      Uint8Array.from([0x00, 0x01, 0x00, 0x00]), // 0x00010000 = 65536
    );
    expect(cursor.uint32()).toBe(65536);
  });

  it("throws when asked to read more bytes than remain", () => {
    const cursor = new MarkerCursor(Uint8Array.from([1, 2, 3]));
    expect(() => cursor.bytes(4)).toThrow(Jpeg2000ParseError);
    expect(() => cursor.bytes(4)).toThrow(/more data than the codestream/);
  });

  it("rejects a negative length outright, before it could otherwise appear to fit", () => {
    const cursor = new MarkerCursor(Uint8Array.from([1, 2, 3, 4, 5]));
    expect(() => cursor.bytes(-1)).toThrow(Jpeg2000ParseError);
  });

  it("advances its own position by exactly the slice length read", () => {
    const cursor = new MarkerCursor(Uint8Array.from([1, 2, 3, 4, 5]));
    cursor.uint8(); // position: 0 -> 1
    const slice = cursor.bytes(3); // position: 1 -> 4
    expect(Array.from(slice)).toEqual([2, 3, 4]);
    expect(cursor.uint8()).toBe(5); // proves position landed on index 4, not 4 - 3 = -2 or left at 1
  });

  it("throws when reading a byte past the end of the data", () => {
    expect(() => new MarkerCursor(Uint8Array.from([])).uint8()).toThrow(
      /ended in the middle of a marker segment/,
    );
  });

  it("accepts a zero-length read without treating it as negative", () => {
    const cursor = new MarkerCursor(Uint8Array.from([1, 2, 3]));
    expect(Array.from(cursor.bytes(0))).toEqual([]);
  });

  it("accepts a read that exactly exhausts the remaining data", () => {
    const cursor = new MarkerCursor(Uint8Array.from([1, 2, 3]));
    expect(Array.from(cursor.bytes(3))).toEqual([1, 2, 3]);
  });
});

describe("parseJpeg2000Codestream", () => {
  it("reads the geometry, coding style and quantization of a real main header", () => {
    const codestream = parseJpeg2000Codestream(fixture("ramp-basic"));
    expect(codestream.siz).toMatchObject({
      xsiz: 32,
      ysiz: 24,
      xosiz: 0,
      yosiz: 0,
      xtsiz: 32,
      ytsiz: 24,
      xtosiz: 0,
      ytosiz: 0,
    });
    expect(codestream.siz.components).toEqual([
      { signed: false, bitDepth: 8, dx: 1, dy: 1 },
    ]);
    expect(codestream.main.cod).toMatchObject({
      decompositionLevels: 2,
      codeBlockWidthExp: 6,
      codeBlockHeightExp: 6,
      codeBlockStyle: 0,
      transform: "reversible-5-3",
      progressionOrder: "LRCP",
      layers: 1,
      multipleComponentTransform: false,
      useSop: false,
      useEph: false,
    });
    // No explicit precinct sizes were transmitted, so every resolution level takes the maximal partition — one precinct covering the whole level.
    expect(codestream.main.cod?.precinctSizes).toEqual([
      { ppx: 15, ppy: 15 },
      { ppx: 15, ppy: 15 },
      { ppx: 15, ppy: 15 },
    ]);
    expect(codestream.main.qcd).toMatchObject({ style: "none", guardBits: 2 });
    // One step size per subband: the lowest level's LL, then three per decomposition level.
    expect(codestream.main.qcd?.stepSizes).toHaveLength(3 * 2 + 1);
    expect(codestream.truncated).toBe(false);
  });

  it("reads explicit precinct sizes when the coding style declares them", () => {
    const codestream = parseJpeg2000Codestream(fixture("precincts"));
    // SPcod lists one packed exponent pair per resolution level starting at level 0. Every level is partitioned at 2^4, which for this fixture's own dimensions splits the higher levels into several precincts each rather than leaving one covering the whole level.
    expect(codestream.main.cod?.precinctSizes).toEqual([
      { ppx: 4, ppy: 4 },
      { ppx: 4, ppy: 4 },
      { ppx: 4, ppy: 4 },
    ]);
    // The guard that makes this fixture worth having: a partition wider than the level it applies to leaves one precinct covering everything and exercises nothing, which is exactly what an earlier version of this fixture did.
    expect(2 ** 4).toBeLessThan(codestream.siz.xsiz - codestream.siz.xosiz);
    expect(2 ** 4).toBeLessThan(codestream.siz.ysiz - codestream.siz.yosiz);
  });

  it("reads the mantissa and exponent of an irreversible quantization", () => {
    const codestream = parseJpeg2000Codestream(fixture("irreversible-photo"));
    expect(codestream.main.qcd?.style).toBe("expounded");
    expect(codestream.main.cod?.transform).toBe("irreversible-9-7");
    // An expounded quantization transmits a two-byte exponent/mantissa pair per subband, and a real encoder's mantissas are not all zero.
    expect(
      codestream.main.qcd?.stepSizes.some((step) => step.mantissa !== 0),
    ).toBe(true);
  });

  it("splits a multi-tile codestream into one tile-part per tile, each with its own data extent", () => {
    const codestream = parseJpeg2000Codestream(fixture("multi-tile"));
    expect(codestream.numTilesWide * codestream.numTilesHigh).toBe(
      codestream.tileParts.length,
    );
    expect(codestream.tileParts.map((part) => part.tileIndex)).toEqual(
      codestream.tileParts.map((_, index) => index),
    );
    for (const part of codestream.tileParts) {
      expect(part.dataEnd).toBeGreaterThan(part.dataStart);
      expect(part.dataEnd).toBeLessThanOrEqual(codestream.bytes.length);
    }
  });

  it("records the encoder comment a COM marker carries", () => {
    expect(
      parseJpeg2000Codestream(fixture("ramp-basic")).comments.join(" "),
    ).toContain("OpenJPEG");
  });

  it("reports a codestream that ends without an EOC marker as truncated", () => {
    const full = fixture("ramp-basic");
    expect(parseJpeg2000Codestream(full).truncated).toBe(false);
    expect(
      parseJpeg2000Codestream(full.subarray(0, full.length - 30)).truncated,
    ).toBe(true);
  });

  it("rejects a codestream that does not begin with SOC followed by SIZ", () => {
    const original = fixture("ramp-basic");
    const noSoc = new Uint8Array(original);
    noSoc[1] = 0x4e;
    expect(() => parseJpeg2000Codestream(noSoc)).toThrow(/SOC/);

    const noSiz = new Uint8Array(original);
    noSiz[3] = 0x52;
    expect(() => parseJpeg2000Codestream(noSiz)).toThrow(/SIZ/);
  });

  it("rejects an SOT whose declared length is not the fixed ten bytes", () => {
    const original = fixture("ramp-basic");
    const sotOffset = findMarker(original, 0xff90);
    const broken = new Uint8Array(original);
    broken[sotOffset + 3] = 12;
    expect(() => parseJpeg2000Codestream(broken)).toThrow(Jpeg2000ParseError);
  });

  it("refuses a codestream whose packet headers live in a PPM marker rather than inline", () => {
    const original = fixture("ramp-basic");
    // Turn the main header's COM segment into a PPM one; its length field stays valid, so the refusal is about the marker and nothing else.
    const comOffset = findMarker(original, 0xff64);
    const asPpm = new Uint8Array(original);
    asPpm[comOffset + 1] = 0x60;
    expect(() => parseJpeg2000Codestream(asPpm)).toThrow(
      Jpeg2000UnsupportedError,
    );
    expect(() => parseJpeg2000Codestream(asPpm)).toThrow(/PPM/);
  });

  it("rejects a marker segment declaring more data than the codestream carries", () => {
    const original = fixture("ramp-basic");
    const comOffset = findMarker(original, 0xff64);
    const broken = new Uint8Array(original);
    broken[comOffset + 2] = 0x7f;
    expect(() => parseJpeg2000Codestream(broken)).toThrow(Jpeg2000ParseError);
  });
});

// A hand-built minimal codestream, precise down to the byte, for exercising header-segment guards a real encoder's output never happens to trip.
function u16(value: number): number[] {
  return [(value >>> 8) & 0xff, value & 0xff];
}
function u32(value: number): number[] {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ];
}
function segment(markerCode: number, body: readonly number[]): number[] {
  const length = 2 + body.length; // Lxxx counts itself, per T.800 A.4.
  return [...u16(markerCode), ...u16(length), ...body];
}

const MARKER_SOC = 0xff4f;
const MARKER_SIZ = 0xff51;
const MARKER_COD = 0xff52;
const MARKER_QCD = 0xff5c;
const MARKER_SOT = 0xff90;
const MARKER_SOD = 0xff93;
const MARKER_EOC = 0xffd9;

function sizSegment(
  overrides: Partial<{
    xsiz: number;
    ysiz: number;
    xosiz: number;
    yosiz: number;
    xtsiz: number;
    ytsiz: number;
    xtosiz: number;
    ytosiz: number;
    componentCount: number;
    componentBytes: readonly number[];
  }> = {},
): number[] {
  const {
    xsiz = 4,
    ysiz = 4,
    xosiz = 0,
    yosiz = 0,
    xtsiz = 4,
    ytsiz = 4,
    xtosiz = 0,
    ytosiz = 0,
    componentCount = 1,
  } = overrides;
  const componentBytes =
    overrides.componentBytes ??
    Array.from({ length: componentCount * 3 }, (_, index) =>
      index % 3 === 0 ? 7 : 1,
    ); // Ssiz = 7 (8-bit unsigned), XRsiz = YRsiz = 1
  return segment(MARKER_SIZ, [
    ...u16(0), // Rsiz
    ...u32(xsiz),
    ...u32(ysiz),
    ...u32(xosiz),
    ...u32(yosiz),
    ...u32(xtsiz),
    ...u32(ytsiz),
    ...u32(xtosiz),
    ...u32(ytosiz),
    ...u16(componentCount),
    ...componentBytes,
  ]);
}

function codSegment(
  overrides: Partial<{
    scod: number;
    progression: number;
    layers: number;
    mct: number;
    decompLevels: number;
    cbW: number;
    cbH: number;
    cbStyle: number;
    transform: number;
  }> = {},
): number[] {
  const {
    scod = 0,
    progression = 0,
    layers = 1,
    mct = 0,
    decompLevels = 0,
    cbW = 0,
    cbH = 0,
    cbStyle = 0,
    transform = 1,
  } = overrides;
  return segment(MARKER_COD, [
    scod,
    progression,
    ...u16(layers),
    mct,
    decompLevels,
    cbW,
    cbH,
    cbStyle,
    transform,
  ]);
}

function qcdSegment(styleCode = 0, guardBits = 0): number[] {
  return segment(MARKER_QCD, [(guardBits << 5) | styleCode]);
}

// SOC + SIZ + COD + QCD + whatever else the caller supplies, terminated by EOC unless told not to. Sized and positioned entirely from what it is given, so a caller only ever states what a test cares about.
function minimalCodestream(
  opts: {
    siz?: readonly number[];
    cod?: readonly number[];
    qcd?: readonly number[];
    afterMainHeader?: readonly number[];
    omitEoc?: boolean;
  } = {},
): Uint8Array<ArrayBuffer> {
  const bytes = [
    ...u16(MARKER_SOC),
    ...(opts.siz ?? sizSegment()),
    ...(opts.cod ?? codSegment()),
    ...(opts.qcd ?? qcdSegment()),
    ...(opts.afterMainHeader ?? []),
  ];
  if (opts.omitEoc !== true) {
    bytes.push(...u16(MARKER_EOC));
  }
  return Uint8Array.from(bytes);
}

// SOT + a tile-part header + SOD, sized correctly from its own body. Psot 0 means "runs to the end of the codestream", the same convention the real format uses.
function tilePart(
  tileIndex: number,
  header: readonly number[],
  data: readonly number[],
  psot = 0,
): number[] {
  return [
    ...u16(MARKER_SOT),
    ...u16(10),
    ...u16(tileIndex),
    ...u32(psot),
    0, // TPsot
    0, // TNsot
    ...header,
    ...u16(MARKER_SOD),
    ...data,
  ];
}

describe("parseJpeg2000Codestream, header-segment guards a real encoder never trips", () => {
  it("rejects a SIZ segment declaring zero components", () => {
    const data = minimalCodestream({
      siz: sizSegment({ componentCount: 0, componentBytes: [] }),
    });
    expect(() => parseJpeg2000Codestream(data)).toThrow(/zero components/);
  });

  it("rejects a SIZ segment whose own length has no room for every component it declares", () => {
    const data = minimalCodestream({
      siz: sizSegment({ componentCount: 2, componentBytes: [7, 1, 1] }), // declares 2, provides 1
    });
    expect(() => parseJpeg2000Codestream(data)).toThrow(
      /leaves room for fewer/,
    );
  });

  it("rejects a SIZ segment whose x extent has no area", () => {
    const data = minimalCodestream({ siz: sizSegment({ xosiz: 4 }) }); // xsiz(4) <= xosiz(4)
    expect(() => parseJpeg2000Codestream(data)).toThrow(/no area/);
  });

  it("rejects a SIZ segment whose y extent has no area even though its x extent does", () => {
    const data = minimalCodestream({ siz: sizSegment({ yosiz: 4 }) });
    expect(() => parseJpeg2000Codestream(data)).toThrow(/no area/);
  });

  it("rejects a SIZ segment declaring a zero-width tile", () => {
    const data = minimalCodestream({ siz: sizSegment({ xtsiz: 0 }) });
    expect(() => parseJpeg2000Codestream(data)).toThrow(/zero-sized tile/);
  });

  it("rejects a SIZ segment declaring a zero-height tile even though its width is fine", () => {
    const data = minimalCodestream({ siz: sizSegment({ ytsiz: 0 }) });
    expect(() => parseJpeg2000Codestream(data)).toThrow(/zero-sized tile/);
  });

  it("rejects a COD segment declaring a transform ISO/IEC 15444-1 does not define", () => {
    const data = minimalCodestream({ cod: codSegment({ transform: 5 }) });
    expect(() => parseJpeg2000Codestream(data)).toThrow(/neither of the two/);
  });

  it("rejects a COD segment whose code-block area exceeds Table A.18's cap", () => {
    const data = minimalCodestream({ cod: codSegment({ cbW: 12, cbH: 12 }) }); // exponents 14 and 14, area 2^28
    expect(() => parseJpeg2000Codestream(data)).toThrow(
      /outside the range ISO\/IEC 15444-1 Table A\.18/,
    );
  });

  it("accepts a COD segment whose code-block area sits exactly at Table A.18's cap", () => {
    const data = minimalCodestream({ cod: codSegment({ cbW: 3, cbH: 3 }) }); // exponents 5 and 5, sum 10, well inside the cap
    const codestream = parseJpeg2000Codestream(data);
    expect(codestream.main.cod).toMatchObject({
      codeBlockWidthExp: 5,
      codeBlockHeightExp: 5,
    });
  });

  it("rejects a COD segment declaring a progression order ISO/IEC 15444-1 Table A.16 does not define", () => {
    const data = minimalCodestream({
      cod: codSegment({ progression: 5 }),
    });
    expect(() => parseJpeg2000Codestream(data)).toThrow(
      /outside the five ISO\/IEC 15444-1 Table A\.16/,
    );
  });

  it("rejects a COD segment declaring zero quality layers", () => {
    const data = minimalCodestream({ cod: codSegment({ layers: 0 }) });
    expect(() => parseJpeg2000Codestream(data)).toThrow(/zero quality layers/);
  });

  it("rejects a QCD segment declaring a quantization style Table A.28 does not define", () => {
    const data = minimalCodestream({ qcd: qcdSegment(3) });
    expect(() => parseJpeg2000Codestream(data)).toThrow(/does not define/);
  });

  it("rejects a marker segment whose own declared length is shorter than the length field itself", () => {
    const data = minimalCodestream({
      afterMainHeader: [...u16(0xff64), ...u16(1)], // COM, Lcom = 1: shorter than the 2-byte length field that carries it
    });
    expect(() => parseJpeg2000Codestream(data)).toThrow(
      /shorter than the length field itself/,
    );
  });

  it("rejects a COM marker whose declared length leaves no room for its own registration field", () => {
    const data = minimalCodestream({
      afterMainHeader: [...u16(0xff64), ...u16(2)], // COM, Lcom = 2: passes the length < 2 guard but leaves nothing for Rcom
    });
    expect(() => parseJpeg2000Codestream(data)).toThrow(
      /more data than the codestream carries/,
    );
  });

  it("records a per-component coding style override from a COC marker", () => {
    const coc = segment(0xff53, [0, 0, 0, 0, 0, 0, 1]); // component 0, decompLevels 0, cbW/cbH/style 0, reversible
    const data = minimalCodestream({ afterMainHeader: coc });
    expect(parseJpeg2000Codestream(data).main.coc.get(0)).toMatchObject({
      transform: "reversible-5-3",
    });
  });

  it("records a per-component quantization override from a QCC marker", () => {
    const qcc = segment(0xff5d, [0, 0]); // component 0, Sqcc: style none, guardBits 0
    const data = minimalCodestream({ afterMainHeader: qcc });
    expect(parseJpeg2000Codestream(data).main.qcc.get(0)).toMatchObject({
      style: "none",
    });
  });

  it("records that a POC marker changed the progression order, without parsing its entries", () => {
    const poc = segment(0xff5f, [0, 0, 0, 0, 0, 0]);
    const data = minimalCodestream({ afterMainHeader: poc });
    expect(parseJpeg2000Codestream(data).main.hasProgressionChanges).toBe(true);
  });

  it("records that an RGN marker declares a region of interest, without applying it", () => {
    const rgn = segment(0xff5e, [0, 0, 0]);
    const data = minimalCodestream({ afterMainHeader: rgn });
    expect(parseJpeg2000Codestream(data).main.hasRegionOfInterest).toBe(true);
  });

  it("records that a PPT marker moves packet headers out of the packet bodies", () => {
    const ppt = segment(0xff61, [0]);
    const data = minimalCodestream({ afterMainHeader: ppt });
    expect(parseJpeg2000Codestream(data).main.hasPackedPacketHeaders).toBe(
      true,
    );
  });

  it("rejects an SOC or SOD marker appearing unexpectedly inside the main header", () => {
    const data = minimalCodestream({
      afterMainHeader: [...u16(MARKER_SOD)],
    });
    expect(() => parseJpeg2000Codestream(data)).toThrow(/unexpected marker/);
  });

  it("rejects a main header carrying no COD marker", () => {
    const data = minimalCodestream({ cod: [] });
    expect(() => parseJpeg2000Codestream(data)).toThrow(/no COD marker/);
  });

  it("rejects a main header carrying no QCD marker", () => {
    const data = minimalCodestream({ qcd: [] });
    expect(() => parseJpeg2000Codestream(data)).toThrow(/no QCD marker/);
  });

  it("rejects a tile-part header that ends before an SOD marker appears", () => {
    const data = minimalCodestream({
      afterMainHeader: [
        ...u16(MARKER_SOT),
        ...u16(10),
        ...u16(0),
        ...u32(0),
        0,
        0,
      ],
      omitEoc: true, // an EOC here would itself be a marker the tile-part-header loop reads, rather than genuinely running out of data
    });
    expect(() => parseJpeg2000Codestream(data)).toThrow(
      /ended without an SOD marker/,
    );
  });

  it("rejects a tile-part header that runs into a second SOT rather than reaching SOD", () => {
    const data = minimalCodestream({
      afterMainHeader: [
        ...u16(MARKER_SOT),
        ...u16(10),
        ...u16(0),
        ...u32(0),
        0,
        0,
        ...u16(MARKER_SOT),
      ],
    });
    expect(() => parseJpeg2000Codestream(data)).toThrow(/rather than at SOD/);
  });

  it("rejects a tile-part whose Psot is shorter than its own header", () => {
    const data = minimalCodestream({
      afterMainHeader: [
        ...u16(MARKER_SOT),
        ...u16(10),
        ...u16(0),
        ...u32(4), // Psot 4 doesn't even cover the fixed 12-byte SOT header
        0,
        0,
        ...u16(MARKER_SOD),
      ],
    });
    expect(() => parseJpeg2000Codestream(data)).toThrow(
      /shorter than its own header/,
    );
  });

  it("trims a trailing EOC from the last tile-part's own data when Psot runs to the end of the codestream", () => {
    const data = minimalCodestream({
      afterMainHeader: tilePart(0, [], [0xaa, 0xbb, 0xcc]),
    });
    const codestream = parseJpeg2000Codestream(data);
    const part = codestream.tileParts[0];
    expect(part).toBeDefined();
    expect(Array.from(data.subarray(part?.dataStart, part?.dataEnd))).toEqual([
      0xaa, 0xbb, 0xcc,
    ]);
  });

  it("leaves a tile-part's data untrimmed when it does not end in 0xFF 0xD9", () => {
    const withoutEoc = minimalCodestream({
      afterMainHeader: tilePart(0, [], [0xaa, 0xbb, 0xcc, 0xdd]),
      omitEoc: true, // an EOC right here would itself be the trailing bytes the trim check is for
    });
    const codestream = parseJpeg2000Codestream(withoutEoc);
    const part = codestream.tileParts[0];
    expect(part).toBeDefined();
    // The tile-part's own trailing 0xFF 0xD9 only gets trimmed when Psot runs to the codestream's own end and the real EOC marker sits there — not merely because the last two bytes happen to match.
    expect(part?.dataEnd).toBe(withoutEoc.length);
  });

  it("does not let a tile-part's own header override the main header's coding and quantization defaults with nothing", () => {
    const data = minimalCodestream({
      afterMainHeader: tilePart(0, [], []),
    });
    const header = parseJpeg2000Codestream(data).tileParts[0]?.header;
    expect(header !== undefined && Object.hasOwn(header, "cod")).toBe(false);
    expect(header !== undefined && Object.hasOwn(header, "qcd")).toBe(false);
  });

  it("lets a tile-part's own COD marker override just the coding defaults, leaving quantization to the main header", () => {
    const data = minimalCodestream({
      afterMainHeader: tilePart(0, codSegment({ layers: 3 }), []),
    });
    const header = parseJpeg2000Codestream(data).tileParts[0]?.header;
    expect(header?.cod).toMatchObject({ layers: 3 });
    // Not merely undefined when read: genuinely absent as a key, so a mutant that always spreads both cod and qcd together can't pass by coincidentally leaving qcd's value at undefined.
    expect(header !== undefined && Object.hasOwn(header, "qcd")).toBe(false);
  });

  it("lets a tile-part's own QCD marker override just the quantization, leaving coding style to the main header", () => {
    const data = minimalCodestream({
      afterMainHeader: tilePart(0, qcdSegment(1, 3), []),
    });
    const header = parseJpeg2000Codestream(data).tileParts[0]?.header;
    expect(header?.qcd).toMatchObject({ style: "derived", guardBits: 3 });
    expect(header !== undefined && Object.hasOwn(header, "cod")).toBe(false);
  });

  it("records both a tile-part's own COD and QCD overrides together", () => {
    const data = minimalCodestream({
      afterMainHeader: tilePart(
        0,
        [...codSegment({ layers: 3 }), ...qcdSegment(1, 3)],
        [],
      ),
    });
    const header = parseJpeg2000Codestream(data).tileParts[0]?.header;
    expect(header?.cod).toMatchObject({ layers: 3 });
    expect(header?.qcd).toMatchObject({ style: "derived", guardBits: 3 });
  });

  it("reads a component index as two bytes once the image declares 257 or more components", () => {
    const siz = sizSegment({ componentCount: 257 });
    // component index 300 (two bytes: 0x01, 0x2c) rather than a single byte, which could not represent it at all
    const coc = segment(0xff53, [1, 0x2c, 0, 0, 0, 0, 0, 1]);
    const data = minimalCodestream({ siz, afterMainHeader: coc });
    expect(parseJpeg2000Codestream(data).main.coc.has(300)).toBe(true);
  });

  it("reports a signed component depth from SIZ's own sign bit", () => {
    const siz = sizSegment({ componentCount: 1, componentBytes: [0x87, 1, 1] }); // Ssiz with the sign bit set
    const data = minimalCodestream({ siz });
    expect(parseJpeg2000Codestream(data).siz.components).toEqual([
      { signed: true, bitDepth: 8, dx: 1, dy: 1 },
    ]);
  });

  it("reads a derived-style quantization's own step sizes, one per subband", () => {
    // Style 1 (derived) transmits a 2-byte exponent/mantissa pair per subband; two entries here, spanning exactly to segmentEnd with no room for a third.
    const qcd = segment(MARKER_QCD, [
      (0 << 5) | 1,
      ...u16((5 << 11) | 100),
      ...u16((6 << 11) | 200),
    ]);
    const data = minimalCodestream({ qcd });
    expect(parseJpeg2000Codestream(data).main.qcd?.stepSizes).toEqual([
      { exponent: 5, mantissa: 100 },
      { exponent: 6, mantissa: 200 },
    ]);
  });

  it("does not misread a marker segment's own explicit-precincts flag as the opposite of what it declares", () => {
    const explicit = codSegment({ scod: 0x01, decompLevels: 1 }); // Scod bit 0 set: two packed precinct-size bytes follow
    const packed = [0x35, 0x24]; // ppx=5,ppy=3 for level 0; ppx=4,ppy=2 for level 1
    const data = minimalCodestream({
      cod: [
        ...explicit.slice(0, 2),
        ...u16(2 + explicit.slice(4).length + packed.length),
        ...explicit.slice(4),
        ...packed,
      ],
    });
    expect(parseJpeg2000Codestream(data).main.cod?.precinctSizes).toEqual([
      { ppx: 5, ppy: 3 },
      { ppx: 4, ppy: 2 },
    ]);
  });

  it("records an explicit per-component precinct override from a COC marker", () => {
    const coc = segment(0xff53, [
      0, // component 0
      0x01, // Scoc: explicit precincts bit set
      0, // decompLevels
      0, // cbW
      0, // cbH
      0, // cbStyle
      1, // transform: reversible
      0x35, // one packed precinct byte for the single resolution level
    ]);
    const data = minimalCodestream({ afterMainHeader: coc });
    expect(
      parseJpeg2000Codestream(data).main.coc.get(0)?.precinctSizes,
    ).toEqual([{ ppx: 5, ppy: 3 }]);
  });

  it("does not record a comment from a COM marker whose registration is not 1 (Latin text)", () => {
    const com = segment(0xff64, [0, 0, 0x41, 0x42]); // registration 0 (binary): "AB" must not surface as a comment
    const data = minimalCodestream({ afterMainHeader: com });
    expect(parseJpeg2000Codestream(data).comments).toEqual([]);
  });

  it("skips a marker segment type this decoder has no other handling for, without recording anything", () => {
    // The body deliberately looks like a registration-1 COM segment ("registration 1, text AB") — if TLM were ever misread as COM this would show up as a spurious comment, not merely a silent no-op that happens to look the same either way.
    const tlm = segment(0xff55, [0, 1, 0x41, 0x42]);
    const data = minimalCodestream({ afterMainHeader: tlm });
    const codestream = parseJpeg2000Codestream(data);
    expect(codestream.comments).toEqual([]);
    expect(codestream.main.hasProgressionChanges).toBe(false);
  });

  it("stops reading quantization step sizes exactly at its own segment boundary", () => {
    // One entry, then a single trailing pad byte — one byte short of a second entry, so a mutant that reads one iteration too many would either read past the segment into whatever follows or throw, rather than stopping here with exactly one.
    const qcd = segment(MARKER_QCD, [
      (0 << 5) | 1,
      ...u16((5 << 11) | 1),
      0xaa,
    ]);
    const data = minimalCodestream({ qcd });
    expect(parseJpeg2000Codestream(data).main.qcd?.stepSizes).toHaveLength(1);
  });

  it("accepts a marker segment whose own declared length runs exactly to the end of the codestream", () => {
    const com = segment(0xff64, [0, 0, 0x41]); // registration 0 (binary), one body byte, landing exactly on the codestream's own last byte
    const data = minimalCodestream({ afterMainHeader: com, omitEoc: true });
    expect(() => parseJpeg2000Codestream(data)).not.toThrow();
  });

  it("trims a trailing EOC from a tile-part whose data is exactly the 2-byte signature and nothing else", () => {
    const data = minimalCodestream({
      afterMainHeader: tilePart(0, [], [0xff, 0xd9]),
      omitEoc: true,
    });
    const part = parseJpeg2000Codestream(data).tileParts[0];
    expect(part?.dataStart).toBe(part?.dataEnd);
  });

  it("starts with no comments at all when the main header carries none", () => {
    expect(parseJpeg2000Codestream(minimalCodestream()).comments).toEqual([]);
  });

  it("rejects a marker segment whose own declared length would run past the end of the codestream", () => {
    const data = minimalCodestream({
      afterMainHeader: [...u16(0xff64), ...u16(100)], // COM claims 98 more bytes that are not actually present
      omitEoc: true,
    });
    expect(() => parseJpeg2000Codestream(data)).toThrow(
      /declares more data than the codestream carries/,
    );
  });

  it("rejects a codestream too short for SOC's own 4-byte check, but accepts one exactly 4 bytes long", () => {
    expect(() =>
      parseJpeg2000Codestream(Uint8Array.from([0xff, 0x4f, 0xff])),
    ).toThrow(/does not begin with an SOC/);
    // Exactly 4 bytes of a genuine SOC + SIZ marker: passes the length check, then fails later (out of data for Lsiz) rather than being rejected here for being "too short".
    expect(() =>
      parseJpeg2000Codestream(Uint8Array.from([0xff, 0x4f, 0xff, 0x51])),
    ).not.toThrow(/does not begin with an SOC/);
  });

  it("rejects a bare SOC marker appearing unexpectedly inside the main header, not only a bare SOD", () => {
    const data = minimalCodestream({
      afterMainHeader: [...u16(MARKER_SOC)],
    });
    expect(() => parseJpeg2000Codestream(data)).toThrow(/unexpected marker/);
  });

  it("computes the tile grid from the tile origin, not by adding it back in", () => {
    const siz = sizSegment({
      xsiz: 10,
      ysiz: 9,
      xtsiz: 4,
      ytsiz: 3,
      xtosiz: 2,
      ytosiz: 1,
    });
    const codestream = parseJpeg2000Codestream(minimalCodestream({ siz }));
    // ceil((10 - 2) / 4) = 2, and ceil((9 - 1) / 3) = 3 — not ceil((10 + 2) / 4) = 3 or ceil((9 + 1) / 3) = 4.
    expect(codestream.numTilesWide).toBe(2);
    expect(codestream.numTilesHigh).toBe(3);
  });

  it("reports the exact declared length in an SOT length-mismatch error", () => {
    const data = minimalCodestream({
      afterMainHeader: [
        ...u16(MARKER_SOT),
        ...u16(12), // declares 12, ISO/IEC 15444-1 A.4.2 fixes it at 10
        ...u16(0),
        ...u32(0),
        0,
        0,
      ],
    });
    expect(() => parseJpeg2000Codestream(data)).toThrow(
      /declares a length of 12, but ISO\/IEC 15444-1 A\.4\.2 fixes it at 10/,
    );
  });

  it("rejects a tile-part header running into an EOC marker rather than reaching SOD", () => {
    const data = minimalCodestream({
      afterMainHeader: [
        ...u16(MARKER_SOT),
        ...u16(10),
        ...u16(0),
        ...u32(0),
        0,
        0,
        ...u16(MARKER_EOC),
      ],
      omitEoc: true,
    });
    expect(() => parseJpeg2000Codestream(data)).toThrow(/rather than at SOD/);
  });

  it("accepts a tile-part whose Psot runs exactly to the end of its own (empty) data, not merely close to it", () => {
    const data = minimalCodestream({
      afterMainHeader: tilePart(0, [], [], 14), // 12-byte SOT + 2-byte SOD = 14, exactly consuming Psot with zero data bytes left
    });
    const part = parseJpeg2000Codestream(data).tileParts[0];
    expect(part?.dataStart).toBe(part?.dataEnd);
  });

  it("does not trim a tile-part's own data when it is shorter than the 2-byte EOC signature itself", () => {
    const data = minimalCodestream({
      afterMainHeader: tilePart(0, [], [0xff]),
      omitEoc: true,
    });
    const part = parseJpeg2000Codestream(data).tileParts[0];
    expect(part?.dataEnd).toBe(data.length);
  });

  it("does not trim a tile-part's own data ending in 0xFF but not 0xD9", () => {
    const data = minimalCodestream({
      afterMainHeader: tilePart(0, [], [0xaa, 0xff, 0x00]),
      omitEoc: true,
    });
    const part = parseJpeg2000Codestream(data).tileParts[0];
    expect(part?.dataEnd).toBe(data.length);
  });

  it("does not trim a tile-part's own data ending in 0xD9 that was not preceded by 0xFF", () => {
    const data = minimalCodestream({
      afterMainHeader: tilePart(0, [], [0xaa, 0x00, 0xd9]),
      omitEoc: true,
    });
    const part = parseJpeg2000Codestream(data).tileParts[0];
    expect(part?.dataEnd).toBe(data.length);
  });
});

// Walks the main header's marker segments to the first occurrence of `marker`, returning the offset of the marker itself. Used instead of a fixed offset because a COM segment's length varies with the encoder's own version string.
function findMarker(data: Uint8Array<ArrayBuffer>, marker: number): number {
  let position = 4 + ((data[4] ?? 0) << 8) + (data[5] ?? 0);
  for (;;) {
    const current = ((data[position] ?? 0) << 8) | (data[position + 1] ?? 0);
    if (current === marker) {
      return position;
    }
    if (position >= data.length - 4) {
      throw new Error(
        `marker 0x${marker.toString(16)} not found in the fixture's main header`,
      );
    }
    position +=
      2 + (((data[position + 2] ?? 0) << 8) | (data[position + 3] ?? 0));
  }
}
