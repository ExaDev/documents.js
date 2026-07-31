import { z } from 'zod';
import { XmlNodeSchema } from './node';

// A part is an ordered forest of nodes; a binary part is its bytes as base64 (base64 keeps the whole Package a real JSON value).
export const XmlPartSchema = z.object({
  kind: z.literal('xml'),
  nodes: z.array(XmlNodeSchema),
});
export type XmlPart = z.infer<typeof XmlPartSchema>;

export const BinaryPartSchema = z.object({
  kind: z.literal('binary'),
  base64: z.string(),
});
export type BinaryPart = z.infer<typeof BinaryPartSchema>;

export const PartSchema = z.discriminatedUnion('kind', [XmlPartSchema, BinaryPartSchema]);
export type Part = z.infer<typeof PartSchema>;

// A whole zip-of-XML package (e.g. an ODF document): every part keyed by its zip-entry path.
export const PackageSchema = z.object({
  parts: z.record(z.string(), PartSchema),
});
export type Package = z.infer<typeof PackageSchema>;
