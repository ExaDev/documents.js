// Corel's own worked example, transcribed byte for byte: the "Example of Generic Header (hex dump)" under WPFF Document Structure, "Generic File Prefix". Every structural number the reader derives is checkable against the prose on that same page -- the file is 745 bytes, the document area begins at 718, the index area begins at 512 and holds five index slots of which the first is the index header, and the document area's first two functions are the Global On (0xDD0A) and Global Off (0xDD0B) style codes that make a document's Open Style well formed.
//
// This is the single most valuable fixture available for this codec: it is the format's own author demonstrating a conforming file, so a parser that agrees with it agrees with WordPerfect rather than with this package's reading of the prose.
//
// https://github.com/OneWingedShark/WordPerfect/blob/master/doc/SDK_Help/FileFormats/WPFF_DocumentStructure.htm

// The dump's non-zero lines, keyed by their offset. Offsets 32..511 are the extended header's zero fill, which the builder writes rather than this table restating thirty identical lines.
const GENERIC_HEADER_LINES: readonly (readonly [number, string])[] = [
  [0, "FF 57 50 43 CE 02 00 00 01 0A 02 01 00 00 00 02"],
  [16, "05 00 00 00 E9 02 00 00 00 00 00 00 00 00 00 00"],
  [512, "02 00 05 00 00 00 00 00 00 00 00 00 00 00 00 55"],
  [528, "01 00 00 00 4E 00 00 00 46 02 00 00 09 25 01 00"],
  [544, "00 00 06 00 00 00 94 02 00 00 0B 30 02 00 00 00"],
  [560, "28 00 00 00 9A 02 00 00 08 5E 01 00 00 00 0C 00"],
  [576, "00 00 C2 02 00 00 28 00 D6 1E C3 0F 39 08 00 00"],
  [592, "11 09 00 00 00 5A 00 1B 01 00 8B 14 36 00 54 00"],
  [608, "69 00 6D 00 65 00 73 00 20 00 4E 00 65 00 77 00"],
  [624, "20 00 52 00 6F 00 6D 00 61 00 6E 00 20 00 52 00"],
  [640, "65 00 67 00 75 00 6C 00 61 00 72 00 00 00 00 00"],
  [656, "00 00 00 00 01 00 01 00 58 02 01 00 00 00 04 00"],
  [672, "28 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00"],
  [688, "00 00 00 00 01 12 02 00 24 00 A1 00 00 00 A1 00"],
  [704, "00 00 50 A5 4E 25 00 00 00 00 00 00 08 00 DD 0A"],
  [720, "10 00 83 01 03 00 03 00 02 00 21 10 00 DD DD 0B"],
  [736, "0B 00 03 00 00 04 0B 00 DD"],
];

// The file size the header's own {file size} long states, and the length of the dump.
export const GENERIC_HEADER_SIZE = 745;

// The offsets the SDK's prose states in words, restated here so a test asserts against the documentation rather than against whatever the parser happens to compute.
export const GENERIC_HEADER_DOCUMENT_AREA_OFFSET = 718;
export const GENERIC_HEADER_INDEX_AREA_OFFSET = 512;

export function genericHeaderBytes(): Uint8Array {
  const bytes = new Uint8Array(GENERIC_HEADER_SIZE);
  for (const [offset, line] of GENERIC_HEADER_LINES) {
    const values = line.split(" ").map((token) => Number.parseInt(token, 16));
    bytes.set(values, offset);
  }
  return bytes;
}
