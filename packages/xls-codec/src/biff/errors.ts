// BIFF8's error-value vocabulary, from the bBoolErr table of [MS-XLS] 2.5.10 (the Bes structure a BoolErr record carries) and the identical BErr byte a Formula record's cached error result uses: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/4a18edf4-b88c-4b39-a857-b31757314d0f
//
// The spellings are the ones a user sees in the cell, which is also what document-schema.js's own `error` cell value carries — ContentCellValue documents its `value` as the error text, and ooxml.js's xlsx reader puts xlsx's own equivalent strings there, so the two codecs agree on what a #DIV/0! cell looks like in the schema.
//
// A Map rather than an object literal, so a lookup miss is genuinely `undefined` from a typed API rather than an index access needing a key assertion to narrow — this workspace bans type assertions outright.
// Bes/BErr byte codes from the bBoolErr table, each named by the error it selects.
const ERROR_CODE_NULL = 0x00;
const ERROR_CODE_DIV0 = 0x07;
const ERROR_CODE_VALUE = 0x0f;
const ERROR_CODE_REF = 0x17;
const ERROR_CODE_NAME = 0x1d;
const ERROR_CODE_NUM = 0x24;
const ERROR_CODE_NA = 0x2a;
const ERROR_CODE_GETTING_DATA = 0x2b;
const ERROR_TEXT: ReadonlyMap<number, string> = new Map([
  [ERROR_CODE_NULL, "#NULL!"],
  [ERROR_CODE_DIV0, "#DIV/0!"],
  [ERROR_CODE_VALUE, "#VALUE!"],
  [ERROR_CODE_REF, "#REF!"],
  [ERROR_CODE_NAME, "#NAME?"],
  [ERROR_CODE_NUM, "#NUM!"],
  [ERROR_CODE_NA, "#N/A"],
  [ERROR_CODE_GETTING_DATA, "#GETTING_DATA"],
]);

/** The displayed spelling of a BIFF8 error code, or undefined for a code [MS-XLS] does not define — which the caller degrades rather than guessing a spelling for. */
export function errorTextOf(code: number): string | undefined {
  return ERROR_TEXT.get(code);
}

/** The write direction's own lookup, built once from ERROR_TEXT rather than as a second hand-maintained table, so the two directions cannot drift apart. */
const ERROR_CODE: ReadonlyMap<string, number> = new Map(
  Array.from(ERROR_TEXT, ([code, text]) => [text, code]),
);

/** The BIFF8 error code for a cell's displayed error text, or undefined when the text is not one of the eight [MS-XLS] defines — which the writer refuses to guess a code for rather than silently substituting a different error. */
export function errorCodeOf(text: string): number | undefined {
  return ERROR_CODE.get(text);
}
