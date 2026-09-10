import type {
  Color,
  ContentSheet,
  ContentSheetConditionalFormat,
  ContentSheetConditionalFormatStyle,
} from "document-schema.js";
import { BiffWriteError } from "../biff/write-errors";
import { RecordBuilder } from "../biff/builder";
import { compileFormulaText } from "../biff/ptg-writer";
import { writeRecord } from "../biff/record-writer";
import { RECORD_CF, RECORD_CONDFMT } from "../biff/record-types";
import type { SheetRuleOperator } from "document-schema.js";

// The write-side inverse of conditional-format.ts's readCondFmtGroup/readCf: one CondFmt record ([MS-XLS] 2.4.56) per rule, each carrying exactly one CF record ([MS-XLS] 2.4.42) -- the schema models a rule's ranges per rule, so there is nothing to group the way a multi-rule CondFmt would. The CF record is the reader's own layout in reverse: ct 0x01 (comparison), cp (the operator), cce1/cce2, the DXFN structure naming the rule's own style, then the two CFParsedFormulaNoCCE operands compileFormulaText produces.

const CP_BY_OPERATOR: ReadonlyMap<SheetRuleOperator, number> = new Map([
  ["between", 0x1],
  ["notBetween", 0x2],
  ["equal", 0x3],
  ["notEqual", 0x4],
  ["greaterThan", 0x5],
  ["lessThan", 0x6],
  ["greaterThanOrEqual", 0x7],
  ["lessThanOrEqual", 0x8],
]);

// DXFFNTD's own fixed length ([MS-XLS] 2.4.97), mirrored from parseDxfStyle's own constant: everything this writer states in the block is zero but icvFore.
const DXFFNTD_LENGTH = 122;
const DXFFNTD_ICV_FORE_OFFSET = 64 + 16;

// The DXFN structure ([MS-XLS] 2.4.97), the exact inverse of parseDxfStyle: the 4+2 flag words (bit 26 = a DXFFntD font block, bit 29 = a DXFPat fill block), then only the blocks the flags name, in the reader's own order (font, alignment, border, pattern -- the middle two never set, since the schema's style carries no alignment or border). The font block states one fact and nothing else: the text colour, as icvFore. The pattern block states a solid fill whose visible colour is the foreground icv, the identical reading resolveFillBackground's own solid case makes on the way back in.
function writeDxfn(
  style: ContentSheetConditionalFormatStyle | undefined,
  icvOf: (color: Color) => number,
): Uint8Array<ArrayBuffer> {
  const textColor = style?.textColor;
  const background = style?.background;
  if (textColor === undefined && background === undefined) {
    return new Uint8Array(0);
  }
  const flags = new RecordBuilder();
  let flagsWord = 0;
  if (textColor !== undefined) {
    flagsWord |= 0x1 << 26;
  }
  if (background !== undefined) {
    flagsWord |= 0x1 << 29;
  }
  flags.u32(flagsWord);
  flags.u16(0); // fIfmtUser clear -- no number-format override
  if (textColor !== undefined) {
    const fontBlock = new Uint8Array(DXFFNTD_LENGTH);
    const view = new DataView(
      fontBlock.buffer,
      fontBlock.byteOffset,
      fontBlock.byteLength,
    );
    view.setInt32(DXFFNTD_ICV_FORE_OFFSET, icvOf(textColor), true);
    flags.bytes(fontBlock);
  }
  if (background !== undefined) {
    // DXFPat's packed word, the mirror of parseDxfStyle's own extraction: unused1(10) fls(6) icvForeground(7) icvBackground(7) unused2(2), LSB first. fls 1 is solid, whose visible colour is the foreground icv; the background icv is unread in the solid case, so 0 states nothing it overrides.
    const patWord = (0x1 << 10) | (icvOf(background) << 16);
    flags.u32(patWord >>> 0);
  }
  return flags.build();
}

function writeCfRecord(
  rule: Extract<ContentSheetConditionalFormat, { type: "cellIs" }>,
  icvOf: (color: Color) => number,
): Uint8Array<ArrayBuffer> {
  const cp = CP_BY_OPERATOR.get(rule.operator);
  if (cp === undefined) {
    throw new BiffWriteError(
      `conditional-format operator "${rule.operator}" has no CF cp value`,
    );
  }
  const rgce1 = compileFormulaText(rule.formula1);
  const rgce2 =
    rule.formula2 !== undefined ? compileFormulaText(rule.formula2) : undefined;
  const dxf = writeDxfn(rule.style, icvOf);
  const writer = new RecordBuilder()
    .u8(0x01) // ct: comparison -- the one condition type a base CF record can state
    .u8(cp)
    .u16(rgce1.length)
    .u16(rgce2?.length ?? 0)
    .bytes(dxf)
    .bytes(rgce1);
  if (rgce2 !== undefined) {
    writer.bytes(rgce2);
  }
  return writeRecord(RECORD_CF, writer.build());
}

// One rule's bounding box, the CondFmt header's own refBound ([MS-XLS] 2.5.56): the tight rectangle containing every range the rule names -- redundant with sqref for this reader's purposes, but a real consumer's own grammar expects it and it costs four u16s to state honestly.
function boundingBoxOf(
  rule: Extract<ContentSheetConditionalFormat, { type: "cellIs" }>,
): {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
} {
  let startRow = Number.MAX_SAFE_INTEGER;
  let endRow = 0;
  let startColumn = Number.MAX_SAFE_INTEGER;
  let endColumn = 0;
  for (const range of rule.ranges) {
    startRow = Math.min(startRow, range.startRow);
    endRow = Math.max(endRow, range.endRow);
    startColumn = Math.min(startColumn, range.startColumn);
    endColumn = Math.max(endColumn, range.endColumn);
  }
  return { startRow, endRow, startColumn, endColumn };
}

export function writeSheetConditionalFormats(
  sheet: ContentSheet,
  icvOf: (color: Color) => number,
): Uint8Array<ArrayBuffer>[] {
  const rules = sheet.conditionalFormats ?? [];
  if (rules.length === 0) {
    return [];
  }
  const pieces: Uint8Array<ArrayBuffer>[] = [];
  for (const [index, rule] of rules.entries()) {
    if (rule.type !== "cellIs") {
      // The base CF record states exactly one condition shape: a comparison. Every other variant the schema models (colour scale, data bar, icon set, the text family, top10, uniqueValues, ...) is a CF12/CFEx-era rule with no base-CF spelling, and writing a CF12 record is its own mechanism this writer does not build -- named here rather than silently dropped, the identical refusal convention the four out-of-scope formula constructs already draw.
      throw new BiffWriteError(
        `a conditional-format rule of type "${rule.type}" has no base BIFF8 CF spelling; this writer states cellIs comparisons only (CF12 writing is out of scope), so the rule cannot be written rather than silently dropped`,
      );
    }
    if (rule.ranges.length === 0) {
      throw new BiffWriteError(
        "a conditional-format rule carrying no range states nothing; the schema requires at least one",
      );
    }
    for (const range of rule.ranges) {
      if (
        range.startRow > 0xffff ||
        range.endRow > 0xffff ||
        range.startColumn > 0xff ||
        range.endColumn > 0xff
      ) {
        throw new BiffWriteError(
          `a conditional-format range (rows ${range.startRow}-${range.endRow}, columns ${range.startColumn}-${range.endColumn}) is outside BIFF8's own grid; a .xls workbook cannot address it`,
        );
      }
    }
    // nID ([MS-XLS] 2.5.56): the group's own identifier, unique per worksheet -- what a later CFEx record's own nID cross-references. Minted sequentially from 1, mirroring the 1-based counting a real producer's own first group carries; 15 bits is the field's whole width.
    const nID = index + 1;
    if (nID > 0x7fff) {
      throw new BiffWriteError(
        `this sheet's ${rules.length} conditional-format rules exceed CondFmt's own 15-bit nID field`,
      );
    }
    const box = boundingBoxOf(rule);
    const header = new RecordBuilder()
      .u16(1) // ccf: this group carries exactly one CF
      .u16(nID << 1) // fToughRecalc (bit 0) clear, nID in bits 1-15
      .u16(box.startRow)
      .u16(box.endRow)
      .u16(box.startColumn)
      .u16(box.endColumn)
      .u16(rule.ranges.length);
    for (const range of rule.ranges) {
      header.u16(range.startRow);
      header.u16(range.endRow);
      header.u16(range.startColumn);
      header.u16(range.endColumn);
    }
    pieces.push(writeRecord(RECORD_CONDFMT, header.build()));
    pieces.push(writeCfRecord(rule, icvOf));
  }
  return pieces;
}
