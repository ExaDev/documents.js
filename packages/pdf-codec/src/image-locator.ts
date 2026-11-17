import { z } from "zod";

// The name per-image reading gives an image, in a module of its own so diagnostics.ts can carry it on PdfImageLocatorError without depending on read-images.ts, and so the schema's zod import stays off the per-image reader's module graph (read-images.ts imports only the type).

const PdfImageLocatorIndexSchema = z.number().int().nonnegative();

/**
 * Names one image of a PDF, as `listPdfImages` reports it and `decodePdfImage` takes it back. Plain data, so a caller can store it and decode the image in a later call (or a later process) against the same file bytes; the schema validates one read back from storage.
 *
 * - `xobject`: an image XObject, by its indirect object reference. One entry covers every place the document draws it. `generation` is informational: the cross-reference table this package reads keeps one entry per object number, so an object is found by its number whatever generation the locator carries.
 * - `inline`: an inline image (`BI` ... `ID` ... `EI`), which has no object of its own, by its page's zero-based source index and its position among that page's inline images in content-stream order (counted from 0, every inline image counted, including ones the listing leaves out). Decoding one interprets that page's content again to find it; inline images are small by design (ISO 32000-1 8.9.7 recommends at most 4 KB), and producers rarely write them.
 */
export const PdfImageLocatorSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("xobject"),
      objectNumber: PdfImageLocatorIndexSchema,
      generation: PdfImageLocatorIndexSchema,
    })
    .readonly(),
  z
    .object({
      kind: z.literal("inline"),
      pageIndex: PdfImageLocatorIndexSchema,
      occurrence: PdfImageLocatorIndexSchema,
    })
    .readonly(),
]);

/** See `PdfImageLocatorSchema`. */
export type PdfImageLocator = z.infer<typeof PdfImageLocatorSchema>;
