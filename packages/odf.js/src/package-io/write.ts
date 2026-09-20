import type { Package, Part } from "../model/package";
import { base64ToBytes } from "byte-codec";
import { buildXml } from "../xml/build";
import { zipPackage, type ZipEntry } from "../zip";

// Exported so mimetype.ts and manifest.ts -- the ODF-domain modules that own these two parts' content -- reference the same path literals rather than re-declaring them. This module stays the canonical, foundational home for the two path constants because it is the one place their exact spelling is load-bearing for byte layout (the mimetype-first-stored hoist below).
export const MIMETYPE_PART = "mimetype";
export const MANIFEST_PART = "META-INF/manifest.xml";

// The zip entry order serializePackage below actually writes in: "mimetype" first if present, then META-INF/manifest.xml if present, then every other part in the Package's own existing key order -- with each hoisted path EXCLUDED from that final group by construction (a filter predicate, not a delete-then-iterate step some part of the pipeline could skip), so a hoisted path can never also appear a second time among "every other part". Exported (and returning bare paths rather than the built ZipEntry values) so a test can pin this ordering-and-exclusion logic directly, independent of zipPackage's own object-keyed Zippable structure silently collapsing a same-path duplicate into one entry regardless of whether this function ever produced one.
export function orderedPackagePartPaths(pkg: Package): string[] {
  const paths = Object.keys(pkg.parts);
  const hoisted = [MIMETYPE_PART, MANIFEST_PART].filter((path) =>
    paths.includes(path),
  );
  const rest = paths.filter((path) => !hoisted.includes(path));
  return [...hoisted, ...rest];
}

// Serializes a Package back to zip bytes. This is the one deliberate behavioural difference from a generic zip-of-XML writer: ODF requires the "mimetype" part to be the very first zip entry, stored uncompressed (see zip.ts), so it hoists that part first if present, then META-INF/manifest.xml next if present, then every remaining part in the Package's own existing key order -- see orderedPackagePartPaths above for that ordering itself. It never fabricates a mimetype or manifest.xml part that doesn't already exist in the input -- that belongs to a later phase's manifest-construction logic, not this lossless zip<->Package mapping, which stays a pure, honest round trip with no side effects.
export function serializePackage(pkg: Package): Uint8Array<ArrayBuffer> {
  const entries: [string, ZipEntry][] = orderedPackagePartPaths(pkg).map(
    (path) => {
      const part = pkg.parts[path]!;
      return [
        path,
        { bytes: partToBytes(part), stored: path === MIMETYPE_PART },
      ];
    },
  );
  return zipPackage(entries);
}

function partToBytes(part: Part): Uint8Array<ArrayBuffer> {
  switch (part.kind) {
    case "xml":
      return new TextEncoder().encode(buildXml(part.nodes));
    case "binary":
      return base64ToBytes(part.base64);
  }
}
