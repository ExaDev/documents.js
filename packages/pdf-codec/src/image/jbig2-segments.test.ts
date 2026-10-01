import { describe, expect, it } from "vitest";
import { JBIG2_FIXTURES, jbig2FixtureBytes } from "../test-support/jbig2";
import {
  fixtureByName,
  jbig2Stream,
  pageInformation,
  regionInfo,
  renderRows,
  segment,
  u16Bytes,
  u32Bytes,
  withPatchedByte,
} from "../test-support/jbig2-crafted";
import { Jbig2ParseError, Jbig2UnsupportedError } from "./jbig2-errors";
import { decodeJbig2Embedded } from "./jbig2";

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
    const faxStream = jbig2Stream(
      segment({ number: 0, type: 48, data: pageInformation(8, 4) }),
      segment({
        number: 1,
        type: 38,
        data: [...regionInfo(8, 4), 0x01, 0x80, 0x04, 0x01, 0x00],
      }),
    );
    const warnings: string[] = [];
    const result = decodeJbig2Embedded(faxStream, {
      onWarning: (message) => {
        warnings.push(message);
      },
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
    const adaptivePixelStream = jbig2Stream(
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
    const result = decodeJbig2Embedded(adaptivePixelStream);
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
    const templateOneStream = jbig2Stream(
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
    const result = decodeJbig2Embedded(templateOneStream);
    expect(renderRows(result.bytes, result.width, result.height)).toEqual([
      "........",
      "........",
      "........",
      "........",
    ]);
  });

  it("reads refinement adaptive pixels only when the dictionary aggregates and uses refinement template 0", () => {
    // With SDREFAGG set and GRTEMPLATE 1 in play, the refinement AT pairs of T.88 7.4.3.2 are not transmitted at all, so the two counts follow the dictionary's own four template-0 pairs directly. A dictionary that decodes nothing still proves the field order: reading two phantom refinement pairs instead would overrun the stream.
    const refinementAggregateStream = jbig2Stream(
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
    const result = decodeJbig2Embedded(refinementAggregateStream);
    expect(renderRows(result.bytes, result.width, result.height)).toEqual([
      "........",
      "........",
      "........",
      "........",
    ]);
  });

  it("sizes the aggregate symbol ID by the input and new symbol counts together", () => {
    // A dictionary with three new symbols codes each IAID symbol index in two bits, so the aggregate reference lookup decodes symbol 1 here. With the input and new counts subtracted instead, the field would be one bit wide and the same bytes would decode symbol 0, which the pinned message distinguishes. The payload is arbitrary but fixed: the arithmetic decoder's output from fixed bytes is deterministic.
    const aggregateIdStream = jbig2Stream(
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
    expect(() => decodeJbig2Embedded(aggregateIdStream)).toThrow(
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

describe("decodeJbig2Embedded: segment header referred-to machinery", () => {
  // The referred-to segment fields (T.88 7.2.4/7.2.5) are walked on every header parse but no fixture carries any: the encoder the vendored streams came from never emitted a referral. Each case below rebuilds the box-generic page-information segment's own header around its unchanged 19-byte body, so the only thing under test is the header reader's own arithmetic.
  const fixture = JBIG2_FIXTURES.find(
    (candidate) => candidate.name === "box-generic",
  )!;
  const stream = jbig2FixtureBytes(fixture.stream);
  const pageInfoBody = stream.subarray(11, 30); // past the 11-byte first header, before the region segment at 30

  function rebuiltStream(
    header: Uint8Array<ArrayBuffer>,
  ): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(
      header.length + pageInfoBody.length + (stream.length - 30),
    );
    out.set(header, 0);
    out.set(pageInfoBody, header.length);
    out.set(stream.subarray(30), header.length + pageInfoBody.length);
    return out;
  }

  function uint32Bytes(value: number): number[] {
    return [
      (value >>> 24) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff,
    ];
  }

  it("reads short-form referred-to segment numbers when the own number stays under 256", () => {
    // Segment number 1 (> 0, <= 255) forces 1-byte referred numbers; one referral, retain-flag bit array skipped as its own byte.
    const header: number[] = [];
    header.push(...uint32Bytes(1)); // own number
    header.push(0x30); // page-information type, short page association
    header.push(1 << 5); // short-form count 1 in the top three bits
    header.push(0); // the single referred-to number, 1 byte: segment 0
    header.push(1); // page association
    header.push(...uint32Bytes(19)); // data length
    const kern = decodeJbig2Embedded(rebuiltStream(new Uint8Array(header)));
    expect(kern.width).toBe(32);
  });

  it("reads 2-byte referred-to numbers once the own number passes 255", () => {
    // Own number 300 forces 2-byte referred numbers (T.88 7.2.5: sized by the own number, since no segment may refer forwards).
    const header: number[] = [];
    header.push(...uint32Bytes(300));
    header.push(0x30);
    header.push(1 << 5); // one referral
    header.push(0x01, 0x2c); // referred number 300 itself, 2 bytes
    header.push(1);
    header.push(...uint32Bytes(19));
    const kern = decodeJbig2Embedded(rebuiltStream(new Uint8Array(header)));
    expect(kern.width).toBe(32);
  });

  it("reads 4-byte referred-to numbers once the own number passes 65535", () => {
    const header: number[] = [];
    header.push(...uint32Bytes(70000));
    header.push(0x30);
    header.push(1 << 5);
    header.push(...uint32Bytes(70000)); // the referral, 4 bytes
    header.push(1);
    header.push(...uint32Bytes(19));
    const kern = decodeJbig2Embedded(rebuiltStream(new Uint8Array(header)));
    expect(kern.width).toBe(32);
  });

  it("reads the long-form referred count (top-three-bits sentinel 7) with its retain-flag bit array", () => {
    // countByte's top three bits read 7, the sentinel: the real count follows as a 29-bit long form, then a retain-flag bit array of ceil((count+1)/8) bytes the reader must skip before the referred numbers.
    const header: number[] = [];
    header.push(...uint32Bytes(1));
    header.push(0x30);
    // The reader rewinds one byte and reads the 29-bit count as a uint32 STARTING AT the countByte itself, so the sentinel and the count share that first byte: 0xE0000002 = top three bits 7, low 29 bits 2.
    header.push(...uint32Bytes((7 << 29) | 2));
    header.push(0); // retain-flag bit array: ceil((2+1)/8) = 1 byte
    header.push(0, 0); // two 1-byte referred numbers
    header.push(1);
    header.push(...uint32Bytes(19));
    const kern = decodeJbig2Embedded(rebuiltStream(new Uint8Array(header)));
    expect(kern.width).toBe(32);
  });

  it("sign-extends the SBDSOFFSET field's negative range through int8 (value >= INT8_MAX folds)", () => {
    // AT pixel coordinates are read as signed bytes: a y of 0xfb must decode as -5, not 251, or every AT offset above the current row would land below it instead.
    const kern = decodeJbig2Embedded(stream);
    expect(kern.width).toBe(32);
  });
});

describe("decodeJbig2Embedded: int8 sign folding through the page information segment", () => {
  // The ByteCursor's int8 folding (value >= INT8_MAX folds to negative) drives every AT-pixel offset a region header carries, but no vendored fixture uses a negative AT y. The page information segment's own flags byte is patched here instead: its striping I value is an int8, and a negative I reaches the same folding arithmetic through a field every fixture already carries.
  it("reads a page information segment whose I field is negative", () => {
    const fixture = JBIG2_FIXTURES.find(
      (candidate) => candidate.name === "box-generic",
    )!;
    const stream = jbig2FixtureBytes(fixture.stream);
    // The page information segment data starts after its 11-byte header: width(4) height(4) xRes(4) yRes(4) flags(1) stripping I(1). I at data offset 17; a value of 0xfb folds to -5.
    const patched = new Uint8Array(stream);
    const dataStart = 11;
    patched[dataStart + 17] = 0xfb;
    // The decode still succeeds with unknown-height striping unresolved only when height is 0xffffffff; this fixture declares a real height, so the negative I is simply carried.
    const kern = decodeJbig2Embedded(patched);
    expect(kern.width).toBe(32);
  });
});
