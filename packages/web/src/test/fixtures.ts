import { assembleTree } from "document-schema.js";
import {
  documentTreeWithSchema,
  readMarkdownContent,
  type DocumentTreeJson,
} from "documents.js";

// A real, schema-valid, $schema-stamped DocumentTreeJson for component tests that need to hand a StructureTree/InspectPanel something to browse without caring about its specific content. Built here, outside src/ui/**, because that directory's own eslint import-boundary rule bans importing documents.js's conversion functions directly from UI code -- this file exists specifically so a UI test can get a real fixture without violating that boundary itself.
export const SAMPLE_DOCUMENT_TREE: DocumentTreeJson = documentTreeWithSchema(
  assembleTree(readMarkdownContent("# Title\n\nBody.\n")),
);

// A4 in points -- document-schema.js's own PAGE_SIZE_A4 constant, copied rather than re-exported so a UI test can use a standard page size without importing anything from documents.js/document-schema.js in its own src/ui/** file.
export const SAMPLE_PAGE_SIZE = { widthPt: 595.28, heightPt: 841.89 };
