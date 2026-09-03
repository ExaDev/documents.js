// The BIFF record type numbers this package reads, each taken from [MS-XLS] section 2.3.1 (Record Enumeration, By Name) rather than from memory or from another implementation's header file: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/7d9326d6-691a-4fa1-8dce-42082f38e943
//
// A record's type is the first two bytes of its three-component framing (type, size, data) as [MS-XLS] 2.1.4 defines it, so these are the discriminants every reader in this package switches on. Only the records this package actually acts on are named: the enumeration itself runs to several hundred entries, and listing ones nothing reads would be dead data pretending to be coverage.

/** Marks the beginning of a substream and names its document type ([MS-XLS] 2.4.21). */
export const RECORD_BOF = 0x0809;
/** Marks the end of a substream ([MS-XLS] 2.4.103). */
export const RECORD_EOF = 0x000a;
/** Carries the overflow of a preceding record whose data exceeds what one record can hold ([MS-XLS] 2.4.58). */
export const RECORD_CONTINUE = 0x003c;

// --- Workbook globals substream ---

/** One per sheet: its name, hidden state, type, and the stream offset of its own BOF ([MS-XLS] 2.4.28). */
export const RECORD_BOUNDSHEET8 = 0x0085;
/** The shared string table every LabelSst cell indexes into ([MS-XLS] 2.4.265). */
export const RECORD_SST = 0x00fc;
/** A custom number-format code and the identifier cells reference it by ([MS-XLS] 2.4.126). */
export const RECORD_FORMAT = 0x041e;
/** A cell or cell-style extended format record ([MS-XLS] 2.4.353). */
export const RECORD_XF = 0x00e0;
/** A font definition, referenced by index from an XF ([MS-XLS] 2.4.122). */
export const RECORD_FONT = 0x0031;
/** Which of the two date epochs this workbook's serials count from ([MS-XLS] 2.4.77). */
export const RECORD_DATE1904 = 0x0022;
/** Present only in an encrypted workbook, where every record after it is ciphertext ([MS-XLS] 2.4.117). */
export const RECORD_FILEPASS = 0x002f;

// --- Worksheet substream ---

/** The sheet's used range ([MS-XLS] 2.4.90). */
export const RECORD_DIMENSIONS = 0x0200;
/** A single row's height, hidden state, and formatting ([MS-XLS] 2.4.221). */
export const RECORD_ROW = 0x0208;
/** Column width, hidden state, and default format for a range of columns ([MS-XLS] 2.4.53). */
export const RECORD_COLINFO = 0x007d;
/** The sheet's default column width, in whole character widths ([MS-XLS] 2.4.89). */
export const RECORD_DEFCOLWIDTH = 0x0055;
/** The sheet's default row height ([MS-XLS] 2.4.87). */
export const RECORD_DEFAULTROWHEIGHT = 0x0225;
/** Merged cell ranges ([MS-XLS] 2.4.168). */
export const RECORD_MERGECELLS = 0x00e5;

// --- The cell-value record family ([MS-XLS] 2.1.7.20.6's own CELL production) ---

/** An empty cell carrying only formatting ([MS-XLS] 2.4.20). */
export const RECORD_BLANK = 0x0201;
/** A run of empty cells in one row ([MS-XLS] 2.4.174). */
export const RECORD_MULBLANK = 0x00be;
/** A cell holding an RK-encoded number ([MS-XLS] 2.4.220). */
export const RECORD_RK = 0x027e;
/** A run of RK-encoded numeric cells in one row ([MS-XLS] 2.4.175). */
export const RECORD_MULRK = 0x00bd;
/** A cell holding an IEEE 754 double ([MS-XLS] 2.4.180). */
export const RECORD_NUMBER = 0x0203;
/** A cell holding a boolean or an error value ([MS-XLS] 2.4.24). */
export const RECORD_BOOLERR = 0x0205;
/** A cell holding a string by index into the shared string table ([MS-XLS] 2.4.149). */
export const RECORD_LABELSST = 0x00fd;
/** A cell holding an inline string ([MS-XLS] 2.4.148). See the reader's own note on why BIFF8 still meets this in the wild. */
export const RECORD_LABEL = 0x0204;
/** A cell holding a formula, its cached result, and its parsed expression ([MS-XLS] 2.4.127). */
export const RECORD_FORMULA = 0x0006;
/** The string result of the Formula record preceding it ([MS-XLS] 2.4.268). */
export const RECORD_STRING = 0x0207;

// The three records the FORMULA production of [MS-XLS] 2.1.7.20.6 permits between a Formula and its String result: `FORMULA = [Uncalced] Formula [Array / Table / ShrFmla / SUB] [String *Continue]`. None is read, but each has to be recognised so a formula's string result is still found when one sits in between.

/** The expression of an array formula, following the Formula record of its top-left cell ([MS-XLS] 2.4.4). */
export const RECORD_ARRAY = 0x0221;
/** A data-table definition following a Formula record ([MS-XLS] 2.4.334). */
export const RECORD_TABLE = 0x0236;
/** The shared expression a run of Formula records refers to ([MS-XLS] 2.4.260). */
export const RECORD_SHRFMLA = 0x04bc;

// --- BOF document types ([MS-XLS] 2.4.21's own dt field) ---

/** The workbook globals substream. */
export const BOF_TYPE_WORKBOOK = 0x0005;
/** A worksheet or dialog sheet substream. */
export const BOF_TYPE_WORKSHEET = 0x0010;
/** A chart sheet substream. */
export const BOF_TYPE_CHART = 0x0020;
/** A macro sheet substream. */
export const BOF_TYPE_MACRO = 0x0040;

/** The BIFF version every BOF in a BIFF8 workbook stream declares ([MS-XLS] 2.4.21: "The value MUST be 0x0600"). */
export const BIFF8_VERSION = 0x0600;

/** [MS-XLS] 2.1.4: "The record size ... MUST be less than or equal to 8224." The ceiling a writer splits a record at, and the bound a reader can sanity-check a declared size against. */
export const MAX_RECORD_DATA_SIZE = 8224;
