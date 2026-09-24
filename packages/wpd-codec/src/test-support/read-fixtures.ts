import type { ContentDocument, ContentParagraph } from "document-schema.js";
import { readWpdContent } from "../read";
import { buildWpdFile } from "./build-wpd";

export const HARD_EOL = 0xcc;
export const SOFT_EOL = 0xcf;
export const HARD_EOP = 0xc7;
export const SOFT_SPACE = 0x80;
export const HARD_SPACE = 0x81;
export const ATTRIBUTE_ON = 0xf2;
export const ATTRIBUTE_OFF = 0xf3;
export const BOLD = 12;
export const ITALICS = 8;
export const UNDERLINE = 14;
export const STRIKEOUT = 13;
export const DOUBLE_UNDERLINE = 11;
export const SMALL_CAPS = 15;

export function paragraphsOf(document: ContentDocument): ContentParagraph[] {
  if (document.kind !== "wordprocessing") {
    throw new Error("expected a wordprocessing document");
  }
  return document.sections
    .flatMap((section) => section.blocks)
    .filter((block): block is ContentParagraph => block.kind === "paragraph");
}

export function readDocumentArea(
  documentArea: readonly number[],
  packets: Parameters<typeof buildWpdFile>[1] = [],
): ContentDocument {
  return readWpdContent(buildWpdFile(documentArea, packets));
}
