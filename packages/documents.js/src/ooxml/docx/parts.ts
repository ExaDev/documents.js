import type { Package } from "ooxml.js";
import { findMainPartPath } from "ooxml.js";

// The conventional name for a docx body part. OPC names it through the package root's officeDocument relationship, so this is only the fallback for a package that declares no usable one.
const CONVENTIONAL_DOCUMENT_PART_PATH = "word/document.xml";

// The body part this package's own docx passes must agree on. Both the reader's second pass (./read.ts) and the embedded-object splice (./embedded-objects.ts) walk the same part ooxml.js's own readDocxContent already walked, so they resolve it the same way it does; disagreeing would splice markup from one part against sections produced from another.
export function docxMainPartPath(pkg: Package): string {
  return findMainPartPath(pkg) ?? CONVENTIONAL_DOCUMENT_PART_PATH;
}
