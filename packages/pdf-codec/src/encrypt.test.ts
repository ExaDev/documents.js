import { describe, expect, it } from "vitest";
import { ByteReader } from "./bytes/reader";
import { concatBytes } from "./bytes/writer";
import type { PdfDiagnostic } from "./diagnostics";
import {
  NOOP_DIAGNOSTIC_SINK,
  PdfEncryptedError,
  PdfPasswordRequiredError,
} from "./diagnostics";
import {
  PASSWORD_PADDING,
  ZERO_IV,
  computeLegacyFileKeyFromPaddedPassword,
  createStandardDecryptor,
  hardenedHash,
  legacyUserValueCore,
  objectKey,
  padOrTruncatePassword,
} from "./encrypt";
import { AES_BLOCK_BYTES, aesCbcEncrypt } from "./crypto/aes";
import { rc4 } from "./crypto/rc4";
import { sha256, sha384, sha512 } from "./crypto/sha2";
import type { PdfDict, PdfObject } from "./objects";
import {
  asArray,
  asDict,
  dictGet,
  pdfDict,
  pdfHexString,
  pdfName,
  pdfNum,
} from "./objects";
import { parseIndirectObject } from "./parse";
import {
  aes128CleartextMetadataPdf,
  aes128EmptyUserPasswordPdf,
  aes256EmptyUserPasswordPdf,
  rc4Bits128EmptyUserPasswordPdf,
  rc4Bits40EmptyUserPasswordPdf,
} from "./test-support/encrypted-pdfs";
import { readXref } from "./xref";

// Handler-level tests: which /Encrypt dictionaries are readable at all, and how the crypt-filter routing behaves. That a supported dictionary genuinely decrypts a real file is proved end to end in read.test.ts against six qpdf-produced fixtures; these cover the dispatch and refusal paths around it, then go one layer lower than read.test.ts by decrypting the fixtures' own /Info strings directly through createStandardDecryptor, where a mutation of the key derivation or routing is pinned against qpdf's ciphertext rather than against this package's own writer.

function collectDiagnostics(): {
  sink: (diagnostic: PdfDiagnostic) => void;
  diagnostics: PdfDiagnostic[];
} {
  const diagnostics: PdfDiagnostic[] = [];
  return { sink: (diagnostic) => diagnostics.push(diagnostic), diagnostics };
}

function asciiBytes(text: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    bytes[i] = text.charCodeAt(i);
  }
  return bytes;
}

// Lifts one directly-located indirect object out of a real fixture, so tests can reach the /Info dictionary's own still-encrypted strings (and the /Encrypt dictionary itself) without going through readPdf.
function indirectObjectAt(
  pdf: Uint8Array<ArrayBuffer>,
  num: number,
): PdfObject | undefined {
  const xref = readXref(pdf, NOOP_DIAGNOSTIC_SINK);
  const entry = xref.entries.get(num);
  if (entry?.type !== "offset") {
    return undefined;
  }
  const reader = new ByteReader(pdf);
  reader.seek(entry.offset);
  return parseIndirectObject(reader, NOOP_DIAGNOSTIC_SINK)?.value;
}

// Lifts a real fixture's own /Encrypt dictionary and /ID back out of the file, so a test can vary one entry of a genuinely valid handler (and keep a /U that genuinely verifies) instead of inventing a whole consistent one.
function realHandlerFrom(pdf: Uint8Array<ArrayBuffer>): {
  encryptDict: PdfDict;
  fileId: Uint8Array<ArrayBuffer>;
} {
  const xref = readXref(pdf, NOOP_DIAGNOSTIC_SINK);
  const reference = dictGet(xref.trailer, "Encrypt");
  if (reference?.kind !== "ref") {
    throw new Error("fixture trailer has no indirect /Encrypt reference");
  }
  const encryptDict = asDict(indirectObjectAt(pdf, reference.num));
  const id = asArray(dictGet(xref.trailer, "ID"))?.[0];
  if (encryptDict === undefined || id?.kind !== "string") {
    throw new Error("fixture /Encrypt dictionary or /ID could not be read");
  }
  return { encryptDict, fileId: id.bytes };
}

// The still-encrypted bytes of a fixture's /Info /Title, plus the object number and generation a decryptor must key it with. Every fixture carries the same qpdf-encrypted "Secret Title", so a decryption asserted here is checked against an independent implementation's output, never this package's own writer.
function encryptedTitleFrom(
  pdf: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  const info = asDict(indirectObjectAt(pdf, 2));
  const title = info === undefined ? undefined : dictGet(info, "Title");
  if (title?.kind !== "string") {
    throw new Error("fixture /Info object carries no /Title string");
  }
  return title.bytes;
}

function withEntries(
  dict: PdfDict,
  overrides: Record<string, PdfObject>,
): PdfDict {
  const entries = new Map(dict.entries);
  for (const [key, value] of Object.entries(overrides)) {
    entries.set(key, value);
  }
  return { kind: "dict", entries };
}
// Builds a legacy (/V 1, 2, or 4) handler dictionary from a real fixture's own /O, /P and /ID plus a caller-chosen key length, computing the /U that the empty user password produces under those exact inputs. The key derivation exports encrypt-write.ts already shares are the derivation itself, so the /U verifies iff the reader derives the same key; a mutation that changes which key length the dictionary resolves to therefore fails /U verification rather than quietly decrypting with the wrong key.
function legacyHandlerWithKeyBytes(opts: {
  source: () => Uint8Array<ArrayBuffer>;
  version: number;
  revision: number;
  keyBytes: number;
  entries?: Record<string, PdfObject>;
}): {
  dict: PdfDict;
  fileId: Uint8Array<ArrayBuffer>;
  fileKey: Uint8Array<ArrayBuffer>;
} {
  const { encryptDict, fileId } = realHandlerFrom(opts.source());
  const owner = dictGet(encryptDict, "O");
  const permissions = dictGet(encryptDict, "P");
  if (owner?.kind !== "string" || permissions?.kind !== "number") {
    throw new Error("fixture /Encrypt dictionary lacks a usable /O or /P");
  }
  const encryptMetadataEntry = opts.entries?.EncryptMetadata;
  const encryptMetadata =
    encryptMetadataEntry?.kind === "bool" ? encryptMetadataEntry.value : true;
  const fileKey = computeLegacyFileKeyFromPaddedPassword(
    PASSWORD_PADDING,
    owner.bytes,
    permissions.value,
    fileId,
    opts.revision,
    opts.keyBytes,
    encryptMetadata,
  );
  const dict = pdfDict({
    Filter: pdfName("Standard"),
    V: pdfNum(opts.version),
    R: pdfNum(opts.revision),
    O: pdfHexString(owner.bytes),
    U: pdfHexString(legacyUserValueCore(fileKey, fileId, opts.revision)),
    P: pdfNum(permissions.value),
    ...opts.entries,
  });
  return { dict, fileId, fileKey };
}

// Builds a revision 5 or 6 handler around a caller-chosen 32-byte file key: /U carries the validation hash and both salts, /UE wraps the key under the key-salt hash, and the crypt filter routes both methods to AES so a test's crafted values reach the real cipher with exactly that key. Everything is computed with the exported Algorithm 2.A/2.B primitives over independently conformance-tested ciphers, so the decryptor under test is the only thing left to be wrong.
function aesV3HandlerWithKey(opts: {
  revision: 5 | 6;
  fileKey: Uint8Array<ArrayBuffer>;
  ueLength?: number;
}): PdfDict {
  const empty = new Uint8Array(0);
  const validationSalt = Uint8Array.from({ length: 8 }, (_v, i) => 0x10 + i);
  const keySalt = Uint8Array.from({ length: 8 }, (_v, i) => 0x80 + i);
  const wrapped = aesCbcEncrypt(
    hardenedHash(empty, keySalt, empty, opts.revision),
    ZERO_IV,
    opts.fileKey,
  );
  return pdfDict({
    Filter: pdfName("Standard"),
    V: pdfNum(5),
    R: pdfNum(opts.revision),
    CF: pdfDict({ StdCF: pdfDict({ CFM: pdfName("AESV3") }) }),
    StmF: pdfName("StdCF"),
    StrF: pdfName("StdCF"),
    U: pdfHexString(
      concatBytes([
        hardenedHash(empty, validationSalt, empty, opts.revision),
        validationSalt,
        keySalt,
      ]),
    ),
    UE: pdfHexString(
      opts.ueLength === undefined
        ? wrapped
        : wrapped.subarray(0, opts.ueLength),
    ),
  });
}

const EMPTY_ID = new Uint8Array(0);

describe("createStandardDecryptor: handlers it refuses outright", () => {
  it("rejects a security handler other than /Standard", () => {
    const dict = pdfDict({
      Filter: pdfName("Adobe.PubSec"),
      V: pdfNum(4),
      R: pdfNum(4),
    });
    expect(() =>
      createStandardDecryptor(dict, EMPTY_ID, NOOP_DIAGNOSTIC_SINK),
    ).toThrow(PdfEncryptedError);
    expect(() =>
      createStandardDecryptor(dict, EMPTY_ID, NOOP_DIAGNOSTIC_SINK),
    ).toThrow(/only the standard security handler/);
  });

  it("rejects a missing /Filter rather than assuming /Standard", () => {
    expect(() =>
      createStandardDecryptor(
        pdfDict({ V: pdfNum(2), R: pdfNum(3) }),
        EMPTY_ID,
        NOOP_DIAGNOSTIC_SINK,
      ),
    ).toThrow(PdfEncryptedError);
  });

  // /V 3 is Adobe's own unpublished algorithm: there is no specification to implement it from, so it is genuinely unimplementable rather than merely unimplemented.
  it("rejects the unpublished /V 3 algorithm", () => {
    const dict = pdfDict({
      Filter: pdfName("Standard"),
      V: pdfNum(3),
      R: pdfNum(3),
    });
    expect(() =>
      createStandardDecryptor(dict, EMPTY_ID, NOOP_DIAGNOSTIC_SINK),
    ).toThrow(/unsupported standard security handler version \/V 3/);
  });

  it("rejects a revision outside the range its version defines", () => {
    const legacy = pdfDict({
      Filter: pdfName("Standard"),
      V: pdfNum(2),
      R: pdfNum(1),
    });
    expect(() =>
      createStandardDecryptor(legacy, EMPTY_ID, NOOP_DIAGNOSTIC_SINK),
    ).toThrow(/unsupported standard security handler revision \/R 1/);
    const modern = pdfDict({
      Filter: pdfName("Standard"),
      V: pdfNum(5),
      R: pdfNum(4),
    });
    expect(() =>
      createStandardDecryptor(modern, EMPTY_ID, NOOP_DIAGNOSTIC_SINK),
    ).toThrow(/\/V 5 encryption with an unsupported revision \/R 4/);
  });

  it("rejects a crypt filter whose /CFM this codec does not implement", () => {
    const { encryptDict, fileId } = realHandlerFrom(
      aes128EmptyUserPasswordPdf(),
    );
    const cf = pdfDict({
      StdCF: pdfDict({ CFM: pdfName("AESV4"), Length: pdfNum(16) }),
    });
    expect(() =>
      createStandardDecryptor(
        withEntries(encryptDict, { CF: cf }),
        fileId,
        NOOP_DIAGNOSTIC_SINK,
      ),
    ).toThrow(/unsupported \/CFM \/AESV4/);
  });

  it("rejects a /StmF naming a crypt filter the /CF dictionary never defines", () => {
    const { encryptDict, fileId } = realHandlerFrom(
      aes128EmptyUserPasswordPdf(),
    );
    expect(() =>
      createStandardDecryptor(
        withEntries(encryptDict, { StmF: pdfName("NoSuchFilter") }),
        fileId,
        NOOP_DIAGNOSTIC_SINK,
      ),
    ).toThrow(/its own \/CF dictionary does not define/);
  });

  it("rejects an /Encrypt dictionary whose /O or /U is missing entirely", () => {
    const dict = pdfDict({
      Filter: pdfName("Standard"),
      V: pdfNum(2),
      R: pdfNum(3),
      Length: pdfNum(128),
      P: pdfNum(-4),
    });
    expect(() =>
      createStandardDecryptor(dict, EMPTY_ID, NOOP_DIAGNOSTIC_SINK),
    ).toThrow(/\/O entry is missing or is not a direct string/);
  });
});

describe("createStandardDecryptor: password verification", () => {
  it("refuses a file whose /U does not match the empty user password", () => {
    const { encryptDict, fileId } = realHandlerFrom(
      rc4Bits128EmptyUserPasswordPdf(),
    );
    const wrongUser = pdfHexString(new Uint8Array(32).fill(0xab));
    expect(() =>
      createStandardDecryptor(
        withEntries(encryptDict, { U: wrongUser }),
        fileId,
        NOOP_DIAGNOSTIC_SINK,
      ),
    ).toThrow(PdfPasswordRequiredError);
  });

  // The pre-revision-5 key derivation mixes in the first /ID string, so the wrong /ID produces the wrong key and the /U check must catch it — rather than the file appearing to open and every string coming back as noise.
  it("refuses a file when the /ID it was keyed with is wrong", () => {
    const { encryptDict } = realHandlerFrom(rc4Bits128EmptyUserPasswordPdf());
    expect(() =>
      createStandardDecryptor(
        encryptDict,
        new Uint8Array(16).fill(0x11),
        NOOP_DIAGNOSTIC_SINK,
      ),
    ).toThrow(PdfPasswordRequiredError);
  });

  it("reports a revision-6 /U that is too short to carry its own salts", () => {
    const dict = pdfDict({
      Filter: pdfName("Standard"),
      V: pdfNum(5),
      R: pdfNum(6),
      U: pdfHexString(new Uint8Array(32)),
      UE: pdfHexString(new Uint8Array(32)),
    });
    expect(() =>
      createStandardDecryptor(dict, EMPTY_ID, NOOP_DIAGNOSTIC_SINK),
    ).toThrow(/requires 48/);
  });
});

describe("createStandardDecryptor: crypt-filter routing", () => {
  it("leaves strings untouched when /StrF is /Identity while streams stay encrypted", () => {
    const { encryptDict, fileId } = realHandlerFrom(
      aes128EmptyUserPasswordPdf(),
    );
    const decryptor = createStandardDecryptor(
      withEntries(encryptDict, { StrF: pdfName("Identity") }),
      fileId,
      NOOP_DIAGNOSTIC_SINK,
    );
    const value = Uint8Array.from([1, 2, 3, 4]);
    expect(decryptor.decryptString(value, 5, 0)).toBe(value);
    // The stream path still runs a real cipher, so it cannot return the same object back.
    expect(
      decryptor.decryptStream(
        Uint8Array.from(new Array(48).fill(0)),
        pdfDict({}),
        5,
        0,
      ),
    ).not.toBe(value);
  });

  // ISO 32000-1 7.6.3.2: with /EncryptMetadata false, a /Type /Metadata stream is the one stream in the file left in the clear. The fixture is a genuinely qpdf-encrypted --cleartext-metadata file rather than this package's own dictionary with the flag flipped: at revision 4 that flag also feeds four 0xFF bytes into Algorithm 2, so a flipped copy would derive a different file key and fail /U verification outright — which the neighbouring test now pins deliberately.
  it("leaves a /Type /Metadata stream in the clear when /EncryptMetadata is false", () => {
    const { encryptDict, fileId } = realHandlerFrom(
      aes128CleartextMetadataPdf(),
    );
    const decryptor = createStandardDecryptor(
      encryptDict,
      fileId,
      NOOP_DIAGNOSTIC_SINK,
    );
    const value = Uint8Array.from(new Array(48).fill(7));
    expect(
      decryptor.decryptStream(
        value,
        pdfDict({ Type: pdfName("Metadata") }),
        5,
        0,
      ),
    ).toBe(value);
    expect(
      decryptor.decryptStream(
        value,
        pdfDict({ Type: pdfName("XObject") }),
        5,
        0,
      ),
    ).not.toBe(value);
  });

  // The flag is an input to the key itself, not just a per-stream switch: taking a file encrypted with /EncryptMetadata true and merely asserting false over it must fail to authenticate, which is what proves Algorithm 2's step (f) is actually being applied rather than ignored.
  it("derives a different file key when /EncryptMetadata is false, so a flipped flag no longer authenticates", () => {
    const { encryptDict, fileId } = realHandlerFrom(
      aes128EmptyUserPasswordPdf(),
    );
    expect(() =>
      createStandardDecryptor(
        withEntries(encryptDict, {
          EncryptMetadata: { kind: "bool", value: false },
        }),
        fileId,
        NOOP_DIAGNOSTIC_SINK,
      ),
    ).toThrow(PdfPasswordRequiredError);
  });

  it("still encrypts the metadata stream when /EncryptMetadata is absent, its default being true", () => {
    const { encryptDict, fileId } = realHandlerFrom(
      aes128EmptyUserPasswordPdf(),
    );
    const decryptor = createStandardDecryptor(
      encryptDict,
      fileId,
      NOOP_DIAGNOSTIC_SINK,
    );
    const value = Uint8Array.from(new Array(48).fill(7));
    expect(
      decryptor.decryptStream(
        value,
        pdfDict({ Type: pdfName("Metadata") }),
        5,
        0,
      ),
    ).not.toBe(value);
  });
});

describe("createStandardDecryptor: corrupt encrypted values degrade rather than throw", () => {
  it("reports an AES value too short to hold its own initialisation vector", () => {
    const { encryptDict, fileId } = realHandlerFrom(
      aes128EmptyUserPasswordPdf(),
    );
    const { sink, diagnostics } = collectDiagnostics();
    const decryptor = createStandardDecryptor(encryptDict, fileId, sink);
    expect(
      decryptor.decryptString(Uint8Array.from([1, 2, 3, 4, 5]), 5, 0),
    ).toHaveLength(0);
    expect(diagnostics.map((d) => d.code)).toContain("pdf/decrypt-truncated");
  });

  it("treats an AES value carrying only an initialisation vector as empty, with no diagnostic", () => {
    const { encryptDict, fileId } = realHandlerFrom(
      aes128EmptyUserPasswordPdf(),
    );
    const { sink, diagnostics } = collectDiagnostics();
    const decryptor = createStandardDecryptor(encryptDict, fileId, sink);
    expect(decryptor.decryptString(new Uint8Array(16), 5, 0)).toHaveLength(0);
    expect(diagnostics).toHaveLength(0);
  });

  // A garbage AES value decrypts to garbage, which is the honest outcome — what must not happen is a throw, or a result longer than the ciphertext that produced it.
  it("never throws or over-produces on a garbage AES value", () => {
    const { encryptDict, fileId } = realHandlerFrom(
      aes128EmptyUserPasswordPdf(),
    );
    const decryptor = createStandardDecryptor(
      encryptDict,
      fileId,
      NOOP_DIAGNOSTIC_SINK,
    );
    const garbage = Uint8Array.from(
      { length: 48 },
      (_unused, i) => (i * 31) & 0xff,
    );
    expect(decryptor.decryptString(garbage, 9, 0).length).toBeLessThanOrEqual(
      garbage.length - 16,
    );
  });
});

describe("padOrTruncatePassword", () => {
  it("pads a short password with the standard padding string's tail", () => {
    const padded = padOrTruncatePassword(asciiBytes("A"));
    expect(Array.from(padded)).toEqual([
      0x41,
      ...Array.from(PASSWORD_PADDING.subarray(1)),
    ]);
  });

  it("truncates a password longer than 32 bytes to the padding length", () => {
    const long = Uint8Array.from({ length: 40 }, (_v, i) => i);
    expect(Array.from(padOrTruncatePassword(long))).toEqual(
      Array.from(long.subarray(0, PASSWORD_PADDING.length)),
    );
  });

  it("returns the padding string itself for an empty password", () => {
    expect(Array.from(padOrTruncatePassword(new Uint8Array(0)))).toEqual(
      Array.from(PASSWORD_PADDING),
    );
  });

  it("keeps an exactly-32-byte password byte for byte", () => {
    const exact = Uint8Array.from({ length: 32 }, (_v, i) => 0xa0 + i);
    expect(Array.from(padOrTruncatePassword(exact))).toEqual(Array.from(exact));
  });
});

describe("createStandardDecryptor: every cipher against qpdf's own ciphertext", () => {
  // Each fixture's /Info /Title is a real string qpdf encrypted with that fixture's own handler; decrypting it through createStandardDecryptor exercises the version dispatch, key-length resolution, /U verification, per-object key mixing and cipher routing in one assertion whose expected bytes came from an independent implementation. The object-stream fixture is absent because its /Info is not a directly-located object.
  const fixtures: readonly (readonly [
    string,
    () => Uint8Array<ArrayBuffer>,
  ])[] = [
    ["40-bit RC4 (/V 1 /R 2)", rc4Bits40EmptyUserPasswordPdf],
    ["128-bit RC4 (/V 2 /R 3)", rc4Bits128EmptyUserPasswordPdf],
    ["AES-128 (/V 4 /R 4)", aes128EmptyUserPasswordPdf],
    ["AES-128 with /EncryptMetadata false", aes128CleartextMetadataPdf],
    ["AES-256 (/V 5 /R 6)", aes256EmptyUserPasswordPdf],
  ];

  for (const [label, source] of fixtures) {
    it(`decrypts the /Info /Title of a permissions-only PDF encrypted with ${label}`, () => {
      const { encryptDict, fileId } = realHandlerFrom(source());
      const decryptor = createStandardDecryptor(
        encryptDict,
        fileId,
        NOOP_DIAGNOSTIC_SINK,
      );
      expect(
        Array.from(decryptor.decryptString(encryptedTitleFrom(source()), 2, 0)),
      ).toEqual(Array.from(asciiBytes("Secret Title")));
    });
  }

  it("keeps a revision 3 file readable when /EncryptMetadata is false, the flag only feeding the key at revision 4 and later", () => {
    // Algorithm 2 step (f)'s four 0xFF bytes apply from revision 4 upwards; a revision 3 file with the flag set to false must derive exactly the key it would with the flag absent, so the real /U keeps verifying.
    const { encryptDict, fileId } = realHandlerFrom(
      rc4Bits128EmptyUserPasswordPdf(),
    );
    const decryptor = createStandardDecryptor(
      withEntries(encryptDict, {
        EncryptMetadata: { kind: "bool", value: false },
      }),
      fileId,
      NOOP_DIAGNOSTIC_SINK,
    );
    expect(
      Array.from(
        decryptor.decryptString(
          encryptedTitleFrom(rc4Bits128EmptyUserPasswordPdf()),
          2,
          0,
        ),
      ),
    ).toEqual(Array.from(asciiBytes("Secret Title")));
  });

  it("compares all 32 bytes of /U at revision 2, so a corrupted tail is refused", () => {
    const { encryptDict, fileId } = realHandlerFrom(
      rc4Bits40EmptyUserPasswordPdf(),
    );
    const storedUser = dictGet(encryptDict, "U");
    if (storedUser?.kind !== "string") {
      throw new Error("fixture /Encrypt dictionary lacks a /U string");
    }
    const corrupted = new Uint8Array(storedUser.bytes);
    corrupted[20]! ^= 0xff;
    expect(() =>
      createStandardDecryptor(
        withEntries(encryptDict, { U: pdfHexString(corrupted) }),
        fileId,
        NOOP_DIAGNOSTIC_SINK,
      ),
    ).toThrow(PdfPasswordRequiredError);
  });

  it("treats a revision 3 /U as significant only in its first 16 bytes, so an arbitrary tail still opens", () => {
    // Algorithm 5 step (f) pads its 16-byte result out to 32 with arbitrary bytes, so bytes 16 to 31 carry no meaning; corrupting one must not lock the file.
    const { encryptDict, fileId } = realHandlerFrom(
      rc4Bits128EmptyUserPasswordPdf(),
    );
    const storedUser = dictGet(encryptDict, "U");
    if (storedUser?.kind !== "string") {
      throw new Error("fixture /Encrypt dictionary lacks a /U string");
    }
    const corrupted = new Uint8Array(storedUser.bytes);
    corrupted[20]! ^= 0xff;
    const decryptor = createStandardDecryptor(
      withEntries(encryptDict, { U: pdfHexString(corrupted) }),
      fileId,
      NOOP_DIAGNOSTIC_SINK,
    );
    expect(
      Array.from(
        decryptor.decryptString(
          encryptedTitleFrom(rc4Bits128EmptyUserPasswordPdf()),
          2,
          0,
        ),
      ),
    ).toEqual(Array.from(asciiBytes("Secret Title")));
  });
});

describe("createStandardDecryptor: crypt-filter routing and key lengths", () => {
  it("defaults an absent /StmF and /StrF to /Identity at /V 4", () => {
    const { dict, fileId } = legacyHandlerWithKeyBytes({
      source: aes128EmptyUserPasswordPdf,
      version: 4,
      revision: 4,
      keyBytes: 16,
      entries: { Length: pdfNum(128) },
    });
    const decryptor = createStandardDecryptor(
      dict,
      fileId,
      NOOP_DIAGNOSTIC_SINK,
    );
    const value = asciiBytes("left in the clear");
    expect(decryptor.decryptString(value, 7, 0)).toBe(value);
    expect(decryptor.decryptStream(value, pdfDict({}), 7, 0)).toBe(value);
  });

  it("maps a /CFM /None crypt filter to the identity method", () => {
    const { dict, fileId } = legacyHandlerWithKeyBytes({
      source: aes128EmptyUserPasswordPdf,
      version: 4,
      revision: 4,
      keyBytes: 16,
      entries: {
        CF: pdfDict({ StdCF: pdfDict({ CFM: pdfName("None") }) }),
        StmF: pdfName("StdCF"),
        StrF: pdfName("StdCF"),
        Length: pdfNum(128),
      },
    });
    const decryptor = createStandardDecryptor(
      dict,
      fileId,
      NOOP_DIAGNOSTIC_SINK,
    );
    const value = asciiBytes("also left in the clear");
    expect(decryptor.decryptString(value, 7, 0)).toBe(value);
    expect(decryptor.decryptStream(value, pdfDict({}), 7, 0)).toBe(value);
  });

  it("routes a /CFM /V2 crypt filter through RC4 with a per-object key", () => {
    const { dict, fileId, fileKey } = legacyHandlerWithKeyBytes({
      source: aes128EmptyUserPasswordPdf,
      version: 4,
      revision: 4,
      keyBytes: 16,
      entries: {
        CF: pdfDict({
          StdCF: pdfDict({ CFM: pdfName("V2"), Length: pdfNum(16) }),
        }),
        StmF: pdfName("StdCF"),
        StrF: pdfName("StdCF"),
      },
    });
    const decryptor = createStandardDecryptor(
      dict,
      fileId,
      NOOP_DIAGNOSTIC_SINK,
    );
    const value = Uint8Array.from({ length: 24 }, (_v, i) => (i * 37) & 0xff);
    expect(Array.from(decryptor.decryptString(value, 11, 3))).toEqual(
      Array.from(rc4(objectKey(fileKey, 11, 3, "rc4"), value)),
    );
  });

  it("resolves a /CF /Length of exactly 40 as bits, the boundary of the bytes-or-bits guess", () => {
    // 40 is the one value where reading the /Length as bits (5-byte key) and as bytes (40-byte key, out of range) genuinely diverge.
    const { dict, fileId, fileKey } = legacyHandlerWithKeyBytes({
      source: aes128EmptyUserPasswordPdf,
      version: 4,
      revision: 4,
      keyBytes: 5,
      entries: {
        CF: pdfDict({
          StdCF: pdfDict({ CFM: pdfName("V2"), Length: pdfNum(40) }),
        }),
        StmF: pdfName("StdCF"),
        StrF: pdfName("StdCF"),
      },
    });
    const decryptor = createStandardDecryptor(
      dict,
      fileId,
      NOOP_DIAGNOSTIC_SINK,
    );
    const value = Uint8Array.from(
      { length: 20 },
      (_v, i) => (i * 11 + 3) & 0xff,
    );
    expect(Array.from(decryptor.decryptString(value, 4, 1))).toEqual(
      Array.from(rc4(objectKey(fileKey, 4, 1, "rc4"), value)),
    );
  });

  it("falls back to the /Encrypt dictionary's own /Length in bits when the crypt filter states none", () => {
    // The filter states no /Length of its own, so the key length is the top-level /Length's 128 bits: the /U computed for a 16-byte key verifies, and a crafted value comes back through RC4 keyed exactly as the derivation says. The real fixture /Title is not the oracle here, because this dictionary routes /V2 (RC4) while qpdf encrypted that string under AESV2.
    const { dict, fileId, fileKey } = legacyHandlerWithKeyBytes({
      source: aes128EmptyUserPasswordPdf,
      version: 4,
      revision: 4,
      keyBytes: 16,
      entries: {
        CF: pdfDict({ StdCF: pdfDict({ CFM: pdfName("V2") }) }),
        StmF: pdfName("StdCF"),
        StrF: pdfName("StdCF"),
        Length: pdfNum(128),
      },
    });
    const decryptor = createStandardDecryptor(
      dict,
      fileId,
      NOOP_DIAGNOSTIC_SINK,
    );
    const value = Uint8Array.from(
      { length: 22 },
      (_v, i) => (i * 17 + 5) & 0xff,
    );
    expect(Array.from(decryptor.decryptString(value, 8, 2))).toEqual(
      Array.from(rc4(objectKey(fileKey, 8, 2, "rc4"), value)),
    );
  });

  it("gives /CFM /AESV2 exactly one key size whatever /Length claims", () => {
    // AES-128 has a single legal key size, so a /Length of 5 (a plausible byte count) must not shrink the key: the real fixture /U still has to verify against the 16-byte derivation, and the real qpdf ciphertext still has to come back.
    const { dict, fileId } = legacyHandlerWithKeyBytes({
      source: aes128EmptyUserPasswordPdf,
      version: 4,
      revision: 4,
      keyBytes: 16,
      entries: {
        CF: pdfDict({
          StdCF: pdfDict({ CFM: pdfName("AESV2"), Length: pdfNum(5) }),
        }),
        StmF: pdfName("StdCF"),
        StrF: pdfName("StdCF"),
      },
    });
    const decryptor = createStandardDecryptor(
      dict,
      fileId,
      NOOP_DIAGNOSTIC_SINK,
    );
    expect(
      Array.from(
        decryptor.decryptString(
          encryptedTitleFrom(aes128EmptyUserPasswordPdf()),
          2,
          0,
        ),
      ),
    ).toEqual(Array.from(asciiBytes("Secret Title")));
  });

  it("ignores /CF key lengths at /V 2, whose key length comes from /Length alone", () => {
    // /StmF names the filter deliberately: a reader that wrongly consulted crypt-filter key lengths at /V 2 would resolve the filter's /Length 5 as a 5-byte key and fail /U verification against the 16-byte derivation this /U was computed for.
    const { dict, fileId } = legacyHandlerWithKeyBytes({
      source: rc4Bits128EmptyUserPasswordPdf,
      version: 2,
      revision: 3,
      keyBytes: 16,
      entries: {
        CF: pdfDict({
          StdCF: pdfDict({ CFM: pdfName("V2"), Length: pdfNum(5) }),
        }),
        StmF: pdfName("StdCF"),
        StrF: pdfName("StdCF"),
        Length: pdfNum(128),
      },
    });
    const decryptor = createStandardDecryptor(
      dict,
      fileId,
      NOOP_DIAGNOSTIC_SINK,
    );
    expect(
      Array.from(
        decryptor.decryptString(
          encryptedTitleFrom(rc4Bits128EmptyUserPasswordPdf()),
          2,
          0,
        ),
      ),
    ).toEqual(Array.from(asciiBytes("Secret Title")));
  });

  it("keeps /V 1 at its fixed 40-bit key whatever /Length declares", () => {
    const { dict, fileId } = legacyHandlerWithKeyBytes({
      source: rc4Bits40EmptyUserPasswordPdf,
      version: 1,
      revision: 2,
      keyBytes: 5,
      entries: { Length: pdfNum(128) },
    });
    const decryptor = createStandardDecryptor(
      dict,
      fileId,
      NOOP_DIAGNOSTIC_SINK,
    );
    expect(
      Array.from(
        decryptor.decryptString(
          encryptedTitleFrom(rc4Bits40EmptyUserPasswordPdf()),
          2,
          0,
        ),
      ),
    ).toEqual(Array.from(asciiBytes("Secret Title")));
  });

  it("resolves a crypt filter literally named /Identity when /StmF is absent", () => {
    // The absent-/StmF default and the identity method are two different lookups: the method defaults to identity encryption, while the key-length resolution still looks a filter called /Identity up in /CF. A dictionary defining one (with /V2's byte-counted /Length 5) must key itself at 5 bytes, not at the top-level /Length's 16, or the /U computed here stops verifying.
    const { dict, fileId } = legacyHandlerWithKeyBytes({
      source: aes128EmptyUserPasswordPdf,
      version: 4,
      revision: 4,
      keyBytes: 5,
      entries: {
        CF: pdfDict({
          Identity: pdfDict({ CFM: pdfName("V2"), Length: pdfNum(5) }),
        }),
        Length: pdfNum(128),
      },
    });
    const decryptor = createStandardDecryptor(
      dict,
      fileId,
      NOOP_DIAGNOSTIC_SINK,
    );
    const value = asciiBytes("identity leaves this alone");
    expect(decryptor.decryptString(value, 7, 0)).toBe(value);
  });

  it("reports a crypt filter with no /CFM at all as absent rather than named", () => {
    const { dict, fileId } = legacyHandlerWithKeyBytes({
      source: aes128EmptyUserPasswordPdf,
      version: 4,
      revision: 4,
      keyBytes: 16,
      entries: {
        CF: pdfDict({ StdCF: pdfDict({}) }),
        StmF: pdfName("StdCF"),
        StrF: pdfName("StdCF"),
      },
    });
    expect(() =>
      createStandardDecryptor(dict, fileId, NOOP_DIAGNOSTIC_SINK),
    ).toThrow(/unsupported \/CFM \(absent\)/);
  });

  it("refuses a /Length that resolves outside the 40 to 128 bit range, naming the bits", () => {
    // The /U is computed for the declared 17-byte key, so a handler that skipped the range check would go on to verify it and open; the refusal itself is what is being pinned.
    const tooLong = legacyHandlerWithKeyBytes({
      source: rc4Bits128EmptyUserPasswordPdf,
      version: 2,
      revision: 3,
      keyBytes: 17,
      entries: { Length: pdfNum(136) },
    });
    expect(() =>
      createStandardDecryptor(
        tooLong.dict,
        tooLong.fileId,
        NOOP_DIAGNOSTIC_SINK,
      ),
    ).toThrow(/136-bit file key, outside the 40-128 bit range/);

    const tooShort = legacyHandlerWithKeyBytes({
      source: rc4Bits128EmptyUserPasswordPdf,
      version: 2,
      revision: 3,
      keyBytes: 3,
      entries: { Length: pdfNum(24) },
    });
    expect(() =>
      createStandardDecryptor(
        tooShort.dict,
        tooShort.fileId,
        NOOP_DIAGNOSTIC_SINK,
      ),
    ).toThrow(/24-bit file key, outside the 40-128 bit range/);
  });

  it("accepts revision 5, whose hashes stop at the plain SHA-256 of Algorithm 2.A", () => {
    const fileKey = Uint8Array.from({ length: 32 }, (_v, i) => i);
    const dict = aesV3HandlerWithKey({ revision: 5, fileKey });
    const decryptor = createStandardDecryptor(
      dict,
      new Uint8Array(0),
      NOOP_DIAGNOSTIC_SINK,
    );
    // A value encrypted under the chosen key coming back as the right plaintext proves /UE was unwrapped with the revision 5 hash, not merely that the handler was accepted.
    const padded = new Uint8Array(16).fill(4);
    padded.set(asciiBytes("Secret Title"));
    const iv = Uint8Array.from({ length: 16 }, (_v, i) => 0x50 + i);
    const value = concatBytes([iv, aesCbcEncrypt(fileKey, iv, padded)]);
    expect(Array.from(decryptor.decryptString(value, 3, 0))).toEqual(
      Array.from(asciiBytes("Secret Title")),
    );
  });

  it("reports a revision 6 /UE shorter than the 32-byte key it must carry", () => {
    const dict = aesV3HandlerWithKey({
      revision: 6,
      fileKey: Uint8Array.from({ length: 32 }, (_v, i) => i),
      ueLength: 16,
    });
    expect(() =>
      createStandardDecryptor(dict, new Uint8Array(0), NOOP_DIAGNOSTIC_SINK),
    ).toThrow(/\/UE entry is 16 bytes; revision 6 requires 32/);
  });
});

describe("createStandardDecryptor: handler and revision dispatch", () => {
  it("names the handler as unnamed when /Filter is absent altogether", () => {
    expect(() =>
      createStandardDecryptor(
        pdfDict({ V: pdfNum(2), R: pdfNum(3) }),
        EMPTY_ID,
        NOOP_DIAGNOSTIC_SINK,
      ),
    ).toThrow(/the unnamed security handler/);
  });

  it("names a non-standard handler in the refusal", () => {
    expect(() =>
      createStandardDecryptor(
        pdfDict({
          Filter: pdfName("Adobe.PubSec"),
          V: pdfNum(2),
          R: pdfNum(3),
        }),
        EMPTY_ID,
        NOOP_DIAGNOSTIC_SINK,
      ),
    ).toThrow(/the \/Adobe.PubSec security handler/);
  });

  it("rejects a revision 6 handler dictionary at /V 2 rather than reading it as legacy", () => {
    expect(() =>
      createStandardDecryptor(
        pdfDict({ Filter: pdfName("Standard"), V: pdfNum(2), R: pdfNum(6) }),
        EMPTY_ID,
        NOOP_DIAGNOSTIC_SINK,
      ),
    ).toThrow(/unsupported standard security handler revision \/R 6/);
  });
});

describe("hardenedHash: Algorithm 2.B's round loop", () => {
  const empty = new Uint8Array(0);

  it("stops at the plain SHA-256 digest for revision 5", () => {
    const password = asciiBytes("password");
    const salt = Uint8Array.from({ length: 8 }, (_v, i) => 0x30 + i);
    const userData = asciiBytes("ud");
    expect(hardenedHash(password, salt, userData, 5)).toEqual(
      sha256(concatBytes([password, salt, userData])),
    );
  });

  // An independent transcription of Algorithm 2.B's round loop over this package's own conformance-tested SHA-2 and AES primitives, used to locate salt values whose 2.B trace lands on a specific termination boundary. It is the oracle the two boundary tests below assert against.
  function traceRounds(salt: Uint8Array<ArrayBuffer>): {
    rounds: number;
    lastByteAtStop: number;
    k: Uint8Array<ArrayBuffer>;
  } {
    let k = sha256(concatBytes([empty, salt, empty]));
    let round = 0;
    for (;;) {
      const roundInput = concatBytes([empty, k, empty]);
      const k1 = new Uint8Array(roundInput.length * 64);
      for (let i = 0; i < 64; i++) {
        k1.set(roundInput, i * roundInput.length);
      }
      const e = aesCbcEncrypt(
        k.subarray(0, AES_BLOCK_BYTES),
        k.subarray(AES_BLOCK_BYTES, AES_BLOCK_BYTES * 2),
        k1,
      );
      let sum = 0;
      for (let i = 0; i < AES_BLOCK_BYTES; i++) {
        sum += e[i]!;
      }
      const selector = sum % 3;
      k = selector === 0 ? sha256(e) : selector === 1 ? sha384(e) : sha512(e);
      round++;
      if (round >= 64 && e[e.length - 1]! <= round - 32) {
        return { rounds: round, lastByteAtStop: e[e.length - 1]!, k };
      }
    }
  }

  function saltWith(
    predicate: (trace: ReturnType<typeof traceRounds>) => boolean,
  ): { salt: Uint8Array<ArrayBuffer>; trace: ReturnType<typeof traceRounds> } {
    for (let i = 0; i < 10_000; i++) {
      const salt = Uint8Array.from(
        { length: 8 },
        (_v, j) => (i >> (8 * (7 - j))) & 0xff,
      );
      const trace = traceRounds(salt);
      if (predicate(trace)) {
        return { salt, trace };
      }
    }
    throw new Error("no salt with the wanted termination trace was found");
  }

  it("stops after exactly the minimum 64 rounds when round 64's last byte is small enough", () => {
    // Roughly one salt in eight stops at the first legal opportunity, so the search below is a handful of traces, not thousands.
    const { salt, trace } = saltWith((t) => t.rounds === 64);
    expect(trace.rounds).toBe(64);
    expect(hardenedHash(empty, salt, empty, 6)).toEqual(
      trace.k.subarray(0, 32),
    );
  });

  it("stops at the termination test's equality boundary rather than running another round", () => {
    // The loop continues while the last byte is strictly greater than round minus 32; a salt whose stop lands with the last byte exactly at round minus 32 pins that the comparison is strict, since an off-by-one there would run one more round and produce a different key entirely.
    const { salt, trace } = saltWith(
      (t) => t.rounds >= 64 && t.lastByteAtStop === t.rounds - 32,
    );
    expect(trace.lastByteAtStop).toBe(trace.rounds - 32);
    expect(hardenedHash(empty, salt, empty, 6)).toEqual(
      trace.k.subarray(0, 32),
    );
  });
});

describe("createStandardDecryptor: AES values with crafted padding and truncation", () => {
  // A revision 6 handler built around a known 32-byte key, so a test can encrypt its own values with exactly that key and assert byte for byte what comes back: which padding is stripped, which is kept with a diagnostic, and which truncation is tolerated.
  const fileKey = Uint8Array.from(
    { length: 32 },
    (_v, i) => (i * 13 + 5) & 0xff,
  );
  const dict = aesV3HandlerWithKey({ revision: 6, fileKey });

  function decryptorWith(sink: (diagnostic: PdfDiagnostic) => void) {
    return createStandardDecryptor(dict, new Uint8Array(0), sink);
  }

  function encryptedValue(
    plainBlocks: Uint8Array<ArrayBuffer>,
  ): Uint8Array<ArrayBuffer> {
    const iv = Uint8Array.from({ length: 16 }, (_v, i) => (0x40 + i) & 0xff);
    return concatBytes([iv, aesCbcEncrypt(fileKey, iv, plainBlocks)]);
  }

  it("strips valid PKCS#7 padding of four bytes and of a whole block", () => {
    const decryptor = decryptorWith(NOOP_DIAGNOSTIC_SINK);
    const pad4 = new Uint8Array(16).fill(4);
    pad4.set(asciiBytes("Secret Title"));
    expect(
      Array.from(decryptor.decryptString(encryptedValue(pad4), 2, 0)),
    ).toEqual(Array.from(asciiBytes("Secret Title")));

    const pad16 = new Uint8Array(32).fill(16);
    pad16.set(asciiBytes("sixteen bytes!!!"));
    const decrypted = decryptor.decryptString(encryptedValue(pad16), 2, 0);
    expect(Array.from(decrypted)).toEqual(
      Array.from(asciiBytes("sixteen bytes!!!")),
    );

    // A single pad byte is the smallest valid padding, and the one an off-by-one in the validity test would reject.
    const pad1 = new Uint8Array(16).fill(1);
    pad1.set(asciiBytes("fifteen bytes!!"));
    expect(
      Array.from(decryptor.decryptString(encryptedValue(pad1), 2, 0)),
    ).toEqual(Array.from(asciiBytes("fifteen bytes!!")));
  });

  it("keeps the bytes unstripped, with a diagnostic, when the pad byte is zero or above the block size", () => {
    const { sink, diagnostics } = collectDiagnostics();
    const decryptor = decryptorWith(sink);
    const zeroPad = new Uint8Array(16).fill(0);
    zeroPad.set(asciiBytes("zero pad here!"));
    const zeroValue = encryptedValue(zeroPad);
    expect(decryptor.decryptString(zeroValue, 2, 0).length).toBe(
      zeroValue.length - 16,
    );

    const bigPad = new Uint8Array(16).fill(17);
    bigPad.set(asciiBytes("big pad here!!"));
    const bigValue = encryptedValue(bigPad);
    expect(decryptor.decryptString(bigValue, 2, 0).length).toBe(
      bigValue.length - 16,
    );

    expect(diagnostics.map((d) => d.code)).toEqual([
      "pdf/decrypt-bad-padding",
      "pdf/decrypt-bad-padding",
    ]);
    for (const diagnostic of diagnostics) {
      expect(diagnostic.message).toMatch(/did not end in valid PKCS#7 padding/);
    }
  });

  it("drops a trailing partial block with a diagnostic, keeping the whole blocks", () => {
    const { sink, diagnostics } = collectDiagnostics();
    const decryptor = decryptorWith(sink);
    const padded = new Uint8Array(16).fill(3);
    padded.set(asciiBytes("drop the rest"));
    const value = concatBytes([
      encryptedValue(padded),
      asciiBytes("1234"), // ciphertext beyond a whole block: undecryptable, must be dropped not partially read
    ]);
    const decrypted = decryptor.decryptString(value, 2, 0);
    expect(Array.from(decrypted)).toEqual(
      Array.from(asciiBytes("drop the rest")),
    );
    expect(diagnostics.map((d) => d.code)).toEqual(["pdf/decrypt-truncated"]);
    expect(diagnostics[0]?.message).toMatch(
      /not a whole number of 16-byte blocks/,
    );
  });

  it("treats an empty value as empty with no diagnostic at all", () => {
    const { sink, diagnostics } = collectDiagnostics();
    const decryptor = decryptorWith(sink);
    expect(decryptor.decryptString(new Uint8Array(0), 2, 0)).toHaveLength(0);
    expect(diagnostics).toEqual([]);
  });

  it("reports a value too short for an initialisation vector by its actual length", () => {
    const { sink, diagnostics } = collectDiagnostics();
    const decryptor = decryptorWith(sink);
    expect(decryptor.decryptString(asciiBytes("five"), 2, 0)).toHaveLength(0);
    expect(diagnostics.map((d) => d.code)).toEqual(["pdf/decrypt-truncated"]);
    expect(diagnostics[0]?.message).toMatch(
      /is 4 bytes, too short to carry even its own initialisation vector/,
    );
  });
});
