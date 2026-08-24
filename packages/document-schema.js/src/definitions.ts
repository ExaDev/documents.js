import { z } from "zod";
import { ColorSchema } from "./color";
import {
  ContentListMembershipSchema,
  type ContentParagraph,
  type ContentRun,
} from "./content";
import { AlignmentSchema } from "./style";

// The package-level definitions-table facility (ExaDev/document-schema.js#21): named tables at the DocumentTree root whose entries tree nodes reference by string id, so repeated data is stated once and referenced many times. Styles were the first tenant (the StylesTableSchema below), and the tenant-generic DefinitionsTableSchema beside it is what let every later tenant land without this module changing: link, footnote, and comment definitions (ExaDev/markdown-codec#63, ExaDev/document-schema.js#22) ride the `definitions` field, and 4.1.0's three construct tables -- `layers`, `attachments`, `destinations` (ExaDev/document-schema.js#24) -- are three more root fields of this same generic type rather than three parallel shapes. This module defines the schemas and the pure resolution helpers; the frequency pass that mints entries from repeated property tuples is src/factor-styles.ts, which consumes them.

// The paragraph half of a style entry: exactly the canonical ContentParagraph direct properties that a style may carry, and nothing else. Deliberately strict rather than plain: strictObject REJECTS a smuggled extra key instead of silently stripping it, which is what makes the ban list a schema-shape guarantee rather than a documented convention -- frames, sourcePath, and styleId are per-node facts (a position is a fact about a node, not a style; sourcePath and styleId identify the node and its producer-side style), so an entry carrying any of them fails validation outright instead of parsing to a value that quietly dropped them (ExaDev/document-schema.js#21's errata).
export const StyleParagraphPropertiesSchema = z.strictObject({
  alignment: AlignmentSchema.optional(),
  list: ContentListMembershipSchema.optional(),
  spacingBeforePt: z.number().optional(),
  spacingAfterPt: z.number().optional(),
  lineSpacing: z.number().positive().optional(), // multiple of single line height, matching ContentParagraphSchema's own field
  indentLeftPt: z.number().optional(),
  indentFirstLinePt: z.number().optional(),
  pageBreakBefore: z.boolean().optional(), // the page-boundary flags ContentParagraph carries -- the styles-table spelling of a paragraph style that forces a page break
  pageBreakAfter: z.boolean().optional(),
});
export type StyleParagraphProperties = z.infer<
  typeof StyleParagraphPropertiesSchema
>;

// The run half of a style entry: the canonical ContentRun direct formatting properties. sizePt is the real field name (ContentRunSchema's own) -- the issue text's "fontPt" was a typo, corrected in its errata comment. Same strictness and the same ban-list reasoning as StyleParagraphPropertiesSchema above.
export const StyleRunPropertiesSchema = z.strictObject({
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  strike: z.boolean().optional(),
  fontFamily: z.string().optional(),
  sizePt: z.number().positive().optional(),
  color: ColorSchema.optional(),
});
export type StyleRunProperties = z.infer<typeof StyleRunPropertiesSchema>;

// One styles-table entry: resolved canonical properties only, split by the level they apply at. Never a basedOn graph inside the table (the entry is a dictionary value, not a program -- resolution is one overlay chain computed by the consumer, see resolveStyleChain below), never frames/sourcePath/styleId (the two strict sub-objects above are the entire legal field set, so the ban list holds no matter how the entry is constructed).
export const StyleEntrySchema = z.strictObject({
  paragraph: StyleParagraphPropertiesSchema.optional(),
  run: StyleRunPropertiesSchema.optional(),
});
export type StyleEntry = z.infer<typeof StyleEntrySchema>;

// The styles tenant of the definitions facility: string id -> resolved entry. Ids are minted by the factoring pass of src/factor-styles.ts (s1, s2, ... in deterministic order -- minting determinism is the encoding pair's law iii, src/package.ts), and a tree node's `style` ref names a key in exactly this record.
export const StylesTableSchema = z.record(z.string(), StyleEntrySchema);
export type StylesTable = z.infer<typeof StylesTableSchema>;

// The tenant-generic half of the facility: any table of definitions whose entries are not styles -- the type of the `definitions` root field and of the `layers`/`attachments`/`destinations` tables beside it (src/package.ts). Each entry carries a `kind` string naming its tenant (a link definition is { kind: 'link', url, ... }, a footnote definition { kind: 'footnote', ... }, a PDF optional-content group { kind: 'layer', ... }) and an open body belonging to that tenant's own vocabulary -- this package defines the mechanism and the discriminator, never the per-tenant fields, so a new tenant lands additively without this schema changing. Deliberately loose rather than strict: the whole point is that the body's keys are not this package's to enumerate, so unknown keys are preserved through a parse rather than stripped.
export const DefinitionEntrySchema = z.looseObject({
  kind: z.string(),
});
export type DefinitionEntry = z.infer<typeof DefinitionEntrySchema>;

export const DefinitionsTableSchema = z.record(
  z.string(),
  DefinitionEntrySchema,
);
export type DefinitionsTable = z.infer<typeof DefinitionsTableSchema>;

// Field-wise overlay of two style entries: for every property of both halves, inner's value (when present) wins over outer's; a property absent from inner falls through to outer. Explicitly-present-undefined inner values do not overwrite outer -- a key set to undefined is JSON-identical to an absent key (it never serialises), and treating it as a value would make the overlay's result depend on how the producer spelled absence.
export function overlayStyleEntries(
  outer: StyleEntry,
  inner: StyleEntry,
): StyleEntry {
  const paragraph = overlayParagraphProperties(
    outer.paragraph,
    inner.paragraph,
  );
  const run = overlayRunProperties(outer.run, inner.run);
  return {
    ...(paragraph !== undefined ? { paragraph } : {}),
    ...(run !== undefined ? { run } : {}),
  };
}

function overlayParagraphProperties(
  outer: StyleParagraphProperties | undefined,
  inner: StyleParagraphProperties | undefined,
): StyleParagraphProperties | undefined {
  if (outer === undefined) return inner;
  if (inner === undefined) return outer;
  const merged: StyleParagraphProperties = { ...outer };
  if (inner.alignment !== undefined) merged.alignment = inner.alignment;
  if (inner.list !== undefined) merged.list = inner.list;
  if (inner.spacingBeforePt !== undefined)
    merged.spacingBeforePt = inner.spacingBeforePt;
  if (inner.spacingAfterPt !== undefined)
    merged.spacingAfterPt = inner.spacingAfterPt;
  if (inner.lineSpacing !== undefined) merged.lineSpacing = inner.lineSpacing;
  if (inner.indentLeftPt !== undefined)
    merged.indentLeftPt = inner.indentLeftPt;
  if (inner.indentFirstLinePt !== undefined)
    merged.indentFirstLinePt = inner.indentFirstLinePt;
  return merged;
}

function overlayRunProperties(
  outer: StyleRunProperties | undefined,
  inner: StyleRunProperties | undefined,
): StyleRunProperties | undefined {
  if (outer === undefined) return inner;
  if (inner === undefined) return outer;
  const merged: StyleRunProperties = { ...outer };
  if (inner.bold !== undefined) merged.bold = inner.bold;
  if (inner.italic !== undefined) merged.italic = inner.italic;
  if (inner.underline !== undefined) merged.underline = inner.underline;
  if (inner.strike !== undefined) merged.strike = inner.strike;
  if (inner.fontFamily !== undefined) merged.fontFamily = inner.fontFamily;
  if (inner.sizePt !== undefined) merged.sizePt = inner.sizePt;
  if (inner.color !== undefined) merged.color = inner.color;
  return merged;
}

// Folds one node's full overlay chain into a single effective entry: refs ordered outermost first (the nearest ancestor group's style, then each further-out one, ending with the node's own group ref -- however many levels the tree actually uses). An unknown ref throws rather than resolving to nothing, because a package whose tree references an id the styles table does not carry is malformed and a silent skip would quietly drop that level of the chain -- consistency between refs and the table is the producer's responsibility (the same deliberate non-enforcement DocumentTreeSchema applies to pages-versus-frames), but once resolution runs, it runs loudly.
export function resolveStyleChain(
  styles: StylesTable,
  refs: readonly string[],
): StyleEntry {
  let resolved: StyleEntry = {};
  for (const ref of refs) {
    const entry = styles[ref];
    if (entry === undefined) {
      throw new Error(
        `resolveStyleChain: style ref "${ref}" names no entry in the styles table`,
      );
    }
    resolved = overlayStyleEntries(resolved, entry);
  }
  return resolved;
}

// Applies a resolved entry's paragraph half to one paragraph: the paragraph's own direct properties win (innermost), style-supplied values fill only the gaps. Pure -- the input paragraph is never mutated, and when the entry carries no paragraph half the input object is returned as-is (matching the family's ownership discipline of embedding rather than cloning unchanged nodes).
export function applyParagraphStyleProperties(
  properties: StyleParagraphProperties | undefined,
  paragraph: ContentParagraph,
): ContentParagraph {
  if (properties === undefined) return paragraph;
  const effective: ContentParagraph = { ...paragraph };
  if (effective.alignment === undefined && properties.alignment !== undefined)
    effective.alignment = properties.alignment;
  if (effective.list === undefined && properties.list !== undefined)
    effective.list = properties.list;
  if (
    effective.spacingBeforePt === undefined &&
    properties.spacingBeforePt !== undefined
  ) {
    effective.spacingBeforePt = properties.spacingBeforePt;
  }
  if (
    effective.spacingAfterPt === undefined &&
    properties.spacingAfterPt !== undefined
  ) {
    effective.spacingAfterPt = properties.spacingAfterPt;
  }
  if (
    effective.lineSpacing === undefined &&
    properties.lineSpacing !== undefined
  )
    effective.lineSpacing = properties.lineSpacing;
  if (
    effective.indentLeftPt === undefined &&
    properties.indentLeftPt !== undefined
  ) {
    effective.indentLeftPt = properties.indentLeftPt;
  }
  if (
    effective.indentFirstLinePt === undefined &&
    properties.indentFirstLinePt !== undefined
  ) {
    effective.indentFirstLinePt = properties.indentFirstLinePt;
  }
  if (
    effective.pageBreakBefore === undefined &&
    properties.pageBreakBefore !== undefined
  ) {
    effective.pageBreakBefore = properties.pageBreakBefore;
  }
  if (
    effective.pageBreakAfter === undefined &&
    properties.pageBreakAfter !== undefined
  ) {
    effective.pageBreakAfter = properties.pageBreakAfter;
  }
  return effective;
}

// Applies a resolved entry's run half to one run, as run-level defaults: the run's own properties win, style-supplied values fill only the gaps. This is the overlay chain's one extra level down (a resolved entry's run half is the default for every run of the paragraph it resolved for, and each run's own formatting sits innermost on top of it).
export function applyRunStyleProperties(
  properties: StyleRunProperties | undefined,
  run: ContentRun,
): ContentRun {
  if (properties === undefined) return run;
  const effective: ContentRun = { ...run };
  if (effective.bold === undefined && properties.bold !== undefined)
    effective.bold = properties.bold;
  if (effective.italic === undefined && properties.italic !== undefined)
    effective.italic = properties.italic;
  if (effective.underline === undefined && properties.underline !== undefined)
    effective.underline = properties.underline;
  if (effective.strike === undefined && properties.strike !== undefined)
    effective.strike = properties.strike;
  if (effective.fontFamily === undefined && properties.fontFamily !== undefined)
    effective.fontFamily = properties.fontFamily;
  if (effective.sizePt === undefined && properties.sizePt !== undefined)
    effective.sizePt = properties.sizePt;
  if (effective.color === undefined && properties.color !== undefined)
    effective.color = properties.color;
  return effective;
}
