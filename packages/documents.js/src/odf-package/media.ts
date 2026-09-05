import type { Package } from "odf.js";
import { bytesToBase64 } from "odf.js";
import { syncOdfManifest } from "./manifest";

// The real-world ODF convention for image parts -- LibreOffice writes every raster image into a package-root "Pictures/" directory, referenced by draw:image's own xlink:href with no indirection. Confirmed directly against odf.js's own round-trip and manifest fixtures (src/round-trip.test.ts, src/manifest.test.ts, src/typed/odp/read.test.ts), which all use "Pictures/image1.png"-shaped paths -- odf.js's own manifest.ts even calls out "Pictures/" by name as a directory that must never get a synthesized manifest:file-entry of its own (only the individual image parts inside it do).
const PICTURES_DIR = "Pictures";

export interface AddedOdfMedia {
  readonly partPath: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Mirrors src/opc/media.ts's own nextMediaIndex -- scans existing Pictures/ part paths for the given extension and returns one past the highest index found, so successive images never collide even if an earlier one was later removed.
function nextPictureIndex(pkg: Package, extension: string): number {
  const pattern = new RegExp(`^image(\\d+)\\.${escapeRegExp(extension)}$`);
  const prefix = `${PICTURES_DIR}/`;
  let max = 0;
  for (const path of Object.keys(pkg.parts)) {
    if (!path.startsWith(prefix)) {
      continue;
    }
    const match = pattern.exec(path.slice(prefix.length));
    if (match === null) {
      continue;
    }
    const digits = match[1];
    if (digits === undefined) {
      continue;
    }
    const n = Number.parseInt(digits, 10);
    if (n > max) {
      max = n;
    }
  }
  return max + 1;
}

// Atomically inserts a binary image part under Pictures/ and keeps META-INF/manifest.xml in sync with it -- the two package-level effects a new ODF image needs. This is one step simpler than OOXML's addImageMedia (src/opc/media.ts): ODF has no relationship file to also allocate, since a caller references the returned part path directly via xlink:href rather than through an r:id indirection. The format-specific draw:frame/draw:image fragment that references partPath is left to its own caller (a future editor layer), mirroring how src/opc/media.ts also leaves the w:drawing/p:pic fragment to its own callers.
//
// Manifest sync is delegated whole to syncOdfManifest (this file's own manifest.ts, over odf.js's build+write pair) rather than hand-appending a single manifest:file-entry: buildManifest already resolves a binary part's media type by sniffing its actual bytes (odf.js's own resolvePartMediaType falls back to sniffImageFormat for an unrecognised extension), so re-deriving the whole manifest from the package's current parts is both correct and the only way to add this one entry without duplicating that sniffing logic here. Going through syncOdfManifest rather than odf.js's own syncManifest is what keeps that re-derivation from blanking an embedded sub-document's own directory entry (a formula object, say) on the way past -- see that function's own comment. This requires the package to already carry a "mimetype" part (via setDocumentMediaType or an equivalent) -- buildManifest has no way to guess a document's own ODF variant from its parts alone, and throws a clear error if neither a mimetype part nor a documentMediaType override is available.
export function addImageMedia(
  pkg: Package,
  imageBytes: Uint8Array<ArrayBuffer>,
  format: "png" | "jpeg" | "svg" | "gif",
): AddedOdfMedia {
  const index = nextPictureIndex(pkg, format);
  const partPath = `${PICTURES_DIR}/image${index}.${format}`;
  pkg.parts[partPath] = { kind: "binary", base64: bytesToBase64(imageBytes) };
  syncOdfManifest(pkg);
  return { partPath };
}
