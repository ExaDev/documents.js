import { startsWithMagic } from "../magic";

// The classic OLE compound-file header signature ([MS-CFB] section 2.2, HeaderSignature): every legacy OLE2/compound-file payload starts with these eight bytes — a .doc/.xls/.ppt, and the oleObject1.bin spelling of an OOXML package's OLE-embedded object. Exported so a consumer (e.g. ooxml.js's own embedded-object tests) can build a fixture carrying this exact signature rather than re-deriving it.
export const COMPOUND_FILE_MAGIC = [
  ...Array.from("\u00d0\u00cf\u0011\u00e0\u00a1\u00b1\u001a\u00e1", (c) =>
    c.charCodeAt(0),
  ),
] as const;

// A byte check, never a parse-and-catch: true says these bytes start a compound file, not that they are a well-formed one. Structural validation is readCompoundFile's job (src/cfb/read.ts).
export function isCompoundFile(bytes: Uint8Array): boolean {
  return startsWithMagic(bytes, COMPOUND_FILE_MAGIC);
}
