import { readInt32LE, readUint16LE, readUint32LE } from "../bytes";
import { DocFormatError, DocUnsupportedError } from "../errors";
import {
  FC_LCB_VALUE_INDEX,
  FIB_BASE_FLAG,
  FIB_CB_RG_FC_LCB_OFFSET,
  FIB_CSLW_OFFSET,
  FIB_CSLW_REQUIRED,
  FIB_BASE_SIZE,
  FIB_CSW_REQUIRED,
  FIB_FC_LCB_BLOB_OFFSET,
  FIB_RG_LW_OFFSET,
  FIB_W_IDENT,
  LW_OFFSET,
} from "./offsets";

// The File Information Block, [MS-DOC] 2.5.1 -- the structure at offset zero of the WordDocument stream that every other structure in a .doc is reached through. Only the fields this reader acts on are surfaced: the two stream-selection and refusal flags, the per-subdocument CP counts that carve the logical text stream into main document, footnotes, headers and the rest, and the four offset/length pairs locating the piece table, the character and paragraph formatting bin tables, and the style sheet. The remaining ~180 pairs are deliberately not modelled -- a field this package cannot yet act on is better absent than present and ignored, which would read as support it does not have.

export interface Fib {
  readonly nFib: number;
  /** Set when the last save was an incremental ("fast") save. The piece table is what makes such a document readable at all, so this is informational rather than a refusal. */
  readonly fComplex: boolean;
  /** 1 selects the "1Table" stream, 0 the "0Table" stream, as the Table stream every fc offset below is relative to. */
  readonly fWhichTblStm: 0 | 1;

  readonly cbMac: number;
  readonly ccpText: number;
  readonly ccpFtn: number;
  readonly ccpHdd: number;
  readonly ccpAtn: number;
  readonly ccpEdn: number;
  readonly ccpTxbx: number;
  readonly ccpHdrTxbx: number;

  readonly fcStshf: number;
  readonly lcbStshf: number;
  readonly fcPlcfBteChpx: number;
  readonly lcbPlcfBteChpx: number;
  readonly fcPlcfBtePapx: number;
  readonly lcbPlcfBtePapx: number;
  readonly fcClx: number;
  readonly lcbClx: number;

  readonly fcPlcfSed: number;
  readonly lcbPlcfSed: number;

  readonly fcSttbfFfn: number;
  readonly lcbSttbfFfn: number;

  readonly fcPlfLst: number;
  readonly lcbPlfLst: number;
  readonly fcPlfLfo: number;
  readonly lcbPlfLfo: number;
}

export function parseFib(wordDocument: Uint8Array): Fib {
  const wIdent = readUint16LE(wordDocument, 0);
  if (wIdent !== FIB_W_IDENT) {
    throw new DocFormatError(
      `the WordDocument stream begins with 0x${wIdent.toString(16).toUpperCase().padStart(4, "0")} rather than the 0xA5EC every Word Binary File's FibBase.wIdent must carry`,
    );
  }

  const nFib = readUint16LE(wordDocument, 2);
  const flags = readUint16LE(wordDocument, 10);

  // Refused rather than attempted: an encrypted or XOR-obfuscated document's WordDocument and Table streams hold ciphertext, so every offset below would address bytes that are not the structures they claim to be. Parsing on would not fail -- it would produce a piece table of arbitrary offsets and, from it, a document of arbitrary text. Loud refusal is the only honest outcome until decryption exists.
  if ((flags & FIB_BASE_FLAG.fEncrypted) !== 0) {
    throw new DocUnsupportedError(
      (flags & FIB_BASE_FLAG.fObfuscated) !== 0
        ? "this document is XOR-obfuscated ([MS-DOC] 2.2.6.1); doc-codec cannot decrypt it, and reading its streams as plaintext would produce arbitrary text rather than the document's own"
        : "this document is encrypted ([MS-DOC] 2.2.6); doc-codec cannot decrypt it, and reading its streams as plaintext would produce arbitrary text rather than the document's own",
    );
  }

  // csw and cslw are fixed by the specification for every nFib, and the offsets of everything after them are computed from those fixed sizes. A file disagreeing is either corrupt or a format this reader does not know, and either way every subsequent read would land on neighbouring bytes.
  const csw = readUint16LE(wordDocument, FIB_BASE_SIZE);
  if (csw !== FIB_CSW_REQUIRED) {
    throw new DocFormatError(
      `Fib.csw is 0x${csw.toString(16)} rather than the mandated 0x${FIB_CSW_REQUIRED.toString(16)}, so FibRgW97 is not the size every later offset assumes`,
    );
  }
  const cslw = readUint16LE(wordDocument, FIB_CSLW_OFFSET);
  if (cslw !== FIB_CSLW_REQUIRED) {
    throw new DocFormatError(
      `Fib.cslw is 0x${cslw.toString(16)} rather than the mandated 0x${FIB_CSLW_REQUIRED.toString(16)}, so FibRgLw97 is not the size every later offset assumes`,
    );
  }

  const cbRgFcLcb = readUint16LE(wordDocument, FIB_CB_RG_FC_LCB_OFFSET);
  const blobValues = cbRgFcLcb * 2;
  // Every pair this reader needs must fall inside the blob the file declares. Checked once against the highest index rather than per read, so a truncated or downlevel blob is reported as what it is instead of as a failed read of one arbitrary field.
  const highestIndex = Math.max(...Object.values(FC_LCB_VALUE_INDEX));
  if (highestIndex >= blobValues) {
    throw new DocFormatError(
      `Fib.cbRgFcLcb is ${cbRgFcLcb}, giving a FibRgFcLcb blob of ${blobValues} 4-byte values, which does not reach value index ${highestIndex} where lcbClx lives`,
    );
  }

  const lw = (offset: number): number =>
    readInt32LE(wordDocument, FIB_RG_LW_OFFSET + offset);
  const fcLcb = (index: number): number =>
    readUint32LE(wordDocument, FIB_FC_LCB_BLOB_OFFSET + index * 4);

  return {
    nFib,
    fComplex: (flags & FIB_BASE_FLAG.fComplex) !== 0,
    fWhichTblStm: (flags & FIB_BASE_FLAG.fWhichTblStm) !== 0 ? 1 : 0,
    cbMac: lw(LW_OFFSET.cbMac),
    ccpText: lw(LW_OFFSET.ccpText),
    ccpFtn: lw(LW_OFFSET.ccpFtn),
    ccpHdd: lw(LW_OFFSET.ccpHdd),
    ccpAtn: lw(LW_OFFSET.ccpAtn),
    ccpEdn: lw(LW_OFFSET.ccpEdn),
    ccpTxbx: lw(LW_OFFSET.ccpTxbx),
    ccpHdrTxbx: lw(LW_OFFSET.ccpHdrTxbx),
    fcStshf: fcLcb(FC_LCB_VALUE_INDEX.fcStshf),
    lcbStshf: fcLcb(FC_LCB_VALUE_INDEX.lcbStshf),
    fcPlcfBteChpx: fcLcb(FC_LCB_VALUE_INDEX.fcPlcfBteChpx),
    lcbPlcfBteChpx: fcLcb(FC_LCB_VALUE_INDEX.lcbPlcfBteChpx),
    fcPlcfBtePapx: fcLcb(FC_LCB_VALUE_INDEX.fcPlcfBtePapx),
    lcbPlcfBtePapx: fcLcb(FC_LCB_VALUE_INDEX.lcbPlcfBtePapx),
    fcClx: fcLcb(FC_LCB_VALUE_INDEX.fcClx),
    lcbClx: fcLcb(FC_LCB_VALUE_INDEX.lcbClx),
    fcPlcfSed: fcLcb(FC_LCB_VALUE_INDEX.fcPlcfSed),
    lcbPlcfSed: fcLcb(FC_LCB_VALUE_INDEX.lcbPlcfSed),
    fcSttbfFfn: fcLcb(FC_LCB_VALUE_INDEX.fcSttbfFfn),
    lcbSttbfFfn: fcLcb(FC_LCB_VALUE_INDEX.lcbSttbfFfn),
    fcPlfLst: fcLcb(FC_LCB_VALUE_INDEX.fcPlfLst),
    lcbPlfLst: fcLcb(FC_LCB_VALUE_INDEX.lcbPlfLst),
    fcPlfLfo: fcLcb(FC_LCB_VALUE_INDEX.fcPlfLfo),
    lcbPlfLfo: fcLcb(FC_LCB_VALUE_INDEX.lcbPlfLfo),
  };
}

/** The name of the compound-file stream every `fc` offset in the Fib is relative to, selected by FibBase.fWhichTblStm. */
export function tableStreamName(fib: Fib): "0Table" | "1Table" {
  return fib.fWhichTblStm === 1 ? "1Table" : "0Table";
}
