import type { CoverageTable } from "./ot-layout-common";
import { parseClassDef, parseCoverage } from "./ot-layout-common";
import type { SfntFont } from "./sfnt";
import { hasBytes, sfntTableBytes, u16, u32 } from "./sfnt";

// 'GDEF' (The OpenType spec, "GDEF - Glyph Definition Table"; ISO/IEC 14496-22 clause 6.3): the table a font uses to state facts about its own glyphs that every OpenType Layout table shares, the same role ot-layout-common.ts's Coverage and ClassDef fill inside individual subtables. This module exists for exactly one consumer, gsub-table.ts: a GSUB lookup's lookupFlag expresses sentences like "skip marks" (0x0008), "skip glyphs outside mark attachment class 2" (the flag's high byte), and "skip marks outside mark filtering set 1" (0x0010 plus the lookup's trailing markFilteringSet index), and none of those sentences can be evaluated from GSUB alone — the glyph classes, mark attachment classes, and mark glyph sets they quantify over are stated only here.
//
// Only the three subtables lookupFlag semantics need are read: GlyphClassDef, MarkAttachClassDef, and — from minor version 2 onward — MarkGlyphSets. The AttachList and LigCaretList (mark-to-base attachment points and ligature caret positions) serve GPOS mark positioning and text editing, neither of which this package performs; the version 1.3 item variation store serves variable-font instantiation, which this package never does. Every read is bounds-checked and a malformed table yields `undefined` rather than throwing, the same untrusted-font policy ot-layout-common.ts states — but each subtable degrades independently rather than all-or-nothing, because each answers an unrelated question and a GDEF whose MarkAttachClassDef is truncated still states correct glyph classes.

// The glyph class values GlyphClassDef assigns (OpenType spec, "Glyph Class Definition Table"): class 0 is not a value the table carries but the spec's own catch-all for every glyph the table does not list, which parseClassDef already resolves to 0 — "unclassified" is a real answer, not an absence.
export const GLYPH_CLASS_UNCLASSIFIED = 0;
export const GLYPH_CLASS_BASE = 1;
export const GLYPH_CLASS_LIGATURE = 2;
export const GLYPH_CLASS_MARK = 3;
// Class 4 marks a glyph that is a component of a composite glyph. No lookupFlag bit tests for it — it exists for GPOS mark-to-ligature and glyph-decomposition logic — but the constant is exported so a consumer reading classes never meets a bare 4.
export const GLYPH_CLASS_COMPONENT = 4;

// A parsed 'GDEF' table. Every method answers for any glyph ID rather than returning `undefined`: a glyph the table does not mention genuinely IS unclassified, in mark-attachment class 0, and outside every filtering set, the same class-0 catch-all ClassDefTable itself resolves with.
export interface GdefTable {
  // The glyph's GlyphClassDef class: 0 unclassified, 1 base, 2 ligature, 3 mark, 4 component.
  glyphClass(glyphId: number): number;
  // The glyph's MarkAttachClassDef class, 0 for a glyph that table does not list. Mark attachment classes are how a font splits its marks into groups a lookupFlag can selectively ignore: the flag's high byte names the one class whose marks stay visible.
  markAttachClass(glyphId: number): number;
  // Whether the MarkGlyphSets set at `setIndex` covers `glyphId`. `false` for a set index the font does not declare, matching the class-0 catch-all: a lookup naming a nonexistent filtering set skips every mark, exactly as one naming an empty set would.
  markFilteringSetCovers(setIndex: number, glyphId: number): boolean;
}

const GDEF_HEADER_SIZE_1_0 = 12; // uint16 majorVersion + uint16 minorVersion + four Offset16s (glyphClassDef, attachList, ligCaretList, markAttachClassDef)
const GDEF_HEADER_SIZE_1_2 = GDEF_HEADER_SIZE_1_0 + 2; // + Offset16 markGlyphSetsDef, which minor version 2 added
const MARK_GLYPH_SETS_HEADER_SIZE = 4; // uint16 format + uint16 markGlyphSetCount, before the Offset32 coverage array

export function parseGdefTable(font: SfntFont): GdefTable | undefined {
  const bytes = sfntTableBytes(font, "GDEF");
  if (
    bytes === undefined ||
    !hasBytes(bytes, 0, GDEF_HEADER_SIZE_1_0) ||
    u16(bytes, 0) !== 1
  ) {
    return undefined;
  }
  const minorVersion = u16(bytes, 2);
  // GlyphClassDef and MarkAttachClassDef sit in the version 1.0 header every GSUB-era GDEF carries; an offset of 0 is the spec's own "this subtable is absent".
  const glyphClassDefOffset = u16(bytes, 4);
  const glyphClassDef =
    glyphClassDefOffset === 0
      ? undefined
      : parseClassDef(bytes, glyphClassDefOffset);
  const markAttachClassDefOffset = u16(bytes, 10);
  const markAttachClassDef =
    markAttachClassDefOffset === 0
      ? undefined
      : parseClassDef(bytes, markAttachClassDefOffset);
  const markGlyphSets: (CoverageTable | undefined)[] = [];
  if (minorVersion >= 2 && hasBytes(bytes, 0, GDEF_HEADER_SIZE_1_2)) {
    const markGlyphSetsDefOffset = u16(bytes, GDEF_HEADER_SIZE_1_0);
    if (
      markGlyphSetsDefOffset !== 0 &&
      hasBytes(bytes, markGlyphSetsDefOffset, MARK_GLYPH_SETS_HEADER_SIZE) &&
      u16(bytes, markGlyphSetsDefOffset) === 1
    ) {
      const setCount = u16(bytes, markGlyphSetsDefOffset + 2);
      const coverageOffsetsOffset =
        markGlyphSetsDefOffset + MARK_GLYPH_SETS_HEADER_SIZE;
      if (hasBytes(bytes, coverageOffsetsOffset, setCount * 4)) {
        for (let i = 0; i < setCount; i++) {
          // MarkGlyphSets is the one GDEF structure that offsets its entries by 32 bits — a mark set is a whole Coverage table, and a font with many large sets can push past an Offset16's reach.
          markGlyphSets.push(
            parseCoverage(
              bytes,
              markGlyphSetsDefOffset +
                u32(bytes, coverageOffsetsOffset + i * 4),
            ),
          );
        }
      }
    }
  }
  return {
    glyphClass(glyphId: number): number {
      return glyphClassDef === undefined
        ? GLYPH_CLASS_UNCLASSIFIED
        : glyphClassDef(glyphId);
    },
    markAttachClass(glyphId: number): number {
      return markAttachClassDef === undefined ? 0 : markAttachClassDef(glyphId);
    },
    markFilteringSetCovers(setIndex: number, glyphId: number): boolean {
      const set = markGlyphSets[setIndex];
      return set?.coverageIndex(glyphId) !== undefined;
    },
  };
}
