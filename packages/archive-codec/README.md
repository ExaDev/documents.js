# archive-codec

[![GitHub](https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white)](https://github.com/ExaDev/documents.js/tree/main/packages/archive-codec) [![npm](https://img.shields.io/badge/npm-CB3837?logo=npm&logoColor=white)](https://www.npmjs.com/package/archive-codec) [![npm version](https://img.shields.io/npm/v/archive-codec)](https://www.npmjs.com/package/archive-codec) [![CI](https://img.shields.io/github/actions/workflow/status/ExaDev/documents.js/ci.yml?branch=main)](https://github.com/ExaDev/documents.js/actions)

> ZIP-in-ZIP recursive walking under depth and cumulative decompressed-size guards, classic OLE compound-file ([MS-CFB]) reading and writing, [MS-OLEPS] Property Set Stream reading and writing, and the RC4/MD5/SHA-1/XOR-obfuscation primitives the legacy OLE-based binary formats use for their own password-to-open encryption — zero document-format knowledge, the archive and container utility package for the [documents.js family](../../README.md). Worker-isomorphic: the same code runs under Node and inside a Cloudflare Workers isolate.

Created for [documents.js#564](https://github.com/ExaDev/documents.js/issues/564): nothing in the ecosystem recursed into a nested archive. Most concretely, OOXML's embedded-object model — a docx/pptx carrying a genuinely separate ZIP blob at `word/embeddings/oleObject1.xlsx` — had no safe handling anywhere, and no package guarded against recursive-archive inputs at all (`byte-codec`'s 512 MiB per-stream inflate cap does not compose across recursion). A new sibling was chosen over extending `byte-codec` (whose charter is byte/image primitives, zero container-format knowledge) or doing it inline in `documents.js` (which would repeat the duplication `byte-codec`'s own extraction was meant to avoid). Its first family consumer is `ooxml.js`'s OLE embedded-object recovery — [documents.js#733](https://github.com/ExaDev/documents.js/issues/733) (pptx, `p:oleObj`) and [documents.js#734](https://github.com/ExaDev/documents.js/issues/734) (docx, `o:OLEObject`): an OLE payload part's bytes are checked through `isZipArchive` and, when they are a ZIP, decoded as a nested OOXML package behind this package's guarded walk — the bounded inflate that populates `document-schema.js`'s `ContentEmbeddedObject`/`ContentEmbeddedObjectBlock` (the same vocabulary odf.js embeds formula sub-documents through) with a genuinely recovered sub-document.

[documents.js#739](https://github.com/ExaDev/documents.js/issues/739) widened the charter from that ZIP-only v1 scope to the classic OLE compound file, recording the decision explicitly rather than by accident (mirroring the #564 reasoning): real-world Word and PowerPoint files frequently store the embeddee as a `.bin` compound file at `word|ppt/embeddings/oleObject1.bin`, and a CFB reader is container knowledge exactly the way ZIP structure is — sectors, FAT chains, and directory entries, never that any stream is a document. The same recovery now unwraps such a payload's `Package` stream ([MS-OLEDS]'s OLE packaging of the real file) through this package and feeds the packaged ZIP to the unchanged nested decode.

[documents.js#815](https://github.com/ExaDev/documents.js/issues/815), [#816](https://github.com/ExaDev/documents.js/issues/816), and [#817](https://github.com/ExaDev/documents.js/issues/817) then needed the other direction. `xls-codec`, `doc-codec`, `ppt-codec`, and `wpd-codec` each read a legacy Office binary format out of an [MS-CFB] container, and none of them can write one back, because there was no container to put their streams into: a `.xls` writer producing a `Workbook` stream, or a `.doc` writer producing `WordDocument` and `1Table`, needs a conformant compound file to hold them. That container is structural knowledge exactly as the reader's is, so `writeCompoundFile` is the mirror of `readCompoundFile` here rather than four hand-rolled emitters in four codecs.

[documents.js#974](https://github.com/ExaDev/documents.js/issues/974) added the other half of the OLE Package stream: `writeOlePackage`, the mirror of `readOlePackage`, for `rtf-codec`'s own OLE embedding -- an RTF `\object`'s `\objdata` is the hex bytes of a real [MS-CFB] compound file wrapping a `Package` stream, so writing one needed both halves this package already had separately (`writeCompoundFile` for the container, `readOlePackage` for the stream inside it) plus the write side of the stream itself.

[documents.js#815](https://github.com/ExaDev/documents.js/issues/815), [#816](https://github.com/ExaDev/documents.js/issues/816), and [#817](https://github.com/ExaDev/documents.js/issues/817) also each named the same remaining gap: `doc-codec`, `xls-codec`, and `ppt-codec` all hard-coded document metadata (title, author, dates) to an empty object, because that metadata lives in a genuinely different structure from the one each format's own reader already parses -- a [MS-OLEPS] Property Set Stream, conventionally stored as a "\x05SummaryInformation" stream beside `WordDocument`/`Workbook`/`PowerPoint Document` in the identical [MS-CFB] container all three already read through this package. `oleps/read` and `oleps/write` are the generic property-set codec (the stream header, the PropertySet packet's dictionary, and VT_I2/VT_I4/VT_LPSTR/VT_LPWSTR/VT_FILETIME typed values), and `oleps/summary-information` is the SummaryInformation-specific mapping on top of it -- the same two-layer split `cfb/read.ts` and `cfb/ole-package.ts` already establish for the OLE Package stream, container structure below, one named stream's own field layout above.

[documents.js#1108](https://github.com/ExaDev/documents.js/issues/1108) added the RC4/MD5 primitives `xls-codec` needs to decrypt a legacy-encrypted `.xls` workbook: the [MS-OFFCRYPTO] 2.3.6.1 "RC4 encryption header" scheme every BIFF8 `FilePass` record protected this way shares with the same header shape in `.doc`. RC4 and MD5 are trivial and completely unavailable from any platform crypto API this package can portably reach (WebCrypto has never offered either; `node:crypto` dropped RC4 from its default provider with OpenSSL 3), so hand-writing them here — once, shared — is the only option that keeps `xls-codec` and `doc-codec` from each carrying their own copy. `.ppt` turned out NOT to share this scheme at all (see [documents.js#1116](https://github.com/ExaDev/documents.js/issues/1116) below) — the older XOR obfuscation scheme remains out of scope, tracked in [documents.js#922](https://github.com/ExaDev/documents.js/issues/922).

[documents.js#1113](https://github.com/ExaDev/documents.js/issues/1113) is the first of two named future consumers from #1108 to actually land: `doc-codec` decrypts an RC4-encrypted `.doc` given a password, wired against the same primitives `xls-codec` uses. The two codecs' own re-keying intervals genuinely differ (`OFFICE_RC4_BLOCK_SIZE` for `xls-codec`, `OFFICE_RC4_DOC_BLOCK_SIZE` for `doc-codec`), so `decryptOfficeRc4` gained a `blockSize` parameter rather than this package assuming one shared constant — see [Legacy Office encryption](#legacy-office-encryption).

[documents.js#1116](https://github.com/ExaDev/documents.js/issues/1116) is the second: `.ppt`'s own encryption turned out to be a genuinely different scheme, not `ppt-codec`'s eventual integration against #1108's own primitives as originally assumed. [MS-OFFCRYPTO] 2.3.5 "RC4 CryptoAPI Encryption" is SHA-1-based rather than MD5-based, derives its key with no intermediate-hash iteration, and re-keys per persist object rather than at a fixed byte interval — different enough that it needed its own primitives (`crypto/sha1`, `crypto/office-rc4-cryptoapi`) rather than a parameter on the existing ones. See [RC4 CryptoAPI encryption](#rc4-cryptoapi-encryption-ppt).

[documents.js#922](https://github.com/ExaDev/documents.js/issues/922) added the older, much weaker XOR obfuscation scheme both `xls-codec` and `doc-codec` still had no support for: `crypto/xor-obfuscation`'s `createXorObfuscationKey`/`createXorObfuscationPasswordVerifier` (matching [MS-OFFCRYPTO]'s own published pseudocode exactly, cross-checked against Apache POI's `createXorKey1`/`createXorVerifier1` and a real Excel-generated fixture's own stored FilePass fields), `createXorObfuscationArray`, `decryptXorObfuscationMethod1` (`.xls`), and `decryptXorObfuscationMethod2` (`.doc`). The array-construction and data-transform steps genuinely diverge from the published spec text for Method 1 — see [XOR obfuscation](#xor-obfuscation-xlsdoc) below for the full account, including the real-file cross-check that caught it, mirroring the RC4 "40-bit" documentation bug this package already found and corrected once (above).

Scope: **ZIP containers** (read and write over [`fflate`](https://github.com/101arrowz/fflate), recursive walking of ZIP-in-ZIP entries), **classic OLE compound files** (bounded [MS-CFB] reading and conformant [MS-CFB] writing, plus OLE Package stream reading and writing), **[MS-OLEPS] Property Set Streams** (generic read/write of a single-property-set stream, plus SummaryInformation's own title/subject/author/keywords/comments/created/last-saved/last-printed fields), and the **RC4/MD5/SHA-1/XOR-obfuscation primitives** the legacy OLE-based binary formats use for password-to-open encryption — `.doc`/`.xls` share one MD5-based RC4 scheme and one XOR obfuscation scheme (two methods, one per format), `.ppt` uses a genuinely different SHA-1-based RC4 CryptoAPI scheme. **tar and gzip, DocumentSummaryInformation's extended and user-defined property sets, and writing VT_LPSTR (ANSI-codepage) string properties are explicitly out of scope.**

## Getting started

Requires Node.js `>=20` and pnpm `11.6.0`.

```sh
pnpm install
pnpm build          # tsdown -> dist/ (ESM + CJS + .d.ts, one file set per src module)
pnpm typecheck      # tsc -p tsconfig.json && tsc -p tsconfig.node.json (dual tsconfig)
pnpm lint           # eslint . --fix --cache --max-warnings 0
pnpm test           # vitest run --project unit
pnpm test:watch     # vitest --project unit
pnpm test:workers   # vitest run --config vitest.workers.config.ts, inside a real Cloudflare Workers (workerd) isolate
pnpm test:smoke     # builds dist/, then loads the built ESM and CJS barrels and every advertised deep import
```

To run a single test file, pass its path to vitest directly, e.g. `pnpm exec vitest run src/zip/walk.test.ts`.

## What it provides

Every module is importable by package-relative path as well as through the barrel — `tsdown` builds one dist file per src module (`root: 'src'`, the same layout ooxml.js ships), and `package.json`'s `./*` exports wildcard maps each subpath onto it:

```ts
import { readCompoundFile } from "archive-codec/cfb/read";
import { walkArchive } from "archive-codec/zip/walk";
```

The smoke suite (`test/smoke.test.mjs`) is the guard on that advertisement: it loads each module below from the built `dist/` in both module systems, so a build config that stops serving an advertised subpath fails the suite — neither publint nor `attw` catches a wildcard whose targets are missing.

| Module                        | Exports                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `zip/container`               | `zipPackage` (ordered-entries ZIP write with stored-uncompressed support), `unzipPackage`, `ZipEntry`                                                                                                                                                                                                                                                                                                                                                                    |
| `zip/detect`                  | `detectArchiveFormat` (`'zip' \| 'cfb' \| 'unknown'`), `isZipArchive`, `ArchiveFormat`                                                                                                                                                                                                                                                                                                                                                                                   |
| `zip/walk`                    | `walkArchive` (recursive ZIP-in-ZIP walking), `ArchiveWalkEntry`, `ArchiveWalkLimitError`, `MAX_WALK_DEPTH`, `MAX_WALK_TOTAL_BYTES`, `WalkArchiveOptions`                                                                                                                                                                                                                                                                                                                |
| `cfb/detect`                  | `isCompoundFile` (the `D0 CF 11 E0 …` magic-byte check)                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `cfb/read`                    | `readCompoundFile` (bounded [MS-CFB] stream extraction), `CompoundFileStream`, `CompoundFileFormatError`, `MAX_CFB_TOTAL_STREAM_BYTES`, `ReadCompoundFileOptions`                                                                                                                                                                                                                                                                                                        |
| `cfb/write`                   | `writeCompoundFile` ([MS-CFB] container generation), `CompoundFileWriteError`, `WriteCompoundFileOptions` — takes the `CompoundFileStream` array `cfb/read` returns                                                                                                                                                                                                                                                                                                      |
| `cfb/ole-package`             | `readOlePackage` (OLE Package stream unwrapping), `writeOlePackage` (the mirror), `OlePackage`, `OlePackageFormatError`, `OlePackageWriteError`                                                                                                                                                                                                                                                                                                                          |
| `oleps/read`                  | `readPropertySetStream` (generic [MS-OLEPS] property-set decoding), `PropertySetFormatError`                                                                                                                                                                                                                                                                                                                                                                             |
| `oleps/write`                 | `writePropertySetStream` (generic [MS-OLEPS] property-set encoding), `PropertySetWriteError` — takes the `PropertySet` shape `oleps/read` returns                                                                                                                                                                                                                                                                                                                        |
| `oleps/summary-information`   | `readSummaryInformation`, `writeSummaryInformationStream`, `SummaryInformationProperties`, `FMTID_SUMMARY_INFORMATION`                                                                                                                                                                                                                                                                                                                                                   |
| `oleps/layout-metadata`       | `summaryInformationToLayoutMetadata`, `layoutMetadataToSummaryInformation`, `hasSummaryInformationFields` — the `SummaryInformationProperties` <-> `document-schema.js`'s `LayoutMetadata` mapping, shared by `doc-codec`/`xls-codec`/`ppt-codec` (see [Property sets](#property-sets))                                                                                                                                                                                  |
| `crypto/md5`                  | `md5` — RFC 1321 MD5, hand-written (see [Legacy Office encryption](#legacy-office-encryption))                                                                                                                                                                                                                                                                                                                                                                           |
| `crypto/sha1`                 | `sha1` — RFC 3174/FIPS 180-1 SHA-1, hand-written (see [RC4 CryptoAPI encryption](#rc4-cryptoapi-encryption-ppt))                                                                                                                                                                                                                                                                                                                                                         |
| `crypto/rc4`                  | `rc4` — the RC4 stream cipher, hand-written; symmetric, so also the decrypt operation                                                                                                                                                                                                                                                                                                                                                                                    |
| `crypto/office-rc4`           | `deriveOfficeRc4BaseHash`, `deriveOfficeRc4BlockKey`, `decryptOfficeRc4`, `OFFICE_RC4_VERIFIER_LENGTH`, `OFFICE_RC4_BLOCK_SIZE`, `OFFICE_RC4_DOC_BLOCK_SIZE` — [MS-OFFCRYPTO] 2.3.6.2's own key derivation and the block-keyed stream decryption built on it                                                                                                                                                                                                             |
| `crypto/office-rc4-cryptoapi` | `deriveRc4CryptoApiBlockKey`, `verifyRc4CryptoApiPassword`, `RC4_CRYPTOAPI_SALT_LENGTH`, `RC4_CRYPTOAPI_VERIFIER_LENGTH`, `RC4_CRYPTOAPI_VERIFIER_HASH_LENGTH`, `RC4_CRYPTOAPI_DEFAULT_KEY_SIZE_BITS` — [MS-OFFCRYPTO] 2.3.5.2's own key derivation, `.ppt`'s own encryption scheme                                                                                                                                                                                      |
| `crypto/xor-obfuscation`      | `createXorObfuscationKey`, `createXorObfuscationPasswordVerifier`, `createXorObfuscationArray`, `decryptXorObfuscationMethod1` (`.xls`), `decryptXorObfuscationMethod2` (`.doc`), `XOR_OBFUSCATION_ARRAY_LENGTH`, `XOR_OBFUSCATION_MAX_PASSWORD_LENGTH`, `XOR_OBFUSCATION_ROTATE_DISTANCE_METHOD1`, `XOR_OBFUSCATION_ROTATE_DISTANCE_METHOD2` — [MS-OFFCRYPTO] 2.3.7's own weaker, non-cipher legacy obfuscation scheme (see [XOR obfuscation](#xor-obfuscation-xlsdoc)) |

### Recursive walking

```ts
import { walkArchive } from "archive-codec";

// Every entry of every nested ZIP, flattened. Throws ArchiveWalkLimitError if
// the walk exceeds the depth cap or the cumulative decompressed-bytes budget.
for (const entry of walkArchive(docxBytes)) {
  entry.path; // e.g. 'xl/workbook.xml', the path within its own archive
  entry.ancestors; // e.g. ['word/embeddings/oleObject1.xlsx'] -- the nested
  // ZIP entries descended through to reach this one
  entry.bytes; // decompressed content
}
```

Both guards throw rather than truncate: an input outside the contract must fail loudly, never return a partial listing that looks complete. The defaults are `MAX_WALK_DEPTH` (8 — real producers bottom out around depth 3; the motivating OOXML embedded-object case is depth 2) and `MAX_WALK_TOTAL_BYTES` (512 MiB cumulative across every nesting level — the same figure `byte-codec` grants a single stream, re-purposed as one shared budget so a bomb's multiplicative nesting leverage becomes bounded addition). Both are overridable per call via `walkArchive(bytes, { maxDepth, maxTotalBytes })`, and each constant's derivation is stated in its source comment.

### Compound files

```ts
import {
  readCompoundFile,
  readOlePackage,
  writeCompoundFile,
  writeOlePackage,
} from "archive-codec";

// Every stream of a classic OLE compound file, with its storage path.
// Throws CompoundFileFormatError on any structural nonconformance.
for (const stream of readCompoundFile(oleBinBytes)) {
  stream.path; // e.g. 'Package' -- root-level, or 'ObjectStorage/Package'
  stream.bytes; // the stream's content
}

// The OLE packaging a Word/PowerPoint embed wraps the real file in before
// storing it as the 'Package' stream: label, paths, and the file's bytes.
const packageStream = readCompoundFile(oleBinBytes).find(
  (s) => s.path === "Package",
);
if (packageStream !== undefined) {
  readOlePackage(packageStream.bytes).fileBytes; // often a ZIP for a modern embed
}

// The mirror image: builds a 'Package' stream's bytes from the same shape
// readOlePackage returns, to wrap alongside writeCompoundFile -- this is how
// rtf-codec builds the real [MS-CFB] container an RTF \object's \objdata carries.
const packageBytes = writeOlePackage({
  label: "embedded.docx",
  sourcePath: "",
  tempPath: "",
  fileBytes: embeddedFileBytes,
});
const embedBytes = writeCompoundFile([
  { path: "Package", bytes: packageBytes },
]);
```

Reading is bounded the same way walking is: chain cycles and out-of-range sectors fail against bounds derived from the file's own sector count, and one cumulative extracted-bytes budget (`MAX_CFB_TOTAL_STREAM_BYTES`, 512 MiB — the same figure the family grants one decompressed stream) bounds the multiplication a hostile FAT gains by aliasing one sector into many streams. Every structural failure throws rather than truncating — a malformed compound file fails whole, never a partial stream listing that looks complete. Version 3 (512-byte sectors) and version 4 (4096-byte) files both read; the mini-FAT path every stream shorter than the header's cutoff takes is first-class, because a small real-world embed genuinely lands there.

Writing is the mirror image, taking the same `CompoundFileStream` array reading returns:

```ts
import { readCompoundFile, writeCompoundFile } from "archive-codec";

const bytes = writeCompoundFile([
  { path: "WordDocument", bytes: mainStream },
  { path: "1Table", bytes: tableStream },
  { path: "SummaryInformation", bytes: summaryStream },
  { path: "ObjectPool/_1234/Package", bytes: embeddedFile }, // a nested storage
]);

// ... so re-writing what was read is a round trip, not a translation.
writeCompoundFile(readCompoundFile(bytes));
```

Slash-separated paths name the enclosing storages exactly as reading reports them, so nested storages are written as well as read; a request that cannot be expressed as a conformant file throws `CompoundFileWriteError` rather than producing bytes that only look valid — an over-long or illegally named entry (`\`, `:`, and `!` are the characters [MS-CFB] forbids), an empty path segment, two siblings whose names collide under the format's case-insensitive ordering, or a version 3 stream past the 2 GB the format allows one. Both allocation paths are written: a stream at or above the 4096-byte cutoff takes FAT-chained sectors, one below it a run of 64-byte mini sectors in the root entry's own mini stream. Files past the 6.875 MiB that the header's own 109-entry DIFAT array can address spill into chained DIFAT sectors rather than failing, which matters because a real `.doc` or `.xls` reaches that size routinely.

Two details are deliberate rather than incidental. The directory's sibling trees are genuine red-black trees — balanced by construction and coloured so that every [MS-CFB] 2.6.4 constraint holds, including the black-height property — because the sibling tree exists to be binary-searched by name, and the degenerate right-sibling chain that a purely structural reader would still accept is not a search tree. And the output depends only on the set of paths, never on the order they were supplied in, since the directory's order is the format's own name ordering: two callers building the same file from differently ordered lists get identical bytes.

Correctness is checked against independent parsers, not only against this package's own reader: the written files are accepted by [`olefile`](https://github.com/decalage2/olefile) in its strict `DEFECT_INCORRECT` mode and by 7-Zip's Compound handler, both of which return byte-identical stream content, and a real LibreOffice-authored `.doc` read through `readCompoundFile` and re-emitted through `writeCompoundFile` still opens in LibreOffice Writer.

### Property sets

```ts
import {
  readCompoundFile,
  readSummaryInformation,
  writeSummaryInformationStream,
} from "archive-codec";

const stream = readCompoundFile(docBytes).find(
  (s) => s.path === "\x05SummaryInformation",
);
if (stream !== undefined) {
  const metadata = readSummaryInformation(stream.bytes);
  metadata.title; // string | undefined
  metadata.createdIso; // string | undefined, ISO-8601
}

// The mirror image: builds a "\x05SummaryInformation" stream's bytes from the
// same shape, to hand to writeCompoundFile alongside the format's own streams.
const summaryStream = writeSummaryInformationStream({ title: "Q3 report" });
```

`readSummaryInformation`/`writeSummaryInformationStream` cover the seven SummaryInformation fields a caller actually needs (title, subject, author, keywords, comments, and the created/last-saved/last-printed FILETIME timestamps, as ISO-8601 strings); everything else the property set can carry (template, last author, revision number, application name, edit time, page/word/character counts, document security) is read into the stream but not projected into `SummaryInformationProperties`, and the separate `"\x05DocumentSummaryInformation"` stream (company, manager, and custom user-defined properties) is not read or written at all. `readPropertySetStream`/`writePropertySetStream` are the generic layer beneath it — a `PropertySet`'s `formatId` and its `properties` map, keyed by `PropertyIdentifier`, valued by a `{ type, value }` pair over `VT_I2`/`VT_I4`/`VT_LPSTR`/`VT_LPWSTR`/`VT_FILETIME` — for a caller working with a different, non-SummaryInformation property set built on the identical [MS-OLEPS] wire format. The writer only emits `VT_LPWSTR` (Unicode) strings, never `VT_LPSTR`: a `CodePageString`'s ANSI encoding depends on the property set's own CodePage property, and writing an arbitrary codepage's bytes would need a full codepage table this package does not carry, so `VT_LPWSTR`'s codepage-independent UTF-16LE sidesteps the question entirely. The reader still decodes `VT_LPSTR` on the way in — `CP_WINUNICODE` (1200) and windows-1252 (1252, the value the [MS-OLEPS] SummaryInformation worked example itself declares, and the same ANSI convention `cfb/ole-package.ts` already uses) — since a real Office-authored file almost always writes ANSI strings, not Unicode ones.

A property whose type this reader does not decode — an unsupported `PropertyType` (e.g. `VT_CF`, the clipboard-format type `PIDSI_THUMBNAIL` uses), or a `VT_LPSTR` under a `CodePage` other than `CP_WINUNICODE`/windows-1252 — is skipped rather than aborting the whole read: a real SummaryInformation stream routinely carries a thumbnail or a non-Western codepage, and one undecodable property must not fail a read that also carries properties this reader can decode. Genuine structural nonconformance (a bad `ByteOrder`, a truncated stream, a `Dictionary` property, non-zero `TypedPropertyValue` padding) still throws `PropertySetFormatError`.

`oleps/layout-metadata`'s `summaryInformationToLayoutMetadata`/`layoutMetadataToSummaryInformation`/`hasSummaryInformationFields` map `SummaryInformationProperties` to and from `document-schema.js`'s own `LayoutMetadata` — the shared metadata shape every codec's `ContentDocument` carries, format-agnostic rather than specific to any one legacy binary format. `doc-codec`, `xls-codec`, and `ppt-codec` each import these directly rather than maintaining their own copy, wrapping `layoutMetadataToSummaryInformation` with their own `createdIso`/`modifiedIso` date validation so a malformed date is reported through that package's own error vocabulary rather than an opaque `RangeError` out of the FILETIME conversion.

### Legacy Office encryption

```ts
import { deriveOfficeRc4BaseHash, decryptOfficeRc4 } from "archive-codec";

// salt and streamOffset come from the caller's own FilePass-record reading
// (xls-codec's own [MS-XLS] 2.4.117 handling, not this package's concern).
const baseHash = deriveOfficeRc4BaseHash(password, salt);
const plaintext = decryptOfficeRc4(baseHash, streamOffset, ciphertext);
```

`deriveOfficeRc4BaseHash`/`deriveOfficeRc4BlockKey`/`decryptOfficeRc4` implement [MS-OFFCRYPTO] 2.3.6.1/2.3.6.2's RC4 encryption header scheme: a per-workbook base hash derived once from the password and the header's own salt, then a full 128-bit RC4 key re-derived from that base hash at every 1024-byte boundary of the underlying decrypted stream — despite [MS-OFFCRYPTO] 2.3.6.1's own field descriptions twice stating "encrypted using a 40-bit RC4 cipher", which is wrong; the real key is Hfinal in full, confirmed against Apache POI's `BinaryRC4Decryptor` and nolze/msoffcrypto-tool's own doctested test vectors, both cross-checked directly rather than trusted from the spec's own prose — see each constant's own doc comment for the full account, including the truncated-to-5-bytes implementation this package shipped briefly before the cross-check caught it. `decryptOfficeRc4` takes the byte offset a chunk starts at within the whole encrypted stream (not within the chunk itself), so a stream can be decrypted in arbitrary pieces, not only from its own start, and still land on the correct per-block key throughout. The 1024-byte re-keying interval is `decryptOfficeRc4`'s own default `blockSize`, since [MS-XLS]'s own FilePass scheme is this module's original consumer, but it is a real [MS-XLS]-specific value, not a property of the algorithm itself: [MS-DOC] 2.2.6.2's own RC4 encryption header (the identical [MS-OFFCRYPTO] 2.3.6.1 structure, confirmed against Apache POI's `EncryptionMode.binaryRC4` resolving both) re-keys every 512 bytes instead (`OFFICE_RC4_DOC_BLOCK_SIZE`), passed explicitly as `decryptOfficeRc4`'s fourth argument.

This is exactly the piece `xls-codec`'s `FilePass`-record reader and `doc-codec`'s own `EncryptionHeader` reader (ExaDev/documents.js#1113) both need and nothing more: locating the header, reading its own fields, and verifying the password against `EncryptedVerifier`/`EncryptedVerifierHash` are each codec's own concern, not this package's — `archive-codec` carries only the format-agnostic cryptography, never a `.xls`- or `.doc`-specific byte layout. `decryptOfficeRc4`'s own `blockSize` parameter exists because the two codecs' re-keying intervals genuinely differ (`OFFICE_RC4_BLOCK_SIZE`, 1024, for `xls-codec`; `OFFICE_RC4_DOC_BLOCK_SIZE`, 512, for `doc-codec`) -- confirmed as real, independent values against Apache POI's own `Biff8DecryptingStream` and `BinaryRC4Decryptor` respectively, not one shared constant this package could have assumed. `md5`/`rc4` are exported individually too, for reuse by the RC4 CryptoAPI scheme below, which is symmetric enough to need `rc4` but not this module's own MD5-based key derivation.

### RC4 CryptoAPI encryption (.ppt)

```ts
import {
  deriveRc4CryptoApiBlockKey,
  verifyRc4CryptoApiPassword,
  rc4,
} from "archive-codec";

// salt, keySizeBits, and the encrypted verifier fields come from the caller's
// own DocumentEncryptionAtom reading (ppt-codec's own [MS-PPT] 2.3.7 handling,
// not this package's concern).
if (
  !verifyRc4CryptoApiPassword(
    password,
    salt,
    keySizeBits,
    encryptedVerifier,
    encryptedVerifierHash,
  )
) {
  throw new Error("wrong password");
}
// block is the persist object's own persist ID, not a byte offset -- see below.
const key = deriveRc4CryptoApiBlockKey(password, salt, block, keySizeBits);
const plaintext = rc4(key, ciphertext);
```

`deriveRc4CryptoApiBlockKey`/`verifyRc4CryptoApiPassword` implement [MS-OFFCRYPTO] 2.3.5.1/2.3.5.2's "RC4 CryptoAPI Encryption" scheme, `.ppt`'s own encryption ([documents.js#1116](https://github.com/ExaDev/documents.js/issues/1116)) -- genuinely different from the [Legacy Office encryption](#legacy-office-encryption) scheme above despite both ending in an RC4 keystream: SHA-1 rather than MD5, one hash of the salt and password folded with the block number rather than an intermediate 336-byte buffer, and (per the spec's own prose) explicitly not iterated. There is no `decryptOfficeRc4`-style entry point with its own block-boundary loop here, because RC4 CryptoAPI does not re-key at fixed byte intervals within one continuous stream the way the legacy scheme does: it re-keys per persist object, using that object's own persist ID as the "block number" -- a caller derives the one key its own object needs and applies this package's own `rc4` directly, exactly as `ppt-codec`'s `decryptPptDocumentStream` does. Cross-checked against Apache POI's `EncryptionInfo`/`StandardEncryptionHeader`/`CryptoAPIEncryptionHeader` and nolze/msoffcrypto-tool's `method/rc4_cryptoapi.py`, whose own `_makekey`/`verifypw` this module's derivation and verification mirror.

### XOR obfuscation (.xls/.doc)

```ts
import {
  createXorObfuscationArray,
  createXorObfuscationKey,
  createXorObfuscationPasswordVerifier,
  decryptXorObfuscationMethod1,
  XOR_OBFUSCATION_ROTATE_DISTANCE_METHOD1,
} from "archive-codec";

// key/verificationBytes come from the caller's own FilePass-record reading
// (xls-codec's own [MS-XLS] 2.4.117 handling, not this package's concern).
if (
  createXorObfuscationKey(password) !== key ||
  createXorObfuscationPasswordVerifier(password) !== verificationBytes
) {
  throw new Error("wrong password");
}
const array = createXorObfuscationArray(
  password,
  XOR_OBFUSCATION_ROTATE_DISTANCE_METHOD1,
);
// initialIndex is (streamOffset + recordDataLength) % 16 -- a BIFF-record
// concept xls-codec's own [MS-XLS] 2.2.10 handling computes, not this package's.
const plaintext = decryptXorObfuscationMethod1(array, ciphertext, initialIndex);
```

`createXorObfuscationKey`/`createXorObfuscationPasswordVerifier` implement [MS-OFFCRYPTO] 2.3.7.2/2.3.7.1's own key/verifier derivation exactly as published — confirmed against Apache POI's `createXorKey1`/`createXorVerifier1` and, for `"123456789012345"`, against a genuine Excel-generated XOR-obfuscated `.xls` fixture's own stored FilePass `key`/`verificationBytes` fields (nolze/msoffcrypto-tool's own test corpus, itself sourced from the openwall/john-samples password-cracking corpus). `createXorObfuscationArray` and `decryptXorObfuscationMethod1`, by contrast, do **not** follow [MS-OFFCRYPTO]'s own published pseudocode: decrypting that same real fixture's Workbook stream under the literal spec text (`CreateXorArray_Method1`'s reverse-order `XorRor` construction, `DecryptData_Method1`'s 5-bit rotation) produces garbage, while the algorithm this module actually implements — construct the array from the password's own bytes in forward order plus padding, XOR the alternating low/high byte of the same key, rotate left 2 (`.xls`) or 7 (`.doc`), then decrypt by rotating each byte left 3 before XORing against the array — recovers the fixture's real content (a readable sheet name, a `CodePage` record decrypting to the genuine value 1200, a `Dimensions` row count matching the file's own `Row` record count exactly). This is not a guess: Apache POI's own `CryptoFunctions.createXorArray1` carries the comment _"this code is based on the libre office implementation. The MS-OFFCRYPTO misses some infos about the various rotation sizes"_, and its `XORDecryptor.invokeCipher` states _"It seems that the encrypt and decrypt method is mixed up in the MS-OFFCRYPTO docs"_ — two independent, real, actively-maintained implementations (Apache POI, LibreOffice) converged on the same non-spec algorithm ahead of this package, which now confirms it a third time against genuine Excel output. See `crypto/xor-obfuscation.ts`'s own top comment for the full account, mirroring [Legacy Office encryption](#legacy-office-encryption)'s own "40-bit RC4" documentation-bug precedent above.

`.doc`'s own Method 2 (`decryptXorObfuscationMethod2`) has no equivalent real-file cross-check available — its data transform (plain XOR with a zero-byte exception, no rotation) matches both the published spec and LibreOffice's own `MSCodec_XorWord95::Decode` exactly, but its array-construction rotate distance (7, `XOR_OBFUSCATION_ROTATE_DISTANCE_METHOD2`) is taken from LibreOffice/Apache POI alone, without an independently-encrypted `.doc` fixture to confirm it against the way Method 1 was.

Password verification differs by method: RC4's own `EncryptedVerifier`/`EncryptedVerifierHash` are themselves encrypted, decrypted then compared (see [Legacy Office encryption](#legacy-office-encryption) above); XOR obfuscation's own `key`/`verificationBytes` (Method 1) or 32-bit verifier (Method 2, the high/low halves of the same two functions) are plain, unencrypted checksums of the password, recomputed and compared directly, matching Apache POI's own `XORDecryptor.verifyPassword` — which checks both fields, not either alone.

### ZIP container

`zipPackage` takes an _ordered_ array of `[path, entry]` tuples, not a `Record`, so the caller controls the exact emission order deterministically (the property formats with a fixed-offset first entry — ODF's `mimetype` — depend on), and any entry can be written stored-uncompressed via `stored: true`. `unzipPackage` is the read side; the returned `Record` makes no ordering promise and collapses duplicate paths.

## Conventions

- Worker-isomorphic (see the [family-wide convention](../../README.md#conventions)): runtime `src/` must not import `node:*`, a bare Node builtin, or use the `Buffer` global — enforced by a `no-restricted-imports`/`no-restricted-globals` ESLint rule and exercised in CI by running the test suite inside an actual `workerd` isolate (`pnpm test:workers`). Test files under `src/**/*.test.ts` and `src/test-support/` are exempt and may use Node APIs for fixtures.
- Only `src/index.ts` may be named `index.*` — a custom ESLint rule (`local/no-non-barrel-index`) rejects any other module using an `index` basename, since that would be a hidden entry point the `exports` map in `package.json` doesn't advertise.
- Zero document-format knowledge: this package knows bytes and container structure — ZIP entries, compound-file sectors and directory entries, the OLE packaging wrapper, [MS-OLEPS] property identifiers and typed values, and the RC4/XOR-obfuscation cryptography schemes the legacy OLE-based binary formats happen to encrypt themselves with — never that any entry or stream is a document, or that PID 2 means a title. It depends only on `fflate` — not on `byte-codec`, `ooxml.js`, or `odf.js` (whose ZIP wrappers it deliberately mirrors rather than imports, keeping their branding and release cadences decoupled).

## Install

```sh
pnpm add archive-codec
# or
npm install archive-codec
```

## Release and publishing

Release, CI, and commit-message conventions are all workspace-wide, not package-local — see the [monorepo root README](../../README.md#releases) for the mechanism (topological per-package `semantic-release` via `@exadev/semantic-release-workspace`, OIDC trusted npm publishing, automatic sibling dependency-range rewriting) and its [post-release republishing and attestation](../../README.md#releases) note on the restored GitHub Packages mirrors, npm aliases, and SBOM/provenance signing.

## Contributing

Conventional Commits, enforced workspace-wide by commitlint through a root `commit-msg` hook. Work inside `packages/archive-codec/`; see [CONTRIBUTING.md](../../CONTRIBUTING.md) for the shared git hooks and history conventions.

## License

MIT
