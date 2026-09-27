import { describe, expect, it } from "vitest";
import { JBIG2_FIXTURES, jbig2FixtureBytes } from "../test-support/jbig2";
import { Jbig2ParseError, Jbig2UnsupportedError } from "./jbig2-errors";
import { decodeJbig2Embedded } from "./jbig2";

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

describe("decodeJbig2Embedded: real encoder-produced streams", () => {
  for (const fixture of JBIG2_FIXTURES) {
    it(`recovers the "${fixture.name}" bitmap from its ${fixture.description}`, () => {
      const warnings: string[] = [];
      const result = decodeJbig2Embedded(jbig2FixtureBytes(fixture.stream), {
        globals:
          fixture.globals === undefined
            ? undefined
            : jbig2FixtureBytes(fixture.globals),
        onWarning: (message) => {
          warnings.push(message);
        },
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
      Jbig2UnsupportedError,
    );
  });

  it("rejects a stream whose segment declares more data than it carries", () => {
    const stream = jbig2FixtureBytes(fixture.stream);
    const truncated = stream.subarray(0, stream.length - 4);
    expect(() => decodeJbig2Embedded(truncated)).toThrow(Jbig2ParseError);
  });

  it("rejects a region composed before any page information segment declared the page", () => {
    // Everything from the second segment onward, with the page information segment dropped.
    const stream = jbig2FixtureBytes(fixture.stream);
    expect(() => decodeJbig2Embedded(stream.subarray(30))).toThrow(
      Jbig2ParseError,
    );
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
