#!/usr/bin/env node
// Regenerates src/test-support/encrypted-pdfs.ts: a set of genuinely encrypted PDFs, produced by qpdf, for src/encrypt.test.ts and src/read.test.ts to read back.
//
// Run with `node scripts/generate-encrypted-pdf-fixtures.mjs`, which requires qpdf on PATH (`brew install qpdf`). Not part of `pnpm build`/`pnpm test` -- the generated .ts file is committed like any other checked-in generated artifact, so the test suite needs neither qpdf nor a filesystem read to run.
//
// Why qpdf rather than encrypting a fixture with this package's own crypto: an encryption test that both writes and reads with the same code proves only that the code is self-consistent. Every fixture here is produced by a mature, independent implementation, so a bug in this package's own key derivation, per-object key mixing, or cipher shows up as a test failure rather than cancelling itself out. The plain source PDF is likewise built here by literal byte concatenation rather than by calling writePdf, matching src/test-support/pdf.ts's own "the read-side and write-side oracles must be genuinely independent" rule.
//
// This script is deliberately outside tsconfig.json's "include" and eslint.config.ts's linted set (see the "scripts" entry in both), matching the existing precedent for scripts/generate-math-font-asset.mjs.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outputPath = join(here, '..', 'src', 'test-support', 'encrypted-pdfs.ts');

// The plaintext every fixture below is an encrypted copy of. Deliberately carries BOTH a stream (the page content) and strings (the /Info entries): PDF encrypts the two through separate code paths -- separate crypt filters entirely, under /V 4 and /V 5 -- so a fixture with only one of them would leave half the implementation unexercised.
const PAGE_TEXT = 'Encrypted hello';
const INFO_TITLE = 'Secret Title';
const INFO_AUTHOR = 'Jane Smith';

function buildPlainPdf() {
  const content = Buffer.from(`BT /F1 12 Tf 10 50 Td (${PAGE_TEXT}) Tj ET`, 'latin1');
  const bodies = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const chunks = [Buffer.from('%PDF-1.4\n', 'latin1')];
  const offsets = [];
  let length = chunks[0].length;
  const push = (buffer) => {
    chunks.push(buffer);
    length += buffer.length;
  };
  bodies.forEach((body, index) => {
    offsets.push(length);
    push(Buffer.from(`${index + 1} 0 obj\n${body}\nendobj\n`, 'latin1'));
  });
  offsets.push(length);
  push(Buffer.from(`5 0 obj\n<< /Length ${content.length} >>\nstream\n`, 'latin1'));
  push(content);
  push(Buffer.from('\nendstream\nendobj\n', 'latin1'));
  offsets.push(length);
  push(Buffer.from(`6 0 obj\n<< /Title (${INFO_TITLE}) /Author (${INFO_AUTHOR}) >>\nendobj\n`, 'latin1'));

  const xrefOffset = length;
  const rows = ['xref\n0 7\n', '0000000000 65535 f \n', ...offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)];
  push(Buffer.from(rows.join(''), 'latin1'));
  push(Buffer.from(`trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`, 'latin1'));
  return Buffer.concat(chunks);
}

// Each fixture's own qpdf --encrypt arguments. --allow-weak-crypto is required for the RC4 variants: qpdf refuses to *write* RC4 without it, which is exactly right for new files and exactly why a reader still has to handle them.
const FIXTURES = [
  {
    name: 'rc4_40',
    exportName: 'rc4Bits40EmptyUserPasswordPdf',
    comment: '/V 1 /R 2, 40-bit RC4 -- the original PDF 1.1 encryption, still emitted by older producers. Owner password set, user password empty.',
    args: ['--allow-weak-crypto', '--encrypt', '--user-password=', '--owner-password=ownersecret', '--bits=40', '--'],
  },
  {
    name: 'rc4_128',
    exportName: 'rc4Bits128EmptyUserPasswordPdf',
    comment: '/V 2 /R 3, 128-bit RC4 -- adds Algorithm 2\'s 50-iteration key strengthening and Algorithm 5\'s /U derivation over the 40-bit case.',
    args: ['--allow-weak-crypto', '--encrypt', '--user-password=', '--owner-password=ownersecret', '--bits=128', '--use-aes=n', '--'],
  },
  {
    name: 'aes_128',
    exportName: 'aes128EmptyUserPasswordPdf',
    comment: '/V 4 /R 4 with a /CFM /AESV2 crypt filter -- the first version to route streams and strings through named crypt filters (/StmF, /StrF) rather than one document-wide cipher.',
    args: ['--encrypt', '--user-password=', '--owner-password=ownersecret', '--bits=128', '--use-aes=y', '--'],
  },
  {
    name: 'aes_128_cleartext_metadata',
    exportName: 'aes128CleartextMetadataPdf',
    comment:
      'The same /V 4 /R 4 AESV2 encryption with /EncryptMetadata false. Not a cosmetic variation: at revision 4 and above, that flag feeds four 0xFF bytes into Algorithm 2 itself, so this file has a genuinely different file key from the fixture above -- reading it at all proves that step is implemented, and its /U differs from the fixture above for exactly that reason.',
    args: ['--encrypt', '--user-password=', '--owner-password=ownersecret', '--bits=128', '--use-aes=y', '--cleartext-metadata', '--'],
  },
  {
    name: 'aes_256',
    exportName: 'aes256EmptyUserPasswordPdf',
    comment: '/V 5 /R 6 with a /CFM /AESV3 crypt filter -- the modern default. Its file key is unwrapped from /UE rather than derived from /O, and the password check runs the SHA-256/384/512 hardened hash of ISO 32000-2 Algorithm 2.B.',
    args: ['--encrypt', '--user-password=', '--owner-password=ownersecret', '--bits=256', '--'],
  },
  {
    name: 'aes_256_object_streams',
    exportName: 'aes256ObjectStreamsPdf',
    comment:
      'AES-256 again, but with the catalog, page tree and /Info packed into a compressed object stream behind a cross-reference stream -- what every modern producer actually emits. A genuinely separate code path, and one that is easy to get wrong in exactly one direction: per ISO 32000-1 7.5.7 the object stream is decrypted as a whole stream and the objects unpacked from it are then already in the clear, so decrypting their strings a second time would corrupt every one of them.',
    args: ['--encrypt', '--user-password=', '--owner-password=ownersecret', '--bits=256', '--', '--object-streams=generate'],
  },
  {
    name: 'rc4_128_user_password',
    exportName: 'rc4Bits128RealUserPasswordPdf',
    comment: 'A genuinely password-protected RC4-128 file: opening it needs the user password "letmein", which this codec neither accepts nor guesses.',
    args: ['--allow-weak-crypto', '--encrypt', '--user-password=letmein', '--owner-password=ownersecret', '--bits=128', '--use-aes=n', '--'],
  },
  {
    name: 'aes_256_user_password',
    exportName: 'aes256RealUserPasswordPdf',
    comment: 'The same, at /V 5 /R 6 -- the failure has to be detected by Algorithm 2.A\'s validation-salt check rather than by Algorithm 5\'s /U comparison.',
    args: ['--encrypt', '--user-password=letmein', '--owner-password=ownersecret', '--bits=256', '--'],
  },
];

const workDir = mkdtempSync(join(tmpdir(), 'pdf-codec-encrypt-'));
try {
  const plainPath = join(workDir, 'plain.pdf');
  writeFileSync(plainPath, buildPlainPdf());

  const sections = FIXTURES.map((fixture) => {
    const outPath = join(workDir, `${fixture.name}.pdf`);
    execFileSync('qpdf', [...fixture.args, plainPath, outPath]);
    const base64 = readFileSync(outPath).toString('base64');
    const chunks = base64.match(/.{1,160}/g) ?? [];
    return `// ${fixture.comment}\nexport function ${fixture.exportName}(): Uint8Array<ArrayBuffer> {\n  return base64ToBytes(\n${chunks.map((chunk) => `    '${chunk}'`).join(' +\n')},\n  );\n}\n`;
  });

  const qpdfVersion = execFileSync('qpdf', ['--version']).toString().split('\n')[0].trim();
  const header = `// AUTO-GENERATED by scripts/generate-encrypted-pdf-fixtures.mjs -- do not hand-edit.
// Regenerate with: node scripts/generate-encrypted-pdf-fixtures.mjs (requires qpdf on PATH).
//
// Real encrypted PDFs, produced by ${qpdfVersion} from one plain source document that script builds itself. Every one is an encrypted copy of the same page -- a single line of text reading ${JSON.stringify(PAGE_TEXT)}, with an /Info dictionary whose /Title is ${JSON.stringify(INFO_TITLE)} and /Author is ${JSON.stringify(INFO_AUTHOR)} -- so a test can assert on the decrypted content of a stream AND of strings without caring which cipher got it there.
//
// Encrypted by an independent implementation on purpose: a fixture this package encrypted itself would let a bug in key derivation or in a cipher cancel out between the write and read halves and pass anyway. Embedded as base64 rather than checked in as .pdf files so the suite needs no filesystem access, matching src/assets/stix-two-math-font.ts's own precedent.
import { base64ToBytes } from '../util/base64';

export const ENCRYPTED_FIXTURE_PAGE_TEXT = ${JSON.stringify(PAGE_TEXT)};
export const ENCRYPTED_FIXTURE_TITLE = ${JSON.stringify(INFO_TITLE)};
export const ENCRYPTED_FIXTURE_AUTHOR = ${JSON.stringify(INFO_AUTHOR)};

`;

  writeFileSync(outputPath, header + sections.join('\n'), 'utf8');
  console.log(`Wrote ${outputPath} (${FIXTURES.length} fixtures)`);
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
