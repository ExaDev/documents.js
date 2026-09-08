import { describe, expect, it } from "vitest";
import { aesCbcDecrypt } from "./crypto/aes";
import { rc4 } from "./crypto/rc4";
import {
  computeLegacyFileKeyFromPaddedPassword,
  hardenedHash,
  legacyUserValueCore,
  objectKey,
  padOrTruncatePassword,
} from "./encrypt";
import type { PdfEncryptionScheme } from "./encrypt-write";
import { PdfEncryptionError, createStandardEncryptor } from "./encrypt-write";
import { LAYOUT_FORMAT_VERSION } from "./layout";
import type { LayoutDocument } from "./layout";
import { asName, asNumber, dictGet } from "./objects";
import type { PdfDict } from "./objects";
import { readPdf } from "./read";
import { writePdf } from "./write";

const HELVETICA = {
  family: "Helvetica",
  weight: "normal",
  style: "normal",
} as const;
const BLACK = { r: 0, g: 0, b: 0 };
const ALL_SCHEMES: readonly PdfEncryptionScheme[] = [
  "rc4-40",
  "rc4-128",
  "aes-128",
  "aes-256",
];

function docWithSecretContent(): LayoutDocument {
  return {
    formatVersion: LAYOUT_FORMAT_VERSION,
    metadata: { title: "Secret Title", author: "Jane Smith" },
    pages: [
      {
        widthPt: 200,
        heightPt: 100,
        items: [
          {
            kind: "text",
            text: "Encrypted hello",
            xPt: 10,
            yPt: 50,
            font: HELVETICA,
            sizePt: 12,
            color: BLACK,
          },
        ],
      },
    ],
    images: {},
  };
}

function requireStringBytes(
  dict: PdfDict,
  key: string,
): Uint8Array<ArrayBuffer> {
  const value = dictGet(dict, key);
  if (value?.kind !== "string") {
    throw new Error(`expected /${key} to be a direct string`);
  }
  return value.bytes;
}

describe("createStandardEncryptor: default scope", () => {
  it("defaults to aes-256 with an empty user password and full permissions", () => {
    const encryptor = createStandardEncryptor({}, new Uint8Array(16));
    expect(asName(dictGet(encryptor.encryptDict, "Filter"))).toBe("Standard");
    expect(asNumber(dictGet(encryptor.encryptDict, "V"))).toBe(5);
    expect(asNumber(dictGet(encryptor.encryptDict, "R"))).toBe(6);
    expect(asNumber(dictGet(encryptor.encryptDict, "P"))).toBe(-4); // every meaningful/reserved bit set except bits 1-2
  });

  it("defaults the owner password to the user password when only one is supplied", () => {
    // Algorithm 3 step (a)'s own convention, applied uniformly across schemes: with no owner password at all, the resulting /O must be exactly what an explicit ownerPassword equal to userPassword would produce.
    const fileId = new Uint8Array(16).fill(7);
    const a = createStandardEncryptor(
      { userPassword: "shared", scheme: "rc4-128" },
      fileId,
    );
    const b = createStandardEncryptor(
      { userPassword: "shared", ownerPassword: "shared", scheme: "rc4-128" },
      fileId,
    );
    expect(requireStringBytes(a.encryptDict, "O")).toEqual(
      requireStringBytes(b.encryptDict, "O"),
    );
  });

  it("restricts permitted operations via the permissions option", () => {
    const encryptor = createStandardEncryptor(
      { permissions: { print: false, modifyContents: false } },
      new Uint8Array(16),
    );
    const p = asNumber(dictGet(encryptor.encryptDict, "P"))!;
    expect((p >> 2) & 1).toBe(0); // bit 3: print
    expect((p >> 3) & 1).toBe(0); // bit 4: modify
    expect((p >> 4) & 1).toBe(1); // bit 5: copy, still permitted
    expect((p >> 6) & 1).toBe(1); // bit 7: reserved, always 1
    expect((p >> 31) & 1).toBe(1); // bit 32: reserved, always 1
  });

  it("rejects a non-ASCII password for a legacy scheme", () => {
    expect(() =>
      createStandardEncryptor(
        { userPassword: "café", scheme: "rc4-128" },
        new Uint8Array(16),
      ),
    ).toThrow(PdfEncryptionError);
  });

  it("accepts a non-ASCII password for aes-256, whose passwords are Unicode", () => {
    expect(() =>
      createStandardEncryptor(
        { userPassword: "café", scheme: "aes-256" },
        new Uint8Array(16),
      ),
    ).not.toThrow();
  });

  it("never re-encrypts a /Type /Metadata stream when encryptMetadata is false", () => {
    const encryptor = createStandardEncryptor(
      { scheme: "aes-128", encryptMetadata: false },
      new Uint8Array(16),
    );
    const value = Uint8Array.from(new Array(32).fill(7));
    const metadataDict = {
      kind: "dict" as const,
      entries: new Map([["Type", { kind: "name" as const, name: "Metadata" }]]),
    };
    expect(encryptor.encryptStream(value, metadataDict, 9, 0)).toBe(value);
    const xobjectDict = {
      kind: "dict" as const,
      entries: new Map([["Type", { kind: "name" as const, name: "XObject" }]]),
    };
    expect(encryptor.encryptStream(value, xobjectDict, 9, 0)).not.toBe(value);
  });
});

// The primary correctness proof requested for this feature: encrypt a real document, then decrypt it back with this package's OWN reader and confirm the content survives. The reader only ever tries the empty user password (see encrypt.ts's own header), so every one of these uses an empty userPassword and a distinct, genuinely non-empty ownerPassword -- a real permissions-only document, still exercising Algorithm 3/9's owner-password computation for real, and (for rc4-128/aes-256) checked deeply; rc4-40/aes-128 get a real round trip too since the assertions are identical for every scheme.
describe("writePdf + readPdf: encryption round-trips through this package's own reader", () => {
  for (const scheme of ALL_SCHEMES) {
    it(`round-trips text and metadata through the ${scheme} scheme`, () => {
      const pdf = writePdf(docWithSecretContent(), {
        encryption: { ownerPassword: "let-the-owner-in-only", scheme },
      });
      const doc = readPdf(pdf);
      expect(doc.metadata.title).toBe("Secret Title");
      expect(doc.metadata.author).toBe("Jane Smith");
      const [page] = doc.pages;
      const [item] = page!.items;
      expect(item).toMatchObject({ kind: "text", text: "Encrypted hello" });
    });
  }

  it("produces a document that does not read back as its own plaintext", () => {
    // Sanity check on the round-trip tests above: without a decryptor, the raw bytes must not already contain the plaintext title, proving the string really was encrypted rather than the round trip merely tolerating an accidentally-unencrypted file.
    const pdf = writePdf(docWithSecretContent(), {
      encryption: { scheme: "aes-256" },
    });
    const text = new TextDecoder("latin1").decode(pdf);
    expect(text).not.toContain("Secret Title");
    expect(text).not.toContain("Encrypted hello");
  });

  it("writes no /Encrypt dictionary and no /ID at all when encryption is not requested", () => {
    const pdf = writePdf(docWithSecretContent());
    const text = new TextDecoder("latin1").decode(pdf);
    expect(text).not.toContain("/Encrypt");
    expect(text).not.toContain("/ID [");
  });
});

// Beyond the reader-level round trip above (necessarily an empty user password, since the reader accepts no other), these reconstruct Algorithm 6 (rc4-128) and Algorithm 2.A (aes-256) directly against the exact same exported primitives encrypt.ts's own read side uses, proving a genuinely non-empty user password is handled correctly end to end -- key derivation, /U validation, and per-object content decryption -- even though the public reader has no way to exercise that path itself.
describe("createStandardEncryptor: a real, non-empty user password verifies against the published algorithm", () => {
  it("rc4-128: Algorithm 2 + Algorithm 6 authenticate the real password, and Algorithm 1 decrypts real content", () => {
    const fileId = new Uint8Array(16).fill(0x42);
    const encryptor = createStandardEncryptor(
      { userPassword: "correct horse", scheme: "rc4-128" },
      fileId,
    );
    const owner = requireStringBytes(encryptor.encryptDict, "O");
    const user = requireStringBytes(encryptor.encryptDict, "U");
    const p = asNumber(dictGet(encryptor.encryptDict, "P"))!;
    const revision = asNumber(dictGet(encryptor.encryptDict, "R"))!;
    const keyBytes = 16;

    const asciiPasswordBytes = Uint8Array.from("correct horse", (ch) =>
      ch.charCodeAt(0),
    );
    const fileKey = computeLegacyFileKeyFromPaddedPassword(
      padOrTruncatePassword(asciiPasswordBytes),
      owner,
      p,
      fileId,
      revision,
      keyBytes,
      true,
    );
    // Algorithm 6: the forward Algorithm 5 computation over the real password's derived key must match the first 16 bytes this encryptor actually stored in /U.
    const recomputedUser = legacyUserValueCore(fileKey, fileId, revision);
    expect(recomputedUser.subarray(0, 16)).toEqual(user.subarray(0, 16));

    const plaintext = new TextEncoder().encode("a genuinely secret string");
    const ciphertext = encryptor.encryptString(plaintext, 11, 0);
    const objKey = objectKey(fileKey, 11, 0, "rc4");
    expect(rc4(objKey, ciphertext)).toEqual(plaintext);
  });

  it("aes-256: Algorithm 2.A authenticates the real password and unwraps the real file key from /UE", () => {
    const encryptor = createStandardEncryptor(
      { userPassword: "correct horse battery staple", scheme: "aes-256" },
      new Uint8Array(16),
    );
    const u = requireStringBytes(encryptor.encryptDict, "U");
    const ue = requireStringBytes(encryptor.encryptDict, "UE");
    const revision = asNumber(dictGet(encryptor.encryptDict, "R"))!;
    const passwordBytes = new TextEncoder().encode(
      "correct horse battery staple",
    );

    const validationSalt = u.subarray(32, 40);
    const keySalt = u.subarray(40, 48);
    const empty = new Uint8Array(0);
    const validationHash = hardenedHash(
      passwordBytes,
      validationSalt,
      empty,
      revision,
    );
    expect(validationHash).toEqual(u.subarray(0, 32));

    const intermediateKey = hardenedHash(
      passwordBytes,
      keySalt,
      empty,
      revision,
    );
    const zeroIv = new Uint8Array(16);
    const fileKey = aesCbcDecrypt(intermediateKey, zeroIv, ue);

    const plaintext = new TextEncoder().encode(
      "a genuinely secret AES-256 string",
    );
    const ciphertext = encryptor.encryptString(plaintext, 3, 0);
    const iv = ciphertext.subarray(0, 16);
    const body = ciphertext.subarray(16);
    const padded = aesCbcDecrypt(fileKey, iv, body);
    const padLength = padded[padded.length - 1]!;
    expect(padded.subarray(0, padded.length - padLength)).toEqual(plaintext);
  });
});

describe("createStandardEncryptor: the /Encrypt dictionary's own O/U/OE/UE", () => {
  it("are well-formed, non-empty strings for every scheme", () => {
    for (const scheme of ALL_SCHEMES) {
      const encryptor = createStandardEncryptor(
        { scheme, ownerPassword: "owner-secret" },
        new Uint8Array(16),
      );
      const owner = requireStringBytes(encryptor.encryptDict, "O");
      const user = requireStringBytes(encryptor.encryptDict, "U");
      expect(owner.length).toBeGreaterThan(0);
      expect(user.length).toBeGreaterThan(0);
      if (scheme === "aes-256") {
        expect(requireStringBytes(encryptor.encryptDict, "OE").length).toBe(32);
        expect(requireStringBytes(encryptor.encryptDict, "UE").length).toBe(32);
        expect(requireStringBytes(encryptor.encryptDict, "Perms").length).toBe(
          16,
        );
      }
    }
  });
});
