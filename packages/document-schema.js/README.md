# document-content-model

[![GitHub](https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white)](https://github.com/ExaDev/document-content-model) [![npm](https://img.shields.io/badge/npm-CB3837?logo=npm&logoColor=white)](https://www.npmjs.com/package/document-content-model) [![Release](https://img.shields.io/github/v/release/ExaDev/document-content-model)](https://github.com/ExaDev/document-content-model/releases/latest) [![CI](https://img.shields.io/github/actions/workflow/status/ExaDev/document-content-model/ci.yml?branch=main)](https://github.com/ExaDev/document-content-model/actions)

> The canonical, format-agnostic content and layout schema pivot shared by [ooxml.js](https://github.com/ExaDev/ooxml.js), [odf.js](https://github.com/ExaDev/odf.js), and [documents.js](https://github.com/ExaDev/documents.js).

Both `ooxml.js` and `documents.js` independently arrived at the same content vocabulary -- paragraphs, runs, tables, images, shapes, slides -- because `documents.js`'s docx/pptx-to-PDF pipeline needed a richer model than `ooxml.js`'s own readers originally produced, and that model was later ported back into `ooxml.js` itself. The result was two field-identical copies maintained in two places. This package is the fix: one schema, imported by every format package instead of redefined by each. It also sidesteps a circular dependency that would otherwise appear once `odf.js` exists, since `documents.js` depends on both `ooxml.js` and `odf.js`.

It contains only [Zod](https://zod.dev) schemas, their inferred types, and a handful of trivial schema-attached helpers (hex-colour conversion, a recursive structural type guard for the mutually-recursive table/block types). There is no XML, ZIP, PDF, or other binary handling here, and no `zod` dependency other than `zod` itself.

## Usage

```ts
import { ContentDocumentSchema, LayoutDocumentSchema } from 'document-content-model';

const content = ContentDocumentSchema.parse(someWordprocessingOrPresentationValue);
const layout = LayoutDocumentSchema.parse(somePageLayoutValue);
```

## License

MIT
