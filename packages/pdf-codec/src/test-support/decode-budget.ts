import { zlibSync } from "fflate";
import type { PdfDecodeBudget } from "../decode-budget";
import { PdfDecodeBudgetError } from "../decode-budget";
import { decodeStream } from "../filters";
import type { PdfObjectResolver } from "../interpret-types";
import type { PdfDict, PdfObject, PdfStream } from "../objects";
import { asDict } from "../objects";
import { enc, FixtureBuilder } from "./pdf";

// Encoders and fixtures for the decode-budget tests: each filter's own encoding of a run of zero bytes (the cheapest input that decodes to many bytes), and documents whose only large decode sits at one named site.

/**
 * A run of zero bytes, FlateDecode-encoded: a few hundred bytes of input for a megabyte of output.
 * @param size - the decoded length
 * @returns the zlib-framed stream
 */
export function flateZeros(size: number): Uint8Array<ArrayBuffer> {
  return zlibSync(new Uint8Array(size));
}

// RunLengthDecode's longest repeat run (ISO 32000-1 7.4.5): a length byte of 129 repeats the next byte 257 - 129 = 128 times.
const RUN_LENGTH_LONGEST_REPEAT = 128;
const RUN_LENGTH_REPEAT_BASE = 257;
const RUN_LENGTH_EOD = 128;

/**
 * A run of zero bytes, RunLengthDecode-encoded as repeat runs, then the end-of-data marker.
 * @param size - the decoded length
 * @returns the encoded bytes
 */
export function runLengthZeros(size: number): Uint8Array<ArrayBuffer> {
  const out: number[] = [];
  for (let left = size; left > 0; left -= RUN_LENGTH_LONGEST_REPEAT) {
    const run = Math.min(left, RUN_LENGTH_LONGEST_REPEAT);
    if (run === 1) {
      out.push(0, 0); // a one-byte literal run: length byte 0, then the byte
    } else {
      out.push(RUN_LENGTH_REPEAT_BASE - run, 0);
    }
  }
  out.push(RUN_LENGTH_EOD);
  return new Uint8Array(out);
}

// ASCII85's 'z' stands for a whole group of four zero bytes.
const ASCII85_GROUP_BYTES = 4;

/**
 * A run of zero bytes, ASCII85Decode-encoded with 'z' groups (and `!` digits for a final partial group), ending in the "~" end-of-data marker and its closing bracket.
 * @param size - the decoded length
 * @returns the encoded bytes
 */
export function ascii85Zeros(size: number): Uint8Array<ArrayBuffer> {
  const groups = Math.floor(size / ASCII85_GROUP_BYTES);
  const rest = size % ASCII85_GROUP_BYTES;
  // A partial group of n bytes is written as n + 1 digits; zero bytes are all '!' digits.
  const tail = rest === 0 ? "" : "!".repeat(rest + 1);
  return enc(`${"z".repeat(groups)}${tail}~>`);
}

/**
 * A run of zero bytes, ASCIIHexDecode-encoded, ending in the end-of-data bracket.
 * @param size - the decoded length
 * @returns the encoded bytes
 */
export function asciiHexZeros(size: number): Uint8Array<ArrayBuffer> {
  return enc(`${"00".repeat(size)}>`);
}

const LZW_CLEAR = 256;
const LZW_EOD = 257;
const LZW_FIRST_CODE = 258;
const LZW_MAX_WIDTH = 12;
const LZW_INITIAL_WIDTH = 9;
const BITS_PER_BYTE = 8;
const BYTE_MASK = 0xff;

/**
 * Any bytes, LZWDecode-encoded with /EarlyChange 1 (the default): a clear code, the codes, then end-of-data, with the code width growing one code early as ISO 32000-1 7.4.4 describes and the table cleared before it would pass twelve bits.
 * @param data - the bytes to encode
 * @returns the encoded bytes
 */
export function lzwEncode(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const out: number[] = [];
  let bitBuffer = 0;
  let bitCount = 0;
  let width = LZW_INITIAL_WIDTH;
  const write = (code: number): void => {
    bitBuffer = (bitBuffer << width) | code;
    bitCount += width;
    while (bitCount >= BITS_PER_BYTE) {
      bitCount -= BITS_PER_BYTE;
      out.push((bitBuffer >>> bitCount) & BYTE_MASK);
    }
    bitBuffer &= (1 << bitCount) - 1;
  };
  let table = new Map<string, number>();
  let next = LZW_FIRST_CODE;
  const reset = (): void => {
    table = new Map();
    for (let i = 0; i < LZW_FIRST_CODE - 2; i++) {
      table.set(String.fromCharCode(i), i);
    }
    next = LZW_FIRST_CODE;
    width = LZW_INITIAL_WIDTH;
  };
  write(LZW_CLEAR);
  reset();
  let current = "";
  for (const byte of data) {
    const extended = current + String.fromCharCode(byte);
    if (table.has(extended)) {
      current = extended;
      continue;
    }
    write(table.get(current)!);
    table.set(extended, next);
    next++;
    // The decoder's table runs one entry behind the encoder's, and with EarlyChange it widens once its own next code is 2^width - 1, so the encoder widens once its next code reaches 2^width: both then switch before the same code.
    if (next >= 1 << width) {
      if (width === LZW_MAX_WIDTH) {
        write(LZW_CLEAR);
        reset();
      } else {
        width++;
      }
    }
    current = String.fromCharCode(byte);
  }
  if (current !== "") {
    write(table.get(current)!);
  }
  write(LZW_EOD);
  if (bitCount > 0) {
    out.push((bitBuffer << (BITS_PER_BYTE - bitCount)) & BYTE_MASK);
  }
  return new Uint8Array(out);
}

/**
 * A full `PdfObjectResolver` over hand-built objects whose decodeStream charges `budget`, naming each stream by the object number `objects` holds it under: what a document opened with `maxDecodedBytes` does, for a test that calls one reader directly.
 * @param objects - the document's objects by number
 * @param budget - the budget every decode is charged against
 * @returns the resolver
 */
export function budgetedResolver(
  objects: ReadonlyMap<number, PdfObject>,
  budget: PdfDecodeBudget,
): PdfObjectResolver {
  const numbers = new Map<PdfDict, number>();
  for (const [num, obj] of objects) {
    if (obj.kind === "stream") {
      numbers.set(obj.dict, num);
    }
  }
  const resolve = (obj: PdfObject | undefined): PdfObject | undefined =>
    obj?.kind === "ref" ? objects.get(obj.num) : obj;
  const objectNumberOf = (stream: PdfStream): number | undefined =>
    numbers.get(stream.dict);
  return {
    resolve,
    resolveDict: (obj) => asDict(resolve(obj)),
    decodeStream: (stream, sink) =>
      decodeStream(stream.raw, stream.dict, sink, {
        resolve,
        budget,
        objectNumber: objectNumberOf(stream),
        objectNumberOf,
      }),
    chargeDecodedBytes: (stream, bytes) => {
      budget.charge(bytes, {
        objectNumber: objectNumberOf(stream),
        filters: [],
      });
    },
  };
}

// A cross-reference stream row's fixed width here, /W [1 4 2]: a type byte, a four-byte offset or object stream number, and a two-byte generation or index.
const XREF_ROW_BYTES = 7;
const XREF_OFFSET_BYTES = 4;
const XREF_TYPE_OFFSET = 1;
const XREF_TYPE_COMPRESSED = 2;
/** The object stream's object number in the documents objectStreamPdf builds. */
export const OBJECT_STREAM_OBJ = 10;
/** The cross-reference stream's object number in the documents objectStreamPdf builds. */
export const XREF_STREAM_OBJ = 11;
const CONTENT_STREAM_OBJ = 4;

function bigEndian(value: number, width: number): number[] {
  return Array.from(
    { length: width },
    (_, i) => (value >>> ((width - 1 - i) * BITS_PER_BYTE)) & BYTE_MASK,
  );
}

/**
 * A one-page document whose catalog, page tree and page live in a FlateDecode object stream, located by a cross-reference stream, with optional zero padding decoded after each: the object stream's padding follows its objects, so the objects still parse, and the cross-reference stream's follows its rows, which the reader never reaches. With `brokenStartxref` the startxref offset points nowhere, so the reader recovers the table by scanning for objects, which decodes the object stream during the scan.
 * @param objectStreamPadding - the zero bytes the object stream decodes to after its objects
 * @param xrefStreamPadding - the zero bytes the cross-reference stream decodes to after its rows
 * @param brokenStartxref - whether startxref names a nonsense offset
 * @returns the document
 */
export function objectStreamPdf(
  objectStreamPadding: number,
  xrefStreamPadding: number,
  brokenStartxref = false,
): Uint8Array<ArrayBuffer> {
  const bodies = [
    { num: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { num: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
    {
      num: 3,
      body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents ${String(CONTENT_STREAM_OBJ)} 0 R >>`,
    },
  ];
  let data = "";
  const offsets: number[] = [];
  for (const { body } of bodies) {
    offsets.push(data.length);
    data += `${body} `;
  }
  const header = bodies
    .map(({ num }, i) => `${String(num)} ${String(offsets[i])}`)
    .join(" ");
  const text = enc(`${header}\n${data}`);
  const decoded = new Uint8Array(text.length + objectStreamPadding);
  decoded.set(text);

  const b = new FixtureBuilder().header("1.5");
  b.stream(
    OBJECT_STREAM_OBJ,
    `<< /Type /ObjStm /N ${String(bodies.length)} /First ${String(header.length + 1)} /Filter /FlateDecode >>`,
    zlibSync(decoded),
  );
  b.stream(CONTENT_STREAM_OBJ, "<< >>", enc("0 0 1 1 re f"));
  const rows: number[][] = [new Array<number>(XREF_ROW_BYTES).fill(0)];
  for (let num = 1; num <= XREF_STREAM_OBJ; num++) {
    const inStream = bodies.findIndex((entry) => entry.num === num);
    if (inStream >= 0) {
      rows.push([
        XREF_TYPE_COMPRESSED,
        ...bigEndian(OBJECT_STREAM_OBJ, XREF_OFFSET_BYTES),
        0,
        inStream,
      ]);
    } else if (num === OBJECT_STREAM_OBJ || num === CONTENT_STREAM_OBJ) {
      rows.push([
        XREF_TYPE_OFFSET,
        ...bigEndian(b.offsetOf(num), XREF_OFFSET_BYTES),
        0,
        0,
      ]);
    } else if (num === XREF_STREAM_OBJ) {
      rows.push([
        XREF_TYPE_OFFSET,
        ...bigEndian(b.length, XREF_OFFSET_BYTES),
        0,
        0,
      ]);
    } else {
      rows.push(new Array<number>(XREF_ROW_BYTES).fill(0));
    }
  }
  const xrefOffset = b.length;
  const table = new Uint8Array(
    rows.length * XREF_ROW_BYTES + xrefStreamPadding,
  );
  rows.forEach((row, i) => {
    table.set(row, i * XREF_ROW_BYTES);
  });
  b.stream(
    XREF_STREAM_OBJ,
    `<< /Type /XRef /Size ${String(rows.length)} /W [1 4 2] /Root 1 0 R /Filter /FlateDecode >>`,
    zlibSync(table),
  );
  b.raw(`startxref\n${String(brokenStartxref ? 999_999 : xrefOffset)}\n%%EOF`);
  return b.bytes();
}

// JPEG markers (ITU-T T.81 Table B.1): start of image, a baseline start-of-frame, end of image.
const JPEG_SOI = [0xff, 0xd8];
const JPEG_SOF0 = [0xff, 0xc0];
const JPEG_EOI = [0xff, 0xd9];
const JPEG_PRECISION = 8;
const JPEG_COMPONENT_SPEC_BYTES = 3;
const JPEG_SOF_FIXED_BYTES = 8;
const JPEG_SAMPLING_1X1 = 0x11;

/**
 * The header of a baseline JPEG declaring a frame size, with no scan data: enough for a reader that only reads the frame header, which is all a JPEG passed through undecoded gets.
 * @param width - the declared width in pixels
 * @param height - the declared height in pixels
 * @param components - the declared component count
 * @returns the bytes
 */
export function jpegHeader(
  width: number,
  height: number,
  components: number,
): Uint8Array<ArrayBuffer> {
  const length = JPEG_SOF_FIXED_BYTES + components * JPEG_COMPONENT_SPEC_BYTES;
  const specs: number[] = [];
  for (let id = 1; id <= components; id++) {
    specs.push(id, JPEG_SAMPLING_1X1, 0);
  }
  return new Uint8Array([
    ...JPEG_SOI,
    ...JPEG_SOF0,
    ...bigEndian(length, 2),
    JPEG_PRECISION,
    ...bigEndian(height, 2),
    ...bigEndian(width, 2),
    components,
    ...specs,
    ...JPEG_EOI,
  ]);
}

/** The decoded size the decode-budget tests' large streams expand to. */
export const LARGE = 1 << 20;
/** The budget the decode-budget tests set: a sixteenth of LARGE, so a site that decodes without charging reads to the end instead of throwing. */
export const BUDGET = LARGE / 16;

/**
 * Runs `run` and returns the PdfDecodeBudgetError it throws, checking it names `objectNumber` (and `filters`, when given).
 * @param run - the read or decode expected to be refused
 * @param objectNumber - the object number the error must name
 * @param filters - the filter chain the error must name
 * @returns the error
 * @throws Error when `run` throws anything else, throws nothing, or the error names another stream
 */
export function expectBudgetError(
  run: () => unknown,
  objectNumber: number | undefined,
  filters?: readonly string[],
): PdfDecodeBudgetError {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  if (!(caught instanceof PdfDecodeBudgetError)) {
    throw new Error(`expected a PdfDecodeBudgetError, got ${String(caught)}`);
  }
  if (caught.code !== "pdf/decode-budget-exceeded") {
    throw new Error(`unexpected code ${caught.code}`);
  }
  if (caught.objectNumber !== objectNumber) {
    throw new Error(
      `expected object ${String(objectNumber)}, got ${String(caught.objectNumber)}`,
    );
  }
  if (filters !== undefined && caught.filters.join() !== filters.join()) {
    throw new Error(
      `expected filters ${filters.join()}, got ${caught.filters.join()}`,
    );
  }
  return caught;
}

// --- Whole documents: each fixture puts its one large decode at a single site. ---

export const FLATE_ZEROS = flateZeros(LARGE);
export const BIG = "<< /Filter /FlateDecode >>";
export const BIG_OBJ = 9;

export interface SiteFixture {
  readonly pageResources?: string;
  readonly content?: string;
  readonly catalogExtra?: string;
  readonly objects?: (b: FixtureBuilder) => void;
  readonly maxObj?: number;
}

// Writes a null object for every number up to `maxObj` a fixture left unused, so its classic cross-reference table has an entry for each.
export function fillUnused(b: FixtureBuilder, maxObj: number): void {
  for (let num = 1; num <= maxObj; num++) {
    try {
      b.offsetOf(num);
    } catch {
      b.object(num, "null");
    }
  }
}

// Catalog 1, page tree 2, page 3, content 5, then whatever the site adds (object 9 is the large stream in every fixture that has one).
export function sitePdf(site: SiteFixture): Uint8Array<ArrayBuffer> {
  const b = new FixtureBuilder().header("1.7");
  b.object(1, `<< /Type /Catalog /Pages 2 0 R ${site.catalogExtra ?? ""} >>`);
  b.object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  b.object(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << ${site.pageResources ?? ""} >> /Contents 5 0 R >>`,
  );
  b.stream(5, "<< >>", enc(site.content ?? ""));
  site.objects?.(b);
  fillUnused(b, site.maxObj ?? 5);
  b.classicXrefAndTrailer(site.maxObj ?? 5, "/Root 1 0 R");
  return b.bytes();
}

export function bigStream(b: FixtureBuilder, num = BIG_OBJ): void {
  b.stream(num, BIG, FLATE_ZEROS);
}

export const SHOW_TEXT = "BT /F1 12 Tf 10 50 Td (A) Tj ET";
export const TO_UNICODE_PRIVATE_USE = enc(
  "/CIDInit /ProcSet findresource begin begincmap 1 begincodespacerange <00> <FF> endcodespacerange 1 beginbfchar <41> <F041> endbfchar endcmap end",
);

// A page whose /Contents array holds a small stream and a large one (object 6).
export function contentSitePdf(): Uint8Array<ArrayBuffer> {
  const b = new FixtureBuilder().header("1.7");
  b.object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  b.object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  b.object(
    3,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << >> /Contents [5 0 R 6 0 R] >>",
  );
  b.stream(5, "<< >>", enc("0 0 1 1 re f"));
  bigStream(b, 6);
  fillUnused(b, 6);
  b.classicXrefAndTrailer(6, "/Root 1 0 R");
  return b.bytes();
}
