// The RC4 and XOR-encryption suites split from content.test.ts, restating its harness verbatim.

import {
  createXorObfuscationArray,
  createXorObfuscationKey,
  createXorObfuscationPasswordVerifier,
  decryptOfficeRc4,
  decryptXorObfuscationMethod1,
  deriveOfficeRc4BaseHash,
  md5,
  XOR_OBFUSCATION_ARRAY_LENGTH,
  XOR_OBFUSCATION_ROTATE_DISTANCE_METHOD1,
} from "archive-codec";
import {} from "document-schema.js";
import { describe, expect, it } from "vitest";

import {
  BOF_TYPE_CHART,
  BOF_TYPE_WORKBOOK,
  BOF_TYPE_WORKSHEET,
  RECORD_BOF,
  RECORD_BOUNDSHEET8,
  RECORD_EOF,
  RECORD_FILEPASS,
  RECORD_COLINFO,
  RECORD_NUMBER,
  RECORD_XF,
} from "./biff/record-types";
import { BiffFormatError } from "./biff/records";
import {} from "./container";
import { readXlsContent } from "./content";
import {
  bofData,
  cell,
  cellXfTrailer,
  concat,
  f64,
  record,
  shortXlUnicodeString,
  u16,
  u32,
} from "./test-support/biff";
import { compoundFile } from "./test-support/cfb";
import {} from "./test-support/escher";

// End-to-end: a genuine [MS-CFB] compound file holding a hand-built BIFF8 record stream, read the whole way through to a ContentDocument. Every byte sequence is assembled from the field layouts [MS-XLS] specifies, so a failure here points at this package's reading of the specification rather than at a captured file's quirks.

/** Assembles a workbook stream: the globals substream, then one worksheet substream per sheet, and reports where each sheet's BOF landed so BoundSheet8 can name it. */
function workbookStream(options: {
  globals: readonly Uint8Array<ArrayBuffer>[];
  sheets: readonly {
    name: string;
    records: readonly Uint8Array<ArrayBuffer>[];
    /** BoundSheet8's own dt field; 0x00 (a worksheet) unless a test needs otherwise. */
    sheetType?: number;
  }[];
}): Uint8Array<ArrayBuffer> {
  // Built in two passes, because BoundSheet8's lbPlyPos has to name a byte offset that only exists once the globals substream's own length is known — and that length depends on the BoundSheet8 records themselves. The first pass measures with placeholder offsets, the second writes the real ones; both produce identically sized records, so the measurement holds.
  const build = (offsets: readonly number[]): Uint8Array<ArrayBuffer> => {
    const boundSheets = options.sheets.map((sheet, index) =>
      record(RECORD_BOUNDSHEET8, [
        ...u32(offsets[index] ?? 0),
        0x00,
        sheet.sheetType ?? 0x00,
        ...shortXlUnicodeString(sheet.name),
      ]),
    );
    const globals = concat(
      record(RECORD_BOF, bofData(BOF_TYPE_WORKBOOK)),
      ...options.globals,
      ...boundSheets,
      record(RECORD_EOF, []),
    );
    const sheetStreams = options.sheets.map((sheet) =>
      concat(
        record(RECORD_BOF, bofData(BOF_TYPE_WORKSHEET)),
        ...sheet.records,
        record(RECORD_EOF, []),
      ),
    );
    return concat(globals, ...sheetStreams);
  };

  const measured = build(options.sheets.map(() => 0));
  const globalsLength =
    measured.length -
    options.sheets.reduce((sum, sheet) => {
      const stream = concat(
        record(RECORD_BOF, bofData(BOF_TYPE_WORKSHEET)),
        ...sheet.records,
        record(RECORD_EOF, []),
      );
      return sum + stream.length;
    }, 0);

  let offset = globalsLength;
  const offsets: number[] = [];
  for (const sheet of options.sheets) {
    offsets.push(offset);
    offset += concat(
      record(RECORD_BOF, bofData(BOF_TYPE_WORKSHEET)),
      ...sheet.records,
      record(RECORD_EOF, []),
    ).length;
  }
  return build(offsets);
}

/** Wraps a workbook stream in the compound-file container a real .xls carries it in. */
function xlsFile(stream: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  return compoundFile([{ path: "Workbook", bytes: stream }]);
}

/** Adds a real `"\x05SummaryInformation"` stream beside an .xls file's existing streams — composed with archive-codec's own writeSummaryInformationStream/writeCompoundFile rather than by extending xlsFile, which stays a pure BIFF8-only fixture builder. */

/** The fifteen style XFs a real file writes before its first cell XF, so a cell's own ixfe of 15 lands on the first cell format — which is what [MS-XLS] 2.5.168 requires of an ixfe. Every cell XF here carries an undecorated trailing payload; xfTableWithDecoration below is the sibling a decoration test builds its own cell XF through instead. */
function xfTable(...cellFormats: readonly number[]): Uint8Array<ArrayBuffer>[] {
  const styles = Array.from({ length: 15 }, () =>
    record(RECORD_XF, [
      ...u16(0),
      ...u16(0),
      ...u16(0x0004),
      ...cellXfTrailer(),
    ]),
  );
  const cells = cellFormats.map((formatId) =>
    record(RECORD_XF, [
      ...u16(0),
      ...u16(formatId),
      ...u16(0),
      ...cellXfTrailer(),
    ]),
  );
  return [...styles, ...cells];
}

/** A Font record ([MS-XLS] 2.4.122) with an uncompressed fontName — the record's own "fontName.fHighByte MUST equal 1" rule — for a test driving the per-cell font reader. Every field left absent carries the spec's own default shape (Arial at 10pt/200 twips, no flags, Automatic colour, normal weight, no underline). */

/** As xfTable, but the single cell XF this builds references the given font index rather than font 0 — for a test exercising per-cell fonts. */

describe("RC4-encrypted workbooks", () => {
  const PASSWORD = "correct horse";
  const SALT = new Uint8Array(16).map((_, index) => index * 7 + 1);
  const FILEPASS_HEADER_LENGTH = 2 + 2 + 2 + 16 + 16 + 16;

  // [MS-XLS] 2.2.10's own excluded-record set and the BoundSheet8 lbPlyPos exception, re-derived here independently of workbook/encryption.ts rather than imported from it — so a round trip through readXlsContent actually exercises that module's own understanding of the spec, rather than a test built from its own exclusion list vacuously agreeing with itself.
  const NEVER_ENCRYPTED_TYPES = new Set([
    RECORD_BOF,
    RECORD_FILEPASS,
    0x0194, // UsrExcl
    0x0195, // FileLock
    0x00e1, // InterfaceHdr
    0x0196, // RRDInfo
    0x0138, // RRDHead
  ]);

  /** Parses a stream's own records with their absolute offsets, independently of biff/records.ts, for the same reason above. */
  function parseForEncryption(stream: Uint8Array<ArrayBuffer>): {
    type: number;
    offset: number;
    data: Uint8Array<ArrayBuffer>;
  }[] {
    const view = new DataView(
      stream.buffer,
      stream.byteOffset,
      stream.byteLength,
    );
    const records = [];
    let offset = 0;
    while (offset < stream.length) {
      const type = view.getUint16(offset, true);
      const size = view.getUint16(offset + 2, true);
      const dataStart = offset + 4;
      records.push({
        type,
        offset,
        data: stream.slice(dataStart, dataStart + size),
      });
      offset = dataStart + size;
    }
    return records;
  }

  /**
   * Takes a plaintext workbook stream already carrying a same-length FilePass placeholder record (so every BoundSheet8 lbPlyPos workbookStream computed already accounts for its real size) and turns it into a genuinely RC4-encrypted one: real FilePass header fields in place of the placeholder, and every other record's data encrypted per [MS-XLS] 2.2.10's own rules. RC4's XOR symmetry makes "encrypt" and "decrypt" literally the same operation, so this reuses decryptOfficeRc4 — the same primitive readXlsContent decrypts with — rather than a separate encryption routine; the two directions cancelling out is exactly what makes RC4 what it is, not a shortcut that only looks like a round trip.
   */
  function encryptWorkbookStream(
    plainStreamWithPlaceholder: Uint8Array<ArrayBuffer>,
    password: string,
    salt: Uint8Array<ArrayBuffer>,
  ): Uint8Array<ArrayBuffer> {
    const baseHash = deriveOfficeRc4BaseHash(password, salt);
    const verifier = new Uint8Array(16).map((_, index) => index * 3 + 11);
    const verifierHash = md5(verifier);
    const encryptedVerifier = decryptOfficeRc4(baseHash, 0, verifier);
    const encryptedVerifierHash = decryptOfficeRc4(baseHash, 16, verifierHash);
    const filePassData = new Uint8Array(FILEPASS_HEADER_LENGTH);
    const filePassView = new DataView(filePassData.buffer);
    filePassView.setUint16(0, 0x0001, true); // wEncryptionType: RC4
    filePassView.setUint16(2, 1, true); // vMajor
    filePassView.setUint16(4, 1, true); // vMinor
    filePassData.set(salt, 6);
    filePassData.set(encryptedVerifier, 22);
    filePassData.set(encryptedVerifierHash, 38);

    const parts: Uint8Array<ArrayBuffer>[] = [];
    for (const rec of parseForEncryption(plainStreamWithPlaceholder)) {
      let data: Uint8Array<ArrayBuffer>;
      if (rec.type === RECORD_FILEPASS) {
        data = filePassData;
      } else if (NEVER_ENCRYPTED_TYPES.has(rec.type)) {
        data = rec.data;
      } else if (rec.type === RECORD_BOUNDSHEET8) {
        const lbPlyPos = rec.data.subarray(0, 4);
        const rest = decryptOfficeRc4(
          baseHash,
          rec.offset + 4 + 4,
          rec.data.subarray(4),
        );
        data = new Uint8Array(rec.data.length);
        data.set(lbPlyPos, 0);
        data.set(rest, 4);
      } else {
        data = decryptOfficeRc4(baseHash, rec.offset + 4, rec.data);
      }
      parts.push(record(rec.type, [...data]));
    }
    return concat(...parts);
  }

  function encryptedXlsFile(
    globals: readonly Uint8Array<ArrayBuffer>[],
    sheets: Parameters<typeof workbookStream>[0]["sheets"],
    password = PASSWORD,
    salt = SALT,
  ): Uint8Array<ArrayBuffer> {
    const placeholder = record(
      RECORD_FILEPASS,
      new Array<number>(FILEPASS_HEADER_LENGTH).fill(0),
    );
    const plain = workbookStream({
      globals: [placeholder, ...globals],
      sheets,
    });
    return xlsFile(encryptWorkbookStream(plain, password, salt));
  }

  it("refuses an encrypted workbook when no password is given", () => {
    const bytes = encryptedXlsFile(xfTable(0), [
      { name: "Sheet1", records: [] },
    ]);

    expect(() => readXlsContent(bytes)).toThrow(BiffFormatError);
  });

  it("refuses an encrypted workbook given the wrong password", () => {
    const bytes = encryptedXlsFile(xfTable(0), [
      { name: "Sheet1", records: [] },
    ]);

    expect(() => readXlsContent(bytes, "the wrong password")).toThrow(
      BiffFormatError,
    );
  });

  it("decrypts an encrypted workbook given the correct password", () => {
    const bytes = encryptedXlsFile(xfTable(0), [
      {
        name: "Sheet1",
        records: [record(RECORD_NUMBER, [...cell(0, 0), ...f64(42)])],
      },
    ]);

    const content = readXlsContent(bytes, PASSWORD);

    expect(content.sheets[0]?.name).toBe("Sheet1");
    expect(content.sheets[0]?.cells[0]).toMatchObject({
      row: 0,
      column: 0,
      value: { kind: "number", value: 42 },
    });
  });

  it("decrypts correctly across a 1024-byte RC4 block boundary", () => {
    // A run of NUMBER records padding the sheet substream well past the first 1024-byte block, so the sheet's later cells only decrypt correctly if decryptOfficeRc4's per-block re-keying is wired up right, not just its first block.
    const paddingCells = Array.from({ length: 80 }, (_, index) =>
      record(RECORD_NUMBER, [...cell(index, 0), ...f64(index)]),
    );
    const bytes = encryptedXlsFile(xfTable(0), [
      {
        name: "Sheet1",
        records: [
          ...paddingCells,
          record(RECORD_NUMBER, [...cell(80, 0), ...f64(999)]),
        ],
      },
    ]);

    const content = readXlsContent(bytes, PASSWORD);

    expect(content.sheets[0]?.cells[0]).toMatchObject({
      value: { kind: "number", value: 0 },
    });
    expect(content.sheets[0]?.cells[80]).toMatchObject({
      value: { kind: "number", value: 999 },
    });
  });
});

describe("XOR-obfuscated workbooks", () => {
  const PASSWORD = "123456789012345";
  const FILEPASS_HEADER_LENGTH = 2 + 2 + 2;

  // Re-derived independently of workbook/encryption.ts, same rationale as the RC4 suite above.
  const NEVER_ENCRYPTED_TYPES = new Set([
    RECORD_BOF,
    RECORD_FILEPASS,
    0x0194, // UsrExcl
    0x0195, // FileLock
    0x00e1, // InterfaceHdr
    0x0196, // RRDInfo
    0x0138, // RRDHead
  ]);

  /** Parses a stream's own records with their absolute offsets, independently of biff/records.ts — shares the RC4 suite's own approach above, but duplicated locally since that one is scoped inside the sibling describe block. */
  function parseForEncryption(stream: Uint8Array<ArrayBuffer>): {
    type: number;
    offset: number;
    data: Uint8Array<ArrayBuffer>;
  }[] {
    const view = new DataView(
      stream.buffer,
      stream.byteOffset,
      stream.byteLength,
    );
    const records = [];
    let offset = 0;
    while (offset < stream.length) {
      const type = view.getUint16(offset, true);
      const size = view.getUint16(offset + 2, true);
      const dataStart = offset + 4;
      records.push({
        type,
        offset,
        data: stream.slice(dataStart, dataStart + size),
      });
      offset = dataStart + size;
    }
    return records;
  }

  /** [MS-XLS] 2.2.10's own XorArrayIndex rule, matching workbook/encryption.ts's own xorArrayIndexFor — re-derived here rather than imported, same rationale as the RC4 suite's own encryptWorkbookStream. */
  function xorArrayIndexFor(
    spanOffset: number,
    recordDataLength: number,
  ): number {
    return (spanOffset + recordDataLength) % XOR_OBFUSCATION_ARRAY_LENGTH;
  }

  /**
   * Method 1's own encrypt direction: the inverse of decryptXorObfuscationMethod1's rotate-then-XOR (XOR first, then rotate right 3) — independently derived and confirmed (in a scratch script, not against this package's own code) to reproduce a genuine Excel-generated XOR-obfuscated fixture's exact ciphertext byte for byte (nolze/msoffcrypto-tool's own tests/inputs/xor_password_123456789012345.xls; see archive-codec's own crypto/xor-obfuscation.test.ts, whose "decrypts a real Excel-generated BoundSheet8 span" vector is lifted from that same file). Method 1's transform is not self-inverse the way Method 2's is, so unlike the RC4 suite's own encryptWorkbookStream (which reuses the decrypt primitive directly), this needs its own, separate direction — kept local to this test file rather than exported from archive-codec, which implements no encrypt direction at all (see xor-obfuscation.ts's own top comment).
   */
  function encryptXorObfuscationMethod1(
    array: Uint8Array<ArrayBuffer>,
    data: Uint8Array<ArrayBuffer>,
    initialIndex: number,
  ): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(data.length);
    const dataView = new DataView(
      data.buffer,
      data.byteOffset,
      data.byteLength,
    );
    const arrayView = new DataView(
      array.buffer,
      array.byteOffset,
      array.byteLength,
    );
    let index = initialIndex % XOR_OBFUSCATION_ARRAY_LENGTH;
    for (let i = 0; i < data.length; i += 1) {
      const withKey = dataView.getUint8(i) ^ arrayView.getUint8(index);
      out[i] = ((withKey >>> 3) | (withKey << 5)) & 0xff;
      index = (index + 1) % XOR_OBFUSCATION_ARRAY_LENGTH;
    }
    return out;
  }

  /** Takes a plaintext workbook stream already carrying a same-length FilePass placeholder record and turns it into a genuinely XOR-obfuscated one: real FilePass header fields (key/verificationBytes) in place of the placeholder, and every other record's data obfuscated per [MS-XLS] 2.2.10's own rules. */
  function obfuscateWorkbookStream(
    plainStreamWithPlaceholder: Uint8Array<ArrayBuffer>,
    password: string,
  ): Uint8Array<ArrayBuffer> {
    const array = createXorObfuscationArray(
      password,
      XOR_OBFUSCATION_ROTATE_DISTANCE_METHOD1,
    );
    const filePassData = new Uint8Array(FILEPASS_HEADER_LENGTH);
    const filePassView = new DataView(filePassData.buffer);
    filePassView.setUint16(0, 0x0000, true); // wEncryptionType: XOR obfuscation
    filePassView.setUint16(2, createXorObfuscationKey(password), true);
    filePassView.setUint16(
      4,
      createXorObfuscationPasswordVerifier(password),
      true,
    );

    const parts: Uint8Array<ArrayBuffer>[] = [];
    for (const rec of parseForEncryption(plainStreamWithPlaceholder)) {
      let data: Uint8Array<ArrayBuffer>;
      if (rec.type === RECORD_FILEPASS) {
        data = filePassData;
      } else if (NEVER_ENCRYPTED_TYPES.has(rec.type)) {
        data = rec.data;
      } else if (rec.type === RECORD_BOUNDSHEET8) {
        const lbPlyPos = rec.data.subarray(0, 4);
        const spanOffset = rec.offset + 4 + 4;
        const rest = encryptXorObfuscationMethod1(
          array,
          rec.data.subarray(4),
          xorArrayIndexFor(spanOffset, rec.data.length),
        );
        data = new Uint8Array(rec.data.length);
        data.set(lbPlyPos, 0);
        data.set(rest, 4);
      } else {
        const spanOffset = rec.offset + 4;
        data = encryptXorObfuscationMethod1(
          array,
          rec.data,
          xorArrayIndexFor(spanOffset, rec.data.length),
        );
      }
      parts.push(record(rec.type, [...data]));
    }
    return concat(...parts);
  }

  function obfuscatedXlsFile(
    globals: readonly Uint8Array<ArrayBuffer>[],
    sheets: Parameters<typeof workbookStream>[0]["sheets"],
    password = PASSWORD,
  ): Uint8Array<ArrayBuffer> {
    const placeholder = record(
      RECORD_FILEPASS,
      new Array<number>(FILEPASS_HEADER_LENGTH).fill(0),
    );
    const plain = workbookStream({
      globals: [placeholder, ...globals],
      sheets,
    });
    return xlsFile(obfuscateWorkbookStream(plain, password));
  }

  it("refuses an obfuscated workbook when no password is given", () => {
    const bytes = obfuscatedXlsFile(xfTable(0), [
      { name: "Sheet1", records: [] },
    ]);

    expect(() => readXlsContent(bytes)).toThrow(BiffFormatError);
  });

  it("refuses an obfuscated workbook given the wrong password", () => {
    const bytes = obfuscatedXlsFile(xfTable(0), [
      { name: "Sheet1", records: [] },
    ]);

    expect(() => readXlsContent(bytes, "the wrong password")).toThrow(
      BiffFormatError,
    );
  });

  it("decrypts an obfuscated workbook given the correct password", () => {
    const bytes = obfuscatedXlsFile(xfTable(0), [
      {
        name: "Sheet1",
        records: [record(RECORD_NUMBER, [...cell(0, 0), ...f64(42)])],
      },
    ]);

    const content = readXlsContent(bytes, PASSWORD);

    expect(content.sheets[0]?.name).toBe("Sheet1");
    expect(content.sheets[0]?.cells[0]).toMatchObject({
      row: 0,
      column: 0,
      value: { kind: "number", value: 42 },
    });
  });

  it("decrypts correctly across the 16-byte XorArrayIndex period, across several records", () => {
    // A run of NUMBER records long enough to cycle the 16-byte obfuscation array several times over, so a later cell only decrypts correctly if the per-record XorArrayIndex ((streamOffset + recordDataLength) % 16) is recomputed for every record rather than assumed constant.
    const paddingCells = Array.from({ length: 40 }, (_, index) =>
      record(RECORD_NUMBER, [...cell(index, 0), ...f64(index)]),
    );
    const bytes = obfuscatedXlsFile(xfTable(0), [
      {
        name: "Sheet1",
        records: [
          ...paddingCells,
          record(RECORD_NUMBER, [...cell(40, 0), ...f64(999)]),
        ],
      },
    ]);

    const content = readXlsContent(bytes, PASSWORD);

    expect(content.sheets[0]?.cells[0]).toMatchObject({
      value: { kind: "number", value: 0 },
    });
    expect(content.sheets[0]?.cells[40]).toMatchObject({
      value: { kind: "number", value: 999 },
    });
  });

  it("decrypts a real Excel-generated XOR-obfuscated BoundSheet8 span using the shared archive-codec primitive directly", () => {
    // The same real ciphertext vector archive-codec's own crypto/xor-obfuscation.test.ts verifies — exercised again here to confirm xls-codec's own re-export/import wiring reaches the identical, real-file-validated result, not just archive-codec's own internal test.
    const array = createXorObfuscationArray(
      "123456789012345",
      XOR_OBFUSCATION_ROTATE_DISTANCE_METHOD1,
    );
    const ciphertext = Uint8Array.from(Buffer.from("5b28fc2ade6d5d", "hex"));
    const plaintext = decryptXorObfuscationMethod1(array, ciphertext, 13);
    expect(new TextDecoder().decode(plaintext.subarray(4))).toBe("420");
  });
});

it("refuses a compound file holding no Workbook stream", () => {
  const bytes = compoundFile([
    { path: "WordDocument", bytes: new Uint8Array([1, 2, 3]) },
  ]);

  expect(() => readXlsContent(bytes)).toThrow(BiffFormatError);
});

it("refuses bytes that are not a compound file at all", () => {
  expect(() =>
    readXlsContent(new Uint8Array([0x50, 0x4b, 0x03, 0x04])),
  ).toThrow(BiffFormatError);
});

it("treats a BoundSheet8 lbPlyPos landing on a non-worksheet substream as no substream at all", () => {
  // A worksheet-typed BoundSheet8 entry whose own lbPlyPos happens to name the byte offset of a CHART substream, not a genuine worksheet one — a malformed/corrupt file this reader must not misread rather than one any real producer would write. Finding a substream at that offset is not enough on its own; its own BOF-declared documentType must agree with BOF_TYPE_WORKSHEET too, or the sheet degrades to the empty default (readSheet's own module comment) rather than parsing a chart substream's records as if they were a worksheet's.
  const boundSheetPlaceholder = record(RECORD_BOUNDSHEET8, [
    ...u32(0),
    0x00,
    0x00, // dt: worksheet
    ...shortXlUnicodeString("Sheet1"),
  ]);
  const globals = concat(
    record(RECORD_BOF, bofData(BOF_TYPE_WORKBOOK)),
    ...xfTable(0),
    boundSheetPlaceholder,
    record(RECORD_EOF, []),
  );
  const chartSubstream = concat(
    record(RECORD_BOF, bofData(BOF_TYPE_CHART)),
    record(RECORD_NUMBER, [...cell(0, 0), ...f64(42)]),
    record(RECORD_EOF, []),
  );
  const boundSheet = record(RECORD_BOUNDSHEET8, [
    ...u32(globals.length), // lbPlyPos — lands exactly on the chart substream's own BOF, not a worksheet's.
    0x00,
    0x00,
    ...shortXlUnicodeString("Sheet1"),
  ]);
  const bytes = xlsFile(
    concat(
      record(RECORD_BOF, bofData(BOF_TYPE_WORKBOOK)),
      ...xfTable(0),
      boundSheet,
      record(RECORD_EOF, []),
      chartSubstream,
    ),
  );

  const content = readXlsContent(bytes);

  expect(content.sheets[0]?.cells).toStrictEqual([]);
});

it("refuses a Workbook stream that carries no records at all, so no globals substream exists", () => {
  expect(() => readXlsContent(xlsFile(new Uint8Array(0)))).toThrow(
    "workbook stream holds no substreams, so it carries no globals substream",
  );
});

it("reads a hidden column with no width at all as hidden alone, not a spurious widthPt", () => {
  // ColInfo's own coldx of 0 converts to a non-positive widthPt — a column this reader never materialises a width for, only its hidden state — unlike a real writeXlsContent round trip, which always states SOME width for every column it emits a ColInfo record for at all.
  const globals = concat(
    record(RECORD_BOF, bofData(BOF_TYPE_WORKBOOK)),
    ...xfTable(0),
    record(RECORD_BOUNDSHEET8, [
      ...u32(0),
      0x00,
      0x00,
      ...shortXlUnicodeString("Sheet1"),
    ]),
    record(RECORD_EOF, []),
  );
  const finalBytes = xlsFile(
    concat(
      record(RECORD_BOF, bofData(BOF_TYPE_WORKBOOK)),
      ...xfTable(0),
      record(RECORD_BOUNDSHEET8, [
        ...u32(globals.length),
        0x00,
        0x00,
        ...shortXlUnicodeString("Sheet1"),
      ]),
      record(RECORD_EOF, []),
      record(RECORD_BOF, bofData(BOF_TYPE_WORKSHEET)),
      record(RECORD_COLINFO, [
        ...u16(3), // first
        ...u16(3), // last
        ...u16(0), // coldx: 0 — no usable width
        ...u16(15), // ixfe, unread
        ...u16(0x0001), // grbit: hidden
      ]),
      record(RECORD_EOF, []),
    ),
  );

  const content = readXlsContent(finalBytes);
  const column3 = content.sheets[0]?.columns.find((col) => col.index === 3);

  expect(column3).toStrictEqual({ index: 3, hidden: true });
});

it("omits a column entirely when it states neither a usable width nor a hidden flag", () => {
  // The mirror image of the hidden-alone case above: coldx 0 (no usable width) AND grbit clear (not hidden) means the ColInfo record states nothing ContentSheetColumn has a field for, so the column must not appear in the output at all — not as a bare {index} entry either.
  const globals = concat(
    record(RECORD_BOF, bofData(BOF_TYPE_WORKBOOK)),
    ...xfTable(0),
    record(RECORD_BOUNDSHEET8, [
      ...u32(0),
      0x00,
      0x00,
      ...shortXlUnicodeString("Sheet1"),
    ]),
    record(RECORD_EOF, []),
  );
  const finalBytes = xlsFile(
    concat(
      record(RECORD_BOF, bofData(BOF_TYPE_WORKBOOK)),
      ...xfTable(0),
      record(RECORD_BOUNDSHEET8, [
        ...u32(globals.length),
        0x00,
        0x00,
        ...shortXlUnicodeString("Sheet1"),
      ]),
      record(RECORD_EOF, []),
      record(RECORD_BOF, bofData(BOF_TYPE_WORKSHEET)),
      record(RECORD_COLINFO, [
        ...u16(3),
        ...u16(3),
        ...u16(0), // coldx: 0 — no usable width
        ...u16(15),
        ...u16(0x0000), // grbit: not hidden
      ]),
      record(RECORD_EOF, []),
    ),
  );

  const content = readXlsContent(finalBytes);

  expect(
    content.sheets[0]?.columns.find((col) => col.index === 3),
  ).toBeUndefined();
});

it("leaves numberFormatCode entirely absent for a cell whose own ixfe resolves to no cell format at all", () => {
  // An ixfe past the end of the workbook's own cell-format table — a malformed record this reader must not crash on, and must not report a fabricated format for either. Own-property check, not a value check: a bug materialising the key with an explicit undefined value would pass a plain .toBeUndefined() assertion just as easily as a genuinely absent key would.
  const bytes = xlsFile(
    workbookStream({
      globals: xfTable(0),
      sheets: [
        {
          name: "Sheet1",
          records: [record(RECORD_NUMBER, [...cell(0, 0, 9999), ...f64(1)])],
        },
      ],
    }),
  );

  const readBack = readXlsContent(bytes).sheets[0]?.cells[0];

  expect(readBack?.value).toStrictEqual({ kind: "number", value: 1 });
  expect(Object.hasOwn(readBack ?? {}, "numberFormatCode")).toBe(false);
});
