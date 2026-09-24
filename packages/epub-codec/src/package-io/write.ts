import type { EpubPackage, Part } from "../model/package";
import { OCF_MIMETYPE_PATH } from "../format";
import { base64ToBytes } from "byte-codec";
import { buildXml } from "../xml/build";
import { zipPackage, type ZipEntry } from "../zip";

// Serializes an EpubPackage back to zip bytes. This is the one deliberate behavioural difference from a generic zip-of-XML writer: OCF requires the "mimetype" part to be the very first zip entry, stored uncompressed (EPUB 3.3 section 6.3, and see zip.ts's own ordered-entries contract), so it hoists that part first if present, then every remaining part in the Package's own existing key order — mirroring odf.js's identical ODF Packages mimetype-first hoist exactly, the same requirement in a different container format. It never fabricates a mimetype part that doesn't already exist in the input — that belongs to a later phase's package-construction logic (src/write.ts's own buildEpubPackageFromContent), not this lossless zip<->Package mapping, which stays a pure, honest round trip with no side effects.
export function serializePackage(pkg: EpubPackage): Uint8Array<ArrayBuffer> {
  const remaining = new Map(Object.entries(pkg.parts));
  const entries: [string, ZipEntry][] = [];

  const mimetype = remaining.get(OCF_MIMETYPE_PATH);
  if (mimetype !== undefined) {
    entries.push([
      OCF_MIMETYPE_PATH,
      { bytes: partToBytes(mimetype), stored: true },
    ]);
    remaining.delete(OCF_MIMETYPE_PATH);
  }

  for (const [path, part] of remaining) {
    entries.push([path, { bytes: partToBytes(part) }]);
  }

  return zipPackage(entries);
}

function partToBytes(part: Part): Uint8Array<ArrayBuffer> {
  switch (part.kind) {
    case "xml":
      return new TextEncoder().encode(buildXml(part.nodes));
    case "binary":
      return base64ToBytes(part.base64);
  }
  return assertNeverPart(part);
}

// The same per-part decode serializePackage uses, exposed as a plain entries Record rather than zip bytes — src/read.ts's own readEpubInternal is the one caller, reconstituting the exact Record<string, Uint8Array> shape unzipPackage used to hand it (mimetype/container.xml/OPF/XHTML content) so its own existing entries[path]-keyed reading logic needs no further change once bytes flow through decodePackage first. This does mean an XML part already parsed once by parsePackage is serialised back to a string here and re-parsed again by whichever of src/opf, src/nav, or src/xhtml reads it next — a real, deliberate cost accepted to keep this refactor's blast radius to "decodePackage first, encodePackage last" rather than threading EpubPackage's own parsed XmlNode[] through every one of those modules' own string-based entry points.
export function packageToEntries(
  pkg: EpubPackage,
): Record<string, Uint8Array<ArrayBuffer>> {
  const entries: Record<string, Uint8Array<ArrayBuffer>> = {};
  for (const [path, part] of Object.entries(pkg.parts)) {
    entries[path] = partToBytes(part);
  }
  return entries;
}

// Reached only if the union behind `part` ever gains a member partToBytes's own switch does not match: every current member has a case there, so `part` narrows to `never` at the call, and adding an uncovered member makes that narrowing fail and the call stop compiling. Exists so the switch's own exhaustiveness, proven by the type checker rather than by a catch-all default that would silently emit nothing for a genuinely new member, still gives consistent-return an explicit statement to see past the switch. Exported so a test can exercise the throw directly with a forced-invalid cast, since it is otherwise unreachable.
export function assertNeverPart(value: never): never {
  throw new Error(`epub-codec: unhandled part ${JSON.stringify(value)}`);
}
