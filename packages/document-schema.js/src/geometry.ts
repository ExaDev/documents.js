import { z } from 'zod';

// Geometry primitives shared by every content/layout schema (ContentSection's page, ContentShape's frame, LayoutPage's dimensions). Ported from ooxml.js's typed/shared/geometry.ts and documents.js's src/model/geometry.ts (identical shape in both). flipY is NOT here: it bridges OOXML/ODF's top-left/y-down space into PDF's bottom-left/y-up space, a PDF-rendering concern specific to documents.js, not a content-model shape.

export const BoxSchema = z.object({
  xPt: z.number(),
  yPt: z.number(),
  widthPt: z.number().nonnegative(),
  heightPt: z.number().nonnegative(),
});
export type Box = z.infer<typeof BoxSchema>;

export const PageSizeSchema = z.object({
  widthPt: z.number().positive(),
  heightPt: z.number().positive(),
});
export type PageSize = z.infer<typeof PageSizeSchema>;

export const MarginsSchema = z.object({
  topPt: z.number().nonnegative(),
  rightPt: z.number().nonnegative(),
  bottomPt: z.number().nonnegative(),
  leftPt: z.number().nonnegative(),
});
export type Margins = z.infer<typeof MarginsSchema>;

// US Letter: 612 x 792 pt (8.5 x 11 in). The default page size when a docx section has no explicit w:sectPr/w:pgSz.
export const PAGE_SIZE_LETTER: PageSize = { widthPt: 612, heightPt: 792 };

// A4: 595.28 x 841.89 pt (210 x 297 mm).
export const PAGE_SIZE_A4: PageSize = { widthPt: 595.28, heightPt: 841.89 };

// PowerPoint's default 16:9 slide size: 12,192,000 x 6,858,000 EMU -> 960 x 540 pt.
export const SLIDE_SIZE_WIDESCREEN: PageSize = { widthPt: 960, heightPt: 540 };

// PowerPoint's legacy 4:3 slide size: 9,144,000 x 6,858,000 EMU -> 720 x 540 pt.
export const SLIDE_SIZE_STANDARD: PageSize = { widthPt: 720, heightPt: 540 };
