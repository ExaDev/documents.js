// Sprm byte sequences and content-navigation helpers shared by read.test.ts and read-styles.test.ts, both of which exercise readDocContent against hand-built grpprl fixtures.
//
// Test-support only: excluded from the published dist per the family convention (tsdown.config.ts drops src/test-support/**), and never imported by src/index.ts.

import type { ContentBlock, ContentParagraph } from "document-schema.js";
import type { readDocContent } from "../read";

// Sprm byte sequences, each written little-endian from its own opcode: the two-byte sprm then its operand.
export const BOLD_ON = [0x35, 0x08, 0x01]; // sprmCFBold, ToggleOperand 0x01.
export const ITALIC_ON = [0x36, 0x08, 0x01]; // sprmCFItalic.
export const SIZE_24PT = [0x43, 0x4a, 0x30, 0x00]; // sprmCHps, 48 half-points.
export const RED_TEXT = [0x42, 0x2a, 0x06]; // sprmCIco, palette entry 6.
export const CENTRED = [0x61, 0x24, 0x01]; // sprmPJc, logical centre.
export const SPACE_BEFORE_12PT = [0x13, 0xa4, 0xf0, 0x00]; // sprmPDyaBefore, 240 twips.
export const PAGE_BREAK_BEFORE = [0x07, 0x24, 0x01]; // sprmPFPageBreakBefore, Bool8 true.
// A section grpprl stating a page 600x800pt with a 90/54/45/36pt left/right/top/bottom margin, one Prl per sprm, none of them the format's own default value, so a test reading them back proves the real field rather than coincidentally matching a fallback.
export const SECTION_GEOMETRY = [
  0x1f,
  0xb0,
  0xe0,
  0x2e, // sprmSXaPage, 12000 twips (600pt).
  0x20,
  0xb0,
  0x80,
  0x3e, // sprmSYaPage, 16000 twips (800pt).
  0x21,
  0xb0,
  0x08,
  0x07, // sprmSDxaLeft, 1800 twips (90pt).
  0x22,
  0xb0,
  0x38,
  0x04, // sprmSDxaRight, 1080 twips (54pt).
  0x23,
  0x90,
  0x84,
  0x03, // sprmSDyaTop, 900 twips (45pt).
  0x24,
  0x90,
  0xd0,
  0x02, // sprmSDyaBottom, 720 twips (36pt).
];

export function paragraphs(
  document: ReturnType<typeof readDocContent>,
): ContentBlock[] {
  if (document.kind !== "wordprocessing") {
    throw new Error("a .doc always reads as a wordprocessing document");
  }
  const section = document.sections[0];
  if (section === undefined) throw new Error("a section must be present");
  return [...section.blocks];
}

// Narrows one block of the read document to a paragraph, so each assertion below reads the field it means rather than repeating a kind check and an index guard.
export function paragraphAt(
  document: ReturnType<typeof readDocContent>,
  index: number,
): ContentParagraph {
  const block = paragraphs(document)[index];
  if (block === undefined) throw new Error(`no block at index ${index}`);
  if (block.kind !== "paragraph") {
    throw new Error(`block ${index} is a ${block.kind}, not a paragraph`);
  }
  return block;
}

export function textOf(paragraph: ContentParagraph): string {
  return paragraph.runs.map((run) => run.text).join("");
}
