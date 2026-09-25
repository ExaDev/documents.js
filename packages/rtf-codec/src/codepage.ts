// Byte-to-character decoding for RTF's ANSI layer: the half of the format that predates \uN and that every real-world document still uses for its ordinary text.
//
// RTF reaches a code page by three routes the specification defines (RTF 1.9.1, "Character Set" and "Font Table"), and they compose in a fixed precedence:
//
//  1. The document keyword: \ansi (cp1252 in practice), \mac (Mac Roman), \pc (cp437), \pca (cp850). \ansi is the default when none is stated.
//  2. \ansicpgN, "the default ANSI code page used to perform the Unicode to ANSI conversion when writing RTF text ... The reader can use the same ANSI code page to convert ANSI text back to Unicode", emitted right after the keyword above and overriding it.
//  3. The font's own page, for text in a run tagged with a \fN: "runs of text marked with a particular font index use the codepage for that font as given by \cpgN or implied by \fcharsetN". \cpgN supersedes \fcharsetN, and both supersede the document page for that run's own bytes.
//
// FCHARSET_CODEPAGES below is the spec's own charset-to-codepage table, transcribed from the \fcharsetN entry.
//
// The tables in SINGLE_BYTE_PAGES were GENERATED, not typed: each is `bytes([b]).decode(codec)` over 0x80..0xFF from Python's own codec library, because a hand-transcribed 128-entry table is exactly where one transposed character hides until a real document decodes wrong. Bytes 0x00..0x7F are US-ASCII in every page here and are mapped directly rather than stored. A byte a page genuinely leaves undefined decodes as U+FFFD, which is what its own table says, rather than an invented mapping.
//
// The five East Asian DBCS pages (932 Shift-JIS, 936 GBK/GB2312, 949 UHC/Hangul, 950 Big5, 1361 Johab) are supported too, through DBCS_LEAD_BYTE_TABLES and DBCS_SINGLE_BYTE_EXTRAS in ./codepage-dbcs.ts — generated the same way and by the same script's own header comment (scripts/generate-dbcs-tables.py) for the full citation and cross-validation notes.
//
// One deliberate gap remains, reported rather than silently papered over: code page 42 (SYMBOL_CHARSET, what \fcharset2 names) is not a character encoding at all — its bytes are glyph indices into whichever symbol font the run names, and the spec's own advice is to "find the last SYMBOL_CHARSET font control word \fN used, look up font N in the font table and find the face name" to know which. Without the font's own cmap there is no correct Unicode for those bytes, so they decode through cp1252 and report rtf/unsupported-codepage, so a caller sees the gap instead of receiving plausible-looking mojibake.
//
// UTF-8 (\ansicpg65001, which RichEdit and some non-Word producers emit) IS supported, through the platform's own TextDecoder. That is why this module decodes a byte RUN rather than one byte at a time: a stateful multi-byte encoding cannot be decoded byte-by-byte, and the reader accordingly buffers consecutive ANSI bytes and flushes them here at the first event that is not another byte. The DBCS pages share that same run-buffered entry point rather than adding one of their own — a DBCS lead byte and its trail byte can arrive in the same run as ordinary single-byte characters either side of it, so the run itself, not the byte, is still the unit a codepage decodes.

import { RtfDiagnosticCodes } from "./diagnostics";
import type { RtfDiagnosticSink } from "./diagnostics";
import {
  DBCS_LEAD_BYTE_TABLES,
  DBCS_SINGLE_BYTE_EXTRAS,
} from "./codepage-dbcs";

export const DEFAULT_CODEPAGE = 1252;
export const UTF8_CODEPAGE = 65001;

// The single-byte OEM/Windows/Mac code pages SINGLE_BYTE_PAGES decodes, named by each page's own standard Microsoft designation, the same number an RTF \ansicpgN/\cpgN control word or \ansi/\pc/\pca document keyword names (see this module's own header). DEFAULT_CODEPAGE above already names 1252 (Windows Latin 1, \ansi's own default); SINGLE_BYTE_PAGES reuses it below rather than redeclaring it.
const CODEPAGE_437_OEM_US = 437; // OEM United States (MS-DOS Latin US), \pc's own default page.
const CODEPAGE_819_ISO_LATIN1 = 819; // ISO 8859-1 Latin I.
const CODEPAGE_850_OEM_MULTILINGUAL_LATIN1 = 850; // OEM Multilingual Latin I, \pca's own default page.
const CODEPAGE_852_OEM_LATIN2 = 852; // OEM Latin II (Central European).
const CODEPAGE_860_OEM_PORTUGUESE = 860;
const CODEPAGE_862_OEM_HEBREW = 862;
const CODEPAGE_863_OEM_FRENCH_CANADIAN = 863;
const CODEPAGE_865_OEM_NORDIC = 865;
const CODEPAGE_866_OEM_RUSSIAN = 866;
const CODEPAGE_874_WINDOWS_THAI = 874;
const CODEPAGE_1250_WINDOWS_CENTRAL_EUROPEAN = 1250;
const CODEPAGE_1251_WINDOWS_CYRILLIC = 1251;
const CODEPAGE_1253_WINDOWS_GREEK = 1253;
const CODEPAGE_1254_WINDOWS_TURKISH = 1254;
const CODEPAGE_1255_WINDOWS_HEBREW = 1255;
const CODEPAGE_1256_WINDOWS_ARABIC = 1256;
const CODEPAGE_1257_WINDOWS_BALTIC = 1257;
const CODEPAGE_1258_WINDOWS_VIETNAMESE = 1258;
const CODEPAGE_10000_MAC_ROMAN = 10000; // \mac's own default page.
const CODEPAGE_10006_MAC_GREEK = 10006;
const CODEPAGE_10007_MAC_CYRILLIC = 10007;
const CODEPAGE_10029_MAC_CENTRAL_EUROPEAN = 10029; // Mac Latin 2.
const CODEPAGE_10081_MAC_TURKISH = 10081;

const SINGLE_BYTE_PAGES: ReadonlyMap<number, string> = new Map([
  [
    CODEPAGE_437_OEM_US,
    "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ",
  ],
  [
    CODEPAGE_819_ISO_LATIN1,
    " ¡¢£¤¥¦§¨©ª«¬­®¯°±²³´µ¶·¸¹º»¼½¾¿ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõö÷øùúûüýþÿ",
  ],
  [
    CODEPAGE_850_OEM_MULTILINGUAL_LATIN1,
    "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´­±‗¾¶§÷¸°¨·¹³²■ ",
  ],
  [
    CODEPAGE_852_OEM_LATIN2,
    "ÇüéâäůćçłëŐőîŹÄĆÉĹĺôöĽľŚśÖÜŤťŁ×čáíóúĄąŽžĘę¬źČş«»░▒▓│┤ÁÂĚŞ╣║╗╝Żż┐└┴┬├─┼Ăă╚╔╩╦╠═╬¤đĐĎËďŇÍÎě┘┌█▄ŢŮ▀ÓßÔŃńňŠšŔÚŕŰýÝţ´­˝˛ˇ˘§÷¸°¨˙űŘř■ ",
  ],
  [
    CODEPAGE_860_OEM_PORTUGUESE,
    "ÇüéâãàÁçêÊèÍÔìÃÂÉÀÈôõòÚùÌÕÜ¢£Ù₧ÓáíóúñÑªº¿Ò¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ",
  ],
  [
    CODEPAGE_862_OEM_HEBREW,
    "אבגדהוזחטיךכלםמןנסעףפץצקרשת¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ",
  ],
  [
    CODEPAGE_863_OEM_FRENCH_CANADIAN,
    "ÇüéâÂà¶çêëèïî‗À§ÉÈÊôËÏûù¤ÔÜ¢£ÙÛƒ¦´óú¨¸³¯Î⌐¬½¼¾«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ",
  ],
  [
    CODEPAGE_865_OEM_NORDIC,
    "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø₧ƒáíóúñÑªº¿⌐¬½¼¡«¤░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ",
  ],
  [
    CODEPAGE_866_OEM_RUSSIAN,
    "АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмноп░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀рстуфхцчшщъыьэюяЁёЄєЇїЎў°∙·√№¤■ ",
  ],
  [
    CODEPAGE_874_WINDOWS_THAI,
    "€����…�����������‘’“”•–—�������� กขฃคฅฆงจฉชซฌญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรฤลฦวศษสหฬอฮฯะัาำิีึืฺุู����฿เแโใไๅๆ็่้๊๋์ํ๎๏๐๑๒๓๔๕๖๗๘๙๚๛����",
  ],
  [
    CODEPAGE_1250_WINDOWS_CENTRAL_EUROPEAN,
    "€�‚�„…†‡�‰Š‹ŚŤŽŹ�‘’“”•–—�™š›śťžź ˇ˘Ł¤Ą¦§¨©Ş«¬­®Ż°±˛ł´µ¶·¸ąş»Ľ˝ľżŔÁÂĂÄĹĆÇČÉĘËĚÍÎĎĐŃŇÓÔŐÖ×ŘŮÚŰÜÝŢßŕáâăäĺćçčéęëěíîďđńňóôőö÷řůúűüýţ˙",
  ],
  [
    CODEPAGE_1251_WINDOWS_CYRILLIC,
    "ЂЃ‚ѓ„…†‡€‰Љ‹ЊЌЋЏђ‘’“”•–—�™љ›њќћџ ЎўЈ¤Ґ¦§Ё©Є«¬­®Ї°±Ііґµ¶·ё№є»јЅѕїАБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмнопрстуфхцчшщъыьэюя",
  ],
  [
    DEFAULT_CODEPAGE,
    "€�‚ƒ„…†‡ˆ‰Š‹Œ�Ž��‘’“”•–—˜™š›œ�žŸ ¡¢£¤¥¦§¨©ª«¬­®¯°±²³´µ¶·¸¹º»¼½¾¿ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõö÷øùúûüýþÿ",
  ],
  [
    CODEPAGE_1253_WINDOWS_GREEK,
    "€�‚ƒ„…†‡�‰�‹�����‘’“”•–—�™�›���� ΅Ά£¤¥¦§¨©�«¬­®―°±²³΄µ¶·ΈΉΊ»Ό½ΎΏΐΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡ�ΣΤΥΦΧΨΩΪΫάέήίΰαβγδεζηθικλμνξοπρςστυφχψωϊϋόύώ�",
  ],
  [
    CODEPAGE_1254_WINDOWS_TURKISH,
    "€�‚ƒ„…†‡ˆ‰Š‹Œ����‘’“”•–—˜™š›œ��Ÿ ¡¢£¤¥¦§¨©ª«¬­®¯°±²³´µ¶·¸¹º»¼½¾¿ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏĞÑÒÓÔÕÖ×ØÙÚÛÜİŞßàáâãäåæçèéêëìíîïğñòóôõö÷øùúûüışÿ",
  ],
  [
    CODEPAGE_1255_WINDOWS_HEBREW,
    "€�‚ƒ„…†‡ˆ‰�‹�����‘’“”•–—˜™�›���� ¡¢£₪¥¦§¨©×«¬­®¯°±²³´µ¶·¸¹÷»¼½¾¿ְֱֲֳִֵֶַָֹ�ֻּֽ־ֿ׀ׁׂ׃װױײ׳״�������אבגדהוזחטיךכלםמןנסעףפץצקרשת��‎‏�",
  ],
  [
    CODEPAGE_1256_WINDOWS_ARABIC,
    "€پ‚ƒ„…†‡ˆ‰ٹ‹Œچژڈگ‘’“”•–—ک™ڑ›œ‌‍ں ،¢£¤¥¦§¨©ھ«¬­®¯°±²³´µ¶·¸¹؛»¼½¾؟ہءآأؤإئابةتثجحخدذرزسشصض×طظعغـفقكàلâمنهوçèéêëىيîïًٌٍَôُِ÷ّùْûü‎‏ے",
  ],
  [
    CODEPAGE_1257_WINDOWS_BALTIC,
    "€�‚�„…†‡�‰�‹�¨ˇ¸�‘’“”•–—�™�›�¯˛� �¢£¤�¦§Ø©Ŗ«¬­®Æ°±²³´µ¶·ø¹ŗ»¼½¾æĄĮĀĆÄÅĘĒČÉŹĖĢĶĪĻŠŃŅÓŌÕÖ×ŲŁŚŪÜŻŽßąįāćäåęēčéźėģķīļšńņóōõö÷ųłśūüżž˙",
  ],
  [
    CODEPAGE_1258_WINDOWS_VIETNAMESE,
    "€�‚ƒ„…†‡ˆ‰�‹Œ����‘’“”•–—˜™�›œ��Ÿ ¡¢£¤¥¦§¨©ª«¬­®¯°±²³´µ¶·¸¹º»¼½¾¿ÀÁÂĂÄÅÆÇÈÉÊË̀ÍÎÏĐÑ̉ÓÔƠÖ×ØÙÚÛÜỮßàáâăäåæçèéêë́íîïđṇ̃óôơö÷øùúûüư₫ÿ",
  ],
  [
    CODEPAGE_10000_MAC_ROMAN,
    "ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»… ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ",
  ],
  [
    CODEPAGE_10006_MAC_GREEK,
    "Ä¹²É³ÖÜ΅àâä΄¨çéèêë£™îï•½‰ôö¦€ùûü†ΓΔΘΛΞΠß®©ΣΪ§≠°·Α±≤≥¥ΒΕΖΗΙΚΜΦΫΨΩάΝ¬ΟΡ≈Τ«»… ΥΧΆΈœ–―“”‘’÷ΉΊΌΎέήίόΏύαβψδεφγηιξκλμνοπώρστθωςχυζϊϋΐΰ­",
  ],
  [
    CODEPAGE_10007_MAC_CYRILLIC,
    "АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ†°Ґ£§•¶І®©™Ђђ≠Ѓѓ∞±≤≥іµґЈЄєЇїЉљЊњјЅ¬√ƒ≈∆«»… ЋћЌќѕ–—“”‘’÷„ЎўЏџ№Ёёяабвгдежзийклмнопрстуфхцчшщъыьэю€",
  ],
  [
    CODEPAGE_10029_MAC_CENTRAL_EUROPEAN,
    "ÄĀāÉĄÖÜáąČäčĆćéŹźĎíďĒēĖóėôöõúĚěü†°Ę£§•¶ß®©™ę¨≠ģĮįĪ≤≥īĶ∂∑łĻļĽľĹĺŅņŃ¬√ńŇ∆«»… ňŐÕőŌ–—“”‘’÷◊ōŔŕŘ‹›řŖŗŠ‚„šŚśÁŤťÍŽžŪÓÔūŮÚůŰűŲųÝýķŻŁżĢˇ",
  ],
  [
    CODEPAGE_10081_MAC_TURKISH,
    "ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»… ÀÃÕŒœ–—“”‘’÷◊ÿŸĞğİıŞş‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔÒÚÛÙˆ˜¯˘˙˚¸˝˛ˇ",
  ],
]);

// The specification's own \fcharsetN table (RTF 1.9.1, "Font Table"), charset to code page. Charset 1 ("Default") maps to code page 0 there, meaning "whatever the system default is", which for a reader is the document's own page rather than a page of its own — so it is absent here and a font declaring it simply inherits.
// Codepages named here only by FCHARSET_CODEPAGES below: Mac charsets this module has no single-byte table for (they route through DBCS_LEAD_BYTE_TABLES or, for 42, report unsupported per this module's own header), plus the five DBCS pages FCHARSET_CODEPAGES also names by number.
const CODEPAGE_42_SYMBOL = 42; // SYMBOL_CHARSET — not a character encoding at all; see this module's own header.
const CODEPAGE_10001_MAC_JAPANESE = 10001;
const CODEPAGE_10002_MAC_TRADITIONAL_CHINESE = 10002;
const CODEPAGE_10003_MAC_KOREAN = 10003;
const CODEPAGE_10004_MAC_ARABIC = 10004;
const CODEPAGE_10005_MAC_HEBREW = 10005;
const CODEPAGE_10008_MAC_SIMPLIFIED_CHINESE = 10008;
const CODEPAGE_10021_MAC_THAI = 10021;
const CODEPAGE_932_SHIFT_JIS = 932;
const CODEPAGE_936_GBK = 936;
const CODEPAGE_949_UHC = 949;
const CODEPAGE_950_BIG5 = 950;
const CODEPAGE_1361_JOHAB = 1361;

// The RTF spec's own \fcharsetN values (RTF 1.9.1, "Font Table"), named per the spec's own table: the Mac-specific range (77-89) names a Mac script rather than a Windows LOGFONT charset constant, and the rest match the LOGFONT CharSet values of the same name. FCHARSET_ANSI (0) and FCHARSET_SYMBOL (2) need no named constant: both are below this rule's own ignore threshold (-1, 0, 1, 2) and are used bare in the Map below.
const FCHARSET_MAC_ROMAN = 77;
const FCHARSET_MAC_SHIFT_JIS = 78; // Mac Japanese.
const FCHARSET_MAC_HANGUL = 79; // Mac Korean.
const FCHARSET_MAC_GB2312 = 80; // Mac Simplified Chinese.
const FCHARSET_MAC_BIG5 = 81; // Mac Traditional Chinese.
const FCHARSET_MAC_HEBREW = 83;
const FCHARSET_MAC_ARABIC = 84;
const FCHARSET_MAC_GREEK = 85;
const FCHARSET_MAC_TURKISH = 86;
const FCHARSET_MAC_THAI = 87;
const FCHARSET_MAC_EASTEUROPE = 88; // Mac Central European (Mac Latin 2).
const FCHARSET_MAC_RUSSIAN = 89; // Mac Cyrillic.
const FCHARSET_SHIFTJIS = 128;
const FCHARSET_HANGUL = 129;
const FCHARSET_JOHAB = 130;
const FCHARSET_GB2312 = 134;
const FCHARSET_CHINESEBIG5 = 136;
const FCHARSET_GREEK = 161;
const FCHARSET_TURKISH = 162;
const FCHARSET_VIETNAMESE = 163;
const FCHARSET_HEBREW = 177;
const FCHARSET_ARABIC = 178;
const FCHARSET_BALTIC = 186;
const FCHARSET_RUSSIAN = 204;
const FCHARSET_THAI = 222;
const FCHARSET_EASTEUROPE = 238;
const FCHARSET_PC437 = 254;
const FCHARSET_OEM = 255;

const FCHARSET_CODEPAGES: ReadonlyMap<number, number> = new Map([
  [0, DEFAULT_CODEPAGE],
  [2, CODEPAGE_42_SYMBOL],
  [FCHARSET_MAC_ROMAN, CODEPAGE_10000_MAC_ROMAN],
  [FCHARSET_MAC_SHIFT_JIS, CODEPAGE_10001_MAC_JAPANESE],
  [FCHARSET_MAC_HANGUL, CODEPAGE_10003_MAC_KOREAN],
  [FCHARSET_MAC_GB2312, CODEPAGE_10008_MAC_SIMPLIFIED_CHINESE],
  [FCHARSET_MAC_BIG5, CODEPAGE_10002_MAC_TRADITIONAL_CHINESE],
  [FCHARSET_MAC_HEBREW, CODEPAGE_10005_MAC_HEBREW],
  [FCHARSET_MAC_ARABIC, CODEPAGE_10004_MAC_ARABIC],
  [FCHARSET_MAC_GREEK, CODEPAGE_10006_MAC_GREEK],
  [FCHARSET_MAC_TURKISH, CODEPAGE_10081_MAC_TURKISH],
  [FCHARSET_MAC_THAI, CODEPAGE_10021_MAC_THAI],
  [FCHARSET_MAC_EASTEUROPE, CODEPAGE_10029_MAC_CENTRAL_EUROPEAN],
  [FCHARSET_MAC_RUSSIAN, CODEPAGE_10007_MAC_CYRILLIC],
  [FCHARSET_SHIFTJIS, CODEPAGE_932_SHIFT_JIS],
  [FCHARSET_HANGUL, CODEPAGE_949_UHC],
  [FCHARSET_JOHAB, CODEPAGE_1361_JOHAB],
  [FCHARSET_GB2312, CODEPAGE_936_GBK],
  [FCHARSET_CHINESEBIG5, CODEPAGE_950_BIG5],
  [FCHARSET_GREEK, CODEPAGE_1253_WINDOWS_GREEK],
  [FCHARSET_TURKISH, CODEPAGE_1254_WINDOWS_TURKISH],
  [FCHARSET_VIETNAMESE, CODEPAGE_1258_WINDOWS_VIETNAMESE],
  [FCHARSET_HEBREW, CODEPAGE_1255_WINDOWS_HEBREW],
  [FCHARSET_ARABIC, CODEPAGE_1256_WINDOWS_ARABIC],
  [FCHARSET_BALTIC, CODEPAGE_1257_WINDOWS_BALTIC],
  [FCHARSET_RUSSIAN, CODEPAGE_1251_WINDOWS_CYRILLIC],
  [FCHARSET_THAI, CODEPAGE_874_WINDOWS_THAI],
  [FCHARSET_EASTEUROPE, CODEPAGE_1250_WINDOWS_CENTRAL_EUROPEAN],
  [FCHARSET_PC437, CODEPAGE_437_OEM_US],
  [FCHARSET_OEM, CODEPAGE_850_OEM_MULTILINGUAL_LATIN1],
]);

// The four document-level character-set keywords and the pages they name, per the spec's own <character set> production.
export const DOCUMENT_CHARSET_CODEPAGES: ReadonlyMap<string, number> = new Map([
  ["ansi", DEFAULT_CODEPAGE],
  ["mac", CODEPAGE_10000_MAC_ROMAN],
  ["pc", CODEPAGE_437_OEM_US],
  ["pca", CODEPAGE_850_OEM_MULTILINGUAL_LATIN1],
]);

export function codepageForFontCharset(charset: number): number | undefined {
  return FCHARSET_CODEPAGES.get(charset);
}

export function isSupportedCodepage(codepage: number): boolean {
  return (
    codepage === UTF8_CODEPAGE ||
    SINGLE_BYTE_PAGES.has(codepage) ||
    DBCS_LEAD_BYTE_TABLES.has(codepage)
  );
}

// Decodes one run of ANSI bytes through `codepage`. A run, not a byte, because \ansicpg65001 is UTF-8 and a stateful multi-byte encoding cannot be decoded a byte at a time — see this module's own header.
//
// An unsupported page decodes through cp1252 and reports rtf/unsupported-codepage once per run rather than throwing: the rest of the document is still readable, and cp1252 agrees with every supported page on the ASCII range, so a document whose non-ASCII content is incidental still reads correctly. The sink is what makes that visible instead of silent. An empty input needs no dedicated fast path: TextDecoder.decode, the DBCS state machine, and the single-byte for-of loop below all already produce "" on their own for zero bytes, with no codepage lookup or diagnostic ever triggered along the way.
// The first byte value SINGLE_BYTE_PAGES/DBCS_LEAD_BYTE_TABLES/DBCS_SINGLE_BYTE_EXTRAS cover (0x80-0xFF): every byte below this is plain US-ASCII, decoded directly via String.fromCharCode rather than a table lookup — see this module's own header.
const HIGH_BYTE_MIN = 0x80;

export function decodeCodepageBytes(
  input: Uint8Array,
  codepage: number,
  sink: RtfDiagnosticSink,
): string {
  if (codepage === UTF8_CODEPAGE) {
    return new TextDecoder("utf-8").decode(input);
  }
  const leadTable = DBCS_LEAD_BYTE_TABLES.get(codepage);
  if (leadTable !== undefined) {
    return decodeDbcsBytes(input, codepage, leadTable);
  }
  const table = SINGLE_BYTE_PAGES.get(codepage);
  if (table === undefined) {
    sink({
      code: RtfDiagnosticCodes.UNSUPPORTED_CODEPAGE,
      severity: "warning",
      message: `code page ${String(codepage)} is not supported; decoding this run through code page ${String(DEFAULT_CODEPAGE)} instead`,
    });
    return decodeCodepageBytes(input, DEFAULT_CODEPAGE, sink);
  }
  let out = "";
  for (const byte of input) {
    // charAt, not a bracket read: every entry in SINGLE_BYTE_PAGES is exactly 128 characters (0x80..0xFF, generated and verified against Python's own codec library — see this module's own header), so `byte - 0x80` is always in range and a `?? "�"` fallback for the bracket-read's own `string | undefined` type would be pretending an unreachable case is real, per this family's no-defensive-over-engineering convention (base64.ts's own bytesToBase64 states the identical charAt-over-bracket-read reasoning).
    out +=
      byte < HIGH_BYTE_MIN
        ? String.fromCharCode(byte)
        : table.charAt(byte - HIGH_BYTE_MIN);
  }
  return out;
}

// The lead-byte state machine a DBCS page needs (see this module's own header): a byte under 0x80 is always ASCII, a byte the page uses as a lead byte consumes the byte after it too (or, at the end of a run with no byte left to consume, decodes alone as U+FFFD — a genuine RTF document never actually splits a DBCS character's two bytes across separate runs, since \'hh escapes and raw bytes both feed the same buffered run this function receives whole), and every other byte is either one of the page's own single-byte extensions (932's halfwidth katakana and a handful of others — see DBCS_SINGLE_BYTE_EXTRAS's own comment in ./codepage-dbcs.ts) or genuinely undefined and decodes as U+FFFD, the same fallback SINGLE_BYTE_PAGES uses above.
function decodeDbcsBytes(
  input: Uint8Array,
  codepage: number,
  leadTable: ReadonlyMap<number, string>,
): string {
  const singleByteExtras = DBCS_SINGLE_BYTE_EXTRAS.get(codepage);
  let out = "";
  let i = 0;
  // No explicit i < input.length bound: i's own step varies (1 or 2 bytes per iteration), but a Uint8Array index at or past its own length always reads back undefined rather than throwing, so the byte === undefined check below is already the one true stopping condition — a separate length comparison would only ever fire in lockstep with it.
  for (;;) {
    const byte = input[i];
    if (byte === undefined) {
      break;
    }
    if (byte < HIGH_BYTE_MIN) {
      out += String.fromCharCode(byte);
      i += 1;
      continue;
    }
    const trailTable = leadTable.get(byte);
    if (trailTable !== undefined) {
      const trail = input[i + 1];
      // charAt, not a bracket read: trailTable is always a dense 256-character string (DBCS_LEAD_BYTE_TABLES's own header comment), so a trail byte (0x00-0xFF) is always in range, and a `?? "�"` fallback for the bracket-read's own `string | undefined` type would be pretending an unreachable case is real — the same reasoning decodeCodepageBytes's own single-byte loop already states for SINGLE_BYTE_PAGES.
      out += trail === undefined ? "�" : trailTable.charAt(trail);
      // Always 2, even when trail is undefined: trail is only ever undefined when i + 1 is already past input's own end, meaning i was already the last index — advancing by 1 or by 2 from there both land past input.length either way, so there is no real pair left to skip over by advancing the full 2.
      i += 2;
      continue;
    }
    // charAt, not a bracket read, for the identical reason: DBCS_SINGLE_BYTE_EXTRAS's own header comment states each entry is a dense 128-character string, so byte - 0x80 is always in range once singleByteExtras itself is known to exist.
    out +=
      singleByteExtras === undefined
        ? "�"
        : singleByteExtras.charAt(byte - HIGH_BYTE_MIN);
    i += 1;
  }
  return out;
}
