// A hand-built FIB writer for the reader's tests, assembled directly from [MS-DOC] 2.5.1's own field tables rather than dumped from a real Word file: FibBase (32 bytes) + csw (2) + FibRgW97 (28) + cslw (2) + FibRgLw97 (88) + cbRgFcLcb (2) + FibRgFcLcb97 (cbRgFcLcb x 8) + cswNew (2). Every offset it writes is the offset the reader under test independently derives from the same tables, so a disagreement between the two is a real defect rather than two copies of one mistake -- the builder places fields by adding up the spec's declared field sizes, while the parser reads them from named constants.
//
// Test-support only: excluded from the published dist per the family convention (tsdown.config.ts drops src/test-support/**), and never imported by src/index.ts.

import { FIB_FC_LCB_BLOB_OFFSET, FIB_RG_LW_OFFSET } from "../fib/offsets";

export interface FibSpec {
  readonly nFib?: number;
  readonly fComplex?: boolean;
  readonly fEncrypted?: boolean;
  readonly fObfuscated?: boolean;
  readonly fWhichTblStm?: 0 | 1;
  readonly cbMac?: number;
  readonly ccpText?: number;
  readonly ccpFtn?: number;
  readonly ccpHdd?: number;
  readonly ccpAtn?: number;
  readonly ccpEdn?: number;
  readonly ccpTxbx?: number;
  readonly ccpHdrTxbx?: number;
  readonly fcStshf?: number;
  readonly lcbStshf?: number;
  readonly fcPlcfBteChpx?: number;
  readonly lcbPlcfBteChpx?: number;
  readonly fcPlcfBtePapx?: number;
  readonly lcbPlcfBtePapx?: number;
  readonly fcClx?: number;
  readonly lcbClx?: number;
  readonly fcPlcfSed?: number;
  readonly lcbPlcfSed?: number;
  readonly fcPlfLst?: number;
  readonly lcbPlfLst?: number;
  readonly fcPlfLfo?: number;
  readonly lcbPlfLfo?: number;
  /** Overridden only to test the reader's own rejection of a wrong signature. */
  readonly wIdent?: number;
  /** The count of 64-bit values in FibRgFcLcbBlob. 0x005D is the value [MS-DOC] 2.5.1 mandates for nFib 0x00C1. */
  readonly cbRgFcLcb?: number;
}

// Field offsets inside FibRgLw97 ([MS-DOC] 2.5.4), counted forward through its declared field order: cbMac, reserved1, reserved2, ccpText, ccpFtn, ccpHdd, reserved3, ccpAtn, ccpEdn, ccpTxbx, ccpHdrTxbx, then reserved4..reserved14.
const LW = {
  cbMac: 0,
  ccpText: 12,
  ccpFtn: 16,
  ccpHdd: 20,
  ccpAtn: 28,
  ccpEdn: 32,
  ccpTxbx: 36,
  ccpHdrTxbx: 40,
} as const;

// Ordinal positions of the fc/lcb pairs inside FibRgFcLcb97 ([MS-DOC] 2.5.5), 0-based over the flat array of 4-byte values, counted from its first field (fcStshfOrig at 0). Written as value indexes rather than byte offsets so the arithmetic matches the spec's own "array of 64-bit values" framing.
const FC_LCB_INDEX = {
  fcStshf: 2,
  fcPlcfBteChpx: 24,
  fcPlcfBtePapx: 26,
  fcClx: 66,
  fcPlcfSed: 12,
  fcPlfLst: 146,
  fcPlfLfo: 148,
} as const;

export function buildFib(spec: FibSpec = {}): Uint8Array<ArrayBuffer> {
  const cbRgFcLcb = spec.cbRgFcLcb ?? 0x005d;
  const blobBytes = cbRgFcLcb * 8;
  const total = FIB_FC_LCB_BLOB_OFFSET + blobBytes + 2;
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);

  // FibBase.
  view.setUint16(0, spec.wIdent ?? 0xa5ec, true);
  view.setUint16(2, spec.nFib ?? 0x00c1, true);
  let flags = 0x1000; // fExtChar, which [MS-DOC] says MUST be 1.
  if (spec.fComplex === true) flags |= 0x0004;
  if (spec.fEncrypted === true) flags |= 0x0100;
  if ((spec.fWhichTblStm ?? 1) === 1) flags |= 0x0200;
  if (spec.fObfuscated === true) flags |= 0x8000;
  view.setUint16(10, flags, true);
  view.setUint16(12, 0x00bf, true); // nFibBack.

  view.setUint16(32, 0x000e, true); // csw.
  view.setUint16(62, 0x0016, true); // cslw.

  const lw = (offset: number, value: number): void => {
    view.setInt32(FIB_RG_LW_OFFSET + offset, value, true);
  };
  lw(LW.cbMac, spec.cbMac ?? 0);
  lw(LW.ccpText, spec.ccpText ?? 0);
  lw(LW.ccpFtn, spec.ccpFtn ?? 0);
  lw(LW.ccpHdd, spec.ccpHdd ?? 0);
  lw(LW.ccpAtn, spec.ccpAtn ?? 0);
  lw(LW.ccpEdn, spec.ccpEdn ?? 0);
  lw(LW.ccpTxbx, spec.ccpTxbx ?? 0);
  lw(LW.ccpHdrTxbx, spec.ccpHdrTxbx ?? 0);

  view.setUint16(FIB_FC_LCB_BLOB_OFFSET - 2, cbRgFcLcb, true);

  const pair = (index: number, fc: number, lcb: number): void => {
    const offset = FIB_FC_LCB_BLOB_OFFSET + index * 4;
    if (offset + 8 > FIB_FC_LCB_BLOB_OFFSET + blobBytes) return;
    view.setUint32(offset, fc, true);
    view.setUint32(offset + 4, lcb, true);
  };
  pair(FC_LCB_INDEX.fcStshf, spec.fcStshf ?? 0, spec.lcbStshf ?? 0);
  pair(
    FC_LCB_INDEX.fcPlcfBteChpx,
    spec.fcPlcfBteChpx ?? 0,
    spec.lcbPlcfBteChpx ?? 0,
  );
  pair(
    FC_LCB_INDEX.fcPlcfBtePapx,
    spec.fcPlcfBtePapx ?? 0,
    spec.lcbPlcfBtePapx ?? 0,
  );
  pair(FC_LCB_INDEX.fcClx, spec.fcClx ?? 0, spec.lcbClx ?? 0);
  pair(FC_LCB_INDEX.fcPlcfSed, spec.fcPlcfSed ?? 0, spec.lcbPlcfSed ?? 0);
  pair(FC_LCB_INDEX.fcPlfLst, spec.fcPlfLst ?? 0, spec.lcbPlfLst ?? 0);
  pair(FC_LCB_INDEX.fcPlfLfo, spec.fcPlfLfo ?? 0, spec.lcbPlfLfo ?? 0);

  return bytes;
}
