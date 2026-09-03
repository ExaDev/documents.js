// BIFF8's error-value vocabulary, from the bBoolErr table of [MS-XLS] 2.5.10 (the Bes structure a BoolErr record carries) and the identical BErr byte a Formula record's cached error result uses: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/4a18edf4-b88c-4b39-a857-b31757314d0f
//
// The spellings are the ones a user sees in the cell, which is also what document-schema.js's own `error` cell value carries -- ContentCellValue documents its `value` as the error text, and ooxml.js's xlsx reader puts xlsx's own equivalent strings there, so the two codecs agree on what a #DIV/0! cell looks like in the schema.
//
// A Map rather than an object literal, so a lookup miss is genuinely `undefined` from a typed API rather than an index access needing a key assertion to narrow -- this workspace bans type assertions outright.
const ERROR_TEXT: ReadonlyMap<number, string> = new Map([
  [0x00, "#NULL!"],
  [0x07, "#DIV/0!"],
  [0x0f, "#VALUE!"],
  [0x17, "#REF!"],
  [0x1d, "#NAME?"],
  [0x24, "#NUM!"],
  [0x2a, "#N/A"],
  [0x2b, "#GETTING_DATA"],
]);

/** The displayed spelling of a BIFF8 error code, or undefined for a code [MS-XLS] does not define -- which the caller degrades rather than guessing a spelling for. */
export function errorTextOf(code: number): string | undefined {
  return ERROR_TEXT.get(code);
}
