import { z } from "zod";
import { XmlNodeSchema } from "../xml/node";

// The lossless byte-level Package model (ExaDev/documents.js#963), mirroring ooxml.js's and odf.js's own model/package.ts exactly: a part is an ordered forest of nodes when it looks like XML, or its raw bytes as base64 otherwise (base64 keeps the whole Package a real JSON value) -- the same "genuinely lossless, not merely restorable" boundary those two siblings already draw between their own decodePackage/encodePackage pair and their higher-level, lossy typed readers.

export const XmlPartSchema = z.object({
  kind: z.literal("xml"),
  nodes: z.array(XmlNodeSchema),
});
export type XmlPart = z.infer<typeof XmlPartSchema>;

export const BinaryPartSchema = z.object({
  kind: z.literal("binary"),
  base64: z.string(),
});
export type BinaryPart = z.infer<typeof BinaryPartSchema>;

export const PartSchema = z.discriminatedUnion("kind", [
  XmlPartSchema,
  BinaryPartSchema,
]);
export type Part = z.infer<typeof PartSchema>;

// A whole EPUB OCF package: every part keyed by its zip-entry path. The mimetype part's own mandatory first-entry/stored/uncompressed OCF layout (EPUB 3.3 section 6.3) is not a property this schema states -- src/package-io/write.ts's own serializePackage restores it unconditionally on every encode, the same division of responsibility odf.js's identical ODF Packages requirement already draws between its own Package schema (silent on ordering) and its serializePackage (which enforces it).
export const EpubPackageSchema = z.object({
  parts: z.record(z.string(), PartSchema),
});
export type EpubPackage = z.infer<typeof EpubPackageSchema>;
