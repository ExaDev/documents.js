import { startsWithMagic } from '../magic';

// The classic OLE compound-file header signature ([MS-CFB] section 2.2, HeaderSignature): every legacy OLE2/compound-file payload starts with these eight bytes -- a .doc/.xls/.ppt, and the oleObject1.bin spelling of an OOXML package's OLE-embedded object.
const COMPOUND_FILE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] as const;

// A byte check, never a parse-and-catch: true says these bytes start a compound file, not that they are a well-formed one. Structural validation is readCompoundFile's job (src/cfb/read.ts).
export function isCompoundFile(bytes: Uint8Array): boolean {
  return startsWithMagic(bytes, COMPOUND_FILE_MAGIC);
}
