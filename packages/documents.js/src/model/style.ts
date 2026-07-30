import { z } from 'zod';

// A requested font, independent of any concrete rendering backend -- src/pdf/fonts.ts resolves this to one of the 14 standard PDF faces at write time; src/pdf/font-read.ts produces one from a PDF's own /BaseFont + /FontDescriptor at read time.
export const LayoutFontSchema = z.object({
  family: z.string(),
  weight: z.enum(['normal', 'bold']),
  style: z.enum(['normal', 'italic']),
});
export type LayoutFont = z.infer<typeof LayoutFontSchema>;

export const DEFAULT_LAYOUT_FONT: LayoutFont = { family: 'Helvetica', weight: 'normal', style: 'normal' };

export const AlignmentSchema = z.enum(['left', 'center', 'right', 'justify']);
export type Alignment = z.infer<typeof AlignmentSchema>;
