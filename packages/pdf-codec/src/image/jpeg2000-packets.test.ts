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
  type Jpeg2000CodeBlock,
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
    options: Readonly<{ useSop?: boolean; useEph?: boolean }> = {},
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
