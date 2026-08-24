// A real, complete TrueType font that declares the family "Calibri" -- the one fixture src/commands/convert-fonts.test.ts cannot get any other way. Proving that --font-file beats documents.js's own vendored Carlito substitute needs a font whose family name genuinely matches the family the document asked for (pdf-codec's FontRegistry resolves a caller-supplied face by exact normalized family, so a font declaring anything else would simply never be reached), and no such font is portably available: a system Calibri exists only on machines with Microsoft Office installed, and nothing in this repo or its dependencies ships one.
//
// So it is built rather than found: the vendored Caladea face documents.js already carries is recovered through the public createFontRegistry API, and only its 'name' table is replaced, leaving every outline, metric, and cmap byte of a genuine font untouched. Its PostScript name is set to a deliberately synthetic value, so a PDF's own /BaseFont entry says exactly which face was embedded and can never be confused with either the vendored Carlito substitute or the real Caladea it was cut from.
//
// Table offsets and the 'name' table layout are ISO/IEC 14496-22 clause 4 and clause 5.2.7 respectively -- the same clauses src/runtime/font-face.ts reads, which is deliberate: this builder is that reader's write-side inverse, so a test feeding one into the other proves both against real font bytes rather than against each other's assumptions alone.
import { createFontRegistry } from "documents.js";

// What the fixture font declares as its family: the family the fixture document below also asks for, and the family documents.js's own vendored-substitute table maps to Carlito.
export const FIXTURE_FONT_FAMILY = "Calibri";

// The fixture font's PostScript name, which is what a PDF /BaseFont entry carries (after pdf-codec's own six-letter subset tag). Deliberately not "Calibri" or "Caladea": a test asserting on this string is then asserting on this exact fixture and nothing else.
export const FIXTURE_FONT_POSTSCRIPT_NAME = "DocumentCliTestFace";

const TABLE_DIRECTORY_HEADER_SIZE = 12;
const TABLE_RECORD_SIZE = 16;
const TABLE_TAG_SIZE = 4;

const NAME_HEADER_SIZE = 6;
const NAME_RECORD_SIZE = 12;
const NAME_ID_FAMILY = 1;
const NAME_ID_SUBFAMILY = 2;
const NAME_ID_FULL = 4;
const NAME_ID_POSTSCRIPT = 6;

const PLATFORM_WINDOWS = 3;
const WINDOWS_ENCODING_UNICODE_BMP = 1;
const WINDOWS_LANGUAGE_EN_US = 0x0409;

const SFNT_TABLE_ALIGNMENT = 4;

interface NameEntry {
  readonly nameId: number;
  readonly text: string;
}

function encodeUtf16Be(text: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(text.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < text.length; i++) {
    view.setUint16(i * 2, text.charCodeAt(i));
  }
  return bytes;
}

function decodeTag(view: DataView, offset: number): string {
  let tag = "";
  for (let i = 0; i < TABLE_TAG_SIZE; i++) {
    tag += String.fromCharCode(view.getUint8(offset + i));
  }
  return tag;
}

// A format-0 'name' table carrying only Windows/Unicode-BMP/en-US records -- the platform every font a real caller passes declares, and the first one src/runtime/font-face.ts's own platform preference reaches for.
function buildNameTable(
  entries: readonly NameEntry[],
): Uint8Array<ArrayBuffer> {
  const encoded = entries.map((entry) => ({
    nameId: entry.nameId,
    bytes: encodeUtf16Be(entry.text),
  }));
  const storageOffset = NAME_HEADER_SIZE + encoded.length * NAME_RECORD_SIZE;
  const storageLength = encoded.reduce(
    (total, entry) => total + entry.bytes.length,
    0,
  );

  const table = new Uint8Array(storageOffset + storageLength);
  const view = new DataView(table.buffer);
  view.setUint16(0, 0); // format 0: platform/encoding/language/name records only, no language-tag records
  view.setUint16(2, encoded.length);
  view.setUint16(4, storageOffset);

  let stringOffset = 0;
  for (const [index, entry] of encoded.entries()) {
    const recordOffset = NAME_HEADER_SIZE + index * NAME_RECORD_SIZE;
    view.setUint16(recordOffset, PLATFORM_WINDOWS);
    view.setUint16(recordOffset + 2, WINDOWS_ENCODING_UNICODE_BMP);
    view.setUint16(recordOffset + 4, WINDOWS_LANGUAGE_EN_US);
    view.setUint16(recordOffset + 6, entry.nameId);
    view.setUint16(recordOffset + 8, entry.bytes.length);
    view.setUint16(recordOffset + 10, stringOffset);
    table.set(entry.bytes, storageOffset + stringOffset);
    stringOffset += entry.bytes.length;
  }
  return table;
}

// Appends the replacement table at the (4-byte-aligned) end of the file and repoints the directory's own 'name' record at it, rather than rewriting the whole file's table layout. The original table's bytes stay in place as unreferenced padding, which is legal and invisible: an sfnt reader reaches every table exclusively through the directory's offset/length pair. Table checksums and 'head' checkSumAdjustment are deliberately left stale -- no reader in this family verifies them, and recomputing them would add a second, unrelated piece of format machinery to a fixture builder.
function replaceNameTable(
  font: Uint8Array<ArrayBuffer>,
  nameTable: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  const padding =
    (SFNT_TABLE_ALIGNMENT - (font.length % SFNT_TABLE_ALIGNMENT)) %
    SFNT_TABLE_ALIGNMENT;
  const tableOffset = font.length + padding;

  const patched = new Uint8Array(tableOffset + nameTable.length);
  patched.set(font, 0);
  patched.set(nameTable, tableOffset);

  const view = new DataView(patched.buffer);
  const numTables = view.getUint16(4);
  for (let index = 0; index < numTables; index++) {
    const recordOffset =
      TABLE_DIRECTORY_HEADER_SIZE + index * TABLE_RECORD_SIZE;
    if (decodeTag(view, recordOffset) !== "name") {
      continue;
    }
    view.setUint32(recordOffset + 8, tableOffset);
    view.setUint32(recordOffset + 12, nameTable.length);
    return patched;
  }
  throw new Error(
    "the vendored face this fixture is cut from declares no 'name' table record",
  );
}

// One of the four vendored Caladea faces documents.js already ships, recovered through the only public API that exposes real font bytes: a FontRegistry resolving 'Cambria', which its own vendored-substitute table maps to Caladea. Exported so a test needing a genuine, unmodified font -- one whose own 'name'/'OS/2' tables were written by a real font tool rather than by the builder below -- has one without shipping a font file in this repository.
export function vendoredCaladeaFaceBytes(options: {
  readonly bold: boolean;
  readonly italic: boolean;
}): Uint8Array<ArrayBuffer> {
  const resolved = createFontRegistry().resolve({
    family: "Cambria",
    weight: options.bold ? "bold" : "normal",
    style: options.italic ? "italic" : "normal",
  });
  if (resolved.kind !== "embedded") {
    throw new Error(
      `expected documents.js's vendored substitute table to embed a face for Cambria, got a ${resolved.kind} face`,
    );
  }
  return resolved.face.font.bytes;
}

export function fixtureCalibriFontBytes(): Uint8Array<ArrayBuffer> {
  const nameTable = buildNameTable([
    { nameId: NAME_ID_FAMILY, text: FIXTURE_FONT_FAMILY },
    { nameId: NAME_ID_SUBFAMILY, text: "Regular" },
    { nameId: NAME_ID_FULL, text: `${FIXTURE_FONT_FAMILY} Regular` },
    { nameId: NAME_ID_POSTSCRIPT, text: FIXTURE_FONT_POSTSCRIPT_NAME },
  ]);
  return replaceNameTable(
    vendoredCaladeaFaceBytes({ bold: false, italic: false }),
    nameTable,
  );
}
