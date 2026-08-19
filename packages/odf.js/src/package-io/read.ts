import type { Package } from '../model/package';
import { bytesToBase64 } from '../util/base64';
import { parseXml } from '../xml/parse';
import { unzipPackage } from '../zip';

export function parsePackage(bytes: Uint8Array<ArrayBuffer>): Package {
  const entries = unzipPackage(bytes);
  const parts: Package['parts'] = {};
  for (const [path, partBytes] of Object.entries(entries)) {
    if (looksLikeXml(partBytes)) {
      const xml = new TextDecoder('utf-8').decode(partBytes);
      parts[path] = { kind: 'xml', nodes: parseXml(xml) };
    } else {
      parts[path] = { kind: 'binary', base64: bytesToBase64(partBytes) };
    }
  }
  return { parts };
}

// An XML part (after any BOM/whitespace) starts with '<'; no standard ODF binary part (png, jpeg, embedded font, embedded object, thumbnail, ...) starts with '<', so a misclassification only ever stores an XML part losslessly as base64 -- it never misparses a binary part.
function looksLikeXml(bytes: Uint8Array<ArrayBuffer>): boolean {
  let i = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    i = 3;
  }
  while (i < bytes.length) {
    const b = bytes[i]!;
    if (b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d) {
      i = i + 1;
      continue;
    }
    return b === 0x3c;
  }
  return false;
}
