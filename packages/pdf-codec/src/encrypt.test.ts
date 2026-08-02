import { describe, expect, it } from 'vitest';
import { ByteReader } from './bytes/reader';
import type { PdfDiagnostic } from './diagnostics';
import { NOOP_DIAGNOSTIC_SINK, PdfEncryptedError, PdfPasswordRequiredError } from './diagnostics';
import { createStandardDecryptor } from './encrypt';
import type { PdfDict, PdfObject } from './objects';
import { asArray, asDict, dictGet, pdfDict, pdfHexString, pdfName, pdfNum } from './objects';
import { parseIndirectObject } from './parse';
import { aes128CleartextMetadataPdf, aes128EmptyUserPasswordPdf, rc4Bits128EmptyUserPasswordPdf } from './test-support/encrypted-pdfs';
import { readXref } from './xref';

// Handler-level tests: which /Encrypt dictionaries are readable at all, and how the crypt-filter routing behaves. That a supported dictionary genuinely decrypts a real file is proved end to end in read.test.ts against six qpdf-produced fixtures; these cover the dispatch and refusal paths around it.

function collectDiagnostics(): { sink: (diagnostic: PdfDiagnostic) => void; diagnostics: PdfDiagnostic[] } {
  const diagnostics: PdfDiagnostic[] = [];
  return { sink: (diagnostic) => diagnostics.push(diagnostic), diagnostics };
}

// Lifts a real fixture's own /Encrypt dictionary and /ID back out of the file, so a test can vary one entry of a genuinely valid handler (and keep a /U that genuinely verifies) instead of inventing a whole consistent one.
function realHandlerFrom(pdf: Uint8Array<ArrayBuffer>): { encryptDict: PdfDict; fileId: Uint8Array<ArrayBuffer> } {
  const xref = readXref(pdf, NOOP_DIAGNOSTIC_SINK);
  const reference = dictGet(xref.trailer, 'Encrypt');
  if (reference?.kind !== 'ref') {
    throw new Error('fixture trailer has no indirect /Encrypt reference');
  }
  const entry = xref.entries.get(reference.num);
  if (entry?.type !== 'offset') {
    throw new Error('fixture /Encrypt object is not directly located');
  }
  const reader = new ByteReader(pdf);
  reader.seek(entry.offset);
  const encryptDict = asDict(parseIndirectObject(reader, NOOP_DIAGNOSTIC_SINK)?.value);
  const id = asArray(dictGet(xref.trailer, 'ID'))?.[0];
  if (encryptDict === undefined || id?.kind !== 'string') {
    throw new Error('fixture /Encrypt dictionary or /ID could not be read');
  }
  return { encryptDict, fileId: id.bytes };
}

function withEntries(dict: PdfDict, overrides: Record<string, PdfObject>): PdfDict {
  const entries = new Map(dict.entries);
  for (const [key, value] of Object.entries(overrides)) {
    entries.set(key, value);
  }
  return { kind: 'dict', entries };
}

const EMPTY_ID = new Uint8Array(0);

describe('createStandardDecryptor: handlers it refuses outright', () => {
  it('rejects a security handler other than /Standard', () => {
    const dict = pdfDict({ Filter: pdfName('Adobe.PubSec'), V: pdfNum(4), R: pdfNum(4) });
    expect(() => createStandardDecryptor(dict, EMPTY_ID, NOOP_DIAGNOSTIC_SINK)).toThrow(PdfEncryptedError);
    expect(() => createStandardDecryptor(dict, EMPTY_ID, NOOP_DIAGNOSTIC_SINK)).toThrow(/only the standard security handler/);
  });

  it('rejects a missing /Filter rather than assuming /Standard', () => {
    expect(() => createStandardDecryptor(pdfDict({ V: pdfNum(2), R: pdfNum(3) }), EMPTY_ID, NOOP_DIAGNOSTIC_SINK)).toThrow(PdfEncryptedError);
  });

  // /V 3 is Adobe's own unpublished algorithm: there is no specification to implement it from, so it is genuinely unimplementable rather than merely unimplemented.
  it('rejects the unpublished /V 3 algorithm', () => {
    const dict = pdfDict({ Filter: pdfName('Standard'), V: pdfNum(3), R: pdfNum(3) });
    expect(() => createStandardDecryptor(dict, EMPTY_ID, NOOP_DIAGNOSTIC_SINK)).toThrow(/unsupported standard security handler version \/V 3/);
  });

  it('rejects a revision outside the range its version defines', () => {
    const legacy = pdfDict({ Filter: pdfName('Standard'), V: pdfNum(2), R: pdfNum(1) });
    expect(() => createStandardDecryptor(legacy, EMPTY_ID, NOOP_DIAGNOSTIC_SINK)).toThrow(/unsupported standard security handler revision \/R 1/);
    const modern = pdfDict({ Filter: pdfName('Standard'), V: pdfNum(5), R: pdfNum(4) });
    expect(() => createStandardDecryptor(modern, EMPTY_ID, NOOP_DIAGNOSTIC_SINK)).toThrow(/\/V 5 encryption with an unsupported revision \/R 4/);
  });

  it('rejects a crypt filter whose /CFM this codec does not implement', () => {
    const { encryptDict, fileId } = realHandlerFrom(aes128EmptyUserPasswordPdf());
    const cf = pdfDict({ StdCF: pdfDict({ CFM: pdfName('AESV4'), Length: pdfNum(16) }) });
    expect(() => createStandardDecryptor(withEntries(encryptDict, { CF: cf }), fileId, NOOP_DIAGNOSTIC_SINK)).toThrow(/unsupported \/CFM \/AESV4/);
  });

  it('rejects a /StmF naming a crypt filter the /CF dictionary never defines', () => {
    const { encryptDict, fileId } = realHandlerFrom(aes128EmptyUserPasswordPdf());
    expect(() => createStandardDecryptor(withEntries(encryptDict, { StmF: pdfName('NoSuchFilter') }), fileId, NOOP_DIAGNOSTIC_SINK)).toThrow(/its own \/CF dictionary does not define/);
  });

  it('rejects an /Encrypt dictionary whose /O or /U is missing entirely', () => {
    const dict = pdfDict({ Filter: pdfName('Standard'), V: pdfNum(2), R: pdfNum(3), Length: pdfNum(128), P: pdfNum(-4) });
    expect(() => createStandardDecryptor(dict, EMPTY_ID, NOOP_DIAGNOSTIC_SINK)).toThrow(/\/O entry is missing or is not a direct string/);
  });
});

describe('createStandardDecryptor: password verification', () => {
  it('refuses a file whose /U does not match the empty user password', () => {
    const { encryptDict, fileId } = realHandlerFrom(rc4Bits128EmptyUserPasswordPdf());
    const wrongUser = pdfHexString(new Uint8Array(32).fill(0xab));
    expect(() => createStandardDecryptor(withEntries(encryptDict, { U: wrongUser }), fileId, NOOP_DIAGNOSTIC_SINK)).toThrow(PdfPasswordRequiredError);
  });

  // The pre-revision-5 key derivation mixes in the first /ID string, so the wrong /ID produces the wrong key and the /U check must catch it -- rather than the file appearing to open and every string coming back as noise.
  it('refuses a file when the /ID it was keyed with is wrong', () => {
    const { encryptDict } = realHandlerFrom(rc4Bits128EmptyUserPasswordPdf());
    expect(() => createStandardDecryptor(encryptDict, new Uint8Array(16).fill(0x11), NOOP_DIAGNOSTIC_SINK)).toThrow(PdfPasswordRequiredError);
  });

  it('reports a revision-6 /U that is too short to carry its own salts', () => {
    const dict = pdfDict({ Filter: pdfName('Standard'), V: pdfNum(5), R: pdfNum(6), U: pdfHexString(new Uint8Array(32)), UE: pdfHexString(new Uint8Array(32)) });
    expect(() => createStandardDecryptor(dict, EMPTY_ID, NOOP_DIAGNOSTIC_SINK)).toThrow(/requires 48/);
  });
});

describe('createStandardDecryptor: crypt-filter routing', () => {
  it('leaves strings untouched when /StrF is /Identity while streams stay encrypted', () => {
    const { encryptDict, fileId } = realHandlerFrom(aes128EmptyUserPasswordPdf());
    const decryptor = createStandardDecryptor(withEntries(encryptDict, { StrF: pdfName('Identity') }), fileId, NOOP_DIAGNOSTIC_SINK);
    const value = Uint8Array.from([1, 2, 3, 4]);
    expect(decryptor.decryptString(value, 5, 0)).toBe(value);
    // The stream path still runs a real cipher, so it cannot return the same object back.
    expect(decryptor.decryptStream(Uint8Array.from(new Array(48).fill(0)), pdfDict({}), 5, 0)).not.toBe(value);
  });

  // ISO 32000-1 7.6.3.2: with /EncryptMetadata false, a /Type /Metadata stream is the one stream in the file left in the clear. The fixture is a genuinely qpdf-encrypted --cleartext-metadata file rather than this package's own dictionary with the flag flipped: at revision 4 that flag also feeds four 0xFF bytes into Algorithm 2, so a flipped copy would derive a different file key and fail /U verification outright -- which the neighbouring test now pins deliberately.
  it('leaves a /Type /Metadata stream in the clear when /EncryptMetadata is false', () => {
    const { encryptDict, fileId } = realHandlerFrom(aes128CleartextMetadataPdf());
    const decryptor = createStandardDecryptor(encryptDict, fileId, NOOP_DIAGNOSTIC_SINK);
    const value = Uint8Array.from(new Array(48).fill(7));
    expect(decryptor.decryptStream(value, pdfDict({ Type: pdfName('Metadata') }), 5, 0)).toBe(value);
    expect(decryptor.decryptStream(value, pdfDict({ Type: pdfName('XObject') }), 5, 0)).not.toBe(value);
  });

  // The flag is an input to the key itself, not just a per-stream switch: taking a file encrypted with /EncryptMetadata true and merely asserting false over it must fail to authenticate, which is what proves Algorithm 2's step (f) is actually being applied rather than ignored.
  it('derives a different file key when /EncryptMetadata is false, so a flipped flag no longer authenticates', () => {
    const { encryptDict, fileId } = realHandlerFrom(aes128EmptyUserPasswordPdf());
    expect(() => createStandardDecryptor(withEntries(encryptDict, { EncryptMetadata: { kind: 'bool', value: false } }), fileId, NOOP_DIAGNOSTIC_SINK)).toThrow(PdfPasswordRequiredError);
  });

  it('still encrypts the metadata stream when /EncryptMetadata is absent, its default being true', () => {
    const { encryptDict, fileId } = realHandlerFrom(aes128EmptyUserPasswordPdf());
    const decryptor = createStandardDecryptor(encryptDict, fileId, NOOP_DIAGNOSTIC_SINK);
    const value = Uint8Array.from(new Array(48).fill(7));
    expect(decryptor.decryptStream(value, pdfDict({ Type: pdfName('Metadata') }), 5, 0)).not.toBe(value);
  });
});

describe('createStandardDecryptor: corrupt encrypted values degrade rather than throw', () => {
  it('reports an AES value too short to hold its own initialisation vector', () => {
    const { encryptDict, fileId } = realHandlerFrom(aes128EmptyUserPasswordPdf());
    const { sink, diagnostics } = collectDiagnostics();
    const decryptor = createStandardDecryptor(encryptDict, fileId, sink);
    expect(decryptor.decryptString(Uint8Array.from([1, 2, 3, 4, 5]), 5, 0)).toHaveLength(0);
    expect(diagnostics.map((d) => d.code)).toContain('pdf/decrypt-truncated');
  });

  it('treats an AES value carrying only an initialisation vector as empty, with no diagnostic', () => {
    const { encryptDict, fileId } = realHandlerFrom(aes128EmptyUserPasswordPdf());
    const { sink, diagnostics } = collectDiagnostics();
    const decryptor = createStandardDecryptor(encryptDict, fileId, sink);
    expect(decryptor.decryptString(new Uint8Array(16), 5, 0)).toHaveLength(0);
    expect(diagnostics).toHaveLength(0);
  });

  // A garbage AES value decrypts to garbage, which is the honest outcome -- what must not happen is a throw, or a result longer than the ciphertext that produced it.
  it('never throws or over-produces on a garbage AES value', () => {
    const { encryptDict, fileId } = realHandlerFrom(aes128EmptyUserPasswordPdf());
    const decryptor = createStandardDecryptor(encryptDict, fileId, NOOP_DIAGNOSTIC_SINK);
    const garbage = Uint8Array.from({ length: 48 }, (_unused, i) => (i * 31) & 0xff);
    expect(decryptor.decryptString(garbage, 9, 0).length).toBeLessThanOrEqual(garbage.length - 16);
  });
});
