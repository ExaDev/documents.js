// The built-in worksheet-function table PtgFunc and PtgFuncVar's own `iftab`/`tab` field resolves against ([MS-XLS] 2.5.198.17, Ftab — https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/59667dd3-d6f6-4949-8a9b-b26f13949e3c). Every entry [MS-XLS] enumerates is listed here, cited to that same table by its own `iftab` value, so a formula naming a function this reader has never heard of still resolves through the identical published index rather than a partial guess.
//
// The second element of each tuple is the function's FIXED argument count when [MS-XLS]'s own grammar states one — a `*params* = ...` production with no `[optional]` bracket and no `*N(repeated)` group. A function whose grammar admits an optional or repeated argument has no fixed count and is therefore never resolved through PtgFunc: real producers confirm this split empirically (verified against genuine LibreOffice-written BIFF8: PI(), SIN(A1), ROUND(A1,0), ATAN2(A1,B1), SYD(1,2,3,4), and REPLACE("abc",1,1,"x") all compile as PtgFunc with no on-disk argument count, exactly matching a fixed-arity grammar entry with no bracket; COUNT(A1:B1), SUMIF(A1:A1,1), and CONCATENATE("a","b","c") all compile as PtgFuncVar carrying an explicit cparams byte, exactly matching a grammar entry with a `[...]` or `*N(...)` clause) — PtgFunc carries no argument count of its own, so a function's real arity has to come from somewhere, and this column is that somewhere. PtgFuncVar's own `cparams` field is the argument count on disk regardless of what this column says, since a variable-arity call always states its own count.
//
// Most of this table's entries are Excel 4.0 macro-sheet commands (WINDOWS, POKE, ADD.MENU, and the like) that can appear only in a macro-sheet substream, which readXlsContent never walks (it maps worksheet/dialog substreams only, [MS-XLS] 2.4.28's dt 0x00) — carried here anyway because completeness against the published table costs nothing and this reader has no principled way to know in advance which formula a real file will contain.

/** One Ftab entry: the function's own displayed name, and its fixed argument count when the grammar states one (absent for a function [MS-XLS]'s own grammar allows a variable or optional argument list for, which always resolves through PtgFuncVar's own on-disk cparams instead). */
type FtabEntry = readonly [name: string, fixedArity?: number];

/** Fixed argument counts for [MS-XLS]'s own Ftab grammar entries, named so the table below satisfies this workspace's no-magic-numbers rule without losing its own tabular simplicity. Counts 0, 1 and 2 need no constant, since the shared eslint config's own magicNumbers option (see PackageLintOptions.magicNumbers in eslint.shared.ts) already exempts them workspace-wide. */
const FIXED_ARITY_3 = 3;
const FIXED_ARITY_4 = 4;

/** The Ftab table, indexed by array position: index N is Ftab index (iftab) N ([MS-XLS] 2.5.198.17). A slot [MS-XLS] leaves reserved, or that resolves through some other mechanism entirely (0x00ff, the User Defined Function marker, names its callee through its own operand rather than through this table), is `undefined` rather than an entry — the array's own length and gaps stay checkable against the published table line by line via the trailing comment on each slot. */
const FTAB_TABLE: readonly (FtabEntry | undefined)[] = [
  ["COUNT"], // 0x0000
  ["IF"], // 0x0001
  ["ISNA", 1], // 0x0002
  ["ISERROR", 1], // 0x0003
  ["SUM"], // 0x0004
  ["AVERAGE"], // 0x0005
  ["MIN"], // 0x0006
  ["MAX"], // 0x0007
  ["ROW"], // 0x0008
  ["COLUMN"], // 0x0009
  ["NA", 0], // 0x000a
  ["NPV"], // 0x000b
  ["STDEV"], // 0x000c
  ["DOLLAR"], // 0x000d
  ["FIXED"], // 0x000e
  ["SIN", 1], // 0x000f
  ["COS", 1], // 0x0010
  ["TAN", 1], // 0x0011
  ["ATAN", 1], // 0x0012
  ["PI", 0], // 0x0013
  ["SQRT", 1], // 0x0014
  ["EXP", 1], // 0x0015
  ["LN", 1], // 0x0016
  ["LOG10", 1], // 0x0017
  ["ABS", 1], // 0x0018
  ["INT", 1], // 0x0019
  ["SIGN", 1], // 0x001a
  ["ROUND", 2], // 0x001b
  ["LOOKUP"], // 0x001c
  ["INDEX"], // 0x001d
  ["REPT", 2], // 0x001e
  ["MID", FIXED_ARITY_3], // 0x001f
  ["LEN", 1], // 0x0020
  ["VALUE", 1], // 0x0021
  ["TRUE", 0], // 0x0022
  ["FALSE", 0], // 0x0023
  ["AND"], // 0x0024
  ["OR"], // 0x0025
  ["NOT", 1], // 0x0026
  ["MOD", 2], // 0x0027
  ["DCOUNT", FIXED_ARITY_3], // 0x0028
  ["DSUM", FIXED_ARITY_3], // 0x0029
  ["DAVERAGE", FIXED_ARITY_3], // 0x002a
  ["DMIN", FIXED_ARITY_3], // 0x002b
  ["DMAX", FIXED_ARITY_3], // 0x002c
  ["DSTDEV", FIXED_ARITY_3], // 0x002d
  ["VAR"], // 0x002e
  ["DVAR", FIXED_ARITY_3], // 0x002f
  ["TEXT", 2], // 0x0030
  ["LINEST"], // 0x0031
  ["TREND"], // 0x0032
  ["LOGEST"], // 0x0033
  ["GROWTH"], // 0x0034
  ["GOTO", 1], // 0x0035
  ["HALT"], // 0x0036
  ["RETURN"], // 0x0037
  ["PV"], // 0x0038
  ["FV"], // 0x0039
  ["NPER"], // 0x003a
  ["PMT"], // 0x003b
  ["RATE"], // 0x003c
  ["MIRR", FIXED_ARITY_3], // 0x003d
  ["IRR"], // 0x003e
  ["RAND", 0], // 0x003f
  ["MATCH"], // 0x0040
  ["DATE", FIXED_ARITY_3], // 0x0041
  ["TIME", FIXED_ARITY_3], // 0x0042
  ["DAY", 1], // 0x0043
  ["MONTH", 1], // 0x0044
  ["YEAR", 1], // 0x0045
  ["WEEKDAY"], // 0x0046
  ["HOUR", 1], // 0x0047
  ["MINUTE", 1], // 0x0048
  ["SECOND", 1], // 0x0049
  ["NOW", 0], // 0x004a
  ["AREAS", 1], // 0x004b
  ["ROWS", 1], // 0x004c
  ["COLUMNS", 1], // 0x004d
  ["OFFSET"], // 0x004e
  ["ABSREF", 2], // 0x004f
  ["RELREF", 2], // 0x0050
  ["ARGUMENT"], // 0x0051
  ["SEARCH"], // 0x0052
  ["TRANSPOSE", 1], // 0x0053
  ["ERROR"], // 0x0054
  ["STEP", 0], // 0x0055
  ["TYPE", 1], // 0x0056
  ["ECHO"], // 0x0057
  ["SET.NAME"], // 0x0058
  ["CALLER", 0], // 0x0059
  ["DEREF", 1], // 0x005a
  ["WINDOWS"], // 0x005b
  ["SERIES"], // 0x005c
  ["DOCUMENTS"], // 0x005d
  ["ACTIVE.CELL", 0], // 0x005e
  ["SELECTION", 0], // 0x005f
  ["RESULT"], // 0x0060
  ["ATAN2", 2], // 0x0061
  ["ASIN", 1], // 0x0062
  ["ACOS", 1], // 0x0063
  ["CHOOSE"], // 0x0064
  ["HLOOKUP"], // 0x0065
  ["VLOOKUP"], // 0x0066
  ["LINKS"], // 0x0067
  ["INPUT"], // 0x0068
  ["ISREF", 1], // 0x0069
  ["GET.FORMULA", 1], // 0x006a
  ["GET.NAME"], // 0x006b
  ["SET.VALUE", 2], // 0x006c
  ["LOG"], // 0x006d
  ["EXEC"], // 0x006e
  ["CHAR", 1], // 0x006f
  ["LOWER", 1], // 0x0070
  ["UPPER", 1], // 0x0071
  ["PROPER", 1], // 0x0072
  ["LEFT"], // 0x0073
  ["RIGHT"], // 0x0074
  ["EXACT", 2], // 0x0075
  ["TRIM", 1], // 0x0076
  ["REPLACE", FIXED_ARITY_4], // 0x0077
  ["SUBSTITUTE"], // 0x0078
  ["CODE", 1], // 0x0079
  ["NAMES"], // 0x007a
  ["DIRECTORY"], // 0x007b
  ["FIND"], // 0x007c
  ["CELL"], // 0x007d
  ["ISERR", 1], // 0x007e
  ["ISTEXT", 1], // 0x007f
  ["ISNUMBER", 1], // 0x0080
  ["ISBLANK", 1], // 0x0081
  ["T", 1], // 0x0082
  ["N", 1], // 0x0083
  ["FOPEN"], // 0x0084
  ["FCLOSE", 1], // 0x0085
  ["FSIZE", 1], // 0x0086
  ["FREADLN", 1], // 0x0087
  ["FREAD", 2], // 0x0088
  ["FWRITELN", 2], // 0x0089
  ["FWRITE", 2], // 0x008a
  ["FPOS"], // 0x008b
  ["DATEVALUE", 1], // 0x008c
  ["TIMEVALUE", 1], // 0x008d
  ["SLN", FIXED_ARITY_3], // 0x008e
  ["SYD", FIXED_ARITY_4], // 0x008f
  ["DDB"], // 0x0090
  ["GET.DEF"], // 0x0091
  ["REFTEXT"], // 0x0092
  ["TEXTREF"], // 0x0093
  ["INDIRECT"], // 0x0094
  ["REGISTER"], // 0x0095
  ["CALL"], // 0x0096
  ["ADD.BAR"], // 0x0097
  ["ADD.MENU"], // 0x0098
  ["ADD.COMMAND"], // 0x0099
  ["ENABLE.COMMAND"], // 0x009a
  ["CHECK.COMMAND"], // 0x009b
  ["RENAME.COMMAND"], // 0x009c
  ["SHOW.BAR"], // 0x009d
  ["DELETE.MENU"], // 0x009e
  ["DELETE.COMMAND"], // 0x009f
  ["GET.CHART.ITEM"], // 0x00a0
  ["DIALOG.BOX", 1], // 0x00a1
  ["CLEAN", 1], // 0x00a2
  ["MDETERM", 1], // 0x00a3
  ["MINVERSE", 1], // 0x00a4
  ["MMULT", 2], // 0x00a5
  ["FILES"], // 0x00a6
  ["IPMT"], // 0x00a7
  ["PPMT"], // 0x00a8
  ["COUNTA"], // 0x00a9
  ["CANCEL.KEY"], // 0x00aa
  ["FOR"], // 0x00ab
  ["WHILE", 1], // 0x00ac
  ["BREAK", 0], // 0x00ad
  ["NEXT", 0], // 0x00ae
  ["INITIATE", 2], // 0x00af
  ["REQUEST", 2], // 0x00b0
  ["POKE", FIXED_ARITY_3], // 0x00b1
  ["EXECUTE", 2], // 0x00b2
  ["TERMINATE", 1], // 0x00b3
  ["RESTART"], // 0x00b4
  ["HELP"], // 0x00b5
  ["GET.BAR"], // 0x00b6
  ["PRODUCT"], // 0x00b7
  ["FACT", 1], // 0x00b8
  ["GET.CELL"], // 0x00b9
  ["GET.WORKSPACE", 1], // 0x00ba
  ["GET.WINDOW"], // 0x00bb
  ["GET.DOCUMENT"], // 0x00bc
  ["DPRODUCT", FIXED_ARITY_3], // 0x00bd
  ["ISNONTEXT", 1], // 0x00be
  ["GET.NOTE"], // 0x00bf
  ["NOTE"], // 0x00c0
  ["STDEVP"], // 0x00c1
  ["VARP"], // 0x00c2
  ["DSTDEVP", FIXED_ARITY_3], // 0x00c3
  ["DVARP", FIXED_ARITY_3], // 0x00c4
  ["TRUNC"], // 0x00c5
  ["ISLOGICAL", 1], // 0x00c6
  ["DCOUNTA", FIXED_ARITY_3], // 0x00c7
  ["DELETE.BAR", 1], // 0x00c8
  ["UNREGISTER", 1], // 0x00c9
  undefined, // 0x00ca reserved by [MS-XLS] (no Ftab entry defined for this index)
  undefined, // 0x00cb reserved by [MS-XLS] (no Ftab entry defined for this index)
  ["USDOLLAR"], // 0x00cc
  ["FINDB"], // 0x00cd
  ["SEARCHB"], // 0x00ce
  ["REPLACEB", FIXED_ARITY_4], // 0x00cf
  ["LEFTB"], // 0x00d0
  ["RIGHTB"], // 0x00d1
  ["MIDB", FIXED_ARITY_3], // 0x00d2
  ["LENB", 1], // 0x00d3
  ["ROUNDUP", 2], // 0x00d4
  ["ROUNDDOWN", 2], // 0x00d5
  ["ASC", 1], // 0x00d6
  ["DBCS", 1], // 0x00d7
  ["RANK"], // 0x00d8
  undefined, // 0x00d9 reserved by [MS-XLS] (no Ftab entry defined for this index)
  undefined, // 0x00da reserved by [MS-XLS] (no Ftab entry defined for this index)
  ["ADDRESS"], // 0x00db
  ["DAYS360"], // 0x00dc
  ["TODAY", 0], // 0x00dd
  ["VDB"], // 0x00de
  ["ELSE", 0], // 0x00df
  ["ELSE.IF", 1], // 0x00e0
  ["END.IF", 0], // 0x00e1
  ["FOR.CELL"], // 0x00e2
  ["MEDIAN"], // 0x00e3
  ["SUMPRODUCT"], // 0x00e4
  ["SINH", 1], // 0x00e5
  ["COSH", 1], // 0x00e6
  ["TANH", 1], // 0x00e7
  ["ASINH", 1], // 0x00e8
  ["ACOSH", 1], // 0x00e9
  ["ATANH", 1], // 0x00ea
  ["DGET", FIXED_ARITY_3], // 0x00eb
  ["CREATE.OBJECT"], // 0x00ec
  ["VOLATILE"], // 0x00ed
  ["LAST.ERROR", 0], // 0x00ee
  ["CUSTOM.UNDO"], // 0x00ef
  ["CUSTOM.REPEAT"], // 0x00f0
  ["FORMULA.CONVERT"], // 0x00f1
  ["GET.LINK.INFO"], // 0x00f2
  ["TEXT.BOX"], // 0x00f3
  ["INFO", 1], // 0x00f4
  ["GROUP", 0], // 0x00f5
  ["GET.OBJECT"], // 0x00f6
  ["DB"], // 0x00f7
  ["PAUSE"], // 0x00f8
  undefined, // 0x00f9 reserved by [MS-XLS] (no Ftab entry defined for this index)
  undefined, // 0x00fa reserved by [MS-XLS] (no Ftab entry defined for this index)
  ["RESUME"], // 0x00fb
  ["FREQUENCY", 2], // 0x00fc
  ["ADD.TOOLBAR"], // 0x00fd
  ["DELETE.TOOLBAR", 1], // 0x00fe
  undefined, // 0x00ff (User Defined Function) has no fixed name of its own — the call names the UDF through its own operand, not through this table — so it is intentionally not listed here.
  ["RESET.TOOLBAR", 1], // 0x0100
  ["EVALUATE", 1], // 0x0101
  ["GET.TOOLBAR"], // 0x0102
  ["GET.TOOL"], // 0x0103
  ["SPELLING.CHECK"], // 0x0104
  ["ERROR.TYPE", 1], // 0x0105
  ["APP.TITLE"], // 0x0106
  ["WINDOW.TITLE"], // 0x0107
  ["SAVE.TOOLBAR"], // 0x0108
  ["ENABLE.TOOL", FIXED_ARITY_3], // 0x0109
  ["PRESS.TOOL", FIXED_ARITY_3], // 0x010a
  ["REGISTER.ID"], // 0x010b
  ["GET.WORKBOOK"], // 0x010c
  ["AVEDEV"], // 0x010d
  ["BETADIST"], // 0x010e
  ["GAMMALN", 1], // 0x010f
  ["BETAINV"], // 0x0110
  ["BINOMDIST", FIXED_ARITY_4], // 0x0111
  ["CHIDIST", 2], // 0x0112
  ["CHIINV", 2], // 0x0113
  ["COMBIN", 2], // 0x0114
  ["CONFIDENCE", FIXED_ARITY_3], // 0x0115
  ["CRITBINOM", FIXED_ARITY_3], // 0x0116
  ["EVEN", 1], // 0x0117
  ["EXPONDIST", FIXED_ARITY_3], // 0x0118
  ["FDIST", FIXED_ARITY_3], // 0x0119
  ["FINV", FIXED_ARITY_3], // 0x011a
  ["FISHER", 1], // 0x011b
  ["FISHERINV", 1], // 0x011c
  ["FLOOR", 2], // 0x011d
  ["GAMMADIST", FIXED_ARITY_4], // 0x011e
  ["GAMMAINV", FIXED_ARITY_3], // 0x011f
  ["CEILING", 2], // 0x0120
  ["HYPGEOMDIST", FIXED_ARITY_4], // 0x0121
  ["LOGNORMDIST", FIXED_ARITY_3], // 0x0122
  ["LOGINV", FIXED_ARITY_3], // 0x0123
  ["NEGBINOMDIST", FIXED_ARITY_3], // 0x0124
  ["NORMDIST", FIXED_ARITY_4], // 0x0125
  ["NORMSDIST", 1], // 0x0126
  ["NORMINV", FIXED_ARITY_3], // 0x0127
  ["NORMSINV", 1], // 0x0128
  ["STANDARDIZE", FIXED_ARITY_3], // 0x0129
  ["ODD", 1], // 0x012a
  ["PERMUT", 2], // 0x012b
  ["POISSON", FIXED_ARITY_3], // 0x012c
  ["TDIST", FIXED_ARITY_3], // 0x012d
  ["WEIBULL", FIXED_ARITY_4], // 0x012e
  ["SUMXMY2", 2], // 0x012f
  ["SUMX2MY2", 2], // 0x0130
  ["SUMX2PY2", 2], // 0x0131
  ["CHITEST", 2], // 0x0132
  ["CORREL", 2], // 0x0133
  ["COVAR", 2], // 0x0134
  ["FORECAST", FIXED_ARITY_3], // 0x0135
  ["FTEST", 2], // 0x0136
  ["INTERCEPT", 2], // 0x0137
  ["PEARSON", 2], // 0x0138
  ["RSQ", 2], // 0x0139
  ["STEYX", 2], // 0x013a
  ["SLOPE", 2], // 0x013b
  ["TTEST", FIXED_ARITY_4], // 0x013c
  ["PROB"], // 0x013d
  ["DEVSQ"], // 0x013e
  ["GEOMEAN"], // 0x013f
  ["HARMEAN"], // 0x0140
  ["SUMSQ"], // 0x0141
  ["KURT"], // 0x0142
  ["SKEW"], // 0x0143
  ["ZTEST"], // 0x0144
  ["LARGE", 2], // 0x0145
  ["SMALL", 2], // 0x0146
  ["QUARTILE", 2], // 0x0147
  ["PERCENTILE", 2], // 0x0148
  ["PERCENTRANK"], // 0x0149
  ["MODE"], // 0x014a
  ["TRIMMEAN", 2], // 0x014b
  ["TINV", 2], // 0x014c
  undefined, // 0x014d reserved by [MS-XLS] (no Ftab entry defined for this index)
  ["MOVIE.COMMAND"], // 0x014e
  ["GET.MOVIE"], // 0x014f
  ["CONCATENATE"], // 0x0150
  ["POWER", 2], // 0x0151
  ["PIVOT.ADD.DATA"], // 0x0152
  ["GET.PIVOT.TABLE"], // 0x0153
  ["GET.PIVOT.FIELD"], // 0x0154
  ["GET.PIVOT.ITEM"], // 0x0155
  ["RADIANS", 1], // 0x0156
  ["DEGREES", 1], // 0x0157
  ["SUBTOTAL"], // 0x0158
  ["SUMIF"], // 0x0159
  ["COUNTIF", 2], // 0x015a
  ["COUNTBLANK", 1], // 0x015b
  ["SCENARIO.GET"], // 0x015c
  ["OPTIONS.LISTS.GET", 1], // 0x015d
  ["ISPMT", FIXED_ARITY_4], // 0x015e
  ["DATEDIF", FIXED_ARITY_3], // 0x015f
  ["DATESTRING", 1], // 0x0160
  ["NUMBERSTRING", 2], // 0x0161
  ["ROMAN"], // 0x0162
  ["OPEN.DIALOG"], // 0x0163
  ["SAVE.DIALOG"], // 0x0164
  ["VIEW.GET"], // 0x0165
  ["GETPIVOTDATA"], // 0x0166
  ["HYPERLINK"], // 0x0167
  ["PHONETIC", 1], // 0x0168
  ["AVERAGEA"], // 0x0169
  ["MAXA"], // 0x016a
  ["MINA"], // 0x016b
  ["STDEVPA"], // 0x016c
  ["VARPA"], // 0x016d
  ["STDEVA"], // 0x016e
  ["VARA"], // 0x016f
  ["BAHTTEXT", 1], // 0x0170
  ["THAIDAYOFWEEK", 1], // 0x0171
  ["THAIDIGIT", 1], // 0x0172
  ["THAIMONTHOFYEAR", 1], // 0x0173
  ["THAINUMSOUND", 1], // 0x0174
  ["THAINUMSTRING", 1], // 0x0175
  ["THAISTRINGLENGTH", 1], // 0x0176
  ["ISTHAIDIGIT", 1], // 0x0177
  ["ROUNDBAHTDOWN", 1], // 0x0178
  ["ROUNDBAHTUP", 1], // 0x0179
  ["THAIYEAR", 1], // 0x017a
  ["RTD"], // 0x017b
];

/** A function's displayed name, by its Ftab index — consulted for both PtgFunc and PtgFuncVar. */
export const FTAB_NAMES: ReadonlyMap<number, string> = new Map(
  FTAB_TABLE.flatMap((entry, iftab) => {
    if (!entry) return [];
    const [name] = entry;
    return [[iftab, name] as const];
  }),
);

/** A function's fixed argument count, by its Ftab index — consulted only for PtgFunc, whose own token carries no count. Absent for every entry [MS-XLS]'s grammar gives an optional or repeated argument, which is never resolved through PtgFunc in practice (see the module comment). */
export const FTAB_FIXED_ARITY: ReadonlyMap<number, number> = new Map(
  FTAB_TABLE.flatMap((entry, iftab) => {
    const arity = entry?.[1];
    return arity === undefined ? [] : [[iftab, arity] as const];
  }),
);

/** The write direction's own lookup: a function's Ftab index by its displayed name, consulted by biff/ptg-writer.ts when compiling a formula's own function calls back into PtgFunc/PtgFuncVar tokens. Built from FTAB_NAMES rather than as a second hand-maintained table, so the two directions cannot drift apart; every name in this table is unique, so the inversion loses nothing. */
export const FTAB_IFTAB_BY_NAME: ReadonlyMap<string, number> = new Map(
  Array.from(FTAB_NAMES, ([iftab, name]) => [name, iftab] as const),
);
