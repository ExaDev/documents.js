// The WHATWG Encoding Standard's legacy single-byte encodings (https://encoding.spec.whatwg.org/#legacy-single-byte-encodings, https://web.archive.org/web/2026/https://encoding.spec.whatwg.org/#legacy-single-byte-encodings), the bounded set of code pages ExaDev/documents.js#1361 adds to what {@link DecodeTextOptions.encoding} can declare. That standard, rather than an arbitrary list, is the derivation: it is the same standard TextDecoder itself implements, so naming exactly the encodings it names as legacy single-byte keeps decodeText's own vocabulary aligned with the one web platform standard every consumer already expects, and every one of them shares windows-1252's own decoder shape, a fixed 256-byte table with the bytes below 0x80 always ASCII. windows-1252 itself stays in decode.ts, where its decoder already lived before this file existed.
//
// Legacy multi-byte and double-byte encodings (Shift_JIS, EUC-JP, ISO-2022-JP, GBK, gb18030, Big5, EUC-KR) are deliberately excluded from this file: they are not a bounded extension of this table shape at all, needing a variable-width, often stateful decoder over index tables with tens of thousands of entries rather than a further 256-byte lookup, so folding them into this table would not be the same kind of change. That was tracked as its own issue (ExaDev/documents.js#1388) rather than left unrecorded: decode-dbcs.ts carries the non-stateful ones (Shift_JIS, EUC-JP, EUC-KR, GBK, gb18030, Big5) against generated index tables of their own, the same shape this file's own header comment describes for these tables but at the scale those encodings actually need, and decode-iso-2022-jp.ts carries ISO-2022-JP itself, a genuine escape-sequence state machine rather than a byte-width decoder.
//
// Each table below holds only the bytes from 0x80 to 0xFF: every one of these encodings maps 0x00-0x7F to the same code point as the byte itself, exactly as windows-1252 already does, so ASCII needs no table at all. A byte the encoding leaves without a character of its own, the same kind of gap {@link WINDOWS_1252_UNDEFINED_BYTES} exists to name for windows-1252, is written here as U+FFFD; no real single-byte legacy encoding maps any byte to the replacement character on purpose, so that value can never be confused with a genuine mapping, and {@link decodeLegacySingleByte} treats seeing it as the signal to refuse the byte rather than silently emitting a replacement character into the result.
//
// The tables themselves were generated, not typed by hand: for each encoding, every byte from 0x80 to 0xFF was decoded through the host's own ICU-backed TextDecoder (Node with full-icu, the default build) and the resulting code point recorded, with a byte that TextDecoder's fatal mode rejects recorded as the U+FFFD gap marker instead. ICU's implementation of the Encoding Standard is the reference this module has no other way to check itself against for two dozen code pages at once, the same reason ExaDev/documents.js#1361 gives for why decodeText's own tests compare its windows-1252, UTF-16 and UTF-32 decoders byte for byte against a platform TextDecoder. Once generated, the tables are ordinary static data with no further dependency on ICU or on any host's decoder support, which is the entire point of holding them in this module rather than delegating to TextDecoder: the same bytes decode the same way on every host, full-icu or small-icu, Node or workerd.

/** A legacy single-byte encoding {@link decodeText} can decode when the caller declares it explicitly. Never produced by detection: nothing distinguishes one of these code pages from another, or from windows-1252, without the statistical model this module does not carry (see {@link TextEncodingLabel}). */
export type LegacySingleByteEncodingLabel =
  | "ibm866"
  | "iso-8859-2"
  | "iso-8859-3"
  | "iso-8859-4"
  | "iso-8859-5"
  | "iso-8859-6"
  | "iso-8859-7"
  | "iso-8859-8"
  | "iso-8859-8-i"
  | "iso-8859-10"
  | "iso-8859-13"
  | "iso-8859-14"
  | "iso-8859-15"
  | "iso-8859-16"
  | "koi8-r"
  | "koi8-u"
  | "macintosh"
  | "windows-874"
  | "windows-1250"
  | "windows-1251"
  | "windows-1253"
  | "windows-1254"
  | "windows-1255"
  | "windows-1256"
  | "windows-1257"
  | "windows-1258"
  | "x-mac-cyrillic";

/** Byte 0x80-0xFF lookup tables for {@link LegacySingleByteEncodingLabel}, one 128-character string per encoding, indexed by `byte - 0x80`. See the top of this file for what generated them and what a U+FFFD entry means. */
export const LEGACY_SINGLE_BYTE_TABLES: Readonly<
  Record<LegacySingleByteEncodingLabel, string>
> = {
  ibm866:
    "\u0410\u0411\u0412\u0413\u0414\u0415\u0416\u0417" + // 0x80-0x87
    "\u0418\u0419\u041a\u041b\u041c\u041d\u041e\u041f" + // 0x88-0x8f
    "\u0420\u0421\u0422\u0423\u0424\u0425\u0426\u0427" + // 0x90-0x97
    "\u0428\u0429\u042a\u042b\u042c\u042d\u042e\u042f" + // 0x98-0x9f
    "\u0430\u0431\u0432\u0433\u0434\u0435\u0436\u0437" + // 0xa0-0xa7
    "\u0438\u0439\u043a\u043b\u043c\u043d\u043e\u043f" + // 0xa8-0xaf
    "\u2591\u2592\u2593\u2502\u2524\u2561\u2562\u2556" + // 0xb0-0xb7
    "\u2555\u2563\u2551\u2557\u255d\u255c\u255b\u2510" + // 0xb8-0xbf
    "\u2514\u2534\u252c\u251c\u2500\u253c\u255e\u255f" + // 0xc0-0xc7
    "\u255a\u2554\u2569\u2566\u2560\u2550\u256c\u2567" + // 0xc8-0xcf
    "\u2568\u2564\u2565\u2559\u2558\u2552\u2553\u256b" + // 0xd0-0xd7
    "\u256a\u2518\u250c\u2588\u2584\u258c\u2590\u2580" + // 0xd8-0xdf
    "\u0440\u0441\u0442\u0443\u0444\u0445\u0446\u0447" + // 0xe0-0xe7
    "\u0448\u0449\u044a\u044b\u044c\u044d\u044e\u044f" + // 0xe8-0xef
    "\u0401\u0451\u0404\u0454\u0407\u0457\u040e\u045e" + // 0xf0-0xf7
    "\u00b0\u2219\u00b7\u221a\u2116\u00a4\u25a0\u00a0", // 0xf8-0xff
  "iso-8859-2":
    "\u0080\u0081\u0082\u0083\u0084\u0085\u0086\u0087" + // 0x80-0x87
    "\u0088\u0089\u008a\u008b\u008c\u008d\u008e\u008f" + // 0x88-0x8f
    "\u0090\u0091\u0092\u0093\u0094\u0095\u0096\u0097" + // 0x90-0x97
    "\u0098\u0099\u009a\u009b\u009c\u009d\u009e\u009f" + // 0x98-0x9f
    "\u00a0\u0104\u02d8\u0141\u00a4\u013d\u015a\u00a7" + // 0xa0-0xa7
    "\u00a8\u0160\u015e\u0164\u0179\u00ad\u017d\u017b" + // 0xa8-0xaf
    "\u00b0\u0105\u02db\u0142\u00b4\u013e\u015b\u02c7" + // 0xb0-0xb7
    "\u00b8\u0161\u015f\u0165\u017a\u02dd\u017e\u017c" + // 0xb8-0xbf
    "\u0154\u00c1\u00c2\u0102\u00c4\u0139\u0106\u00c7" + // 0xc0-0xc7
    "\u010c\u00c9\u0118\u00cb\u011a\u00cd\u00ce\u010e" + // 0xc8-0xcf
    "\u0110\u0143\u0147\u00d3\u00d4\u0150\u00d6\u00d7" + // 0xd0-0xd7
    "\u0158\u016e\u00da\u0170\u00dc\u00dd\u0162\u00df" + // 0xd8-0xdf
    "\u0155\u00e1\u00e2\u0103\u00e4\u013a\u0107\u00e7" + // 0xe0-0xe7
    "\u010d\u00e9\u0119\u00eb\u011b\u00ed\u00ee\u010f" + // 0xe8-0xef
    "\u0111\u0144\u0148\u00f3\u00f4\u0151\u00f6\u00f7" + // 0xf0-0xf7
    "\u0159\u016f\u00fa\u0171\u00fc\u00fd\u0163\u02d9", // 0xf8-0xff
  "iso-8859-3":
    "\u0080\u0081\u0082\u0083\u0084\u0085\u0086\u0087" + // 0x80-0x87
    "\u0088\u0089\u008a\u008b\u008c\u008d\u008e\u008f" + // 0x88-0x8f
    "\u0090\u0091\u0092\u0093\u0094\u0095\u0096\u0097" + // 0x90-0x97
    "\u0098\u0099\u009a\u009b\u009c\u009d\u009e\u009f" + // 0x98-0x9f
    "\u00a0\u0126\u02d8\u00a3\u00a4\ufffd\u0124\u00a7" + // 0xa0-0xa7
    "\u00a8\u0130\u015e\u011e\u0134\u00ad\ufffd\u017b" + // 0xa8-0xaf
    "\u00b0\u0127\u00b2\u00b3\u00b4\u00b5\u0125\u00b7" + // 0xb0-0xb7
    "\u00b8\u0131\u015f\u011f\u0135\u00bd\ufffd\u017c" + // 0xb8-0xbf
    "\u00c0\u00c1\u00c2\ufffd\u00c4\u010a\u0108\u00c7" + // 0xc0-0xc7
    "\u00c8\u00c9\u00ca\u00cb\u00cc\u00cd\u00ce\u00cf" + // 0xc8-0xcf
    "\ufffd\u00d1\u00d2\u00d3\u00d4\u0120\u00d6\u00d7" + // 0xd0-0xd7
    "\u011c\u00d9\u00da\u00db\u00dc\u016c\u015c\u00df" + // 0xd8-0xdf
    "\u00e0\u00e1\u00e2\ufffd\u00e4\u010b\u0109\u00e7" + // 0xe0-0xe7
    "\u00e8\u00e9\u00ea\u00eb\u00ec\u00ed\u00ee\u00ef" + // 0xe8-0xef
    "\ufffd\u00f1\u00f2\u00f3\u00f4\u0121\u00f6\u00f7" + // 0xf0-0xf7
    "\u011d\u00f9\u00fa\u00fb\u00fc\u016d\u015d\u02d9", // 0xf8-0xff
  "iso-8859-4":
    "\u0080\u0081\u0082\u0083\u0084\u0085\u0086\u0087" + // 0x80-0x87
    "\u0088\u0089\u008a\u008b\u008c\u008d\u008e\u008f" + // 0x88-0x8f
    "\u0090\u0091\u0092\u0093\u0094\u0095\u0096\u0097" + // 0x90-0x97
    "\u0098\u0099\u009a\u009b\u009c\u009d\u009e\u009f" + // 0x98-0x9f
    "\u00a0\u0104\u0138\u0156\u00a4\u0128\u013b\u00a7" + // 0xa0-0xa7
    "\u00a8\u0160\u0112\u0122\u0166\u00ad\u017d\u00af" + // 0xa8-0xaf
    "\u00b0\u0105\u02db\u0157\u00b4\u0129\u013c\u02c7" + // 0xb0-0xb7
    "\u00b8\u0161\u0113\u0123\u0167\u014a\u017e\u014b" + // 0xb8-0xbf
    "\u0100\u00c1\u00c2\u00c3\u00c4\u00c5\u00c6\u012e" + // 0xc0-0xc7
    "\u010c\u00c9\u0118\u00cb\u0116\u00cd\u00ce\u012a" + // 0xc8-0xcf
    "\u0110\u0145\u014c\u0136\u00d4\u00d5\u00d6\u00d7" + // 0xd0-0xd7
    "\u00d8\u0172\u00da\u00db\u00dc\u0168\u016a\u00df" + // 0xd8-0xdf
    "\u0101\u00e1\u00e2\u00e3\u00e4\u00e5\u00e6\u012f" + // 0xe0-0xe7
    "\u010d\u00e9\u0119\u00eb\u0117\u00ed\u00ee\u012b" + // 0xe8-0xef
    "\u0111\u0146\u014d\u0137\u00f4\u00f5\u00f6\u00f7" + // 0xf0-0xf7
    "\u00f8\u0173\u00fa\u00fb\u00fc\u0169\u016b\u02d9", // 0xf8-0xff
  "iso-8859-5":
    "\u0080\u0081\u0082\u0083\u0084\u0085\u0086\u0087" + // 0x80-0x87
    "\u0088\u0089\u008a\u008b\u008c\u008d\u008e\u008f" + // 0x88-0x8f
    "\u0090\u0091\u0092\u0093\u0094\u0095\u0096\u0097" + // 0x90-0x97
    "\u0098\u0099\u009a\u009b\u009c\u009d\u009e\u009f" + // 0x98-0x9f
    "\u00a0\u0401\u0402\u0403\u0404\u0405\u0406\u0407" + // 0xa0-0xa7
    "\u0408\u0409\u040a\u040b\u040c\u00ad\u040e\u040f" + // 0xa8-0xaf
    "\u0410\u0411\u0412\u0413\u0414\u0415\u0416\u0417" + // 0xb0-0xb7
    "\u0418\u0419\u041a\u041b\u041c\u041d\u041e\u041f" + // 0xb8-0xbf
    "\u0420\u0421\u0422\u0423\u0424\u0425\u0426\u0427" + // 0xc0-0xc7
    "\u0428\u0429\u042a\u042b\u042c\u042d\u042e\u042f" + // 0xc8-0xcf
    "\u0430\u0431\u0432\u0433\u0434\u0435\u0436\u0437" + // 0xd0-0xd7
    "\u0438\u0439\u043a\u043b\u043c\u043d\u043e\u043f" + // 0xd8-0xdf
    "\u0440\u0441\u0442\u0443\u0444\u0445\u0446\u0447" + // 0xe0-0xe7
    "\u0448\u0449\u044a\u044b\u044c\u044d\u044e\u044f" + // 0xe8-0xef
    "\u2116\u0451\u0452\u0453\u0454\u0455\u0456\u0457" + // 0xf0-0xf7
    "\u0458\u0459\u045a\u045b\u045c\u00a7\u045e\u045f", // 0xf8-0xff
  "iso-8859-6":
    "\u0080\u0081\u0082\u0083\u0084\u0085\u0086\u0087" + // 0x80-0x87
    "\u0088\u0089\u008a\u008b\u008c\u008d\u008e\u008f" + // 0x88-0x8f
    "\u0090\u0091\u0092\u0093\u0094\u0095\u0096\u0097" + // 0x90-0x97
    "\u0098\u0099\u009a\u009b\u009c\u009d\u009e\u009f" + // 0x98-0x9f
    "\u00a0\ufffd\ufffd\ufffd\u00a4\ufffd\ufffd\ufffd" + // 0xa0-0xa7
    "\ufffd\ufffd\ufffd\ufffd\u060c\u00ad\ufffd\ufffd" + // 0xa8-0xaf
    "\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd" + // 0xb0-0xb7
    "\ufffd\ufffd\ufffd\u061b\ufffd\ufffd\ufffd\u061f" + // 0xb8-0xbf
    "\ufffd\u0621\u0622\u0623\u0624\u0625\u0626\u0627" + // 0xc0-0xc7
    "\u0628\u0629\u062a\u062b\u062c\u062d\u062e\u062f" + // 0xc8-0xcf
    "\u0630\u0631\u0632\u0633\u0634\u0635\u0636\u0637" + // 0xd0-0xd7
    "\u0638\u0639\u063a\ufffd\ufffd\ufffd\ufffd\ufffd" + // 0xd8-0xdf
    "\u0640\u0641\u0642\u0643\u0644\u0645\u0646\u0647" + // 0xe0-0xe7
    "\u0648\u0649\u064a\u064b\u064c\u064d\u064e\u064f" + // 0xe8-0xef
    "\u0650\u0651\u0652\ufffd\ufffd\ufffd\ufffd\ufffd" + // 0xf0-0xf7
    "\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd", // 0xf8-0xff
  "iso-8859-7":
    "\u0080\u0081\u0082\u0083\u0084\u0085\u0086\u0087" + // 0x80-0x87
    "\u0088\u0089\u008a\u008b\u008c\u008d\u008e\u008f" + // 0x88-0x8f
    "\u0090\u0091\u0092\u0093\u0094\u0095\u0096\u0097" + // 0x90-0x97
    "\u0098\u0099\u009a\u009b\u009c\u009d\u009e\u009f" + // 0x98-0x9f
    "\u00a0\u2018\u2019\u00a3\u20ac\u20af\u00a6\u00a7" + // 0xa0-0xa7
    "\u00a8\u00a9\u037a\u00ab\u00ac\u00ad\ufffd\u2015" + // 0xa8-0xaf
    "\u00b0\u00b1\u00b2\u00b3\u0384\u0385\u0386\u00b7" + // 0xb0-0xb7
    "\u0388\u0389\u038a\u00bb\u038c\u00bd\u038e\u038f" + // 0xb8-0xbf
    "\u0390\u0391\u0392\u0393\u0394\u0395\u0396\u0397" + // 0xc0-0xc7
    "\u0398\u0399\u039a\u039b\u039c\u039d\u039e\u039f" + // 0xc8-0xcf
    "\u03a0\u03a1\ufffd\u03a3\u03a4\u03a5\u03a6\u03a7" + // 0xd0-0xd7
    "\u03a8\u03a9\u03aa\u03ab\u03ac\u03ad\u03ae\u03af" + // 0xd8-0xdf
    "\u03b0\u03b1\u03b2\u03b3\u03b4\u03b5\u03b6\u03b7" + // 0xe0-0xe7
    "\u03b8\u03b9\u03ba\u03bb\u03bc\u03bd\u03be\u03bf" + // 0xe8-0xef
    "\u03c0\u03c1\u03c2\u03c3\u03c4\u03c5\u03c6\u03c7" + // 0xf0-0xf7
    "\u03c8\u03c9\u03ca\u03cb\u03cc\u03cd\u03ce\ufffd", // 0xf8-0xff
  "iso-8859-8":
    "\u0080\u0081\u0082\u0083\u0084\u0085\u0086\u0087" + // 0x80-0x87
    "\u0088\u0089\u008a\u008b\u008c\u008d\u008e\u008f" + // 0x88-0x8f
    "\u0090\u0091\u0092\u0093\u0094\u0095\u0096\u0097" + // 0x90-0x97
    "\u0098\u0099\u009a\u009b\u009c\u009d\u009e\u009f" + // 0x98-0x9f
    "\u00a0\ufffd\u00a2\u00a3\u00a4\u00a5\u00a6\u00a7" + // 0xa0-0xa7
    "\u00a8\u00a9\u00d7\u00ab\u00ac\u00ad\u00ae\u00af" + // 0xa8-0xaf
    "\u00b0\u00b1\u00b2\u00b3\u00b4\u00b5\u00b6\u00b7" + // 0xb0-0xb7
    "\u00b8\u00b9\u00f7\u00bb\u00bc\u00bd\u00be\ufffd" + // 0xb8-0xbf
    "\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd" + // 0xc0-0xc7
    "\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd" + // 0xc8-0xcf
    "\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd" + // 0xd0-0xd7
    "\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\u2017" + // 0xd8-0xdf
    "\u05d0\u05d1\u05d2\u05d3\u05d4\u05d5\u05d6\u05d7" + // 0xe0-0xe7
    "\u05d8\u05d9\u05da\u05db\u05dc\u05dd\u05de\u05df" + // 0xe8-0xef
    "\u05e0\u05e1\u05e2\u05e3\u05e4\u05e5\u05e6\u05e7" + // 0xf0-0xf7
    "\u05e8\u05e9\u05ea\ufffd\ufffd\u200e\u200f\ufffd", // 0xf8-0xff
  "iso-8859-8-i":
    "\u0080\u0081\u0082\u0083\u0084\u0085\u0086\u0087" + // 0x80-0x87
    "\u0088\u0089\u008a\u008b\u008c\u008d\u008e\u008f" + // 0x88-0x8f
    "\u0090\u0091\u0092\u0093\u0094\u0095\u0096\u0097" + // 0x90-0x97
    "\u0098\u0099\u009a\u009b\u009c\u009d\u009e\u009f" + // 0x98-0x9f
    "\u00a0\ufffd\u00a2\u00a3\u00a4\u00a5\u00a6\u00a7" + // 0xa0-0xa7
    "\u00a8\u00a9\u00d7\u00ab\u00ac\u00ad\u00ae\u00af" + // 0xa8-0xaf
    "\u00b0\u00b1\u00b2\u00b3\u00b4\u00b5\u00b6\u00b7" + // 0xb0-0xb7
    "\u00b8\u00b9\u00f7\u00bb\u00bc\u00bd\u00be\ufffd" + // 0xb8-0xbf
    "\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd" + // 0xc0-0xc7
    "\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd" + // 0xc8-0xcf
    "\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd" + // 0xd0-0xd7
    "\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\u2017" + // 0xd8-0xdf
    "\u05d0\u05d1\u05d2\u05d3\u05d4\u05d5\u05d6\u05d7" + // 0xe0-0xe7
    "\u05d8\u05d9\u05da\u05db\u05dc\u05dd\u05de\u05df" + // 0xe8-0xef
    "\u05e0\u05e1\u05e2\u05e3\u05e4\u05e5\u05e6\u05e7" + // 0xf0-0xf7
    "\u05e8\u05e9\u05ea\ufffd\ufffd\u200e\u200f\ufffd", // 0xf8-0xff
  "iso-8859-10":
    "\u0080\u0081\u0082\u0083\u0084\u0085\u0086\u0087" + // 0x80-0x87
    "\u0088\u0089\u008a\u008b\u008c\u008d\u008e\u008f" + // 0x88-0x8f
    "\u0090\u0091\u0092\u0093\u0094\u0095\u0096\u0097" + // 0x90-0x97
    "\u0098\u0099\u009a\u009b\u009c\u009d\u009e\u009f" + // 0x98-0x9f
    "\u00a0\u0104\u0112\u0122\u012a\u0128\u0136\u00a7" + // 0xa0-0xa7
    "\u013b\u0110\u0160\u0166\u017d\u00ad\u016a\u014a" + // 0xa8-0xaf
    "\u00b0\u0105\u0113\u0123\u012b\u0129\u0137\u00b7" + // 0xb0-0xb7
    "\u013c\u0111\u0161\u0167\u017e\u2015\u016b\u014b" + // 0xb8-0xbf
    "\u0100\u00c1\u00c2\u00c3\u00c4\u00c5\u00c6\u012e" + // 0xc0-0xc7
    "\u010c\u00c9\u0118\u00cb\u0116\u00cd\u00ce\u00cf" + // 0xc8-0xcf
    "\u00d0\u0145\u014c\u00d3\u00d4\u00d5\u00d6\u0168" + // 0xd0-0xd7
    "\u00d8\u0172\u00da\u00db\u00dc\u00dd\u00de\u00df" + // 0xd8-0xdf
    "\u0101\u00e1\u00e2\u00e3\u00e4\u00e5\u00e6\u012f" + // 0xe0-0xe7
    "\u010d\u00e9\u0119\u00eb\u0117\u00ed\u00ee\u00ef" + // 0xe8-0xef
    "\u00f0\u0146\u014d\u00f3\u00f4\u00f5\u00f6\u0169" + // 0xf0-0xf7
    "\u00f8\u0173\u00fa\u00fb\u00fc\u00fd\u00fe\u0138", // 0xf8-0xff
  "iso-8859-13":
    "\u0080\u0081\u0082\u0083\u0084\u0085\u0086\u0087" + // 0x80-0x87
    "\u0088\u0089\u008a\u008b\u008c\u008d\u008e\u008f" + // 0x88-0x8f
    "\u0090\u0091\u0092\u0093\u0094\u0095\u0096\u0097" + // 0x90-0x97
    "\u0098\u0099\u009a\u009b\u009c\u009d\u009e\u009f" + // 0x98-0x9f
    "\u00a0\u201d\u00a2\u00a3\u00a4\u201e\u00a6\u00a7" + // 0xa0-0xa7
    "\u00d8\u00a9\u0156\u00ab\u00ac\u00ad\u00ae\u00c6" + // 0xa8-0xaf
    "\u00b0\u00b1\u00b2\u00b3\u201c\u00b5\u00b6\u00b7" + // 0xb0-0xb7
    "\u00f8\u00b9\u0157\u00bb\u00bc\u00bd\u00be\u00e6" + // 0xb8-0xbf
    "\u0104\u012e\u0100\u0106\u00c4\u00c5\u0118\u0112" + // 0xc0-0xc7
    "\u010c\u00c9\u0179\u0116\u0122\u0136\u012a\u013b" + // 0xc8-0xcf
    "\u0160\u0143\u0145\u00d3\u014c\u00d5\u00d6\u00d7" + // 0xd0-0xd7
    "\u0172\u0141\u015a\u016a\u00dc\u017b\u017d\u00df" + // 0xd8-0xdf
    "\u0105\u012f\u0101\u0107\u00e4\u00e5\u0119\u0113" + // 0xe0-0xe7
    "\u010d\u00e9\u017a\u0117\u0123\u0137\u012b\u013c" + // 0xe8-0xef
    "\u0161\u0144\u0146\u00f3\u014d\u00f5\u00f6\u00f7" + // 0xf0-0xf7
    "\u0173\u0142\u015b\u016b\u00fc\u017c\u017e\u2019", // 0xf8-0xff
  "iso-8859-14":
    "\u0080\u0081\u0082\u0083\u0084\u0085\u0086\u0087" + // 0x80-0x87
    "\u0088\u0089\u008a\u008b\u008c\u008d\u008e\u008f" + // 0x88-0x8f
    "\u0090\u0091\u0092\u0093\u0094\u0095\u0096\u0097" + // 0x90-0x97
    "\u0098\u0099\u009a\u009b\u009c\u009d\u009e\u009f" + // 0x98-0x9f
    "\u00a0\u1e02\u1e03\u00a3\u010a\u010b\u1e0a\u00a7" + // 0xa0-0xa7
    "\u1e80\u00a9\u1e82\u1e0b\u1ef2\u00ad\u00ae\u0178" + // 0xa8-0xaf
    "\u1e1e\u1e1f\u0120\u0121\u1e40\u1e41\u00b6\u1e56" + // 0xb0-0xb7
    "\u1e81\u1e57\u1e83\u1e60\u1ef3\u1e84\u1e85\u1e61" + // 0xb8-0xbf
    "\u00c0\u00c1\u00c2\u00c3\u00c4\u00c5\u00c6\u00c7" + // 0xc0-0xc7
    "\u00c8\u00c9\u00ca\u00cb\u00cc\u00cd\u00ce\u00cf" + // 0xc8-0xcf
    "\u0174\u00d1\u00d2\u00d3\u00d4\u00d5\u00d6\u1e6a" + // 0xd0-0xd7
    "\u00d8\u00d9\u00da\u00db\u00dc\u00dd\u0176\u00df" + // 0xd8-0xdf
    "\u00e0\u00e1\u00e2\u00e3\u00e4\u00e5\u00e6\u00e7" + // 0xe0-0xe7
    "\u00e8\u00e9\u00ea\u00eb\u00ec\u00ed\u00ee\u00ef" + // 0xe8-0xef
    "\u0175\u00f1\u00f2\u00f3\u00f4\u00f5\u00f6\u1e6b" + // 0xf0-0xf7
    "\u00f8\u00f9\u00fa\u00fb\u00fc\u00fd\u0177\u00ff", // 0xf8-0xff
  "iso-8859-15":
    "\u0080\u0081\u0082\u0083\u0084\u0085\u0086\u0087" + // 0x80-0x87
    "\u0088\u0089\u008a\u008b\u008c\u008d\u008e\u008f" + // 0x88-0x8f
    "\u0090\u0091\u0092\u0093\u0094\u0095\u0096\u0097" + // 0x90-0x97
    "\u0098\u0099\u009a\u009b\u009c\u009d\u009e\u009f" + // 0x98-0x9f
    "\u00a0\u00a1\u00a2\u00a3\u20ac\u00a5\u0160\u00a7" + // 0xa0-0xa7
    "\u0161\u00a9\u00aa\u00ab\u00ac\u00ad\u00ae\u00af" + // 0xa8-0xaf
    "\u00b0\u00b1\u00b2\u00b3\u017d\u00b5\u00b6\u00b7" + // 0xb0-0xb7
    "\u017e\u00b9\u00ba\u00bb\u0152\u0153\u0178\u00bf" + // 0xb8-0xbf
    "\u00c0\u00c1\u00c2\u00c3\u00c4\u00c5\u00c6\u00c7" + // 0xc0-0xc7
    "\u00c8\u00c9\u00ca\u00cb\u00cc\u00cd\u00ce\u00cf" + // 0xc8-0xcf
    "\u00d0\u00d1\u00d2\u00d3\u00d4\u00d5\u00d6\u00d7" + // 0xd0-0xd7
    "\u00d8\u00d9\u00da\u00db\u00dc\u00dd\u00de\u00df" + // 0xd8-0xdf
    "\u00e0\u00e1\u00e2\u00e3\u00e4\u00e5\u00e6\u00e7" + // 0xe0-0xe7
    "\u00e8\u00e9\u00ea\u00eb\u00ec\u00ed\u00ee\u00ef" + // 0xe8-0xef
    "\u00f0\u00f1\u00f2\u00f3\u00f4\u00f5\u00f6\u00f7" + // 0xf0-0xf7
    "\u00f8\u00f9\u00fa\u00fb\u00fc\u00fd\u00fe\u00ff", // 0xf8-0xff
  "iso-8859-16":
    "\u0080\u0081\u0082\u0083\u0084\u0085\u0086\u0087" + // 0x80-0x87
    "\u0088\u0089\u008a\u008b\u008c\u008d\u008e\u008f" + // 0x88-0x8f
    "\u0090\u0091\u0092\u0093\u0094\u0095\u0096\u0097" + // 0x90-0x97
    "\u0098\u0099\u009a\u009b\u009c\u009d\u009e\u009f" + // 0x98-0x9f
    "\u00a0\u0104\u0105\u0141\u20ac\u201e\u0160\u00a7" + // 0xa0-0xa7
    "\u0161\u00a9\u0218\u00ab\u0179\u00ad\u017a\u017b" + // 0xa8-0xaf
    "\u00b0\u00b1\u010c\u0142\u017d\u201d\u00b6\u00b7" + // 0xb0-0xb7
    "\u017e\u010d\u0219\u00bb\u0152\u0153\u0178\u017c" + // 0xb8-0xbf
    "\u00c0\u00c1\u00c2\u0102\u00c4\u0106\u00c6\u00c7" + // 0xc0-0xc7
    "\u00c8\u00c9\u00ca\u00cb\u00cc\u00cd\u00ce\u00cf" + // 0xc8-0xcf
    "\u0110\u0143\u00d2\u00d3\u00d4\u0150\u00d6\u015a" + // 0xd0-0xd7
    "\u0170\u00d9\u00da\u00db\u00dc\u0118\u021a\u00df" + // 0xd8-0xdf
    "\u00e0\u00e1\u00e2\u0103\u00e4\u0107\u00e6\u00e7" + // 0xe0-0xe7
    "\u00e8\u00e9\u00ea\u00eb\u00ec\u00ed\u00ee\u00ef" + // 0xe8-0xef
    "\u0111\u0144\u00f2\u00f3\u00f4\u0151\u00f6\u015b" + // 0xf0-0xf7
    "\u0171\u00f9\u00fa\u00fb\u00fc\u0119\u021b\u00ff", // 0xf8-0xff
  "koi8-r":
    "\u2500\u2502\u250c\u2510\u2514\u2518\u251c\u2524" + // 0x80-0x87
    "\u252c\u2534\u253c\u2580\u2584\u2588\u258c\u2590" + // 0x88-0x8f
    "\u2591\u2592\u2593\u2320\u25a0\u2219\u221a\u2248" + // 0x90-0x97
    "\u2264\u2265\u00a0\u2321\u00b0\u00b2\u00b7\u00f7" + // 0x98-0x9f
    "\u2550\u2551\u2552\u0451\u2553\u2554\u2555\u2556" + // 0xa0-0xa7
    "\u2557\u2558\u2559\u255a\u255b\u255c\u255d\u255e" + // 0xa8-0xaf
    "\u255f\u2560\u2561\u0401\u2562\u2563\u2564\u2565" + // 0xb0-0xb7
    "\u2566\u2567\u2568\u2569\u256a\u256b\u256c\u00a9" + // 0xb8-0xbf
    "\u044e\u0430\u0431\u0446\u0434\u0435\u0444\u0433" + // 0xc0-0xc7
    "\u0445\u0438\u0439\u043a\u043b\u043c\u043d\u043e" + // 0xc8-0xcf
    "\u043f\u044f\u0440\u0441\u0442\u0443\u0436\u0432" + // 0xd0-0xd7
    "\u044c\u044b\u0437\u0448\u044d\u0449\u0447\u044a" + // 0xd8-0xdf
    "\u042e\u0410\u0411\u0426\u0414\u0415\u0424\u0413" + // 0xe0-0xe7
    "\u0425\u0418\u0419\u041a\u041b\u041c\u041d\u041e" + // 0xe8-0xef
    "\u041f\u042f\u0420\u0421\u0422\u0423\u0416\u0412" + // 0xf0-0xf7
    "\u042c\u042b\u0417\u0428\u042d\u0429\u0427\u042a", // 0xf8-0xff
  "koi8-u":
    "\u2500\u2502\u250c\u2510\u2514\u2518\u251c\u2524" + // 0x80-0x87
    "\u252c\u2534\u253c\u2580\u2584\u2588\u258c\u2590" + // 0x88-0x8f
    "\u2591\u2592\u2593\u2320\u25a0\u2219\u221a\u2248" + // 0x90-0x97
    "\u2264\u2265\u00a0\u2321\u00b0\u00b2\u00b7\u00f7" + // 0x98-0x9f
    "\u2550\u2551\u2552\u0451\u0454\u2554\u0456\u0457" + // 0xa0-0xa7
    "\u2557\u2558\u2559\u255a\u255b\u0491\u045e\u255e" + // 0xa8-0xaf
    "\u255f\u2560\u2561\u0401\u0404\u2563\u0406\u0407" + // 0xb0-0xb7
    "\u2566\u2567\u2568\u2569\u256a\u0490\u040e\u00a9" + // 0xb8-0xbf
    "\u044e\u0430\u0431\u0446\u0434\u0435\u0444\u0433" + // 0xc0-0xc7
    "\u0445\u0438\u0439\u043a\u043b\u043c\u043d\u043e" + // 0xc8-0xcf
    "\u043f\u044f\u0440\u0441\u0442\u0443\u0436\u0432" + // 0xd0-0xd7
    "\u044c\u044b\u0437\u0448\u044d\u0449\u0447\u044a" + // 0xd8-0xdf
    "\u042e\u0410\u0411\u0426\u0414\u0415\u0424\u0413" + // 0xe0-0xe7
    "\u0425\u0418\u0419\u041a\u041b\u041c\u041d\u041e" + // 0xe8-0xef
    "\u041f\u042f\u0420\u0421\u0422\u0423\u0416\u0412" + // 0xf0-0xf7
    "\u042c\u042b\u0417\u0428\u042d\u0429\u0427\u042a", // 0xf8-0xff
  macintosh:
    "\u00c4\u00c5\u00c7\u00c9\u00d1\u00d6\u00dc\u00e1" + // 0x80-0x87
    "\u00e0\u00e2\u00e4\u00e3\u00e5\u00e7\u00e9\u00e8" + // 0x88-0x8f
    "\u00ea\u00eb\u00ed\u00ec\u00ee\u00ef\u00f1\u00f3" + // 0x90-0x97
    "\u00f2\u00f4\u00f6\u00f5\u00fa\u00f9\u00fb\u00fc" + // 0x98-0x9f
    "\u2020\u00b0\u00a2\u00a3\u00a7\u2022\u00b6\u00df" + // 0xa0-0xa7
    "\u00ae\u00a9\u2122\u00b4\u00a8\u2260\u00c6\u00d8" + // 0xa8-0xaf
    "\u221e\u00b1\u2264\u2265\u00a5\u00b5\u2202\u2211" + // 0xb0-0xb7
    "\u220f\u03c0\u222b\u00aa\u00ba\u03a9\u00e6\u00f8" + // 0xb8-0xbf
    "\u00bf\u00a1\u00ac\u221a\u0192\u2248\u2206\u00ab" + // 0xc0-0xc7
    "\u00bb\u2026\u00a0\u00c0\u00c3\u00d5\u0152\u0153" + // 0xc8-0xcf
    "\u2013\u2014\u201c\u201d\u2018\u2019\u00f7\u25ca" + // 0xd0-0xd7
    "\u00ff\u0178\u2044\u20ac\u2039\u203a\ufb01\ufb02" + // 0xd8-0xdf
    "\u2021\u00b7\u201a\u201e\u2030\u00c2\u00ca\u00c1" + // 0xe0-0xe7
    "\u00cb\u00c8\u00cd\u00ce\u00cf\u00cc\u00d3\u00d4" + // 0xe8-0xef
    "\uf8ff\u00d2\u00da\u00db\u00d9\u0131\u02c6\u02dc" + // 0xf0-0xf7
    "\u00af\u02d8\u02d9\u02da\u00b8\u02dd\u02db\u02c7", // 0xf8-0xff
  "windows-874":
    "\u20ac\u0081\u0082\u0083\u0084\u2026\u0086\u0087" + // 0x80-0x87
    "\u0088\u0089\u008a\u008b\u008c\u008d\u008e\u008f" + // 0x88-0x8f
    "\u0090\u2018\u2019\u201c\u201d\u2022\u2013\u2014" + // 0x90-0x97
    "\u0098\u0099\u009a\u009b\u009c\u009d\u009e\u009f" + // 0x98-0x9f
    "\u00a0\u0e01\u0e02\u0e03\u0e04\u0e05\u0e06\u0e07" + // 0xa0-0xa7
    "\u0e08\u0e09\u0e0a\u0e0b\u0e0c\u0e0d\u0e0e\u0e0f" + // 0xa8-0xaf
    "\u0e10\u0e11\u0e12\u0e13\u0e14\u0e15\u0e16\u0e17" + // 0xb0-0xb7
    "\u0e18\u0e19\u0e1a\u0e1b\u0e1c\u0e1d\u0e1e\u0e1f" + // 0xb8-0xbf
    "\u0e20\u0e21\u0e22\u0e23\u0e24\u0e25\u0e26\u0e27" + // 0xc0-0xc7
    "\u0e28\u0e29\u0e2a\u0e2b\u0e2c\u0e2d\u0e2e\u0e2f" + // 0xc8-0xcf
    "\u0e30\u0e31\u0e32\u0e33\u0e34\u0e35\u0e36\u0e37" + // 0xd0-0xd7
    "\u0e38\u0e39\u0e3a\ufffd\ufffd\ufffd\ufffd\u0e3f" + // 0xd8-0xdf
    "\u0e40\u0e41\u0e42\u0e43\u0e44\u0e45\u0e46\u0e47" + // 0xe0-0xe7
    "\u0e48\u0e49\u0e4a\u0e4b\u0e4c\u0e4d\u0e4e\u0e4f" + // 0xe8-0xef
    "\u0e50\u0e51\u0e52\u0e53\u0e54\u0e55\u0e56\u0e57" + // 0xf0-0xf7
    "\u0e58\u0e59\u0e5a\u0e5b\ufffd\ufffd\ufffd\ufffd", // 0xf8-0xff
  "windows-1250":
    "\u20ac\u0081\u201a\u0083\u201e\u2026\u2020\u2021" + // 0x80-0x87
    "\u0088\u2030\u0160\u2039\u015a\u0164\u017d\u0179" + // 0x88-0x8f
    "\u0090\u2018\u2019\u201c\u201d\u2022\u2013\u2014" + // 0x90-0x97
    "\u0098\u2122\u0161\u203a\u015b\u0165\u017e\u017a" + // 0x98-0x9f
    "\u00a0\u02c7\u02d8\u0141\u00a4\u0104\u00a6\u00a7" + // 0xa0-0xa7
    "\u00a8\u00a9\u015e\u00ab\u00ac\u00ad\u00ae\u017b" + // 0xa8-0xaf
    "\u00b0\u00b1\u02db\u0142\u00b4\u00b5\u00b6\u00b7" + // 0xb0-0xb7
    "\u00b8\u0105\u015f\u00bb\u013d\u02dd\u013e\u017c" + // 0xb8-0xbf
    "\u0154\u00c1\u00c2\u0102\u00c4\u0139\u0106\u00c7" + // 0xc0-0xc7
    "\u010c\u00c9\u0118\u00cb\u011a\u00cd\u00ce\u010e" + // 0xc8-0xcf
    "\u0110\u0143\u0147\u00d3\u00d4\u0150\u00d6\u00d7" + // 0xd0-0xd7
    "\u0158\u016e\u00da\u0170\u00dc\u00dd\u0162\u00df" + // 0xd8-0xdf
    "\u0155\u00e1\u00e2\u0103\u00e4\u013a\u0107\u00e7" + // 0xe0-0xe7
    "\u010d\u00e9\u0119\u00eb\u011b\u00ed\u00ee\u010f" + // 0xe8-0xef
    "\u0111\u0144\u0148\u00f3\u00f4\u0151\u00f6\u00f7" + // 0xf0-0xf7
    "\u0159\u016f\u00fa\u0171\u00fc\u00fd\u0163\u02d9", // 0xf8-0xff
  "windows-1251":
    "\u0402\u0403\u201a\u0453\u201e\u2026\u2020\u2021" + // 0x80-0x87
    "\u20ac\u2030\u0409\u2039\u040a\u040c\u040b\u040f" + // 0x88-0x8f
    "\u0452\u2018\u2019\u201c\u201d\u2022\u2013\u2014" + // 0x90-0x97
    "\u0098\u2122\u0459\u203a\u045a\u045c\u045b\u045f" + // 0x98-0x9f
    "\u00a0\u040e\u045e\u0408\u00a4\u0490\u00a6\u00a7" + // 0xa0-0xa7
    "\u0401\u00a9\u0404\u00ab\u00ac\u00ad\u00ae\u0407" + // 0xa8-0xaf
    "\u00b0\u00b1\u0406\u0456\u0491\u00b5\u00b6\u00b7" + // 0xb0-0xb7
    "\u0451\u2116\u0454\u00bb\u0458\u0405\u0455\u0457" + // 0xb8-0xbf
    "\u0410\u0411\u0412\u0413\u0414\u0415\u0416\u0417" + // 0xc0-0xc7
    "\u0418\u0419\u041a\u041b\u041c\u041d\u041e\u041f" + // 0xc8-0xcf
    "\u0420\u0421\u0422\u0423\u0424\u0425\u0426\u0427" + // 0xd0-0xd7
    "\u0428\u0429\u042a\u042b\u042c\u042d\u042e\u042f" + // 0xd8-0xdf
    "\u0430\u0431\u0432\u0433\u0434\u0435\u0436\u0437" + // 0xe0-0xe7
    "\u0438\u0439\u043a\u043b\u043c\u043d\u043e\u043f" + // 0xe8-0xef
    "\u0440\u0441\u0442\u0443\u0444\u0445\u0446\u0447" + // 0xf0-0xf7
    "\u0448\u0449\u044a\u044b\u044c\u044d\u044e\u044f", // 0xf8-0xff
  "windows-1253":
    "\u20ac\u0081\u201a\u0192\u201e\u2026\u2020\u2021" + // 0x80-0x87
    "\u0088\u2030\u008a\u2039\u008c\u008d\u008e\u008f" + // 0x88-0x8f
    "\u0090\u2018\u2019\u201c\u201d\u2022\u2013\u2014" + // 0x90-0x97
    "\u0098\u2122\u009a\u203a\u009c\u009d\u009e\u009f" + // 0x98-0x9f
    "\u00a0\u0385\u0386\u00a3\u00a4\u00a5\u00a6\u00a7" + // 0xa0-0xa7
    "\u00a8\u00a9\ufffd\u00ab\u00ac\u00ad\u00ae\u2015" + // 0xa8-0xaf
    "\u00b0\u00b1\u00b2\u00b3\u0384\u00b5\u00b6\u00b7" + // 0xb0-0xb7
    "\u0388\u0389\u038a\u00bb\u038c\u00bd\u038e\u038f" + // 0xb8-0xbf
    "\u0390\u0391\u0392\u0393\u0394\u0395\u0396\u0397" + // 0xc0-0xc7
    "\u0398\u0399\u039a\u039b\u039c\u039d\u039e\u039f" + // 0xc8-0xcf
    "\u03a0\u03a1\ufffd\u03a3\u03a4\u03a5\u03a6\u03a7" + // 0xd0-0xd7
    "\u03a8\u03a9\u03aa\u03ab\u03ac\u03ad\u03ae\u03af" + // 0xd8-0xdf
    "\u03b0\u03b1\u03b2\u03b3\u03b4\u03b5\u03b6\u03b7" + // 0xe0-0xe7
    "\u03b8\u03b9\u03ba\u03bb\u03bc\u03bd\u03be\u03bf" + // 0xe8-0xef
    "\u03c0\u03c1\u03c2\u03c3\u03c4\u03c5\u03c6\u03c7" + // 0xf0-0xf7
    "\u03c8\u03c9\u03ca\u03cb\u03cc\u03cd\u03ce\ufffd", // 0xf8-0xff
  "windows-1254":
    "\u20ac\u0081\u201a\u0192\u201e\u2026\u2020\u2021" + // 0x80-0x87
    "\u02c6\u2030\u0160\u2039\u0152\u008d\u008e\u008f" + // 0x88-0x8f
    "\u0090\u2018\u2019\u201c\u201d\u2022\u2013\u2014" + // 0x90-0x97
    "\u02dc\u2122\u0161\u203a\u0153\u009d\u009e\u0178" + // 0x98-0x9f
    "\u00a0\u00a1\u00a2\u00a3\u00a4\u00a5\u00a6\u00a7" + // 0xa0-0xa7
    "\u00a8\u00a9\u00aa\u00ab\u00ac\u00ad\u00ae\u00af" + // 0xa8-0xaf
    "\u00b0\u00b1\u00b2\u00b3\u00b4\u00b5\u00b6\u00b7" + // 0xb0-0xb7
    "\u00b8\u00b9\u00ba\u00bb\u00bc\u00bd\u00be\u00bf" + // 0xb8-0xbf
    "\u00c0\u00c1\u00c2\u00c3\u00c4\u00c5\u00c6\u00c7" + // 0xc0-0xc7
    "\u00c8\u00c9\u00ca\u00cb\u00cc\u00cd\u00ce\u00cf" + // 0xc8-0xcf
    "\u011e\u00d1\u00d2\u00d3\u00d4\u00d5\u00d6\u00d7" + // 0xd0-0xd7
    "\u00d8\u00d9\u00da\u00db\u00dc\u0130\u015e\u00df" + // 0xd8-0xdf
    "\u00e0\u00e1\u00e2\u00e3\u00e4\u00e5\u00e6\u00e7" + // 0xe0-0xe7
    "\u00e8\u00e9\u00ea\u00eb\u00ec\u00ed\u00ee\u00ef" + // 0xe8-0xef
    "\u011f\u00f1\u00f2\u00f3\u00f4\u00f5\u00f6\u00f7" + // 0xf0-0xf7
    "\u00f8\u00f9\u00fa\u00fb\u00fc\u0131\u015f\u00ff", // 0xf8-0xff
  "windows-1255":
    "\u20ac\u0081\u201a\u0192\u201e\u2026\u2020\u2021" + // 0x80-0x87
    "\u02c6\u2030\u008a\u2039\u008c\u008d\u008e\u008f" + // 0x88-0x8f
    "\u0090\u2018\u2019\u201c\u201d\u2022\u2013\u2014" + // 0x90-0x97
    "\u02dc\u2122\u009a\u203a\u009c\u009d\u009e\u009f" + // 0x98-0x9f
    "\u00a0\u00a1\u00a2\u00a3\u20aa\u00a5\u00a6\u00a7" + // 0xa0-0xa7
    "\u00a8\u00a9\u00d7\u00ab\u00ac\u00ad\u00ae\u00af" + // 0xa8-0xaf
    "\u00b0\u00b1\u00b2\u00b3\u00b4\u00b5\u00b6\u00b7" + // 0xb0-0xb7
    "\u00b8\u00b9\u00f7\u00bb\u00bc\u00bd\u00be\u00bf" + // 0xb8-0xbf
    "\u05b0\u05b1\u05b2\u05b3\u05b4\u05b5\u05b6\u05b7" + // 0xc0-0xc7
    "\u05b8\u05b9\u05ba\u05bb\u05bc\u05bd\u05be\u05bf" + // 0xc8-0xcf
    "\u05c0\u05c1\u05c2\u05c3\u05f0\u05f1\u05f2\u05f3" + // 0xd0-0xd7
    "\u05f4\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd" + // 0xd8-0xdf
    "\u05d0\u05d1\u05d2\u05d3\u05d4\u05d5\u05d6\u05d7" + // 0xe0-0xe7
    "\u05d8\u05d9\u05da\u05db\u05dc\u05dd\u05de\u05df" + // 0xe8-0xef
    "\u05e0\u05e1\u05e2\u05e3\u05e4\u05e5\u05e6\u05e7" + // 0xf0-0xf7
    "\u05e8\u05e9\u05ea\ufffd\ufffd\u200e\u200f\ufffd", // 0xf8-0xff
  "windows-1256":
    "\u20ac\u067e\u201a\u0192\u201e\u2026\u2020\u2021" + // 0x80-0x87
    "\u02c6\u2030\u0679\u2039\u0152\u0686\u0698\u0688" + // 0x88-0x8f
    "\u06af\u2018\u2019\u201c\u201d\u2022\u2013\u2014" + // 0x90-0x97
    "\u06a9\u2122\u0691\u203a\u0153\u200c\u200d\u06ba" + // 0x98-0x9f
    "\u00a0\u060c\u00a2\u00a3\u00a4\u00a5\u00a6\u00a7" + // 0xa0-0xa7
    "\u00a8\u00a9\u06be\u00ab\u00ac\u00ad\u00ae\u00af" + // 0xa8-0xaf
    "\u00b0\u00b1\u00b2\u00b3\u00b4\u00b5\u00b6\u00b7" + // 0xb0-0xb7
    "\u00b8\u00b9\u061b\u00bb\u00bc\u00bd\u00be\u061f" + // 0xb8-0xbf
    "\u06c1\u0621\u0622\u0623\u0624\u0625\u0626\u0627" + // 0xc0-0xc7
    "\u0628\u0629\u062a\u062b\u062c\u062d\u062e\u062f" + // 0xc8-0xcf
    "\u0630\u0631\u0632\u0633\u0634\u0635\u0636\u00d7" + // 0xd0-0xd7
    "\u0637\u0638\u0639\u063a\u0640\u0641\u0642\u0643" + // 0xd8-0xdf
    "\u00e0\u0644\u00e2\u0645\u0646\u0647\u0648\u00e7" + // 0xe0-0xe7
    "\u00e8\u00e9\u00ea\u00eb\u0649\u064a\u00ee\u00ef" + // 0xe8-0xef
    "\u064b\u064c\u064d\u064e\u00f4\u064f\u0650\u00f7" + // 0xf0-0xf7
    "\u0651\u00f9\u0652\u00fb\u00fc\u200e\u200f\u06d2", // 0xf8-0xff
  "windows-1257":
    "\u20ac\u0081\u201a\u0083\u201e\u2026\u2020\u2021" + // 0x80-0x87
    "\u0088\u2030\u008a\u2039\u008c\u00a8\u02c7\u00b8" + // 0x88-0x8f
    "\u0090\u2018\u2019\u201c\u201d\u2022\u2013\u2014" + // 0x90-0x97
    "\u0098\u2122\u009a\u203a\u009c\u00af\u02db\u009f" + // 0x98-0x9f
    "\u00a0\ufffd\u00a2\u00a3\u00a4\ufffd\u00a6\u00a7" + // 0xa0-0xa7
    "\u00d8\u00a9\u0156\u00ab\u00ac\u00ad\u00ae\u00c6" + // 0xa8-0xaf
    "\u00b0\u00b1\u00b2\u00b3\u00b4\u00b5\u00b6\u00b7" + // 0xb0-0xb7
    "\u00f8\u00b9\u0157\u00bb\u00bc\u00bd\u00be\u00e6" + // 0xb8-0xbf
    "\u0104\u012e\u0100\u0106\u00c4\u00c5\u0118\u0112" + // 0xc0-0xc7
    "\u010c\u00c9\u0179\u0116\u0122\u0136\u012a\u013b" + // 0xc8-0xcf
    "\u0160\u0143\u0145\u00d3\u014c\u00d5\u00d6\u00d7" + // 0xd0-0xd7
    "\u0172\u0141\u015a\u016a\u00dc\u017b\u017d\u00df" + // 0xd8-0xdf
    "\u0105\u012f\u0101\u0107\u00e4\u00e5\u0119\u0113" + // 0xe0-0xe7
    "\u010d\u00e9\u017a\u0117\u0123\u0137\u012b\u013c" + // 0xe8-0xef
    "\u0161\u0144\u0146\u00f3\u014d\u00f5\u00f6\u00f7" + // 0xf0-0xf7
    "\u0173\u0142\u015b\u016b\u00fc\u017c\u017e\u02d9", // 0xf8-0xff
  "windows-1258":
    "\u20ac\u0081\u201a\u0192\u201e\u2026\u2020\u2021" + // 0x80-0x87
    "\u02c6\u2030\u008a\u2039\u0152\u008d\u008e\u008f" + // 0x88-0x8f
    "\u0090\u2018\u2019\u201c\u201d\u2022\u2013\u2014" + // 0x90-0x97
    "\u02dc\u2122\u009a\u203a\u0153\u009d\u009e\u0178" + // 0x98-0x9f
    "\u00a0\u00a1\u00a2\u00a3\u00a4\u00a5\u00a6\u00a7" + // 0xa0-0xa7
    "\u00a8\u00a9\u00aa\u00ab\u00ac\u00ad\u00ae\u00af" + // 0xa8-0xaf
    "\u00b0\u00b1\u00b2\u00b3\u00b4\u00b5\u00b6\u00b7" + // 0xb0-0xb7
    "\u00b8\u00b9\u00ba\u00bb\u00bc\u00bd\u00be\u00bf" + // 0xb8-0xbf
    "\u00c0\u00c1\u00c2\u0102\u00c4\u00c5\u00c6\u00c7" + // 0xc0-0xc7
    "\u00c8\u00c9\u00ca\u00cb\u0300\u00cd\u00ce\u00cf" + // 0xc8-0xcf
    "\u0110\u00d1\u0309\u00d3\u00d4\u01a0\u00d6\u00d7" + // 0xd0-0xd7
    "\u00d8\u00d9\u00da\u00db\u00dc\u01af\u0303\u00df" + // 0xd8-0xdf
    "\u00e0\u00e1\u00e2\u0103\u00e4\u00e5\u00e6\u00e7" + // 0xe0-0xe7
    "\u00e8\u00e9\u00ea\u00eb\u0301\u00ed\u00ee\u00ef" + // 0xe8-0xef
    "\u0111\u00f1\u0323\u00f3\u00f4\u01a1\u00f6\u00f7" + // 0xf0-0xf7
    "\u00f8\u00f9\u00fa\u00fb\u00fc\u01b0\u20ab\u00ff", // 0xf8-0xff
  "x-mac-cyrillic":
    "\u0410\u0411\u0412\u0413\u0414\u0415\u0416\u0417" + // 0x80-0x87
    "\u0418\u0419\u041a\u041b\u041c\u041d\u041e\u041f" + // 0x88-0x8f
    "\u0420\u0421\u0422\u0423\u0424\u0425\u0426\u0427" + // 0x90-0x97
    "\u0428\u0429\u042a\u042b\u042c\u042d\u042e\u042f" + // 0x98-0x9f
    "\u2020\u00b0\u0490\u00a3\u00a7\u2022\u00b6\u0406" + // 0xa0-0xa7
    "\u00ae\u00a9\u2122\u0402\u0452\u2260\u0403\u0453" + // 0xa8-0xaf
    "\u221e\u00b1\u2264\u2265\u0456\u00b5\u0491\u0408" + // 0xb0-0xb7
    "\u0404\u0454\u0407\u0457\u0409\u0459\u040a\u045a" + // 0xb8-0xbf
    "\u0458\u0405\u00ac\u221a\u0192\u2248\u2206\u00ab" + // 0xc0-0xc7
    "\u00bb\u2026\u00a0\u040b\u045b\u040c\u045c\u0455" + // 0xc8-0xcf
    "\u2013\u2014\u201c\u201d\u2018\u2019\u00f7\u201e" + // 0xd0-0xd7
    "\u040e\u045e\u040f\u045f\u2116\u0401\u0451\u044f" + // 0xd8-0xdf
    "\u0430\u0431\u0432\u0433\u0434\u0435\u0436\u0437" + // 0xe0-0xe7
    "\u0438\u0439\u043a\u043b\u043c\u043d\u043e\u043f" + // 0xe8-0xef
    "\u0440\u0441\u0442\u0443\u0444\u0445\u0446\u0447" + // 0xf0-0xf7
    "\u0448\u0449\u044a\u044b\u044c\u044d\u044e\u20ac", // 0xf8-0xff
};
