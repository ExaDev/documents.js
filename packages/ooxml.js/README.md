# ooxml.js

> Type-safe, lossless round-trip conversion between OOXML packages (`.docx`, `.pptx`, `.xlsx`) and a faithful JSON model, built on [Zod 4](https://zod.dev) codecs.

An OOXML file is a ZIP archive of parts (an OPC "package"): `[Content_Types].xml`, relationships (`*.rels`), XML content parts, and binary parts (images, embedded objects). `ooxml.js` decodes the **whole package** into a faithful JSON model and encodes it back — part for part — so `encode(decode(file))` reproduces the original content.

## Why

Semantic, typed document models are lossy and one-directional: they cannot round-trip. True round-trip requires capturing every part, relationship, and binary byte-for-byte at the content level. `ooxml.js` provides that lossless generic foundation, with ergonomic typed reading views (`Document`, `Presentation`, `Workbook`) layered on top for convenient access.

## Getting started

Requires Node.js `>=20` and pnpm `11.6.0` (pinned via `packageManager` in `package.json`).

```sh
pnpm install
```

Install as a dependency in another project:

```sh
pnpm add ooxml.js
# or
npm install ooxml.js
```

## Usage

```ts
import { decodePackage, encodePackage } from 'ooxml.js';

// .docx / .pptx / .xlsx bytes -> faithful JSON Package
const pkg = decodePackage(new Uint8Array(await file.arrayBuffer()));

// ...inspect or modify pkg.parts...

// Package -> bytes (content-identical to the original)
const bytes = encodePackage(pkg);
```

The core is a Zod 4 codec, so both directions are schema-validated:

```ts
import { z } from 'zod';
import { packageCodec } from 'ooxml.js';

const pkg = z.decode(packageCodec, bytes);
const out = z.encode(packageCodec, pkg);
```

Typed reading views project the generic `Package` into ergonomic models (lossy; for reading, not round-trip):

```ts
import { decodePackage, readDocx } from 'ooxml.js';

const doc = readDocx(decodePackage(bytes));
```

## The ooxml.js format

The verbose `Package` JSON is faithful but repetitive: every node repeats its `type`/`tag`/`attributes`/`children` keys, and tag and namespace strings recur thousands of times across a real document. **The ooxml.js format** is a compact, still-plain-JSON alternative — tuple-encoded nodes plus a single interned string table — that composes on top of `packageCodec` without changing what it guarantees:

```
OOXML bytes --[packageCodec]--> Package --[compactCodec]--> CompactPackage (the ooxml.js format)
```

```ts
import { decodePackage, toCompact, fromCompact } from 'ooxml.js';

const pkg = decodePackage(bytes);
const compact = toCompact(pkg); // { s: string[], p: Record<path, CompactPart> }
const roundTripped = fromCompact(compact); // deep-equals pkg
```

It is a JSON shape, not a compression layer: every string is still human-readable text, so it stays diffable and debuggable, just without the repeated structural keys and duplicate strings of the verbose `Package` model. `fromCompact(toCompact(pkg))` round-trips exactly, and `toCompact` is deterministic for a given `Package` value (the same input always produces the same string table).

Every pair of the three formats — OOXML bytes, `Package`, and `CompactPackage` — has a direct codec, so you never have to hand-compose two calls: `packageCodec` (bytes ⇄ `Package`), `compactCodec` (`Package` ⇄ `CompactPackage`), and `compactPackageCodec` (bytes ⇄ `CompactPackage` directly, via `decodeCompactPackage`/`encodeCompactPackage`):

```ts
import { decodeCompactPackage, encodeCompactPackage } from 'ooxml.js';

const compact = decodeCompactPackage(bytes); // OOXML bytes -> CompactPackage directly
const out = encodeCompactPackage(compact); // CompactPackage -> OOXML bytes directly
```

## Build, test, and lint

```sh
pnpm build          # tsdown -> dist/ (ESM + CJS + .d.ts, via tsdown.config.ts)
pnpm typecheck      # tsc --noEmit
pnpm test           # vitest run
pnpm test:watch     # vitest
pnpm test:smoke     # builds dist/, then verifies the built ESM and CJS artifacts both load and behave identically (test/smoke.mjs)
```

There is no separate lint script or ESLint config; `pnpm typecheck` and `vitest` are the enforced gates. `pnpm prepublishOnly` runs `typecheck`, `tsdown`, `publint`, and `@arethetypeswrong/cli` (`attw --pack`) — the full publish-readiness check — before a release.

To run a single test file: `pnpm vitest run src/typed/docx.test.ts`.

## Architecture

The package is layered from a lossless core outward to lossy convenience views:

- **`src/model/`** — the schemas. `node.ts` defines `XmlNode` (`text` / `cdata` / `comment` / `declaration` / `pi` / `element`) as an ordered forest, matching XML's mixed-content model exactly. `package.ts` defines `Package` as a record of zip-entry path to `Part` (`xml` parts hold a parsed node forest; `binary` parts hold base64 bytes, keeping the whole `Package` a plain JSON value).
- **`src/xml/`** — `parse.ts` and `build.ts` convert between an XML string and the `XmlNode[]` forest, via `fast-xml-parser` in `preserveOrder` mode with entity re-encoding disabled, so element order, mixed content, and original entity encoding survive unchanged.
- **`src/zip.ts`** — thin wrapper over `fflate`'s synchronous `zipSync`/`unzipSync`, isomorphic and dependency-free.
- **`src/package-io/`** — `read.ts` and `write.ts` sit between the zip and XML layers: unzip a package into path -> bytes, classify each entry as XML or binary (`looksLikeXml` sniffs the leading non-whitespace byte for `<`), and parse/serialize accordingly.
- **`src/codec.ts`** — the public round-trip surface: `packageCodec`/`xmlCodec` are `z.codec()` pairs, and `decodePackage`/`encodePackage` are the ergonomic wrappers around them.
- **`src/compact.ts`** — the ooxml.js format: `compactCodec` (`z.codec(PackageSchema, CompactPackageSchema, …)`) maps `Package ⇄ CompactPackage`, with `toCompact`/`fromCompact` as the ergonomic wrappers. `compactPackageCodec` composes `packageCodec` and `compactCodec` into a direct bytes ⇄ `CompactPackage` codec (`decodeCompactPackage`/`encodeCompactPackage`), so all three format pairs — bytes/`Package`, `Package`/`CompactPackage`, bytes/`CompactPackage` — have a named codec rather than requiring callers to chain two.
- **`src/typed/`** — one-way, lossy projections (`docx.ts`, `pptx.ts`, `xlsx.ts`) that read the generic `Package` into ergonomic document/presentation/workbook models: `readDocx` covers paragraphs, runs, tables, resolved hyperlinks, comments, footnotes, headers/footers and list membership; `readPptx` covers slide text, shapes, tables and speaker notes; `readXlsx` covers cell values and formulas, merged ranges and defined names. These cannot be encoded back to a `Package` — round-tripping always goes through `decodePackage`/`encodePackage`, never through a typed view. `util.ts` holds the shared XML-walking helpers (`walk`, `elementsWithTag`, `childrenWithTag`, `attr`, `rootElement`, `textContent`, entity decoding, `resolveRelationships`) that all three typed readers build on.

## Conventions

- **Zod-first schema/type/guard.** Every model type is inferred from its Zod schema (`z.infer<typeof XSchema>`), not hand-written — schema, type, and validator stay in lockstep.
- **`XmlNode` uses a recursive structural guard, not `z.lazy`.** `z.lazy` collapses to `unknown` for the element-children case in the Zod version this project pins, so `XmlElementSchema` validates `children` via `z.custom<XmlNode>(isXmlNode)`, a hand-written recursive type guard in `model/node.ts`. Any change to `XmlNode`'s shape must update `isXmlNode` in step. `src/compact.ts`'s `CompactXmlNode` reuses the same pattern (`isCompactXmlNode` + `z.custom`) for the same reason.
- **Lossless core vs. lossy views is a hard boundary.** `decodePackage`/`encodePackage` (and the underlying codecs) must stay byte/part faithful — every part round-trips unchanged. `src/typed/*` readers are explicitly one-way and are allowed to drop information (documented per-reader, e.g. `readDocx`'s bold/italic toggle presence check ignores `w:val`, and `readXlsx` drops cell styles, formats and charts). Don't blur this line by adding write-back support to a typed reader; a full round-trip always goes through the generic `Package`.
- **XML entities stay raw in the lossless layer.** `parseXml` runs with `processEntities: false` so encoded entities (e.g. `&amp;`) are preserved verbatim for round-trip fidelity; typed readers decode the five standard entities (`decodeEntities` in `typed/util.ts`) only in their own lossy projection, never in the core model.

## Gotchas and quirks

- **No git remote is configured yet.** `git remote -v` is empty; this repository has not been pushed anywhere. Confirm the intended origin before assuming a `git push` target.
- **`test:smoke` depends on a fresh build.** It runs `tsdown && node test/smoke.mjs`, so it always rebuilds `dist/` first — don't run it expecting to test a stale build.
- **Binary-vs-XML part classification is a byte sniff, not an extension check.** `package-io/read.ts`'s `looksLikeXml` looks for a leading `<` after skipping a UTF-8 BOM and whitespace; this is deliberate (no standard OOXML binary part starts with `<`) but means any future binary format starting with `<` would misclassify.
- **`fflate`'s bundled types are ahead of what it actually allocates.** `zip.ts` casts `fflate`'s `Uint8Array<ArrayBufferLike>` results to `Uint8Array<ArrayBuffer>` with a comment explaining why the narrowing is safe (fflate only ever allocates a real `ArrayBuffer`) — don't remove the cast without preserving that guarantee elsewhere.
- **No CI workflow exists yet.** There is no `.github/workflows/` directory; `pnpm build`, `pnpm typecheck`, and `pnpm test` are run locally/manually, not gated by GitHub Actions.

## Fidelity

Conversion is **part-content-faithful**: every XML part re-serialises to equivalent XML, every binary part to identical bytes, and no parts are dropped or added. The re-zipped file is content-identical and opens correctly in Word, Excel, and PowerPoint.

It is **not** guaranteed to be byte-for-byte identical at the ZIP-container level — re-zipping changes archive entry layout (entry order, compression, metadata), and that is not achievable deterministically across the tools that produce OOXML files.

## Contributing

Commits follow Conventional Commits (`feat:`, `fix:`, `test:`, `chore:`), evidenced by the existing git history; there is no `CONTRIBUTING.md` or enforced commit hook yet. There is a single `main` branch and no open pull request workflow established so far.

## License

MIT
