import type { Package, Part } from '../model/package';
import { base64ToBytes } from '../util/base64';
import { buildXml } from '../xml/build';
import { zipPackage, type ZipEntry } from '../zip';

const MIMETYPE_PART = 'mimetype';
const MANIFEST_PART = 'META-INF/manifest.xml';

// Serializes a Package back to zip bytes. This is the one deliberate behavioural difference from a generic zip-of-XML writer: ODF requires the "mimetype" part to be the very first zip entry, stored uncompressed (see zip.ts), so it hoists that part first if present, then META-INF/manifest.xml next if present, then every remaining part in the Package's own existing key order. It never fabricates a mimetype or manifest.xml part that doesn't already exist in the input -- that belongs to a later phase's manifest-construction logic, not this lossless zip<->Package mapping, which stays a pure, honest round trip with no side effects.
export function serializePackage(pkg: Package): Uint8Array<ArrayBuffer> {
  const remaining = new Map(Object.entries(pkg.parts));
  const entries: [string, ZipEntry][] = [];

  const mimetype = remaining.get(MIMETYPE_PART);
  if (mimetype !== undefined) {
    entries.push([MIMETYPE_PART, { bytes: partToBytes(mimetype), stored: true }]);
    remaining.delete(MIMETYPE_PART);
  }

  const manifest = remaining.get(MANIFEST_PART);
  if (manifest !== undefined) {
    entries.push([MANIFEST_PART, { bytes: partToBytes(manifest) }]);
    remaining.delete(MANIFEST_PART);
  }

  for (const [path, part] of remaining) {
    entries.push([path, { bytes: partToBytes(part) }]);
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
