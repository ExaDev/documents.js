import type { Package } from "../model/package";
import { bytesToBase64 } from "../util/base64";
import { parseXml } from "../xml/parse";
import { unzipPackage } from "../zip";

export function parsePackage(bytes: Uint8Array<ArrayBuffer>): Package {
  const entries = unzipPackage(bytes);
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

const UTF8_BOM = [0xef, 0xbb, 0xbf] as const;

// Bytes that are insignificant XML whitespace ahead of a document's root element -- space, tab, LF, CR. A Set rather than a chain of `===` comparisons: a byte either belongs to this fixed set or it doesn't, so membership is the one fact worth testing directly, not a boolean tree with its own sub-clauses to pin separately.
const XML_LEADING_WHITESPACE = new Set<number>([0x20, 0x09, 0x0a, 0x0d]);

// `bytes` opens with a literal UTF-8 BOM (EF BB BF), exported for direct testing of its own boundary (a too-short array, a partial match on one or two of the three bytes) rather than only through looksLikeXml's downstream classification, where a wrongly-detected BOM and a correctly-rejected one can otherwise happen to produce the same XML/binary verdict.
export function hasUtf8Bom(bytes: Uint8Array<ArrayBuffer>): boolean {
  return UTF8_BOM.every((byte, index) => bytes[index] === byte);
}

// An XML part (after any BOM/whitespace) starts with '<'; no standard ODF binary part (png, jpeg, embedded font, embedded object, thumbnail, ...) starts with '<', so a misclassification only ever stores an XML part losslessly as base64 -- it never misparses a binary part.
function looksLikeXml(bytes: Uint8Array<ArrayBuffer>): boolean {
  const start = hasUtf8Bom(bytes) ? UTF8_BOM.length : 0;
  for (const b of bytes.subarray(start)) {
    if (XML_LEADING_WHITESPACE.has(b)) {
      continue;
    }
    return b === 0x3c;
  }
  return false;
}
