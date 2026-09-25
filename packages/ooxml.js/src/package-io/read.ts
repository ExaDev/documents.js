import type { Package } from "../model/package";
import { bytesToBase64 } from "byte-codec";
import { parseXml } from "../xml/parse";
import { unzipPackage } from "../zip";

export function parsePackage(bytes: Uint8Array<ArrayBuffer>): Package {
  return packageFromEntries(unzipPackage(bytes));
}

// The classify-and-parse half of parsePackage, split out for a caller that already holds unzipped entries and needs a bounded inflate between the bytes and this step: the embedded-object decode (typed/embedded.ts) walks its payload through archive-codec's guarded walk first, so its entries arrive pre-decompressed and budget-checked rather than coming from this module's own unbounded unzip.
export function packageFromEntries(
  entries: Record<string, Uint8Array<ArrayBuffer>>,
): Package {
  const parts: Package["parts"] = {};
  for (const [path, partBytes] of Object.entries(entries)) {
    if (looksLikeXml(partBytes)) {
      const xml = new TextDecoder("utf-8").decode(partBytes);
      parts[path] = { kind: "xml", nodes: parseXml(xml) };
    } else {
      parts[path] = { kind: "binary", base64: bytesToBase64(partBytes) };
    }
  }
  return { parts };
}

// The three-byte UTF-8 BOM signature (EF BB BF), named byte-by-byte matching this package's own established signature-naming convention (see typed image/sniff.ts).
const UTF8_BOM_BYTE_0 = 0xef;
const UTF8_BOM_BYTE_1 = 0xbb;
const UTF8_BOM_BYTE_2 = 0xbf;
const UTF8_BOM_LENGTH_BYTES = 3;

// The XML-significant whitespace codepoints XML 1.0 SS2.3's own S production permits before the root element's opening '<': space, tab, LF, CR.
const ASCII_SPACE = 0x20;
const ASCII_TAB = 0x09;
const ASCII_LF = 0x0a;
const ASCII_CR = 0x0d;
const ASCII_LESS_THAN = 0x3c;

// An XML part (after any BOM/whitespace) starts with '<'; no standard OOXML binary part (png, jpeg, font, emf, embedded zip, ...) starts with '<', so a misclassification only ever stores an XML part losslessly as base64 — it never misparses a binary part.
function looksLikeXml(bytes: Uint8Array<ArrayBuffer>): boolean {
  let i = 0;
  // No separate length guard needed: bytes[0]/[1]/[2] are each `undefined` for any array shorter than three bytes (an out-of-range index never throws), and undefined can never equal a real BOM byte value — so a short array already fails this comparison on its own.
  if (
    bytes[0] === UTF8_BOM_BYTE_0 &&
    bytes[1] === UTF8_BOM_BYTE_1 &&
    bytes[2] === UTF8_BOM_BYTE_2
  ) {
    i = UTF8_BOM_LENGTH_BYTES;
  }
  // Bounded by the data itself rather than by a separately tracked length: bytes[i] is `undefined` the moment i runs off the end, which fails every comparison in the loop body below and falls through to the same `return false` the length-bounded loop's own normal exit already reached.
  while (bytes[i] !== undefined) {
    const b = bytes[i]!;
    if (
      b === ASCII_SPACE ||
      b === ASCII_TAB ||
      b === ASCII_LF ||
      b === ASCII_CR
    ) {
      i = i + 1;
      continue;
    }
    return b === ASCII_LESS_THAN;
  }
  return false;
}
