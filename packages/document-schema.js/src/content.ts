import { z } from 'zod';
import { ColorSchema } from './color';
import type { Color } from './color';
import { BoxSchema, MarginsSchema, PageSizeSchema } from './geometry';
import { LayoutMetadataSchema } from './metadata';
import { AlignmentSchema } from './style';

// The shared block model underlying a wordprocessing document's sections and a presentation document's slides. Ported from ooxml.js's src/typed/shared/content.ts (itself ported from documents.js's src/model/content.ts) -- the canonical home now; ooxml.js and documents.js both import this instead of maintaining their own copy. The ContentDocument envelope below (formatVersion + kind + wordprocessing/presentation variants) is this package's own addition on top of that shared vocabulary, matching documents.js's existing model/content.ts shape, since a caller needs a single top-level value to carry through a conversion pipeline.

export const ContentRunSchema = z.object({
  text: z.string(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  strike: z.boolean().optional(),
  fontFamily: z.string().optional(),
  sizePt: z.number().positive().optional(),
  color: ColorSchema.optional(),
  hyperlink: z.string().optional(), // resolved external URI
});
export type ContentRun = z.infer<typeof ContentRunSchema>;

export const ContentListMembershipSchema = z.object({
  numId: z.string(), // w:numId
  level: z.number().int().nonnegative(), // w:ilvl
});
export type ContentListMembership = z.infer<typeof ContentListMembershipSchema>;

export const ContentParagraphSchema = z.object({
  kind: z.literal('paragraph'),
  runs: z.array(ContentRunSchema),
  styleId: z.string().optional(), // w:pStyle/@w:val, e.g. 'Heading1'
  alignment: AlignmentSchema.optional(),
  list: ContentListMembershipSchema.optional(),
  spacingBeforePt: z.number().optional(),
  spacingAfterPt: z.number().optional(),
  lineSpacing: z.number().positive().optional(), // multiple of single line height
  indentLeftPt: z.number().optional(),
  indentFirstLinePt: z.number().optional(),
});
export type ContentParagraph = z.infer<typeof ContentParagraphSchema>;

export const ContentImageBlockSchema = z.object({
  kind: z.literal('image'),
  format: z.enum(['png', 'jpeg']),
  base64: z.string(),
  widthPt: z.number().positive(),
  heightPt: z.number().positive(),
  altText: z.string().optional(),
});
export type ContentImageBlock = z.infer<typeof ContentImageBlockSchema>;

export const ContentPageBreakSchema = z.object({ kind: z.literal('pageBreak') });
export type ContentPageBreak = z.infer<typeof ContentPageBreakSchema>;

// ContentTable is mutually recursive with ContentBlock (a cell contains blocks, which may themselves be tables) -- hand-written, mirroring ooxml.js's own XmlElement/isXmlNode pattern, since z.lazy() collapses to `unknown` for recursive children in the pinned Zod version.
export interface ContentTableCell {
  blocks: ContentBlock[];
  colSpan?: number;
  rowSpan?: number;
  background?: Color;
}

export interface ContentTableRow {
  cells: ContentTableCell[];
  // pptx tables carry an explicit row height (a:tr/@h); docx tables do not model one at the row level in the same way, so this is undefined there.
  heightPt?: number;
}

export interface ContentTable {
  kind: 'table';
  rows: ContentTableRow[];
  columnWidthsPt: number[];
}

export type ContentBlock = ContentParagraph | ContentTable | ContentImageBlock | ContentPageBreak;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isContentRun(value: unknown): value is ContentRun {
  return isRecord(value) && typeof value.text === 'string';
}

function isContentTableCell(value: unknown): value is ContentTableCell {
  return isRecord(value) && Array.isArray(value.blocks) && value.blocks.every(isContentBlock);
}

function isContentTableRow(value: unknown): value is ContentTableRow {
  return (
    isRecord(value) &&
    Array.isArray(value.cells) &&
    value.cells.every(isContentTableCell) &&
    (value.heightPt === undefined || typeof value.heightPt === 'number')
  );
}

// Recursive structural guard. Used via z.custom so table cells validate without a recursive Zod schema (which collapses to `unknown` under z.lazy in this Zod version).
export function isContentBlock(value: unknown): value is ContentBlock {
  if (!isRecord(value)) {
    return false;
  }
  const kind = value.kind;
  if (kind === 'paragraph') {
    return Array.isArray(value.runs) && value.runs.every(isContentRun);
  }
  if (kind === 'image') {
    return (
      (value.format === 'png' || value.format === 'jpeg') &&
      typeof value.base64 === 'string' &&
      typeof value.widthPt === 'number' &&
      typeof value.heightPt === 'number'
    );
  }
  if (kind === 'pageBreak') {
    return true;
  }
  if (kind === 'table') {
    return (
      Array.isArray(value.rows) &&
      value.rows.every(isContentTableRow) &&
      Array.isArray(value.columnWidthsPt) &&
      value.columnWidthsPt.every((w) => typeof w === 'number')
    );
  }
  return false;
}

export const ContentBlockSchema = z.custom<ContentBlock>(isContentBlock);

export const ContentTableCellSchema = z.object({
  blocks: z.array(ContentBlockSchema),
  colSpan: z.number().int().positive().optional(),
  rowSpan: z.number().int().positive().optional(),
  background: ColorSchema.optional(),
});

export const ContentTableRowSchema = z.object({
  cells: z.array(ContentTableCellSchema),
  heightPt: z.number().positive().optional(),
});

export const ContentTableSchema = z.object({
  kind: z.literal('table'),
  rows: z.array(ContentTableRowSchema),
  columnWidthsPt: z.array(z.number().positive()),
});

// A docx section: a run of pages sharing one page size/margins (a w:sectPr boundary starts a new one).
export const ContentSectionSchema = z.object({
  pageSize: PageSizeSchema,
  margins: MarginsSchema,
  blocks: z.array(ContentBlockSchema),
});
export type ContentSection = z.infer<typeof ContentSectionSchema>;

// A pptx shape's frame keeps OOXML's own convention: top-left origin, y down, in points already converted from EMU. rotationDeg is clockwise (DrawingML's own a:xfrm/@rot sense), about the frame's own centre, and is undefined rather than 0 for an unrotated shape -- keeping the common case field-free rather than a stored, always-present zero. insetLeftPt/insetTopPt/insetRightPt/insetBottomPt are always present (never optional): every shape has SOME inset, whether from an explicit a:bodyPr or ECMA-376's own documented default, and a picture/table (which has no text body at all) resolves to zero rather than leaving the field absent. fontScale/lineSpacingReduction come from a:normAutofit's already-computed PowerPoint values (present only when the source shape actually has autofit-shrunk text) and are applied directly rather than re-solved.
export const ContentShapeSchema = z.object({
  name: z.string().optional(),
  frame: BoxSchema,
  rotationDeg: z.number().optional(),
  insetLeftPt: z.number().nonnegative(),
  insetTopPt: z.number().nonnegative(),
  insetRightPt: z.number().nonnegative(),
  insetBottomPt: z.number().nonnegative(),
  fontScale: z.number().positive().optional(),
  lineSpacingReduction: z.number().nonnegative().optional(),
  blocks: z.array(ContentBlockSchema),
});
export type ContentShape = z.infer<typeof ContentShapeSchema>;

export const ContentSlideSchema = z.object({
  size: PageSizeSchema,
  shapes: z.array(ContentShapeSchema),
  notes: z.string(),
});
export type ContentSlide = z.infer<typeof ContentSlideSchema>;

// Bumped whenever ContentDocumentSchema's shape changes incompatibly.
export const CONTENT_FORMAT_VERSION = 1;

export const ContentDocumentSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('wordprocessing'),
    formatVersion: z.literal(CONTENT_FORMAT_VERSION),
    metadata: LayoutMetadataSchema,
    sections: z.array(ContentSectionSchema),
  }),
  z.object({
    kind: z.literal('presentation'),
    formatVersion: z.literal(CONTENT_FORMAT_VERSION),
    metadata: LayoutMetadataSchema,
    slides: z.array(ContentSlideSchema),
  }),
]);
export type ContentDocument = z.infer<typeof ContentDocumentSchema>;
