import { z } from 'zod';

// A requested font, independent of any concrete rendering backend -- src/pdf/fonts.ts resolves this to one of the 14 standard PDF faces at write time; src/pdf/font-read.ts produces one from a PDF's own /BaseFont + /FontDescriptor at read time. This did NOT move to ooxml.js: it's PDF-specific (standard-14 font resolution), a concern ooxml.js has no notion of.
export const LayoutFontSchema = z.object({
  family: z.string(),
  weight: z.enum(['normal', 'bold']),
  style: z.enum(['normal', 'italic']),
});
export type LayoutFont = z.infer<typeof LayoutFontSchema>;

export const DEFAULT_LAYOUT_FONT: LayoutFont = { family: 'Helvetica', weight: 'normal', style: 'normal' };

// Alignment now lives in ooxml.js (this file's own logic was ported there verbatim, since ContentParagraph needs the same type ooxml.js's readDocx/readPptx now produce directly) -- re-exported here under the same name so every existing caller keeps resolving it unchanged.
export type { Alignment } from 'ooxml.js';
export { AlignmentSchema } from 'ooxml.js';
