import { z } from 'zod';

// Ported from documents.js's src/model/style.ts, Alignment only -- LayoutFont/DEFAULT_LAYOUT_FONT is PDF-specific (standard-14 font resolution) and has no place here.

export const AlignmentSchema = z.enum(['left', 'center', 'right', 'justify']);
export type Alignment = z.infer<typeof AlignmentSchema>;
