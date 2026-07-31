import { z } from 'zod';

// Alignment: ported from ooxml.js's typed/shared/style.ts and documents.js's src/model/style.ts (identical shape in both).
export const AlignmentSchema = z.enum(['left', 'center', 'right', 'justify']);
export type Alignment = z.infer<typeof AlignmentSchema>;

// A requested font, independent of any concrete rendering backend -- part of LayoutDocument's own shape (every LayoutText needs one), not OOXML/ODF-specific. documents.js's src/pdf/fonts.ts resolves this to one of the 14 standard PDF faces at write time; src/pdf/font-read.ts produces one from a PDF's own /BaseFont + /FontDescriptor at read time -- that resolution behaviour stays in documents.js, only the shape lives here.
export const LayoutFontSchema = z.object({
  family: z.string(),
  weight: z.enum(['normal', 'bold']),
  style: z.enum(['normal', 'italic']),
});
export type LayoutFont = z.infer<typeof LayoutFontSchema>;

export const DEFAULT_LAYOUT_FONT: LayoutFont = { family: 'Helvetica', weight: 'normal', style: 'normal' };
