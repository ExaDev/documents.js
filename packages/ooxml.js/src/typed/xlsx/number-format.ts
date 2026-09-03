// The classifier for Excel's number-format mini-language -- deciding whether a numeric cell's format code says percentage, currency, date, time, elapsed duration, or plain number -- now lives in excel-number-format, shared with xls-codec's own BIFF8 reading (ExaDev/documents.js#848: both packages had implemented the identical classifier independently). typed/xlsx/content.ts, typed/xlsx/styles.ts, and typed/xlsx/build.ts import it directly from there now; this module keeps only what is genuinely its own -- the WRITE side below (a barrel file is the only place a re-export may live in this package, per eslint.config.ts's barrel-policy rule, so this module cannot forward the classifier itself).
import { isIsoCurrencyCodeShape } from "excel-number-format";

// --- the write side: the formats typed/xlsx/build.ts gives a cell ---------------------------------------------------
//
// One entry per ContentCellValue kind that xlsx cannot express as a cell TYPE and must express as a number format instead. Every code below is real markup modelled on actual LibreOffice output -- this directory's own kitchen-sink.xlsx fixture declares numFmtIds 165-169 as the boolean, date, time, percentage, and currency formats these mirror -- rather than markup invented to satisfy this package's own classifier. Two deliberate differences from that fixture: the fixture's own leading locale tag ([$-809], "English (United Kingdom)") is dropped, since this writer has no locale to claim and would otherwise stamp one producer's region onto every file it writes; and where a fixture format has an exact ECMA-376 built-in equivalent (its '[$-809]0.00%' and '[$-809]hh:mm:ss' are numFmtId 10 and 21 without that tag), the built-in id is referenced instead of redeclaring the code.
//
// Each is checked twice over: fed back through classifyNumberFormat in this module's own test suite, so the writer's vocabulary and the reader's classification cannot drift apart; and rendered by real LibreOffice 26.2 from a genuinely built .xlsx, which displays each one as intended (TRUE/FALSE, 42.56%, GBP99.99, 2026-07-31, 14:30:00) and, converting that file to ODF, recovers office:value-type boolean/percentage/currency+office:currency="GBP"/date/time for them.

// A number format a written cell is displayed through: either one of ECMA-376's own implied built-ins (referenced by id, needing no <numFmt> declaration at all) or a code this writer must declare in the file's own <numFmts>.
export type CellNumberFormat =
  { kind: "builtin"; id: number } | { kind: "custom"; code: string };

// numFmtId 10, '0.00%' -- the built-in percentage format. The cell's own stored value stays the raw fraction (0.4256), which is both what ContentCellValue's 'percentage' variant carries and what a percent-formatted cell holds in every real file; the x100 lives purely in the rendering.
export const PERCENTAGE_NUMBER_FORMAT: CellNumberFormat = {
  kind: "builtin",
  id: 10,
};

// numFmtId 21, 'h:mm:ss' -- the built-in time-of-day format, over a serial that is a pure fraction of a day.
export const TIME_NUMBER_FORMAT: CellNumberFormat = { kind: "builtin", id: 21 };

// numFmtId 4, '#,##0.00' -- the built-in two-decimal number format, and what a 'currency' cell carrying no ISO code at all is written as. This is a REAL, documented semantic loss on the way back: nothing in '#,##0.00' says money, so such a cell reads back as a plain number. The alternative -- writing a generic currency sign to keep the kind -- would put a '¤' in front of every amount in a file whose author never asked for one, so the kind is dropped rather than the value's own appearance changed.
export const AMOUNT_NUMBER_FORMAT: CellNumberFormat = {
  kind: "builtin",
  id: 4,
};

// ISO order rather than one of the built-in date formats, every one of which fixes a different regional field order (numFmtId 14 is US 'mm-dd-yy'): ContentCellValue's own 'date' spelling is ISO, so an ISO-ordered format is the one that displays what the value actually says. The '\-' escapes are LibreOffice's own spelling of a literal separator, kept verbatim.
export const DATE_NUMBER_FORMAT: CellNumberFormat = {
  kind: "custom",
  code: "yyyy\\-mm\\-dd",
};

// The combined form, for ContentCellValue's own 'dateTime' kind -- the date format above plus a seconds-precision time of day, matching that kind's own 'YYYY-MM-DDTHH:MM:SS' spelling. No built-in covers it: numFmtId 22 ('m/d/yy h:mm') is US-ordered and drops seconds.
export const DATE_TIME_NUMBER_FORMAT: CellNumberFormat = {
  kind: "custom",
  code: "yyyy\\-mm\\-dd hh:mm:ss",
};

// A boolean cell is written as t="b" with a 1/0 value (which is how ECMA-376 spells one and how this package's reader reads it back), and this format is what makes real Excel and Calc DISPLAY that 1/0 as TRUE/FALSE instead of as a bare digit -- the positive/negative/zero sections of a three-section format, with the non-zero sections both reading TRUE. Verified LibreOffice markup: the kitchen-sink fixture's own numFmtId 165 is this exact string.
export const BOOLEAN_NUMBER_FORMAT: CellNumberFormat = {
  kind: "custom",
  code: '"TRUE";"TRUE";"FALSE"',
};

// The money format for a currency cell that names its ISO 4217 code: '[$GBP]#,##0.00'. The bracket is what carries the code THROUGH the file -- writing the symbol instead ('£'#,##0.00) would render identically and lose the code permanently, since no faithful symbol-to-code mapping exists on the way back ('$' alone is USD, CAD, AUD and a dozen others). A currency string that is not an ISO-code shape cannot go in that bracket without producing a malformed format code, so it falls back to the plain amount format above rather than being interpolated blindly.
export function currencyNumberFormat(
  code: string | undefined,
): CellNumberFormat {
  if (code === undefined || !isIsoCurrencyCodeShape(code)) {
    return AMOUNT_NUMBER_FORMAT;
  }
  return { kind: "custom", code: `[$${code.toUpperCase()}]#,##0.00` };
}
