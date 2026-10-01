import { JBIG2_FIXTURES, type Jbig2Fixture } from "./jbig2";

export function fixtureByName(name: string): Jbig2Fixture {
  const fixture = JBIG2_FIXTURES.find((candidate) => candidate.name === name);
  if (fixture === undefined) {
    throw new Error(`no JBIG2 fixture named ${name}`);
  }
  return fixture;
}

// Renders a decoded, packed 1-bit-per-pixel bitmap as one string per row so a failure shows the actual picture rather than a byte index. A 1 bit is black, JBIG2's own polarity, which is what decodeJbig2Embedded produces.
export function renderRows(
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

export function u16Bytes(value: number): number[] {
  return [(value >> 8) & 0xff, value & 0xff];
}

export function u32Bytes(value: number): number[] {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ];
}

export function jbig2Stream(
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

export interface CraftedSegment {
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

export function segment(spec: CraftedSegment): number[] {
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
export function pageInformation(
  width: number,
  height: number,
  flags = 0,
): number[] {
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
export function regionInfo(
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

export function withPatchedByte(
  stream: Uint8Array<ArrayBuffer>,
  offset: number,
  value: number,
): Uint8Array<ArrayBuffer> {
  const patched = new Uint8Array(stream);
  patched[offset] = value;
  return patched;
}
