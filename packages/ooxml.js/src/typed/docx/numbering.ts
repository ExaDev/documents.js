import { z } from 'zod';
import type { Package } from '../../model/package';
import type { XmlElement } from '../../model/node';
import { attr, childrenWithTag, rootElement } from '../util';

// Resolves word/numbering.xml's real w:abstractNum/w:num definitions -- the glyph/format, start-at value, and restart rule a consumer needs to actually render a list's own markers -- as a companion to (not a replacement for) ContentListMembership (document-schema.js), which read.ts's readListMembership already tracks unchanged: a paragraph's own numId/level membership. NumberingDefinitions is deliberately a separate, top-level structure exported alongside DocxDocument rather than folded into ContentListMembership itself, for two reasons: (1) ContentListMembership is document-schema.js's own schema, shared verbatim across ooxml.js/odf.js/documents.js -- widening it with an ooxml-specific numbering-definition payload would leak this package's own model into a schema the sibling packages also depend on; (2) a definition is a genuinely document-level resource referenced by numId, not a per-paragraph one -- every paragraph sharing a numId would otherwise carry an identical copy of that numId's full level table repeated on every paragraph, rather than the keyed-map-once, referenced-by-id-many-times shape this file provides.

export const NumberingLevelSchema = z.object({
  // The raw ECMA-376 ST_NumberFormat value (w:numFmt/@w:val) verbatim -- e.g. 'decimal', 'lowerRoman', 'upperRoman', 'lowerLetter', 'upperLetter', 'bullet', 'none', 'ordinal', 'chicago', .... ST_NumberFormat has several dozen members; kept as the raw string rather than narrowed to a bounded enum, since a consumer rendering a list's own marker needs the exact value Word wrote, not a lossy narrowing to whichever subset this reader happened to enumerate (the same reasoning readCellBorderEdge in read.ts applies the other way, where ContentBorder's own style field genuinely is a bounded four-member enum it must narrow into).
  format: z.string(),
  // w:lvlText/@w:val verbatim: a placeholder pattern like '%1.' or '%2)' for a numbered format (the digit names which level's own counter substitutes at that position, 1-based), or a literal bullet glyph string for format 'bullet'.
  text: z.string(),
  // w:start/@w:val: the value this level's counter begins from. Defaults to 1 when w:start itself is absent, ECMA-376's own default.
  startAt: z.number(),
  // w:lvlRestart/@w:val, when present: the (1-based, per ECMA-376 ST_DecimalNumber) level whose own occurrence resets this level's counter back to startAt. Absent (undefined) is ECMA-376's own default behaviour, not "never restarts": a level with no explicit w:lvlRestart still restarts whenever a numbered paragraph at any shallower (numerically lower ilvl) level of the same list occurs -- the standard "each time you go back up a level, the deeper counters start over" list behaviour every real Word list already exhibits.
  restart: z.number().optional(),
});
export type NumberingLevel = z.infer<typeof NumberingLevelSchema>;

// levels is keyed by the level's own zero-based ilvl, stringified (e.g. '0', '1', ...) -- the identical zero-based numbering ContentListMembership.level already uses, so `definitions[membership.numId]?.levels[String(membership.level)]` is the direct lookup path from a paragraph's own membership to its rendering definition. A record rather than a fixed-length array/tuple: an abstractNum's own w:lvlOverride can replace or add individual levels, so the set of populated levels is not guaranteed to be a dense 0..8 run in every real document, even though Word itself always writes all nine.
export const NumberingDefinitionSchema = z.object({
  levels: z.record(z.string(), NumberingLevelSchema),
});
export type NumberingDefinition = z.infer<typeof NumberingDefinitionSchema>;

// Keyed by w:numId -- the same identifier ContentListMembership.numId carries.
export type NumberingDefinitions = Readonly<Record<string, NumberingDefinition>>;

const NUMBERING_PART_PATH = 'word/numbering.xml';

function readLevel(lvl: XmlElement): NumberingLevel | undefined {
  const numFmtEl = childrenWithTag(lvl, 'w:numFmt')[0];
  const lvlTextEl = childrenWithTag(lvl, 'w:lvlText')[0];
  const format = numFmtEl === undefined ? undefined : attr(numFmtEl, 'w:val');
  const text = lvlTextEl === undefined ? undefined : attr(lvlTextEl, 'w:val');
  if (format === undefined || text === undefined) {
    return undefined;
  }
  const startEl = childrenWithTag(lvl, 'w:start')[0];
  const startVal = startEl === undefined ? undefined : attr(startEl, 'w:val');
  const restartEl = childrenWithTag(lvl, 'w:lvlRestart')[0];
  const restartVal = restartEl === undefined ? undefined : attr(restartEl, 'w:val');
  const level: NumberingLevel = {
    format,
    text,
    startAt: startVal === undefined ? 1 : Number(startVal),
  };
  if (restartVal !== undefined) {
    level.restart = Number(restartVal);
  }
  return level;
}

function readAbstractNumLevels(abstractNum: XmlElement): Record<string, NumberingLevel> {
  const levels: Record<string, NumberingLevel> = {};
  for (const lvl of childrenWithTag(abstractNum, 'w:lvl')) {
    const ilvl = attr(lvl, 'w:ilvl');
    if (ilvl === undefined) {
      continue;
    }
    const level = readLevel(lvl);
    if (level !== undefined) {
      levels[ilvl] = level;
    }
  }
  return levels;
}

// w:num/w:lvlOverride overrides one level of its target abstractNum, either wholesale (a nested w:lvl child, the identical shape an abstractNum's own w:lvl uses) or narrowly (w:startOverride alone, changing only where that level's counter begins while keeping its format/text/restart unchanged).
function applyLevelOverrides(baseLevels: Readonly<Record<string, NumberingLevel>>, num: XmlElement): Record<string, NumberingLevel> {
  const levels = { ...baseLevels };
  for (const override of childrenWithTag(num, 'w:lvlOverride')) {
    const ilvl = attr(override, 'w:ilvl');
    if (ilvl === undefined) {
      continue;
    }
    const nestedLvl = childrenWithTag(override, 'w:lvl')[0];
    if (nestedLvl !== undefined) {
      const level = readLevel(nestedLvl);
      if (level !== undefined) {
        levels[ilvl] = level;
      }
      continue;
    }
    const startOverrideEl = childrenWithTag(override, 'w:startOverride')[0];
    const startOverrideVal = startOverrideEl === undefined ? undefined : attr(startOverrideEl, 'w:val');
    const base = levels[ilvl];
    if (startOverrideVal !== undefined && base !== undefined) {
      levels[ilvl] = { ...base, startAt: Number(startOverrideVal) };
    }
  }
  return levels;
}

// Resolves every w:num's own numId to its abstractNumId's level table, with that num's own w:lvlOverride entries (if any) merged on top. A w:num with no matching w:abstractNumId, or whose abstractNumId doesn't resolve to a known w:abstractNum, is skipped entirely -- a malformed reference, not a partial definition worth returning. Returns an empty record when word/numbering.xml itself is absent (a document with no lists at all).
export function readNumberingDefinitions(pkg: Package): NumberingDefinitions {
  const root = rootElement(pkg.parts[NUMBERING_PART_PATH]);
  if (root === undefined) {
    return {};
  }

  const abstractNums = new Map<string, Record<string, NumberingLevel>>();
  for (const abstractNum of childrenWithTag(root, 'w:abstractNum')) {
    const abstractNumId = attr(abstractNum, 'w:abstractNumId');
    if (abstractNumId === undefined) {
      continue;
    }
    abstractNums.set(abstractNumId, readAbstractNumLevels(abstractNum));
  }

  const definitions: Record<string, NumberingDefinition> = {};
  for (const num of childrenWithTag(root, 'w:num')) {
    const numId = attr(num, 'w:numId');
    const abstractNumIdEl = childrenWithTag(num, 'w:abstractNumId')[0];
    const abstractNumId = abstractNumIdEl === undefined ? undefined : attr(abstractNumIdEl, 'w:val');
    if (numId === undefined || abstractNumId === undefined) {
      continue;
    }
    const baseLevels = abstractNums.get(abstractNumId);
    if (baseLevels === undefined) {
      continue;
    }
    definitions[numId] = { levels: applyLevelOverrides(baseLevels, num) };
  }
  return definitions;
}
