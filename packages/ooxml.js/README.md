# ooxml.js

Type-safe, lossless round-trip conversion between OOXML packages (`.docx`, `.pptx`, `.xlsx`) and a faithful JSON model, built on [Zod 4](https://zod.dev) codecs.

An OOXML file is a ZIP archive of parts (an OPC "package"): `[Content_Types].xml`, relationships (`*.rels`), XML content parts, and binary parts (images, embedded objects). `ooxml.js` decodes the **whole package** into a faithful JSON model and encodes it back — part for part — so `encode(decode(file))` reproduces the original content.

## Why

Semantic, typed document models are lossy and one-directional: they cannot round-trip. True round-trip requires capturing every part, relationship, and binary byte-for-byte at the content level. `ooxml.js` provides that lossless generic foundation, with ergonomic typed reading views (`Document`, `Presentation`, `Workbook`) layered on top for convenient access.

## Install

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

## Fidelity

Conversion is **part-content-faithful**: every XML part re-serialises to equivalent XML, every binary part to identical bytes, and no parts are dropped or added. The re-zipped file is content-identical and opens correctly in Word, Excel, and PowerPoint.

It is **not** guaranteed to be byte-for-byte identical at the ZIP-container level — re-zipping changes archive entry layout (entry order, compression, metadata), and that is not achievable deterministically across the tools that produce OOXML files.

## License

MIT
