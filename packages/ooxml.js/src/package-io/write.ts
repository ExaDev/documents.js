import type { Package, Part } from '../model/package';
import { base64ToBytes } from '../util/base64';
import { buildXml } from '../xml/build';
import { zipPackage } from '../zip';

export function serializePackage(pkg: Package): Uint8Array<ArrayBuffer> {
  const entries: Record<string, Uint8Array<ArrayBuffer>> = {};
  for (const [path, part] of Object.entries(pkg.parts)) {
    entries[path] = partToBytes(part);
  }
  return zipPackage(entries);
}

function partToBytes(part: Part): Uint8Array<ArrayBuffer> {
  switch (part.kind) {
    case 'xml':
      return new TextEncoder().encode(buildXml(part.nodes));
    case 'binary':
      return base64ToBytes(part.base64);
  }
}
