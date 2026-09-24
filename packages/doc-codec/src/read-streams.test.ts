import {
  createXorObfuscationArray,
  createXorObfuscationKey,
  createXorObfuscationPasswordVerifier,
  decryptOfficeRc4,
  decryptXorObfuscationMethod2,
  deriveOfficeRc4BaseHash,
  md5,
  OFFICE_RC4_DOC_BLOCK_SIZE,
  OFFICE_RC4_VERIFIER_LENGTH,
  readCompoundFile,
  writeCompoundFile,
  writeSummaryInformationStream,
  XOR_OBFUSCATION_ROTATE_DISTANCE_METHOD2,
} from "archive-codec";
import { describe, expect, it } from "vitest";
import { isDocBytes } from "./detect";
import { DocFormatError, DocUnsupportedError } from "./errors";
import {
  FC_LCB_VALUE_INDEX,
  FIB_FC_LCB_BLOB_OFFSET,
  FIB_LKEY_OFFSET,
} from "./fib/offsets";
import { groupAt, readDocContent, readDocStreams } from "./read";
import type { ParagraphEntry } from "./text/paragraphs";
import { compoundFile } from "./test-support/cfb";
import { buildDoc } from "./test-support/doc";
import { buildFib } from "./test-support/fib";

// Sets one FibRgFcLcb97 lcb field directly in a well-formed document's own WordDocument stream bytes, for exercising a specific bounds-check label readDocContent names when the corresponding structure runs past the Table stream — a well-formed buildDoc fixture never produces an out-of-range lcb on its own.
function docWithLcb(valueIndex: number, lcb: number): Uint8Array<ArrayBuffer> {
  const bytes = buildDoc({ paragraphs: [{ runs: [{ text: "x" }] }] });
  const { wordDocument, table } = readDocStreams(bytes);
  const patched = new Uint8Array(wordDocument);
  new DataView(patched.buffer).setUint32(
    FIB_FC_LCB_BLOB_OFFSET + valueIndex * 4,
    lcb,
    true,
  );
  return compoundFile([
    { path: "WordDocument", bytes: patched },
    { path: "1Table", bytes: new Uint8Array(table) },
  ]);
}

describe("readDocContent's own bounds labels", () => {
  it("names 'Clx in the Table stream' when lcbClx runs past the Table stream", () => {
    expect(() =>
      readDocContent(docWithLcb(FC_LCB_VALUE_INDEX.lcbClx, 0x7fffffff)),
    ).toThrow(/Clx in the Table stream/);
  });

  it("names 'STSH in the Table stream' when lcbStshf runs past the Table stream", () => {
    expect(() =>
      readDocContent(docWithLcb(FC_LCB_VALUE_INDEX.lcbStshf, 0x7fffffff)),
    ).toThrow(/STSH in the Table stream/);
  });

  it("names 'PlcBteChpx in the Table stream' when lcbPlcfBteChpx runs past the Table stream", () => {
    expect(() =>
      readDocContent(docWithLcb(FC_LCB_VALUE_INDEX.lcbPlcfBteChpx, 0x7fffffff)),
    ).toThrow(/PlcBteChpx in the Table stream/);
  });

  it("names 'PlcBtePapx in the Table stream' when lcbPlcfBtePapx runs past the Table stream", () => {
    expect(() =>
      readDocContent(docWithLcb(FC_LCB_VALUE_INDEX.lcbPlcfBtePapx, 0x7fffffff)),
    ).toThrow(/PlcBtePapx in the Table stream/);
  });

  it("names 'PlcBteChpx' (not the slice label) when the bin table's own bytes are not a whole number of elements", () => {
    // A short-but-in-range lcb: the slice into the Table stream itself succeeds, so this is PropertyBinTable's own parsePlc call throwing, naming the constructor's own `what`, distinct from the slice label the previous test covers.
    expect(() =>
      readDocContent(docWithLcb(FC_LCB_VALUE_INDEX.lcbPlcfBteChpx, 5)),
    ).toThrow(/PlcBteChpx is 5 bytes, which does not yield a whole number/);
  });

  it("names 'PlcBtePapx' (not the slice label) when the bin table's own bytes are not a whole number of elements", () => {
    expect(() =>
      readDocContent(docWithLcb(FC_LCB_VALUE_INDEX.lcbPlcfBtePapx, 5)),
    ).toThrow(/PlcBtePapx is 5 bytes, which does not yield a whole number/);
  });

  it("names 'SttbfFfn in the Table stream' when lcbSttbfFfn runs past the Table stream", () => {
    expect(() =>
      readDocContent(docWithLcb(FC_LCB_VALUE_INDEX.lcbSttbfFfn, 0x7fffffff)),
    ).toThrow(/SttbfFfn in the Table stream/);
  });

  it("skips STSH entirely when lcbStshf is exactly 0, rather than treating it as present", () => {
    const bytes = docWithLcb(FC_LCB_VALUE_INDEX.lcbStshf, 0);
    expect(() => readDocContent(bytes)).not.toThrow();
  });
});

describe("groupAt", () => {
  it("returns the group at a real index", () => {
    const groups: ParagraphEntry[][] = [[], []];
    expect(groupAt(groups, 1)).toBe(groups[1]);
  });

  it("names the actual index and group count when the index has no group at all", () => {
    const groups: ParagraphEntry[][] = [[]];
    expect(() => groupAt(groups, 1)).toThrow(
      /internal defect: section index 1 has no group despite 1 sections/,
    );
  });
});

describe("readDocStreams", () => {
  it("selects the Table stream FibBase.fWhichTblStm names", () => {
    const streams = readDocStreams(
      buildDoc({ paragraphs: [{ runs: [{ text: "x" }] }] }),
    );
    expect(streams.fib.fWhichTblStm).toBe(1);
    expect(streams.table.length).toBeGreaterThan(0);
  });

  it("rejects a compound file with no WordDocument stream", () => {
    const bytes = compoundFile([
      { path: "Workbook", bytes: new Uint8Array(16) },
    ]);
    expect(() => readDocStreams(bytes)).toThrow(DocFormatError);
    expect(() => readDocStreams(bytes)).toThrow(/WordDocument/);
  });

  it("names every stream the file actually holds, comma-separated, when WordDocument is missing", () => {
    const bytes = compoundFile([
      { path: "Workbook", bytes: new Uint8Array(16) },
      { path: "ObjectPool", bytes: new Uint8Array(16) },
    ]);
    expect(() => readDocStreams(bytes)).toThrow(
      /it holds: Workbook, ObjectPool/,
    );
  });

  it("rejects a document whose FibBase selects a Table stream the file lacks", () => {
    const bytes = compoundFile([
      { path: "WordDocument", bytes: buildFib({ fWhichTblStm: 0 }) },
    ]);
    expect(() => readDocStreams(bytes)).toThrow(/0Table/);
  });

  it("refuses an encrypted document rather than reading its ciphertext", () => {
    const bytes = compoundFile([
      { path: "WordDocument", bytes: buildFib({ fEncrypted: true }) },
      { path: "1Table", bytes: new Uint8Array(16) },
    ]);
    expect(() => readDocStreams(bytes)).toThrow(DocUnsupportedError);
  });
});

describe("isDocBytes", () => {
  it("accepts a real .doc", () => {
    expect(
      isDocBytes(buildDoc({ paragraphs: [{ runs: [{ text: "x" }] }] })),
    ).toBe(true);
  });

  it("rejects bytes that are not a compound file at all", () => {
    expect(isDocBytes(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe(false);
  });

  it("rejects a compound file of another format, which shares the same container", () => {
    expect(
      isDocBytes(
        compoundFile([{ path: "Workbook", bytes: new Uint8Array(16) }]),
      ),
    ).toBe(false);
  });

  it("rejects a WordDocument stream whose FibBase.wIdent is not 0xA5EC", () => {
    expect(
      isDocBytes(
        compoundFile([
          { path: "WordDocument", bytes: buildFib({ wIdent: 0x1234 }) },
        ]),
      ),
    ).toBe(false);
  });
});

describe("metadata", () => {
  // A real "\x05SummaryInformation" stream added beside the WordDocument/1Table streams a real producer would already have written — composed here with archive-codec's own writeSummaryInformationStream/writeCompoundFile rather than by extending test-support/doc.ts's buildDoc, which stays a pure [MS-DOC]-only fixture builder.
  function withSummaryInformation(
    doc: Uint8Array<ArrayBuffer>,
    metadata: Parameters<typeof writeSummaryInformationStream>[0],
  ): Uint8Array<ArrayBuffer> {
    return writeCompoundFile([
      ...readCompoundFile(doc),
      {
        path: "\x05SummaryInformation",
        bytes: writeSummaryInformationStream(metadata),
      },
    ]);
  }

  it('reads title/author/dates from a real "\\x05SummaryInformation" stream', () => {
    const doc = withSummaryInformation(
      buildDoc({ paragraphs: [{ runs: [{ text: "Hello." }] }] }),
      {
        title: "Meeting notes",
        author: "Cornelius",
        createdIso: "2024-05-01T00:00:00.000Z",
      },
    );
    const result = readDocContent(doc);
    expect(result.metadata).toEqual({
      title: "Meeting notes",
      author: "Cornelius",
      createdIso: "2024-05-01T00:00:00.000Z",
    });
  });

  it('reads {} when the container carries no "\\x05SummaryInformation" stream', () => {
    const doc = buildDoc({ paragraphs: [{ runs: [{ text: "Hello." }] }] });
    expect(readDocContent(doc).metadata).toEqual({});
  });
});

describe("RC4-encrypted documents", () => {
  const PASSWORD = "correct horse";
  const SALT = new Uint8Array(16).map((_, index) => index * 7 + 1);
  const WORD_DOCUMENT_PREFIX_LENGTH = 68;

  /**
   * Takes a plain (unencrypted) .doc's compound-file bytes and turns them into a genuinely RC4-encrypted one: sets FibBase.fEncrypted and lKey, writes a real EncryptionHeader at the start of the Table stream, and encrypts WordDocument from byte 68 and Table from lKey on — each independently, its own block-number counter starting fresh at that stream's own byte 0, exactly as [MS-DOC] 2.2.6.2 requires and encryption.ts's own top comment documents.
   *
   * RC4's XOR symmetry makes "encrypt" and "decrypt" the identical operation, so this reuses decryptOfficeRc4 — the same primitive readDocContent decrypts with — rather than a separate encryption routine; the two directions cancelling out is exactly what makes RC4 what it is, not a shortcut that only looks like a round trip. What this test actually proves is read.ts's own orchestration: locating the right Table stream before a full Fib exists, decrypting at the right offsets, and handing the result to parseFib correctly — the crypto itself is already independently verified (archive-codec's own office-rc4.test.ts, this package's own encryption.test.ts).
   */
  function encryptDoc(
    plainDoc: Uint8Array<ArrayBuffer>,
    password: string,
    salt: Uint8Array<ArrayBuffer>,
  ): Uint8Array<ArrayBuffer> {
    const streams = readCompoundFile(plainDoc);
    const wordDocumentStream = streams.find(
      (stream) => stream.path === "WordDocument",
    );
    const tableStream = streams.find((stream) => stream.path === "1Table");
    if (wordDocumentStream === undefined || tableStream === undefined) {
      throw new Error("buildDoc always writes WordDocument and 1Table");
    }

    const baseHash = deriveOfficeRc4BaseHash(password, salt);
    const verifier = new Uint8Array(16).map((_, index) => index * 3 + 11);
    const verifierHash = md5(verifier);
    const encryptedVerifier = decryptOfficeRc4(
      baseHash,
      0,
      verifier,
      OFFICE_RC4_DOC_BLOCK_SIZE,
    );
    const encryptedVerifierHash = decryptOfficeRc4(
      baseHash,
      OFFICE_RC4_VERIFIER_LENGTH,
      verifierHash,
      OFFICE_RC4_DOC_BLOCK_SIZE,
    );
    const headerSize = 4 + OFFICE_RC4_VERIFIER_LENGTH * 3;
    const header = new Uint8Array(headerSize);
    const headerView = new DataView(header.buffer);
    headerView.setUint16(0, 1, true); // vMajor
    headerView.setUint16(2, 1, true); // vMinor
    header.set(salt, 4);
    header.set(encryptedVerifier, 20);
    header.set(encryptedVerifierHash, 36);

    // A plaintext copy of WordDocument, patched before any encryption happens: fEncrypted/lKey (both in the always-unencrypted 68-byte prefix, so either order would do), and every fc offset FibRgFcLcb97 states relative to the Table stream's own byte 0 — which, in a real encrypted file, the producer writes already accounting for the EncryptionHeader occupying the first lKey bytes there, exactly as it would for any other structure sharing the stream. buildDoc computed these assuming no header at all, so inserting one here means shifting every fc value (never the matching lcb, a length rather than a position) by the same headerSize this fixture is about to prepend — the one piece of this fixture that is not simply "encrypt bytes 68 onward", and the reason this helper reads real field offsets from fib/offsets.ts rather than reimplementing them. This has to happen on the plaintext, not the ciphertext: the FibRgFcLcb97 blob itself sits well past byte 68 (FIB_FC_LCB_BLOB_OFFSET is 154), so it is encrypted content like any other — patching it after encryption would be overwriting ciphertext bytes with a plaintext-shaped value instead of shifting the value the encryption itself protects.
    const shiftedWordDocument = new Uint8Array(wordDocumentStream.bytes);
    const shiftedView = new DataView(shiftedWordDocument.buffer);
    const existingFlags = shiftedView.getUint16(10, true);
    shiftedView.setUint16(10, existingFlags | 0x0100, true); // fEncrypted
    shiftedView.setUint32(FIB_LKEY_OFFSET, headerSize, true); // lKey
    // Shifted unconditionally, even where the existing value happens to be 0: 0 is a genuinely valid Table-stream offset (a real producer often places the Clx at the very start), not a sentinel for "field unused" — every real reader (read.ts's own `fib.lcbStshf > 0 ? ... : undefined`, and the same pattern for every other fc/lcb pair) gates on the matching *lcb* being positive, never on the fc value itself, so shifting an unused field's fc (whose lcb is 0 regardless) changes nothing anything actually reads.
    for (const [name, valueIndex] of Object.entries(FC_LCB_VALUE_INDEX)) {
      if (!name.startsWith("fc")) continue;
      const offset = FIB_FC_LCB_BLOB_OFFSET + valueIndex * 4;
      const existing = shiftedView.getUint32(offset, true);
      shiftedView.setUint32(offset, existing + headerSize, true);
    }

    const wordDocument = new Uint8Array(shiftedWordDocument.length);
    wordDocument.set(
      shiftedWordDocument.subarray(0, WORD_DOCUMENT_PREFIX_LENGTH),
      0,
    );
    wordDocument.set(
      decryptOfficeRc4(
        baseHash,
        WORD_DOCUMENT_PREFIX_LENGTH,
        shiftedWordDocument.subarray(WORD_DOCUMENT_PREFIX_LENGTH),
        OFFICE_RC4_DOC_BLOCK_SIZE,
      ),
      WORD_DOCUMENT_PREFIX_LENGTH,
    );

    const table = new Uint8Array(headerSize + tableStream.bytes.length);
    table.set(header, 0);
    table.set(
      decryptOfficeRc4(
        baseHash,
        headerSize,
        tableStream.bytes,
        OFFICE_RC4_DOC_BLOCK_SIZE,
      ),
      headerSize,
    );

    return writeCompoundFile(
      streams.map((stream) => {
        if (stream.path === "WordDocument")
          return { ...stream, bytes: wordDocument };
        if (stream.path === "1Table") return { ...stream, bytes: table };
        return stream;
      }),
    );
  }

  it("refuses an encrypted document when no password is given", () => {
    const doc = encryptDoc(
      buildDoc({ paragraphs: [{ runs: [{ text: "Secret." }] }] }),
      PASSWORD,
      SALT,
    );
    expect(() => readDocContent(doc)).toThrow(DocUnsupportedError);
  });

  it("refuses an encrypted document given the wrong password", () => {
    const doc = encryptDoc(
      buildDoc({ paragraphs: [{ runs: [{ text: "Secret." }] }] }),
      PASSWORD,
      SALT,
    );
    expect(() => readDocContent(doc, "the wrong password")).toThrow(
      DocUnsupportedError,
    );
  });

  it("decrypts an encrypted document given the correct password", () => {
    const plainDoc = buildDoc({
      paragraphs: [{ runs: [{ text: "Secret meeting notes." }] }],
    });
    const encrypted = encryptDoc(plainDoc, PASSWORD, SALT);

    const plainResult = readDocContent(plainDoc);
    const decryptedResult = readDocContent(encrypted, PASSWORD);

    expect(decryptedResult).toEqual(plainResult);
  });
});

describe("XOR-obfuscated documents", () => {
  const PASSWORD = "correct horse";
  const WORD_DOCUMENT_PREFIX_LENGTH = 68;

  /**
   * Takes a plain (unencrypted) .doc's compound-file bytes and turns them into a genuinely XOR-obfuscated one: sets FibBase.fEncrypted/fObfuscated and lKey (the 32-bit password verifier itself here, not a header byte length — see encryption.ts's own top comment), and obfuscates WordDocument from byte 68 and Table from byte 0 — each independently, exactly as [MS-DOC]'s own XOR Obfuscation section requires.
   *
   * Unlike RC4, XOR obfuscation needs no EncryptionHeader occupying space at the start of the Table stream, so FibRgFcLcb97's own fc offsets (computed by buildDoc assuming no header) need no shifting here — the one genuine simplification over the sibling RC4 fixture above. Method 2's data transform (plain XOR with a zero-byte exception) is its own inverse, so this reuses decryptXorObfuscationMethod2 — the same primitive readDocContent decrypts with — rather than a separate encryption routine, mirroring RC4's own XOR-symmetry reuse above.
   */
  function obfuscateDoc(
    plainDoc: Uint8Array<ArrayBuffer>,
    password: string,
  ): Uint8Array<ArrayBuffer> {
    const streams = readCompoundFile(plainDoc);
    const wordDocumentStream = streams.find(
      (stream) => stream.path === "WordDocument",
    );
    const tableStream = streams.find((stream) => stream.path === "1Table");
    if (wordDocumentStream === undefined || tableStream === undefined) {
      throw new Error("buildDoc always writes WordDocument and 1Table");
    }

    const array = createXorObfuscationArray(
      password,
      XOR_OBFUSCATION_ROTATE_DISTANCE_METHOD2,
    );
    const lKey =
      (createXorObfuscationKey(password) << 16) |
      createXorObfuscationPasswordVerifier(password);

    const shiftedWordDocument = new Uint8Array(wordDocumentStream.bytes);
    const shiftedView = new DataView(shiftedWordDocument.buffer);
    const existingFlags = shiftedView.getUint16(10, true);
    shiftedView.setUint16(10, existingFlags | 0x8100, true); // fEncrypted (0x0100) | fObfuscated (0x8000)
    shiftedView.setUint32(FIB_LKEY_OFFSET, lKey, true);

    const wordDocument = new Uint8Array(shiftedWordDocument.length);
    wordDocument.set(
      shiftedWordDocument.subarray(0, WORD_DOCUMENT_PREFIX_LENGTH),
      0,
    );
    wordDocument.set(
      decryptXorObfuscationMethod2(
        array,
        shiftedWordDocument.subarray(WORD_DOCUMENT_PREFIX_LENGTH),
        WORD_DOCUMENT_PREFIX_LENGTH % 16,
      ),
      WORD_DOCUMENT_PREFIX_LENGTH,
    );

    const table = decryptXorObfuscationMethod2(array, tableStream.bytes, 0);

    return writeCompoundFile(
      streams.map((stream) => {
        if (stream.path === "WordDocument")
          return { ...stream, bytes: wordDocument };
        if (stream.path === "1Table") return { ...stream, bytes: table };
        return stream;
      }),
    );
  }

  it("refuses an obfuscated document when no password is given", () => {
    const doc = obfuscateDoc(
      buildDoc({ paragraphs: [{ runs: [{ text: "Secret." }] }] }),
      PASSWORD,
    );
    expect(() => readDocContent(doc)).toThrow(DocUnsupportedError);
  });

  it("refuses an obfuscated document given the wrong password", () => {
    const doc = obfuscateDoc(
      buildDoc({ paragraphs: [{ runs: [{ text: "Secret." }] }] }),
      PASSWORD,
    );
    expect(() => readDocContent(doc, "the wrong password")).toThrow(
      DocUnsupportedError,
    );
  });

  it("decrypts an obfuscated document given the correct password", () => {
    const plainDoc = buildDoc({
      paragraphs: [{ runs: [{ text: "Secret meeting notes." }] }],
    });
    const obfuscated = obfuscateDoc(plainDoc, PASSWORD);

    const plainResult = readDocContent(plainDoc);
    const decryptedResult = readDocContent(obfuscated, PASSWORD);

    expect(decryptedResult).toEqual(plainResult);
  });
});
