import { CFF_DICT_OP_ROS, parseCffDict, readCffIndex } from './cff';
import { hasBytes, u8 } from './sfnt';

// A deliberately shallow reader for a CFF (Compact Font Format 1.0) font program: its header, its Name INDEX, and just enough of its Top DICT to answer one question -- is this font CID-keyed?
//
// Why that one question is worth a module of its own. This package embeds a TrueType-outline face by preserving glyph IDs and showing text through Identity-H, so a character code in a content stream IS the glyph index in the embedded program (see sfnt-subset.ts and embedded-font-write.ts). Reusing that machinery for a CFF-flavoured font extracted from a source document is only valid while CID == GID holds, and for a CID-keyed CFF it does not: such a font carries its own charset mapping CIDs onto glyph indices, and the two coincide only by accident. Showing text through Identity-H against one anyway produces no error anywhere -- the file is structurally valid, every reader accepts it, and the page simply renders the WRONG GLYPHS. That is precisely the failure this probe exists to prevent: a font it reports as CID-keyed (or cannot read at all) must be refused by the embedding path, which falls back to a vendored substitute face or a standard-14 font instead.
//
// A CID-keyed CFF is marked by the ROS operator in its Top DICT (CFF 1.0 spec, Appendix H and Table 10): the escaped two-byte operator 12 30, whose presence alone is the definition -- "CIDFont operators ... the presence of the ROS operator identifies a CFF FontSet as containing CIDFonts".
//
// Deliberately not read here: the charset, the FDArray/FDSelect a CID-keyed font carries, and every other Top DICT operator. This is a probe, not a CFF reader. The CharStrings INDEX and Private DICT ARE read, but by cff-bounds.ts -- the one module in this package that interprets charstrings, for per-glyph ink bounding boxes -- rather than here; both build on the shared INDEX/DICT primitives in cff.ts.
//
// Input is a BARE CFF program, i.e. the contents of an sfnt 'CFF ' table or of a PDF /FontFile3 stream -- not an 'OTTO' sfnt container. sfnt.ts already slices a table out of a container, and duplicating that here would be a second, driftable copy of it.

const CFF_HEADER_SIZE = 4; // major, minor, hdrSize, offSize
const CFF_MAJOR_VERSION = 1;
const CFF_HEADER_SIZE_OFFSET = 2;

export interface CffProbeResult {
  readonly majorVersion: number;
  readonly minorVersion: number;
  // The first Name INDEX entry: the font's own PostScript name. A CFF FontSet may in principle hold several fonts, but every one embedded in a PDF or wrapped in an sfnt holds exactly one, so this is that font's name.
  readonly name: string;
  // True where the Top DICT carries the ROS operator. The embedding path must refuse a font for which this is true -- see this module's own header comment for what embedding one anyway would silently produce.
  readonly cidKeyed: boolean;
}

// CFF names are ASCII (spec section 7: "the character set is restricted to printable ASCII"), so a per-byte decode is exact rather than an approximation.
function decodeAscii(bytes: Uint8Array<ArrayBuffer>): string {
  let text = '';
  for (const byte of bytes) {
    text += String.fromCharCode(byte);
  }
  return text;
}

// Probes a bare CFF font program. Returns `undefined` for anything this cannot read confidently -- a truncated header, a major version other than 1 (CFF2 has an incompatible header and no Name INDEX at all, and is not a legal PDF /FontFile3 program either), an unreadable Name INDEX or Top DICT INDEX, an empty FontSet, or a malformed Top DICT. The embedding path treats `undefined` and `cidKeyed: true` identically: refuse this font program, substitute a face this package can embed correctly.
export function probeCff(bytes: Uint8Array<ArrayBuffer>): CffProbeResult | undefined {
  if (!hasBytes(bytes, 0, CFF_HEADER_SIZE)) {
    return undefined;
  }
  const majorVersion = u8(bytes, 0);
  const minorVersion = u8(bytes, 1);
  const headerSize = u8(bytes, CFF_HEADER_SIZE_OFFSET);
  if (majorVersion !== CFF_MAJOR_VERSION || headerSize < CFF_HEADER_SIZE) {
    return undefined;
  }

  const nameIndex = readCffIndex(bytes, headerSize);
  if (nameIndex === undefined || nameIndex.count === 0) {
    return undefined;
  }
  const nameBytes = nameIndex.entry(0);
  if (nameBytes === undefined) {
    return undefined;
  }

  const topDictIndex = readCffIndex(bytes, nameIndex.endOffset);
  const topDictBytes = topDictIndex?.entry(0);
  if (topDictBytes === undefined) {
    return undefined;
  }
  const topDict = parseCffDict(topDictBytes);
  if (topDict === undefined) {
    return undefined;
  }

  return { majorVersion, minorVersion, name: decodeAscii(nameBytes), cidKeyed: topDict.has(CFF_DICT_OP_ROS) };
}
