import {
  buildOutline,
  isOutlineNode,
  outlineLeafText,
  type OutlineChild,
  type OutlineLeaf,
} from "document-outline.js";
import { readNativeDocumentTree, type DocumentFormat } from "documents.js";
import { z } from "zod";
import {
  DocumentInputSchema,
  resolveDocumentInput,
} from "../io/document-input";
import { defineOperationWithoutOutputSchema } from "../operation";

// A group the caller renders: buildOutline's own OutlineNode label and source level signal, with children already nested (a client must render indentation from the nesting, never from `level`, which rides the source format's own scale -- heading levels are 1-based, list levels 0-based, and the synthetic per-slide/sheet/page groups are level 1).
interface OutlineGroupJson {
  text: string;
  level: number;
  children: OutlineChildJson[];
}

// A leaf the caller renders: the payload's own kind plus its text (document-outline.js's outlineLeafText -- the same label extraction the Markdown renderer's TOC uses), with the full content payload dropped -- a TOC entry is a label, and shipping every run, style ref, and frame would price a modest document at the whole tree.
type OutlineChildJson = OutlineGroupJson | { kind: string; text: string };

// A leaf's class label. Most leaves carry the schema's own kind literal, but two do not -- a formula (identified structurally by its mathml payload) and a sheet-anchored embedded object (the standalone ContentEmbeddedObject, not the block-level wrapper that reuses kind 'embeddedObject') -- so the label falls back to structural discrimination, the same idiom document-outline.js's own outlineLeafText uses, and the fallthrough after both checks is exactly the standalone embedded object the union has left.
function leafKind(leaf: OutlineLeaf): string {
  if ("kind" in leaf) return leaf.kind;
  if ("mathml" in leaf) return "formula";
  return "embeddedObject";
}

function toOutlineJson(children: readonly OutlineChild[]): OutlineChildJson[] {
  return children.map((child) =>
    isOutlineNode(child)
      ? {
          text: child.text,
          level: child.level,
          children: toOutlineJson(child.children),
        }
      : { kind: leafKind(child), text: outlineLeafText(child) },
  );
}

const OutlineDocumentInputSchema = z.object({
  source: DocumentInputSchema.describe("The document to outline."),
});

interface OutlineDocumentOutput {
  readonly sourceFormat: DocumentFormat;
  readonly kind: string;
  readonly outline: OutlineChildJson[];
}

// No outputSchema, matching the original MCP tool registration -- OutlineChildJson is a genuinely recursive shape, and a hand-written recursive Zod mirror (z.lazy) would be an independently-maintained duplicate of the type above with no consumer that currently validates against it.
export const outlineDocumentOperation = defineOperationWithoutOutputSchema<
  typeof OutlineDocumentInputSchema,
  OutlineDocumentOutput
>({
  name: "outline_document",
  title: "Outline document",
  description:
    "Projects a document's table of contents as a structured outline: reads the source's own native DocumentTree directly (documents.js's readNativeDocumentTree -- no bridging conversion, no discarded output bytes) and runs document-outline.js's buildOutline over it. Groups carry { text, level, children } (a heading's, list item's, slide's, sheet's, or page's own label plus nested children); leaves carry { kind, text }.",
  inputSchema: OutlineDocumentInputSchema,
  async run({ source }, context) {
    const signal = context?.signal;
    const { bytes, format } = await resolveDocumentInput(source, { signal });
    const tree = readNativeDocumentTree(format, bytes, { signal });
    return {
      sourceFormat: format,
      kind: tree.kind,
      outline: toOutlineJson(buildOutline(tree)),
    };
  },
});
