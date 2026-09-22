import type { EpubPackage } from "../model/package";
import { bytesToBase64 } from "byte-codec";
import { parseXml } from "../xml/parse";
import { unzipPackage } from "../zip";

export function parsePackage(bytes: Uint8Array<ArrayBuffer>): EpubPackage {
  return packageFromEntries(unzipPackage(bytes));
}

// The classify-and-parse half of parsePackage, split out for a caller that already holds unzipped entries and needs an EpubPackage from them without unzipping a second time — src/read.ts's own readEpubInternal is exactly that caller, mirroring ooxml.js's own identical packageFromEntries/parsePackage split.
export function packageFromEntries(
  entries: Record<string, Uint8Array<ArrayBuffer>>,
): EpubPackage {
  const parts: EpubPackage["parts"] = {};
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

// An XML part (after any BOM/whitespace) starts with '<'; no standard EPUB binary part (png, jpeg, gif, svg's own raster fallback, embedded font, audio, video, ...) starts with '<' — SVG itself is XML and is correctly classified as such — so a misclassification only ever stores an XML part losslessly as base64, it never misparses a binary part. Mirrors ooxml.js's and odf.js's own identical sniff exactly.
function looksLikeXml(bytes: Uint8Array<ArrayBuffer>): boolean {
  let i = 0;
  // No separate `bytes.length >= 3` clause: an index past the end of `bytes` reads as undefined, which can never equal one of the three real BOM byte values, so the equality checks alone already reject a too-short array.
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    i = 3;
  }
  // No `i < bytes.length` loop bound, and no separate `b === undefined` early return: bytes[i] reads as undefined once i runs past the end, undefined matches none of the whitespace comparisons below, and `undefined === 0x3c` is false — so the loop's own final `return b === 0x3c` already answers "false" for an end-of-array read exactly like an explicit early return would, making a separate length or undefined check a redundant restatement of it.
  for (;;) {
    const b = bytes[i];
    if (b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d) {
      i = i + 1;
      continue;
    }
    return b === 0x3c;
  }
}
