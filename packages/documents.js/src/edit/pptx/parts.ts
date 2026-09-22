import type { Package } from "ooxml.js";
import { findMainPartPath } from "ooxml.js";
import { siblingDirectory } from "../../opc/paths";
import { PRESENTATION_PART_PATH } from "./scaffold";

// Where an already-existing pptx keeps the parts this editor reads and writes — the pptx counterpart of ../docx/parts.ts, and the same distinction: createEmptyPptxPackage names the presentation part itself and writes PRESENTATION_PART_PATH as a literal, while a package handed to openPptx names its own through the root officeDocument relationship (ExaDev/documents.js#1314).
const MEDIA_DIR_NAME = "media";
const SLIDES_DIR_NAME = "slides";

export function pptxMainPartPath(pkg: Package): string {
  return findMainPartPath(pkg) ?? PRESENTATION_PART_PATH;
}

export function pptxMediaDir(presentationPartPath: string): string {
  return siblingDirectory(presentationPartPath, MEDIA_DIR_NAME);
}

// Where a newly added slide part goes: a slides directory beside the presentation part, matching where a real producer puts them relative to its own presentation part.
export function pptxSlidesDir(presentationPartPath: string): string {
  return siblingDirectory(presentationPartPath, SLIDES_DIR_NAME);
}
