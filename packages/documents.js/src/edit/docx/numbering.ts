import type { XmlNode } from "ooxml.js";
import type {
  NumberingDefinition,
  NumberingDefinitions,
  NumberingLevel,
} from "ooxml.js";
import type { ContentListMembership } from "document-schema.js";

// Synthesises a word/numbering.xml part for buildDocxPackage: buildDocxPackage writes w:numPr/w:numId references on list paragraphs (via DocxParagraph.list) but createEmptyDocxPackage builds NO numbering part, so without this the numIds dangle and Word renders no bullets/numbers. Each ContentListMembership's own format (docx's w:numFmt — bullet/decimal/lowerLetter/upperLetter/lowerRoman/upperRoman) is threaded straight through into the level it belongs to; format's absence means an implicit bullet, exactly as ContentListMembershipSchema's own doc comment states. Building the actual w:abstractNum/w:num elements is delegated to ooxml.js's buildNumberingElement (this module's inverse: readNumberingDefinitions/NumberingDefinitions), so this file's only job is turning the numId-remapping pre-pass's own working data into the NumberingDefinitions shape that writer expects.

export const NUMBERING_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml";
export const NUMBERING_REL_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering";
export const NUMBERING_PART_PATH = "word/numbering.xml";

export function declaration(): XmlNode {
  return {
    type: "declaration",
    attributes: [
      { name: "version", value: "1.0" },
      { name: "encoding", value: "UTF-8" },
      { name: "standalone", value: "yes" },
    ],
  };
}

export interface NumberingEntry {
  // The source membership's numId, or undefined for the shared no-numId group (see content.ts's collectListNumIds comment). Carried for diagnosis only — buildNumberingDefinitions below keys its result by remappedNumId, never this.
  readonly sourceNumId: string | undefined;
  readonly remappedNumId: string;
  // ilvl -> the format the first paragraph seen at that numId+level asked for (see content.ts's collectListNumIds for the first-wins rule); absent means the source stated only a depth with no format of its own, which every reader has always treated as an implicit bullet.
  readonly levels: ReadonlyMap<number, ContentListMembership["format"]>;
}

// docx's own ST_NumberFormat placeholder convention (ECMA-376 17.9.13, w:lvlText): a numbered level references its own counter as '%N', N being the level's 1-based position — '%1.' at ilvl 0, '%2.' at ilvl 1, and so on. A bullet level carries a literal glyph instead, since it has no counter to reference.
function lvlText(
  format: ContentListMembership["format"],
  level: number,
): string {
  return format === undefined || format === "bullet" ? "•" : `%${level + 1}.`;
}

// NumberingEntry[] -> the NumberingDefinitions ooxml.js's buildNumberingElement turns into real w:abstractNum/w:num elements — the identical writer buildDocxPackageFromContent already uses for a DocxContent's own explicit numbering, reused here rather than hand-rolling a second XML builder. ContentListMembership.format's own vocabulary (bullet/decimal/lowerLetter/upperLetter/lowerRoman/upperRoman) is already a subset of real ST_NumberFormat values, so no further mapping is needed beyond substituting the implicit-bullet default.
export function buildNumberingDefinitions(
  entries: readonly NumberingEntry[],
): NumberingDefinitions {
  const definitions: Record<string, NumberingDefinition> = {};
  for (const entry of entries) {
    const levels: Record<string, NumberingLevel> = {};
    for (const [level, format] of entry.levels) {
      const numFmt = format ?? "bullet";
      levels[String(level)] = {
        format: numFmt,
        text: lvlText(format, level),
        startAt: 1,
      };
    }
    definitions[entry.remappedNumId] = { levels };
  }
  return definitions;
}
