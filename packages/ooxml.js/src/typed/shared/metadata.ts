import { z } from "zod";
import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import { childrenWithTag, rootElement, textContent } from "../util";

// docProps/core.xml (Dublin Core + extended properties) and docProps/app.xml (the originating application name) use the identical convention across every OOXML format -- docx, pptx, and xlsx alike -- so this reader lives outside any one format's own read.ts rather than being duplicated per format. Ported from documents.js's src/ooxml/core-properties.ts.

export const DocumentMetadataSchema = z.object({
  title: z.string().optional(),
  author: z.string().optional(),
  subject: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  creator: z.string().optional(),
  createdIso: z.string().optional(),
  modifiedIso: z.string().optional(),
});
export type DocumentMetadata = z.infer<typeof DocumentMetadataSchema>;

const CORE_PROPERTIES_PATH = "docProps/core.xml";
const APP_PROPERTIES_PATH = "docProps/app.xml";

function firstElementText(
  root: XmlElement | undefined,
  tag: string,
): string | undefined {
  if (root === undefined) {
    return undefined;
  }
  const element = childrenWithTag(root, tag)[0];
  if (element === undefined) {
    return undefined;
  }
  const text = textContent(element);
  return text.length > 0 ? text : undefined;
}

// cp:keywords is a single free-text element with no delimiter mandated by ECMA-376; comma-separation is the overwhelmingly common convention among real-world producers, so that's what this splits on.
function readKeywords(core: XmlElement | undefined): string[] | undefined {
  const raw = firstElementText(core, "cp:keywords");
  if (raw === undefined) {
    return undefined;
  }
  const parts = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return parts.length > 0 ? parts : undefined;
}

// Reads a package's docProps into a DocumentMetadata. `author` is the human author (dc:creator); `creator` is the originating application (docProps/app.xml's Application element, e.g. "Microsoft Office PowerPoint") -- NOT the same OOXML field despite the name overlap with dc:creator. There is no `producer` field: that is a PDF-specific concept (the tool that produced a PDF) with no OOXML equivalent.
export function readCoreProperties(pkg: Package): DocumentMetadata {
  const core = rootElement(pkg.parts[CORE_PROPERTIES_PATH]);
  const app = rootElement(pkg.parts[APP_PROPERTIES_PATH]);
  return {
    title: firstElementText(core, "dc:title"),
    author: firstElementText(core, "dc:creator"),
    subject: firstElementText(core, "dc:subject"),
    keywords: readKeywords(core),
    creator: firstElementText(app, "Application"),
    createdIso: firstElementText(core, "dcterms:created"),
    modifiedIso: firstElementText(core, "dcterms:modified"),
  };
}
