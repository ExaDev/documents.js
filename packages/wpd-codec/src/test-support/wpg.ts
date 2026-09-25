// Shared WPG fixture-building helpers for stream/wpg.test.ts and its split siblings (wpg-primitives.test.ts, wpg-record-framing.test.ts): every fixture is assembled directly from the specification's own field tables, so each expectation is checkable against the page it cites without a real graphic to hand.

// Every fixture below is assembled directly from the specification's own field tables: the 26-byte prefix, the Class/Type/Extension/Length record header, and each record's documented field order — so each expectation is checkable against the page it cites without a real graphic to hand. Single precision (16-bit coordinates) throughout unless a test states otherwise; ppi of 72 makes one coordinate unit one point, keeping the arithmetic the assertions describe transparent.
export const PPI = 72;

const BYTE_MASK = 0xff;
const BITS_PER_BYTE = 8;
const UINT16_MASK = 0xffff;
const BITS_PER_UINT16 = 16;

export function word(value: number): number[] {
  return [value & BYTE_MASK, (value >>> BITS_PER_BYTE) & BYTE_MASK];
}

export function dword(value: number): number[] {
  return [
    ...word(value & UINT16_MASK),
    ...word((value >>> BITS_PER_UINT16) & UINT16_MASK),
  ];
}

// One record header: Class (0x0F, the value every drawing object in these fixtures carries — the class byte selects which of a shadow/extrusion/cap layer a record renders into, and this decoder, like the reference decoders, dispatches on type alone), Type, Extension count, Length.
const RECORD_CLASS_DRAWING_OBJECT = 0x0f;

export function record(
  type: number,
  data: readonly number[],
  extensionCount = 0,
): number[] {
  return [
    RECORD_CLASS_DRAWING_OBJECT,
    type,
    extensionCount,
    data.length,
    ...data,
  ];
}

// The default extent this package's fixtures use: an 8x4-inch page at PPI (288pt x 144pt at 72 PPI's own single-precision units).
const DEFAULT_EXTENT_RIGHT = 288;
const DEFAULT_EXTENT_TOP = 144;
const DEFAULT_EXTENT: readonly [number, number, number, number] = [
  0,
  0,
  DEFAULT_EXTENT_RIGHT,
  DEFAULT_EXTENT_TOP,
];
// The single-precision viewport's own maximum coordinate value (a signed 16-bit max), used unconditionally: every fixture here is stepped over by the record's own declared length rather than actually read for its viewport bounds.
const VIEWPORT_MAX = 0x7fff;

// The Start WPG record's data at single precision: [h units/inch][v units/inch]<precision>[viewport x 4][extent x 4].
export function startWpgData(options: {
  readonly ppi?: number;
  readonly extent?: readonly [number, number, number, number];
  readonly precision?: number;
}): number[] {
  const ppi = options.ppi ?? PPI;
  const [left, bottom, right, top] = options.extent ?? DEFAULT_EXTENT;
  return [
    ...word(ppi),
    ...word(ppi),
    options.precision ?? 0,
    ...word(0),
    ...word(0),
    ...word(VIEWPORT_MAX),
    ...word(VIEWPORT_MAX), // the viewport, stepped over by the record's own length
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
  extent: readonly [number, number, number, number] = DEFAULT_EXTENT,
): number[] {
  const [left, bottom, right, top] = extent;
  return [
    ...word(xPpi),
    ...word(yPpi),
    precision,
    ...word(0),
    ...word(0),
    ...word(VIEWPORT_MAX),
    ...word(VIEWPORT_MAX),
    ...word(left),
    ...word(bottom),
    ...word(right),
    ...word(top),
  ];
}

// The -1,"WPC" file ID every WordPerfect-family file (WPD and WPG alike) opens with. The leading byte is the literal value -1 (0xFF) rather than an ASCII character, so only "WPC" itself is derived from its own text.
const FILE_ID_NEGATIVE_ONE_BYTE = 0xff;
const WPG_FILE_ID: readonly number[] = [
  FILE_ID_NEGATIVE_ONE_BYTE,
  ...Array.from("WPC", (c) => c.charCodeAt(0)),
];
const WPG_PREFIX_SIZE = 26;
// Product type 1 selects WPG among the WordPerfect-family file types; file type 0x16 (22) is WPG's own value in the same table WPD's file header shares.
const PRODUCT_TYPE_WPG = 1;
const FILE_TYPE_WPG = 0x16;

// A WPG 2.x graphic: the 26-byte prefix, then the records, with {start of document} pointing past the prefix.
export function wpg(
  records: readonly (readonly number[])[],
  majorVersion = 2,
): Uint8Array {
  const flattened = records.flat();
  const head = [
    ...WPG_FILE_ID,
    ...dword(WPG_PREFIX_SIZE),
    PRODUCT_TYPE_WPG,
    FILE_TYPE_WPG,
    majorVersion,
    0, // minor version
    ...word(0), // encryption key: zero when not encrypted
    ...word(WPG_PREFIX_SIZE), // start of packet data
    0, // entry count
    0, // resource complete
    ...word(0), // start encryption
    ...dword(WPG_PREFIX_SIZE + flattened.length),
    ...word(0), // encryption version
  ];
  return new Uint8Array([...head, ...flattened]);
}

export const NO_TEXT = { foldTextData: () => [] };
