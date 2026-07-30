import { z } from 'zod';
import type { LayoutColor } from './color';
import { LayoutColorSchema } from './color';
import { BoxSchema, MarginsSchema, PageSizeSchema } from './geometry';
import { LayoutMetadataSchema } from './layout';
import { AlignmentSchema } from './style';

// Bumped whenever ContentDocumentSchema's shape changes incompatibly.
export const CONTENT_FORMAT_VERSION = 1;

export const ContentRunSchema = z.object({
  text: z.string(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  strike: z.boolean().optional(),
  fontFamily: z.string().optional(),
  sizePt: z.number().positive().optional(),
  color: LayoutColorSchema.optional(),
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

// ContentTable is mutually recursive with ContentBlock (a cell contains blocks, which may themselves be tables) -- hand-written, mirroring ooxml.js's XmlElement/isXmlNode pattern (src/model/node.ts), since z.lazy() collapses to `unknown` for recursive children in the pinned Zod version.
export interface ContentTableCell {
  blocks: ContentBlock[];
  colSpan?: number;
  rowSpan?: number;
  background?: LayoutColor;
}

export interface ContentTableRow {
  cells: ContentTableCell[];
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
  return isRecord(value) && Array.isArray(value.cells) && value.cells.every(isContentTableCell);
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
  background: LayoutColorSchema.optional(),
});

export const ContentTableRowSchema = z.object({
  cells: z.array(ContentTableCellSchema),
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

// A pptx shape's frame keeps OOXML's own convention: top-left origin, y down, in points already converted from EMU. The one deliberate Y-flip into PDF space happens once, in src/layout/slides.ts.
export const ContentShapeSchema = z.object({
  name: z.string().optional(),
  frame: BoxSchema,
  blocks: z.array(ContentBlockSchema),
});
export type ContentShape = z.infer<typeof ContentShapeSchema>;

export const ContentSlideSchema = z.object({
  size: PageSizeSchema,
  shapes: z.array(ContentShapeSchema),
  notes: z.string(),
});
export type ContentSlide = z.infer<typeof ContentSlideSchema>;

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
