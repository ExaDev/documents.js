import { readInt16LE, readUint16LE, readUint32LE, slice } from "../bytes";
import type { Fib } from "../fib/fib";
import { parsePlc } from "../plc";
import { SGC, readGrpprl, type Prl } from "./sprm";

/** Sed, [MS-DOC] 2.9.269: fn(2, ignored) + fcSepx(4) + fnMpr(2, ignored) + fcMpr(4, ignored) -- 12 bytes, the fixed element size parsePlc needs for PlcfSed. */
const SED_SIZE = 12;
const SED_FC_SEPX_OFFSET = 2;

// Section properties, [MS-DOC] 2.6.4 -- the subset of the section-property sprm table this reader converts: page size and the four page margins, which is all document-schema.js's own ContentSection (pageSize + margins) has anywhere to hold. Every other section sprm (columns, headers/footers distance, vertical justification, page borders, line numbering, the rest of the roughly seventy the specification names) is absent rather than present-and-ignored, the identical documented-gap convention pap.ts already uses for paragraph sprms this package does not convert.

/** sprmSXaPage: page width, an unsigned 2-byte twips value. */
const SPRM_S_XA_PAGE = 0xb01f;
/** sprmSYaPage: page height, an unsigned 2-byte twips value. */
const SPRM_S_YA_PAGE = 0xb020;
/** sprmSDxaLeft / sprmSDxaRight: an XAS_nonNeg (unsigned 2-byte twips) left/right margin. */
const SPRM_S_DXA_LEFT = 0xb021;
const SPRM_S_DXA_RIGHT = 0xb022;
/** sprmSDyaTop / sprmSDyaBottom: a YAS (signed 2-byte twips) top/bottom margin -- positive is a minimum margin that grows to avoid a header/footer, negative a fixed margin whose absolute value is used regardless. document-schema.js's Margins has no minimum/fixed distinction, so both forms report the same absolute size (see marginFromYas below). */
const SPRM_S_DYA_TOP = 0x9023;
const SPRM_S_DYA_BOTTOM = 0x9024;

const TWIPS_PER_POINT = 20;

function twipsToPoints(twips: number): number {
  return twips / TWIPS_PER_POINT;
}

// YAS's minimum/fixed distinction is about how the margin interacts with header/footer space this reader does not model; either way, twips is the margin's own physical size, so the absolute value is what a plain Margins field states.
function marginFromYas(twips: number): number {
  return twipsToPoints(Math.abs(twips));
}

export interface SectionProperties {
  pageWidthPt?: number;
  pageHeightPt?: number;
  marginLeftPt?: number;
  marginRightPt?: number;
  marginTopPt?: number;
  marginBottomPt?: number;
}

// Folds a Sepx's grpprl into `into`, in order, so the last Prl to touch a property determines it -- the same precedence rule applyParagraphSprms/applyCharacterSprms already apply to their own property families ([MS-DOC] 2.6's Applying Properties).
export function applySectionSprms(
  prls: readonly Prl[],
  into: SectionProperties,
): SectionProperties {
  for (const prl of prls) {
    if (prl.sprm.sgc !== SGC.section) continue;
    switch (prl.sprm.value) {
      case SPRM_S_XA_PAGE:
        into.pageWidthPt = twipsToPoints(readUint16LE(prl.operand, 0));
        break;
      case SPRM_S_YA_PAGE:
        into.pageHeightPt = twipsToPoints(readUint16LE(prl.operand, 0));
        break;
      case SPRM_S_DXA_LEFT:
        into.marginLeftPt = twipsToPoints(readUint16LE(prl.operand, 0));
        break;
      case SPRM_S_DXA_RIGHT:
        into.marginRightPt = twipsToPoints(readUint16LE(prl.operand, 0));
        break;
      case SPRM_S_DYA_TOP:
        into.marginTopPt = marginFromYas(readInt16LE(prl.operand, 0));
        break;
      case SPRM_S_DYA_BOTTOM:
        into.marginBottomPt = marginFromYas(readInt16LE(prl.operand, 0));
        break;
      default:
        // Every other section sprm is a property this reader does not convert; see this module's own top comment.
        break;
    }
  }
  return into;
}

/** One section's own resolved properties (page size, margins) alongside `startCp`, the character position PlcfSed.aCp[i] names as where its text begins in the main document -- [MS-DOC] 2.8.26: "Each CP specifies the beginning of a range of text in the main document that constitutes a section." read.ts's own splitIntoSections groups the main document's paragraph entries by these boundaries. */
export interface DocSectionProperties extends SectionProperties {
  readonly startCp: number;
}

/** Resolves every section PlcfSed/Sepx states, in document order -- a single zero-start entry with no properties when the file carries no PlcfSed at all (lcbPlcfSed 0) or an empty one, which read.ts's own DEFAULT_PAGE_SIZE/DEFAULT_MARGINS then stand in for field by field, exactly as an individual unstated sprm already does, matching what a single-section document with no PlcfSed at all would resolve to anyway. */
export function readAllSectionProperties(
  wordDocument: Uint8Array,
  table: Uint8Array,
  fib: Pick<Fib, "fcPlcfSed" | "lcbPlcfSed">,
): readonly DocSectionProperties[] {
  if (fib.lcbPlcfSed === 0) {
    return [{ startCp: 0 }];
  }
  const plc = parsePlc(
    slice(table, fib.fcPlcfSed, fib.lcbPlcfSed, "PlcfSed in the Table stream"),
    SED_SIZE,
    "PlcfSed",
  );
  if (plc.count === 0) {
    return [{ startCp: 0 }];
  }
  const sections: DocSectionProperties[] = [];
  for (let index = 0; index < plc.count; index += 1) {
    const startCp = plc.keyAt(index);
    const sed = plc.element(index);
    const fcSepx = readUint32LE(sed, SED_FC_SEPX_OFFSET);
    const cb = readUint16LE(wordDocument, fcSepx);
    const grpprl = slice(
      wordDocument,
      fcSepx + 2,
      cb,
      "Sepx grpprl in the WordDocument stream",
    );
    sections.push({ startCp, ...applySectionSprms(readGrpprl(grpprl), {}) });
  }
  return sections;
}
