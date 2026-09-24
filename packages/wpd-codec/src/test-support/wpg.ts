// Shared WPG fixture-building helpers for stream/wpg.test.ts and its split siblings (wpg-primitives.test.ts, wpg-record-framing.test.ts): every fixture is assembled directly from the specification's own field tables, so each expectation is checkable against the page it cites without a real graphic to hand.

// Every fixture below is assembled directly from the specification's own field tables: the 26-byte prefix, the Class/Type/Extension/Length record header, and each record's documented field order — so each expectation is checkable against the page it cites without a real graphic to hand. Single precision (16-bit coordinates) throughout unless a test states otherwise; ppi of 72 makes one coordinate unit one point, keeping the arithmetic the assertions describe transparent.
export const PPI = 72;

export function word(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff];
}

export function dword(value: number): number[] {
  return [...word(value & 0xffff), ...word((value >>> 16) & 0xffff)];
}

// One record header: Class (0x0F, the value every drawing object in these fixtures carries — the class byte selects which of a shadow/extrusion/cap layer a record renders into, and this decoder, like the reference decoders, dispatches on type alone), Type, Extension count, Length.
export function record(
  type: number,
  data: readonly number[],
  extensionCount = 0,
): number[] {
  return [0x0f, type, extensionCount, data.length, ...data];
}

// The Start WPG record's data at single precision: [h units/inch][v units/inch]<precision>[viewport x 4][extent x 4].
export function startWpgData(options: {
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
export function startWpgDataXY(
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
export function wpg(
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

export const NO_TEXT = { foldTextData: () => [] };
