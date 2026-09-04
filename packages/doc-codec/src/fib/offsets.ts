// Byte offsets of the Fib's variable sections within the WordDocument stream, each derived by adding up the field sizes [MS-DOC] 2.5.1 declares for the Fib itself: base (32 bytes) + csw (2) + fibRgW (28) + cslw (2) + fibRgLw (88) + cbRgFcLcb (2) + fibRgFcLcbBlob (variable) + cswNew (2) + fibRgCswNew (variable).
//
// They are constants rather than a running cursor because the sections that precede the blob are fixed in size for every nFib this reader accepts: csw MUST be 0x000E (14 x 2 bytes = 28) and cslw MUST be 0x0016 (22 x 4 bytes = 88), so only the blob and the trailing cswNew section vary. The counts are still read and checked at parse time -- a file disagreeing with its own mandated counts is corrupt, and reading past it would land every subsequent field on neighbouring bytes.

/** FibBase, [MS-DOC] 2.5.2 -- the fixed 32-byte head of every Fib. csw, the count of 16-bit values in FibRgW97, sits immediately after it, so this doubles as csw's own offset. */
export const FIB_BASE_SIZE = 32;

/** csw MUST be 0x000E, fixing FibRgW97 at 28 bytes and every offset after it. */
export const FIB_CSW_REQUIRED = 0x000e;

/** FibRgW97, [MS-DOC] 2.5.3 -- 14 16-bit values, none of which this reader needs. */
export const FIB_RG_W_OFFSET = FIB_BASE_SIZE + 2;
export const FIB_RG_W_SIZE = FIB_CSW_REQUIRED * 2;

/** cslw, the count of 32-bit values in FibRgLw97. MUST be 0x0016. */
export const FIB_CSLW_OFFSET = FIB_RG_W_OFFSET + FIB_RG_W_SIZE;
export const FIB_CSLW_REQUIRED = 0x0016;

/** FibRgLw97, [MS-DOC] 2.5.4 -- 22 32-bit values holding cbMac and the per-subdocument CP counts. */
export const FIB_RG_LW_OFFSET = FIB_CSLW_OFFSET + 2;
export const FIB_RG_LW_SIZE = FIB_CSLW_REQUIRED * 4;

/** cbRgFcLcb, the count of 64-bit values in FibRgFcLcbBlob. Varies by nFib (0x005D for 0x00C1 through 0x00B7 for 0x0112), so it is read rather than assumed. */
export const FIB_CB_RG_FC_LCB_OFFSET = FIB_RG_LW_OFFSET + FIB_RG_LW_SIZE;

/** FibRgFcLcb97, [MS-DOC] 2.5.5 -- the flat array of paired file offsets and lengths locating every other structure in the Table stream. */
export const FIB_FC_LCB_BLOB_OFFSET = FIB_CB_RG_FC_LCB_OFFSET + 2;

// Field offsets within FibRgLw97, counted forward through its declared field order (cbMac, reserved1, reserved2, ccpText, ccpFtn, ccpHdd, reserved3, ccpAtn, ccpEdn, ccpTxbx, ccpHdrTxbx, reserved4..reserved14). reserved3 sits between ccpHdd and ccpAtn and is easy to miss: omitting it would shift every remaining subdocument count by one field.
export const LW_OFFSET = {
  cbMac: 0,
  ccpText: 12,
  ccpFtn: 16,
  ccpHdd: 20,
  ccpAtn: 28,
  ccpEdn: 32,
  ccpTxbx: 36,
  ccpHdrTxbx: 40,
} as const;

// Ordinal positions of the fc/lcb pairs this reader needs inside FibRgFcLcb97, 0-based over its flat array of 4-byte values counting from fcStshfOrig at index 0. A pair's byte offset within the blob is its index x 4, so fcClx at index 66 sits at blob offset 264 and, with the blob itself at 154, at absolute offset 418 in the WordDocument stream.
export const FC_LCB_VALUE_INDEX = {
  fcStshf: 2,
  lcbStshf: 3,
  fcPlcfBteChpx: 24,
  lcbPlcfBteChpx: 25,
  fcPlcfBtePapx: 26,
  lcbPlcfBtePapx: 27,
  // FibRgFcLcb97's 16th fc/lcb pair, counted forward from fcStshfOrig at pair 0: fcPlcffndRef, fcPlcffndTxt, fcPlcfandRef, fcPlcfandTxt, fcPlcfSed, fcPlcPad, fcPlcfPhe, fcSttbfGlsy, fcPlcfGlsy, fcPlcfHdd, fcPlcfBteChpx, fcPlcfBtePapx, fcPlcfSea, then fcSttbfFfn -- pair 15, value index 30.
  fcSttbfFfn: 30,
  lcbSttbfFfn: 31,
  fcClx: 66,
  lcbClx: 67,
  // Counted forward the same way from fcStshfOrig at value index 0 -- confirmed against every value index above by recounting the spec's own field-by-field FibRgFcLcb97 page in full, not derived by arithmetic from a nearby pair. fcPlfLst is the 74th fc/lcb pair (value index 146), fcPlfLfo the 75th (value index 148).
  fcPlfLst: 146,
  lcbPlfLst: 147,
  fcPlfLfo: 148,
  lcbPlfLfo: 149,
} as const;

// FibBase's bit field at offset 10, [MS-DOC] 2.5.2. The spec's bit diagram lists A..M least-significant-bit first within the little-endian 16-bit value, so fDot is 0x0001 and fObfuscated 0x8000; only the four this reader acts on are named.
export const FIB_BASE_FLAG = {
  fComplex: 0x0004,
  fEncrypted: 0x0100,
  fWhichTblStm: 0x0200,
  fObfuscated: 0x8000,
} as const;

export const FIB_W_IDENT = 0xa5ec;
