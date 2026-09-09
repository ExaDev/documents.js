import type { SfntFont } from "./sfnt";
import { hasBytes, i16, sfntTableBytes, u16, u32 } from "./sfnt";
import { parseCoverage } from "./ot-layout-common";

// 'GSUB' (The OpenType spec, "Glyph Substitution Table"; ISO/IEC 14496-22 clause 6.2): the substitution-side twin of the 'GPOS' pair-kerning table gpos-table.ts reads. This package applies the DEFAULT-ON ligature features -- 'liga' (standard ligatures) and 'rlig' (required ligatures) -- because those are the features an OpenType shaper applies to text it has not been told anything else about, and this package's layout carries no shaping properties beyond family/weight/style. The opt-in and contextual features stay refused by name rather than half-applied: 'smcp' (small caps) is opt-in in every real shaper and reaches through single-substitution lookups a caller never asked this package to turn on, and 'calt' (contextual alternates) / 'clig' (contextual ligatures) reach through the Contextual and Chaining Contextual lookup types (5 and 6), which carry their own rule-matching machinery out of proportion to everything else here. The README states this scope.
//
// Structurally this module deliberately mirrors gpos-table.ts line for line where the two tables genuinely agree -- header, ScriptList, FeatureList, LookupList, and the Extension wrapper are the shared Common Table Formats -- so a reader who knows one already knows the other. Every read is bounds-checked and a malformed table yields `undefined` rather than throwing, the same untrusted-font policy ot-layout-common.ts states.

// The feature tags whose lookups this package applies, in application order.
const LIGATURE_FEATURE_TAGS = ["liga", "rlig"] as const;

const GSUB_HEADER_SIZE = 10; // uint16 majorVersion + uint16 minorVersion + three Offset16s (ScriptList, FeatureList, LookupList) -- the identical layout GPOS's own header carries
const SCRIPT_RECORD_SIZE = 6; // Tag scriptTag + Offset16 scriptOffset
const FEATURE_RECORD_SIZE = 6; // Tag featureTag + Offset16 featureOffset
const LANG_SYS_HEADER_SIZE = 6; // Offset16 lookupOrderOffset (reserved, always NULL) + uint16 requiredFeatureIndex + uint16 featureIndexCount
const FEATURE_HEADER_SIZE = 4; // Offset16 featureParamsOffset + uint16 lookupIndexCount
const LOOKUP_HEADER_SIZE = 6; // uint16 lookupType + uint16 lookupFlag + uint16 subTableCount

// GSUB lookup types this module reads (the spec's own numbering): 1 Single Substitution, 4 Ligature Substitution, 7 Extension Substitution.
const LOOKUP_TYPE_SINGLE_SUBST = 1;
const LOOKUP_TYPE_LIGATURE_SUBST = 4;
const LOOKUP_TYPE_EXTENSION_SUBST = 7;

const EXTENSION_SUBST_HEADER_SIZE = 8; // uint16 substFormat + uint16 extensionLookupType + Offset32 extensionOffset

const PREFERRED_SCRIPT_TAGS = ["latn", "DFLT"] as const;

function readTag(bytes: Uint8Array<ArrayBuffer>, offset: number): string {
  return String.fromCharCode(
    u16(bytes, offset) >> 8,
    u16(bytes, offset) & 0xff,
    u16(bytes, offset + 2) >> 8,
    u16(bytes, offset + 2) & 0xff,
  );
}

// The result of shaping one glyph sequence: `glyphIds` is the sequence actually drawn after substitution, and `spans[i]` is how many glyphs of the input sequence output glyph `i` replaced -- 1 for a glyph that passed through (or was single-substituted), the ligature's own component count for a ligature glyph. A caller that aligned its input sequence with something per-glyph (characters, in embedded-font.ts's case) slices that by `spans`, which is how a ligature glyph's ToUnicode text -- the characters it consumed -- is recovered.
export interface GsubShaping {
  readonly glyphIds: number[];
  readonly spans: number[];
}

// One parsed subtable, in one of the two shapes this module applies. Single and ligature substitution are kept as one union rather than one interface because they answer different questions: a single subtable maps one glyph to its substitute, a ligature subtable asks "does the sequence starting at i match a ligature, and if so which glyph and how many components".
type GsubSubtable =
  | {
      readonly kind: "single";
      readonly lookup: (glyphId: number) => number | undefined;
    }
  | {
      readonly kind: "ligature";
      readonly match: (
        glyphIds: readonly number[],
        index: number,
      ) =>
        | { readonly ligatureGlyph: number; readonly componentCount: number }
        | undefined;
    };

// Single Substitution format 1: every covered glyph shifted by one delta (the compact spelling of "these N glyphs become the N glyphs delta positions later").
const SINGLE_SUBST_FORMAT_1_SIZE = 6; // uint16 substFormat + Offset16 coverageOffset + int16 deltaGlyphID
function parseSingleSubstFormat1(
  bytes: Uint8Array<ArrayBuffer>,
  subtableOffset: number,
): GsubSubtable | undefined {
  if (!hasBytes(bytes, subtableOffset, SINGLE_SUBST_FORMAT_1_SIZE)) {
    return undefined;
  }
  const coverage = parseCoverage(
    bytes,
    subtableOffset + u16(bytes, subtableOffset + 2),
  );
  if (coverage === undefined) {
    return undefined;
  }
  const delta = i16(bytes, subtableOffset + 4);
  return {
    kind: "single",
    lookup: (glyphId: number): number | undefined => {
      if (coverage.coverageIndex(glyphId) === undefined) {
        return undefined;
      }
      return glyphId + delta;
    },
  };
}

// Single Substitution format 2: every covered glyph mapped to its own explicit substitute, in coverage order.
const SINGLE_SUBST_FORMAT_2_HEADER_SIZE = 6; // uint16 substFormat + Offset16 coverageOffset + uint16 glyphCount
function parseSingleSubstFormat2(
  bytes: Uint8Array<ArrayBuffer>,
  subtableOffset: number,
): GsubSubtable | undefined {
  if (!hasBytes(bytes, subtableOffset, SINGLE_SUBST_FORMAT_2_HEADER_SIZE)) {
    return undefined;
  }
  const coverage = parseCoverage(
    bytes,
    subtableOffset + u16(bytes, subtableOffset + 2),
  );
  if (coverage === undefined) {
    return undefined;
  }
  const glyphCount = u16(bytes, subtableOffset + 4);
  const substitutesOffset = subtableOffset + SINGLE_SUBST_FORMAT_2_HEADER_SIZE;
  if (!hasBytes(bytes, substitutesOffset, glyphCount * 2)) {
    return undefined;
  }
  return {
    kind: "single",
    lookup: (glyphId: number): number | undefined => {
      const coverageIndex = coverage.coverageIndex(glyphId);
      if (coverageIndex === undefined || coverageIndex >= glyphCount) {
        return undefined;
      }
      return u16(bytes, substitutesOffset + coverageIndex * 2);
    },
  };
}

// Ligature Substitution format 1: coverage over the FIRST glyph of every ligature, one LigatureSet per covered glyph, one Ligature record per ligature that glyph can begin. A Ligature record states the ligature glyph, the component count (first glyph included), and the remaining components in order -- so matching is "covered first glyph, then the next componentCount-1 glyphs equal the record's components".
const LIGATURE_SUBST_FORMAT_1_HEADER_SIZE = 6; // uint16 substFormat + Offset16 coverageOffset + uint16 ligSetCount
const LIGATURE_SET_HEADER_SIZE = 2; // uint16 ligatureCount
const LIGATURE_HEADER_PREFIX_SIZE = 4; // uint16 ligatureGlyph + uint16 componentCount -- the component array follows

function parseLigatureSubstFormat1(
  bytes: Uint8Array<ArrayBuffer>,
  subtableOffset: number,
): GsubSubtable | undefined {
  if (!hasBytes(bytes, subtableOffset, LIGATURE_SUBST_FORMAT_1_HEADER_SIZE)) {
    return undefined;
  }
  const coverage = parseCoverage(
    bytes,
    subtableOffset + u16(bytes, subtableOffset + 2),
  );
  if (coverage === undefined) {
    return undefined;
  }
  const ligSetCount = u16(bytes, subtableOffset + 4);
  const ligSetOffsetsOffset =
    subtableOffset + LIGATURE_SUBST_FORMAT_1_HEADER_SIZE;
  if (!hasBytes(bytes, ligSetOffsetsOffset, ligSetCount * 2)) {
    return undefined;
  }
  return {
    kind: "ligature",
    match: (
      glyphIds: readonly number[],
      index: number,
    ):
      | { readonly ligatureGlyph: number; readonly componentCount: number }
      | undefined => {
      const coverageIndex = coverage.coverageIndex(glyphIds[index]!);
      if (coverageIndex === undefined || coverageIndex >= ligSetCount) {
        return undefined;
      }
      const ligSetOffset =
        subtableOffset + u16(bytes, ligSetOffsetsOffset + coverageIndex * 2);
      if (!hasBytes(bytes, ligSetOffset, LIGATURE_SET_HEADER_SIZE)) {
        return undefined;
      }
      const ligatureCount = u16(bytes, ligSetOffset);
      const ligatureOffsetsOffset = ligSetOffset + LIGATURE_SET_HEADER_SIZE;
      if (!hasBytes(bytes, ligatureOffsetsOffset, ligatureCount * 2)) {
        return undefined;
      }
      for (let i = 0; i < ligatureCount; i++) {
        const ligatureOffset =
          ligSetOffset + u16(bytes, ligatureOffsetsOffset + i * 2);
        if (!hasBytes(bytes, ligatureOffset, LIGATURE_HEADER_PREFIX_SIZE)) {
          continue;
        }
        const ligatureGlyph = u16(bytes, ligatureOffset);
        const componentCount = u16(bytes, ligatureOffset + 2);
        if (componentCount === 0) {
          continue; // a ligature of zero components describes nothing; the spec's own minimum is 2 (a first glyph plus at least one component)
        }
        const componentsOffset = ligatureOffset + LIGATURE_HEADER_PREFIX_SIZE;
        if (!hasBytes(bytes, componentsOffset, (componentCount - 1) * 2)) {
          continue;
        }
        if (index + componentCount > glyphIds.length) {
          continue; // not enough input left for this ligature
        }
        let matches = true;
        for (let c = 1; c < componentCount; c++) {
          if (
            glyphIds[index + c] !== u16(bytes, componentsOffset + (c - 1) * 2)
          ) {
            matches = false;
            break;
          }
        }
        if (matches) {
          return { ligatureGlyph, componentCount };
        }
      }
      return undefined;
    },
  };
}

// One subtable of one lookup, resolving LookupType 7 (Extension Substitution) transparently -- the identical Offset32 wrapper GPOS lookups use, existing so a subtable can sit beyond an Offset16's reach.
function parseSubtable(
  bytes: Uint8Array<ArrayBuffer>,
  lookupType: number,
  subtableOffset: number,
): GsubSubtable | undefined {
  if (lookupType === LOOKUP_TYPE_EXTENSION_SUBST) {
    if (
      !hasBytes(bytes, subtableOffset, EXTENSION_SUBST_HEADER_SIZE) ||
      u16(bytes, subtableOffset) !== 1
    ) {
      return undefined;
    }
    const extensionLookupType = u16(bytes, subtableOffset + 2);
    if (extensionLookupType === LOOKUP_TYPE_EXTENSION_SUBST) {
      return undefined; // an Extension subtable may not wrap another one; refusing rather than recursing keeps a malformed font from looping
    }
    return parseSubtable(
      bytes,
      extensionLookupType,
      subtableOffset + u32(bytes, subtableOffset + 4),
    );
  }
  if (lookupType === LOOKUP_TYPE_SINGLE_SUBST) {
    if (!hasBytes(bytes, subtableOffset, 2)) {
      return undefined;
    }
    const substFormat = u16(bytes, subtableOffset);
    if (substFormat === 1) {
      return parseSingleSubstFormat1(bytes, subtableOffset);
    }
    if (substFormat === 2) {
      return parseSingleSubstFormat2(bytes, subtableOffset);
    }
    return undefined;
  }
  if (lookupType === LOOKUP_TYPE_LIGATURE_SUBST) {
    if (!hasBytes(bytes, subtableOffset, 2)) {
      return undefined;
    }
    if (u16(bytes, subtableOffset) !== 1) {
      return undefined; // Ligature Substitution has the one format
    }
    return parseLigatureSubstFormat1(bytes, subtableOffset);
  }
  return undefined; // a ligature feature is free to reference a lookup type this module does not read (multiple, alternate, contextual); nothing here can use one
}

// The ScriptList walk, identical in shape to gpos-table.ts's own: Latin if the font has it, the script-independent default if not, otherwise the first script.
function findScriptOffset(
  bytes: Uint8Array<ArrayBuffer>,
  scriptListOffset: number,
): number | undefined {
  if (!hasBytes(bytes, scriptListOffset, 2)) {
    return undefined;
  }
  const scriptCount = u16(bytes, scriptListOffset);
  const recordsOffset = scriptListOffset + 2;
  if (
    !hasBytes(bytes, recordsOffset, scriptCount * SCRIPT_RECORD_SIZE) ||
    scriptCount === 0
  ) {
    return undefined;
  }
  for (const wanted of PREFERRED_SCRIPT_TAGS) {
    for (let i = 0; i < scriptCount; i++) {
      const recordOffset = recordsOffset + i * SCRIPT_RECORD_SIZE;
      if (readTag(bytes, recordOffset) === wanted) {
        return scriptListOffset + u16(bytes, recordOffset + 4);
      }
    }
  }
  return scriptListOffset + u16(bytes, recordsOffset + 4);
}

function parseDefaultLangSysFeatureIndices(
  bytes: Uint8Array<ArrayBuffer>,
  scriptOffset: number,
): number[] {
  if (!hasBytes(bytes, scriptOffset, 2)) {
    return [];
  }
  const defaultLangSysOffset = u16(bytes, scriptOffset);
  if (defaultLangSysOffset === 0) {
    return [];
  }
  const langSysOffset = scriptOffset + defaultLangSysOffset;
  if (!hasBytes(bytes, langSysOffset, LANG_SYS_HEADER_SIZE)) {
    return [];
  }
  const featureIndexCount = u16(bytes, langSysOffset + 4);
  const indicesOffset = langSysOffset + LANG_SYS_HEADER_SIZE;
  if (!hasBytes(bytes, indicesOffset, featureIndexCount * 2)) {
    return [];
  }
  const indices: number[] = [];
  for (let i = 0; i < featureIndexCount; i++) {
    indices.push(u16(bytes, indicesOffset + i * 2));
  }
  return indices;
}

// The lookup indices every applied ligature feature the chosen script enables points at, in feature order and de-duplicated -- the same once-only discipline gpos-table.ts applies to Carlito's seven 'kern' feature records.
function collectLigatureLookupIndices(
  bytes: Uint8Array<ArrayBuffer>,
  featureListOffset: number,
  featureIndices: readonly number[],
): number[] {
  if (!hasBytes(bytes, featureListOffset, 2)) {
    return [];
  }
  const featureCount = u16(bytes, featureListOffset);
  const recordsOffset = featureListOffset + 2;
  if (!hasBytes(bytes, recordsOffset, featureCount * FEATURE_RECORD_SIZE)) {
    return [];
  }
  const lookupIndices: number[] = [];
  const seen = new Set<number>();
  for (const featureIndex of featureIndices) {
    if (featureIndex >= featureCount) {
      continue;
    }
    const recordOffset = recordsOffset + featureIndex * FEATURE_RECORD_SIZE;
    const tag = readTag(bytes, recordOffset);
    if (
      !LIGATURE_FEATURE_TAGS.includes(
        tag as (typeof LIGATURE_FEATURE_TAGS)[number],
      )
    ) {
      continue;
    }
    const featureOffset = featureListOffset + u16(bytes, recordOffset + 4);
    if (!hasBytes(bytes, featureOffset, FEATURE_HEADER_SIZE)) {
      continue;
    }
    const lookupIndexCount = u16(bytes, featureOffset + 2);
    const indicesOffset = featureOffset + FEATURE_HEADER_SIZE;
    if (!hasBytes(bytes, indicesOffset, lookupIndexCount * 2)) {
      continue;
    }
    for (let i = 0; i < lookupIndexCount; i++) {
      const lookupIndex = u16(bytes, indicesOffset + i * 2);
      if (!seen.has(lookupIndex)) {
        seen.add(lookupIndex);
        lookupIndices.push(lookupIndex);
      }
    }
  }
  return lookupIndices;
}

// The shaping function this module hands back: one glyph sequence in, the substituted sequence and its per-glyph input spans out.
export type GsubShaper = (glyphIds: readonly number[]) => GsubShaping;

// Builds a GSUB shaper from a font's own 'GSUB' table, or returns `undefined` when the font has no GSUB, no 'liga'/'rlig' feature reachable from the script it lays text out in, or nothing readable behind one. Lookups whose lookupFlag is nonzero are skipped rather than applied: those flags make a lookup's behaviour depend on GDEF glyph classes (mark, base) this package does not parse, and applying one without that information would not be the lookup the font declared.
export function buildGsubShaper(font: SfntFont): GsubShaper | undefined {
  const bytes = sfntTableBytes(font, "GSUB");
  if (
    bytes === undefined ||
    !hasBytes(bytes, 0, GSUB_HEADER_SIZE) ||
    u16(bytes, 0) !== 1
  ) {
    return undefined;
  }
  const scriptOffset = findScriptOffset(bytes, u16(bytes, 4));
  if (scriptOffset === undefined) {
    return undefined;
  }
  const lookupIndices = collectLigatureLookupIndices(
    bytes,
    u16(bytes, 6),
    parseDefaultLangSysFeatureIndices(bytes, scriptOffset),
  );
  if (lookupIndices.length === 0) {
    return undefined;
  }

  const lookupListOffset = u16(bytes, 8);
  if (!hasBytes(bytes, lookupListOffset, 2)) {
    return undefined;
  }
  const lookupCount = u16(bytes, lookupListOffset);
  const lookupOffsetsOffset = lookupListOffset + 2;
  if (!hasBytes(bytes, lookupOffsetsOffset, lookupCount * 2)) {
    return undefined;
  }

  // Flattened across lookups in feature order, first match wins -- the same reading gpos-table.ts gives its own concatenated subtables, and correct for the same reason: a real ligature table's subtables describe disjoint sequences.
  const subtables: GsubSubtable[] = [];
  for (const lookupIndex of lookupIndices) {
    if (lookupIndex >= lookupCount) {
      continue;
    }
    const lookupOffset =
      lookupListOffset + u16(bytes, lookupOffsetsOffset + lookupIndex * 2);
    if (!hasBytes(bytes, lookupOffset, LOOKUP_HEADER_SIZE)) {
      continue;
    }
    if (u16(bytes, lookupOffset + 2) !== 0) {
      continue; // nonzero lookupFlag depends on GDEF glyph classes this package does not read
    }
    const lookupType = u16(bytes, lookupOffset);
    const subTableCount = u16(bytes, lookupOffset + 4);
    const subtableOffsetsOffset = lookupOffset + LOOKUP_HEADER_SIZE;
    if (!hasBytes(bytes, subtableOffsetsOffset, subTableCount * 2)) {
      continue;
    }
    for (let i = 0; i < subTableCount; i++) {
      const subtable = parseSubtable(
        bytes,
        lookupType,
        lookupOffset + u16(bytes, subtableOffsetsOffset + i * 2),
      );
      if (subtable !== undefined) {
        subtables.push(subtable);
      }
    }
  }
  if (subtables.length === 0) {
    return undefined;
  }

  return (glyphIds: readonly number[]): GsubShaping => {
    const shaped: number[] = [];
    const spans: number[] = [];
    let index = 0;
    // A ligature consumes its components, so the walk advances past a match rather than reconsidering the glyphs inside it: a chain like 'f','f','i' under an 'ff' then an 'ffi' ligature resolves as whichever the subtable order states first, exactly as a real shaper applies its lookups in order at each position.
    outer: while (index < glyphIds.length) {
      for (const subtable of subtables) {
        if (subtable.kind === "single") {
          const substitute = subtable.lookup(glyphIds[index]!);
          if (substitute !== undefined) {
            shaped.push(substitute);
            spans.push(1);
            index += 1;
            continue outer;
          }
        } else {
          const match = subtable.match(glyphIds, index);
          if (match !== undefined) {
            shaped.push(match.ligatureGlyph);
            spans.push(match.componentCount);
            index += match.componentCount;
            continue outer;
          }
        }
      }
      shaped.push(glyphIds[index]!);
      spans.push(1);
      index += 1;
    }
    return { glyphIds: shaped, spans };
  };
}
