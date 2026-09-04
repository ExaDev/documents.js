// The inverse of fib.ts's parseFib: builds a real File Information Block for nFib 0x00C1 (Word 97), the oldest and simplest FIB generation [MS-DOC] 2.5.1 defines and the one this package's own test-support/fib.ts already targets. cbRgFcLcb is fixed at the 0x005D that nFib 0x00C1 mandates ([MS-DOC]'s own Fib page table), and cswNew is fixed at 0 (also mandated for 0x00C1, so fibRgCswNew is simply absent) -- neither is a parameter, because choosing a newer nFib would change both without this writer gaining anything from it: every structure this package writes (the piece table, the two bin tables, the style sheet, the font table) is unchanged across nFib generations.
//
// Only the fields this writer's own reader needs to get back to the streams it wrote are populated: the four subdocument-boundary fields this package's reader itself reads (cbMac, ccpText) plus the fc/lcb pairs locating the Clx, the two property bin tables, the style sheet, and (when used) the font table. Every other fc/lcb pair -- SttbfAssoc, Dop, the printer-driver structures, and the ~140 others [MS-DOC] defines -- is left zero, which is exactly the "undefined, MUST be ignored" contract most of them carry (see FibRgFcLcb97's own field table). A small number of those unpopulated fields carry a genuine "MUST NOT be zero" clause of their own (SttbfAssoc's lcb among them) that this writer does not satisfy: the resulting bytes are conformant for every structure this package's own reader consults, not a certification that Microsoft Word or another third-party reader would accept the file's every field. See the README's own scope note.

import { readUint16LE } from "../bytes";
import { DocFormatError } from "../errors";
import {
  FC_LCB_VALUE_INDEX,
  FIB_BASE_FLAG,
  FIB_BASE_SIZE,
  FIB_CB_RG_FC_LCB_OFFSET,
  FIB_CSLW_OFFSET,
  FIB_CSLW_REQUIRED,
  FIB_CSW_REQUIRED,
  FIB_FC_LCB_BLOB_OFFSET,
  FIB_RG_LW_OFFSET,
  FIB_W_IDENT,
  LW_OFFSET,
} from "./offsets";

/** [MS-DOC]'s own Fib page: nFib 0x00C1 mandates cbRgFcLcb 0x005D and cswNew 0. */
const NFIB_WORD_97 = 0x00c1;
const CB_RG_FC_LCB_WORD_97 = 0x005d;
/** FibBase.nFibBack: "this value SHOULD be 0x00BF" for a document written by an application that does not need older-version compatibility beyond it -- carried verbatim from test-support/fib.ts, which cites the same field. */
const N_FIB_BACK = 0x00bf;
/** FibBase's own flags word at offset 10: fExtChar "MUST be 1" ([MS-DOC] 2.5.2), independent of fComplex/fWhichTblStm/fEncrypted/fObfuscated (see offsets.ts's own FIB_BASE_FLAG). */
const FLAG_F_EXT_CHAR = 0x1000;

export interface FibWriteSpec {
  readonly ccpText: number;
  readonly cbMac: number;
  readonly fcClx: number;
  readonly lcbClx: number;
  readonly fcPlcfSed: number;
  readonly lcbPlcfSed: number;
  readonly fcPlcfBteChpx: number;
  readonly lcbPlcfBteChpx: number;
  readonly fcPlcfBtePapx: number;
  readonly lcbPlcfBtePapx: number;
  readonly fcStshf: number;
  readonly lcbStshf: number;
  /** 0/0 when the document uses no font table (see write.ts). */
  readonly fcSttbfFfn: number;
  readonly lcbSttbfFfn: number;
}

export function buildFib(spec: FibWriteSpec): Uint8Array<ArrayBuffer> {
  const blobBytes = CB_RG_FC_LCB_WORD_97 * 8;
  const total = FIB_FC_LCB_BLOB_OFFSET + blobBytes + 2; // + cswNew, which is 0 and carries no fibRgCswNew after it.
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);

  view.setUint16(0, FIB_W_IDENT, true);
  view.setUint16(2, NFIB_WORD_97, true);
  // fWhichTblStm always selects "1Table" (see write.ts's use of tableStreamName); fComplex, fEncrypted and fObfuscated are never set by a fresh, unencrypted, single-save document this writer produces.
  view.setUint16(10, FLAG_F_EXT_CHAR | FIB_BASE_FLAG.fWhichTblStm, true);
  view.setUint16(12, N_FIB_BACK, true);

  view.setUint16(FIB_BASE_SIZE, FIB_CSW_REQUIRED, true); // csw.
  view.setUint16(FIB_CSLW_OFFSET, FIB_CSLW_REQUIRED, true); // cslw.

  const lw = (offset: number, value: number): void => {
    view.setInt32(FIB_RG_LW_OFFSET + offset, value, true);
  };
  lw(LW_OFFSET.cbMac, spec.cbMac);
  lw(LW_OFFSET.ccpText, spec.ccpText);
  // Every other FibRgLw97 field (ccpFtn, ccpHdd, ccpAtn, ccpEdn, ccpTxbx, ccpHdrTxbx) stays 0: this writer produces only a Main Document, so every other subdocument this package's own reader is aware of is genuinely empty rather than merely unpopulated.

  view.setUint16(FIB_CB_RG_FC_LCB_OFFSET, CB_RG_FC_LCB_WORD_97, true);
  const pair = (index: number, fc: number, lcb: number): void => {
    const offset = FIB_FC_LCB_BLOB_OFFSET + index * 4;
    view.setUint32(offset, fc, true);
    view.setUint32(offset + 4, lcb, true);
  };
  pair(FC_LCB_VALUE_INDEX.fcStshf, spec.fcStshf, spec.lcbStshf);
  pair(
    FC_LCB_VALUE_INDEX.fcPlcfBteChpx,
    spec.fcPlcfBteChpx,
    spec.lcbPlcfBteChpx,
  );
  pair(
    FC_LCB_VALUE_INDEX.fcPlcfBtePapx,
    spec.fcPlcfBtePapx,
    spec.lcbPlcfBtePapx,
  );
  pair(FC_LCB_VALUE_INDEX.fcSttbfFfn, spec.fcSttbfFfn, spec.lcbSttbfFfn);
  pair(FC_LCB_VALUE_INDEX.fcClx, spec.fcClx, spec.lcbClx);
  pair(FC_LCB_VALUE_INDEX.fcPlcfSed, spec.fcPlcfSed, spec.lcbPlcfSed);
  // cswNew (the 2 bytes at FIB_FC_LCB_BLOB_OFFSET + blobBytes) stays 0, which [MS-DOC] mandates for nFib 0x00C1 and which correctly leaves fibRgCswNew absent.

  if (readUint16LE(bytes, 0) !== FIB_W_IDENT) {
    throw new DocFormatError(
      "buildFib produced a Fib whose own wIdent does not read back as 0xA5EC; this is an internal defect, not an input error",
    );
  }
  return bytes;
}
