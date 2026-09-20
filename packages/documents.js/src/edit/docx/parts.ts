import type { Package } from "ooxml.js";
import { findMainPartPath } from "ooxml.js";
import { siblingDirectory } from "../../opc/paths";

// Where an already-existing docx keeps the parts this editor reads and writes. Opening a package is not the same act as building one: a package a producer handed us names its own body through the root officeDocument relationship, and "word/document.xml" is only the convention (ExaDev/documents.js#1314), whereas createEmptyDocxPackage is choosing the name itself and rightly writes the conventional one as a literal (./scaffold.ts).
const CONVENTIONAL_DOCUMENT_PART_PATH = "word/document.xml";
const MEDIA_DIR_NAME = "media";

// The body part of a package being edited, named by its root officeDocument relationship, falling back to the conventional path for a package that declares no usable one.
export function docxMainPartPath(pkg: Package): string {
  return findMainPartPath(pkg) ?? CONVENTIONAL_DOCUMENT_PART_PATH;
}

// Where a newly added image part goes: a media directory beside the body part, so a conventionally named package still gets word/media while a package whose body sits elsewhere keeps its media beside that body rather than in a word/ directory it may not even have. Every relationship to a part in here is built with buildRelativeTarget from the body part's own path, so the target stays correct wherever both end up.
export function docxMediaDir(documentPartPath: string): string {
  return siblingDirectory(documentPartPath, MEDIA_DIR_NAME);
}
