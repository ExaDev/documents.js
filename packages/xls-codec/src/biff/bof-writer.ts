import { RecordBuilder } from "./builder";
import { BIFF8_VERSION } from "./record-types";

// The write-side counterpart of biff/substreams.ts's own BOF reading: the 16-byte payload of a BOF record ([MS-XLS] 2.4.21), which opens every substream. https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/4d6a3d1e-d7c5-405f-bbae-d01e9cb79366
//
// Only vers and dt carry information this package's own reader (or any reader) needs: vers fixes the BIFF version, dt names the substream's document type ([MS-XLS] 2.4.21's own table, exported as BOF_TYPE_WORKBOOK/BOF_TYPE_WORKSHEET). Every field after them is Excel's own edit-history bookkeeping -- which platform last saved the file, whether it ever hit a font limit, which application versions have touched it -- none of which this writer can know or needs to state honestly, since nothing downstream (this reader included) inspects it. The values below are spec-legal constants: rupBuild/rupYear are values a real Excel build has written (0x0DBB, 0x07CC, the latter one of the two years [MS-XLS] permits), and the two history dwords set only the bits the spec marks MUST-be-1 (fWin, fWinAny) with every other flag, reserved field, and version-tracking field left at its own permitted default of zero.

/** rupBuild ([MS-XLS] 2.4.21): an arbitrary build identifier: no permitted-values table constrains it, so any 16-bit value is spec-legal. */
const RUP_BUILD = 0x0dbb;
/** rupYear: [MS-XLS] 2.4.21 requires 0x07CC or 0x07CD. */
const RUP_YEAR = 0x07cc;
/** The doc-flags dword: bit 0 (fWin) and bit 3 (fWinAny) set, both of which [MS-XLS] 2.4.21 fixes at MUST-be-1; every other bit -- fRisc, fBeta, fMacAny, fBetaAny, the unused/reserved runs, fOOM, fGlJmp, fFontLimit, verXLHigh, unused3 -- left at its own spec-permitted default of 0. */
const DOC_FLAGS = 0x00000009;
/** The version-tracking dword: verLowestBiff = 6 (offset 0, [MS-XLS] 2.4.21: "the value MUST be 6"), verLastXLSaved = 0 (offset 8, a value the field's own table permits), reserved2 = 0. */
const VERSION_TRACKING = 0x00000006;

/** Builds a BOF record's 16-byte data for the given substream document type (BOF_TYPE_WORKBOOK, BOF_TYPE_WORKSHEET, ...). */
export function writeBofData(documentType: number): Uint8Array<ArrayBuffer> {
  return new RecordBuilder()
    .u16(BIFF8_VERSION)
    .u16(documentType)
    .u16(RUP_BUILD)
    .u16(RUP_YEAR)
    .u32(DOC_FLAGS)
    .u32(VERSION_TRACKING)
    .build();
}
