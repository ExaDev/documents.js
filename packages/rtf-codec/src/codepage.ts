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
// The five East Asian DBCS pages (932 Shift-JIS, 936 GBK/GB2312, 949 UHC/Hangul, 950 Big5, 1361 Johab) are supported too, through DBCS_LEAD_BYTE_TABLES and DBCS_SINGLE_BYTE_EXTRAS in ./codepage-dbcs.ts -- generated the same way and by the same script's own header comment (scripts/generate-dbcs-tables.py) for the full citation and cross-validation notes.
//
// One deliberate gap remains, reported rather than silently papered over: code page 42 (SYMBOL_CHARSET, what \fcharset2 names) is not a character encoding at all -- its bytes are glyph indices into whichever symbol font the run names, and the spec's own advice is to "find the last SYMBOL_CHARSET font control word \fN used, look up font N in the font table and find the face name" to know which. Without the font's own cmap there is no correct Unicode for those bytes, so they decode through cp1252 and report rtf/unsupported-codepage, so a caller sees the gap instead of receiving plausible-looking mojibake.
//
// UTF-8 (\ansicpg65001, which RichEdit and some non-Word producers emit) IS supported, through the platform's own TextDecoder. That is why this module decodes a byte RUN rather than one byte at a time: a stateful multi-byte encoding cannot be decoded byte-by-byte, and the reader accordingly buffers consecutive ANSI bytes and flushes them here at the first event that is not another byte. The DBCS pages share that same run-buffered entry point rather than adding one of their own -- a DBCS lead byte and its trail byte can arrive in the same run as ordinary single-byte characters either side of it, so the run itself, not the byte, is still the unit a codepage decodes.

import { RtfDiagnosticCodes } from "./diagnostics";
import type { RtfDiagnosticSink } from "./diagnostics";
import {
  DBCS_LEAD_BYTE_TABLES,
  DBCS_SINGLE_BYTE_EXTRAS,
} from "./codepage-dbcs";

export const DEFAULT_CODEPAGE = 1252;
export const UTF8_CODEPAGE = 65001;

const SINGLE_BYTE_PAGES: ReadonlyMap<number, string> = new Map([
  [
    437,
    "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ",
  ],
  [
    819,
    " ¡¢£¤¥¦§¨©ª«¬­®¯°±²³´µ¶·¸¹º»¼½¾¿ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõö÷øùúûüýþÿ",
  ],
  [
    850,
    "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´­±‗¾¶§÷¸°¨·¹³²■ ",
  ],
  [
    852,
    "ÇüéâäůćçłëŐőîŹÄĆÉĹĺôöĽľŚśÖÜŤťŁ×čáíóúĄąŽžĘę¬źČş«»░▒▓│┤ÁÂĚŞ╣║╗╝Żż┐└┴┬├─┼Ăă╚╔╩╦╠═╬¤đĐĎËďŇÍÎě┘┌█▄ŢŮ▀ÓßÔŃńňŠšŔÚŕŰýÝţ´­˝˛ˇ˘§÷¸°¨˙űŘř■ ",
  ],
  [
    860,
    "ÇüéâãàÁçêÊèÍÔìÃÂÉÀÈôõòÚùÌÕÜ¢£Ù₧ÓáíóúñÑªº¿Ò¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ",
  ],
  [
    862,
    "אבגדהוזחטיךכלםמןנסעףפץצקרשת¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ",
  ],
  [
    863,
    "ÇüéâÂà¶çêëèïî‗À§ÉÈÊôËÏûù¤ÔÜ¢£ÙÛƒ¦´óú¨¸³¯Î⌐¬½¼¾«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ",
  ],
  [
    865,
    "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø₧ƒáíóúñÑªº¿⌐¬½¼¡«¤░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ",
  ],
  [
    866,
    "АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмноп░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀рстуфхцчшщъыьэюяЁёЄєЇїЎў°∙·√№¤■ ",
  ],
  [
    874,
    "€����…�����������‘’“”•–—�������� กขฃคฅฆงจฉชซฌญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรฤลฦวศษสหฬอฮฯะัาำิีึืฺุู����฿เแโใไๅๆ็่้๊๋์ํ๎๏๐๑๒๓๔๕๖๗๘๙๚๛����",
  ],
  [
    1250,
    "€�‚�„…†‡�‰Š‹ŚŤŽŹ�‘’“”•–—�™š›śťžź ˇ˘Ł¤Ą¦§¨©Ş«¬­®Ż°±˛ł´µ¶·¸ąş»Ľ˝ľżŔÁÂĂÄĹĆÇČÉĘËĚÍÎĎĐŃŇÓÔŐÖ×ŘŮÚŰÜÝŢßŕáâăäĺćçčéęëěíîďđńňóôőö÷řůúűüýţ˙",
  ],
  [
    1251,
    "ЂЃ‚ѓ„…†‡€‰Љ‹ЊЌЋЏђ‘’“”•–—�™љ›њќћџ ЎўЈ¤Ґ¦§Ё©Є«¬­®Ї°±Ііґµ¶·ё№є»јЅѕїАБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмнопрстуфхцчшщъыьэюя",
  ],
  [
    1252,
    "€�‚ƒ„…†‡ˆ‰Š‹Œ�Ž��‘’“”•–—˜™š›œ�žŸ ¡¢£¤¥¦§¨©ª«¬­®¯°±²³´µ¶·¸¹º»¼½¾¿ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõö÷øùúûüýþÿ",
  ],
  [
    1253,
    "€�‚ƒ„…†‡�‰�‹�����‘’“”•–—�™�›���� ΅Ά£¤¥¦§¨©�«¬­®―°±²³΄µ¶·ΈΉΊ»Ό½ΎΏΐΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡ�ΣΤΥΦΧΨΩΪΫάέήίΰαβγδεζηθικλμνξοπρςστυφχψωϊϋόύώ�",
  ],
  [
    1254,
    "€�‚ƒ„…†‡ˆ‰Š‹Œ����‘’“”•–—˜™š›œ��Ÿ ¡¢£¤¥¦§¨©ª«¬­®¯°±²³´µ¶·¸¹º»¼½¾¿ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏĞÑÒÓÔÕÖ×ØÙÚÛÜİŞßàáâãäåæçèéêëìíîïğñòóôõö÷øùúûüışÿ",
  ],
  [
    1255,
    "€�‚ƒ„…†‡ˆ‰�‹�����‘’“”•–—˜™�›���� ¡¢£₪¥¦§¨©×«¬­®¯°±²³´µ¶·¸¹÷»¼½¾¿ְֱֲֳִֵֶַָֹ�ֻּֽ־ֿ׀ׁׂ׃װױײ׳״�������אבגדהוזחטיךכלםמןנסעףפץצקרשת��‎‏�",
  ],
  [
    1256,
    "€پ‚ƒ„…†‡ˆ‰ٹ‹Œچژڈگ‘’“”•–—ک™ڑ›œ‌‍ں ،¢£¤¥¦§¨©ھ«¬­®¯°±²³´µ¶·¸¹؛»¼½¾؟ہءآأؤإئابةتثجحخدذرزسشصض×طظعغـفقكàلâمنهوçèéêëىيîïًٌٍَôُِ÷ّùْûü‎‏ے",
  ],
  [
    1257,
    "€�‚�„…†‡�‰�‹�¨ˇ¸�‘’“”•–—�™�›�¯˛� �¢£¤�¦§Ø©Ŗ«¬­®Æ°±²³´µ¶·ø¹ŗ»¼½¾æĄĮĀĆÄÅĘĒČÉŹĖĢĶĪĻŠŃŅÓŌÕÖ×ŲŁŚŪÜŻŽßąįāćäåęēčéźėģķīļšńņóōõö÷ųłśūüżž˙",
  ],
  [
    1258,
    "€�‚ƒ„…†‡ˆ‰�‹Œ����‘’“”•–—˜™�›œ��Ÿ ¡¢£¤¥¦§¨©ª«¬­®¯°±²³´µ¶·¸¹º»¼½¾¿ÀÁÂĂÄÅÆÇÈÉÊË̀ÍÎÏĐÑ̉ÓÔƠÖ×ØÙÚÛÜỮßàáâăäåæçèéêë́íîïđṇ̃óôơö÷øùúûüư₫ÿ",
  ],
  [
    10000,
    "ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»… ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ",
  ],
  [
    10006,
    "Ä¹²É³ÖÜ΅àâä΄¨çéèêë£™îï•½‰ôö¦€ùûü†ΓΔΘΛΞΠß®©ΣΪ§≠°·Α±≤≥¥ΒΕΖΗΙΚΜΦΫΨΩάΝ¬ΟΡ≈Τ«»… ΥΧΆΈœ–―“”‘’÷ΉΊΌΎέήίόΏύαβψδεφγηιξκλμνοπώρστθωςχυζϊϋΐΰ­",
  ],
  [
    10007,
    "АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ†°Ґ£§•¶І®©™Ђђ≠Ѓѓ∞±≤≥іµґЈЄєЇїЉљЊњјЅ¬√ƒ≈∆«»… ЋћЌќѕ–—“”‘’÷„ЎўЏџ№Ёёяабвгдежзийклмнопрстуфхцчшщъыьэю€",
  ],
  [
    10029,
    "ÄĀāÉĄÖÜáąČäčĆćéŹźĎíďĒēĖóėôöõúĚěü†°Ę£§•¶ß®©™ę¨≠ģĮįĪ≤≥īĶ∂∑łĻļĽľĹĺŅņŃ¬√ńŇ∆«»… ňŐÕőŌ–—“”‘’÷◊ōŔŕŘ‹›řŖŗŠ‚„šŚśÁŤťÍŽžŪÓÔūŮÚůŰűŲųÝýķŻŁżĢˇ",
  ],
  [
    10081,
    "ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»… ÀÃÕŒœ–—“”‘’÷◊ÿŸĞğİıŞş‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔÒÚÛÙˆ˜¯˘˙˚¸˝˛ˇ",
  ],
]);

// The specification's own \fcharsetN table (RTF 1.9.1, "Font Table"), charset to code page. Charset 1 ("Default") maps to code page 0 there, meaning "whatever the system default is", which for a reader is the document's own page rather than a page of its own -- so it is absent here and a font declaring it simply inherits.
const FCHARSET_CODEPAGES: ReadonlyMap<number, number> = new Map([
  [0, 1252],
  [2, 42],
  [77, 10000],
  [78, 10001],
  [79, 10003],
  [80, 10008],
  [81, 10002],
  [83, 10005],
  [84, 10004],
  [85, 10006],
  [86, 10081],
  [87, 10021],
  [88, 10029],
  [89, 10007],
  [128, 932],
  [129, 949],
  [130, 1361],
  [134, 936],
  [136, 950],
  [161, 1253],
  [162, 1254],
  [163, 1258],
  [177, 1255],
  [178, 1256],
  [186, 1257],
  [204, 1251],
  [222, 874],
  [238, 1250],
  [254, 437],
  [255, 850],
]);

// The four document-level character-set keywords and the pages they name, per the spec's own <character set> production.
export const DOCUMENT_CHARSET_CODEPAGES: ReadonlyMap<string, number> = new Map([
  ["ansi", 1252],
  ["mac", 10000],
  ["pc", 437],
  ["pca", 850],
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

// Decodes one run of ANSI bytes through `codepage`. A run, not a byte, because \ansicpg65001 is UTF-8 and a stateful multi-byte encoding cannot be decoded a byte at a time -- see this module's own header.
//
// An unsupported page decodes through cp1252 and reports rtf/unsupported-codepage once per run rather than throwing: the rest of the document is still readable, and cp1252 agrees with every supported page on the ASCII range, so a document whose non-ASCII content is incidental still reads correctly. The sink is what makes that visible instead of silent.
export function decodeCodepageBytes(
  input: Uint8Array,
  codepage: number,
  sink: RtfDiagnosticSink,
): string {
  if (input.length === 0) {
    return "";
  }
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
    // charAt, not a bracket read: every entry in SINGLE_BYTE_PAGES is exactly 128 characters (0x80..0xFF, generated and verified against Python's own codec library -- see this module's own header), so `byte - 0x80` is always in range and a `?? "�"` fallback for the bracket-read's own `string | undefined` type would be pretending an unreachable case is real, per this family's no-defensive-over-engineering convention (base64.ts's own bytesToBase64 states the identical charAt-over-bracket-read reasoning).
    out += byte < 0x80 ? String.fromCharCode(byte) : table.charAt(byte - 0x80);
  }
  return out;
}

// The lead-byte state machine a DBCS page needs (see this module's own header): a byte under 0x80 is always ASCII, a byte the page uses as a lead byte consumes the byte after it too (or, at the end of a run with no byte left to consume, decodes alone as U+FFFD -- a genuine RTF document never actually splits a DBCS character's two bytes across separate runs, since \'hh escapes and raw bytes both feed the same buffered run this function receives whole), and every other byte is either one of the page's own single-byte extensions (932's halfwidth katakana and a handful of others -- see DBCS_SINGLE_BYTE_EXTRAS's own comment in ./codepage-dbcs.ts) or genuinely undefined and decodes as U+FFFD, the same fallback SINGLE_BYTE_PAGES uses above.
function decodeDbcsBytes(
  input: Uint8Array,
  codepage: number,
  leadTable: ReadonlyMap<number, string>,
): string {
  const singleByteExtras = DBCS_SINGLE_BYTE_EXTRAS.get(codepage);
  let out = "";
  let i = 0;
  while (i < input.length) {
    const byte = input[i];
    if (byte === undefined) {
      break;
    }
    if (byte < 0x80) {
      out += String.fromCharCode(byte);
      i += 1;
      continue;
    }
    const trailTable = leadTable.get(byte);
    if (trailTable !== undefined) {
      const trail = input[i + 1];
      out += trail === undefined ? "�" : (trailTable[trail] ?? "�");
      i += trail === undefined ? 1 : 2;
      continue;
    }
    out += singleByteExtras?.[byte - 0x80] ?? "�";
    i += 1;
  }
  return out;
}
