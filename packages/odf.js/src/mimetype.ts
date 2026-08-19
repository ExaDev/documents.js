import type { Package } from './model/package';
import { MIMETYPE_PART } from './package-io/write';
import { base64ToBytes, bytesToBase64 } from './util/base64';

// Reads the raw "mimetype" part's bytes as a UTF-8 string, or undefined if the package has no mimetype part at all (or if that part was somehow parsed as XML rather than binary, which no valid mimetype content -- a bare media-type string -- would ever trigger). Returns undefined rather than throwing: a package with no mimetype part is malformed ODF, but reading that absence is not itself an error this function needs to report.
export function readMimetype(pkg: Package): string | undefined {
  const part = pkg.parts[MIMETYPE_PART];
  if (part?.kind !== 'binary') {
    return undefined;
  }
  return new TextDecoder('utf-8').decode(base64ToBytes(part.base64));
}

// Sets (or replaces) the package's "mimetype" part to exactly the ASCII bytes of mediaType -- no trailing newline, no BOM, no XML declaration -- matching the ODF Packages spec's fixed-byte-offset requirement for this part (see package-io/write.ts's mimetype-first-stored hoist and test-support/zip.ts's assertMimetypeEntryLayout).
export function writeMimetype(pkg: Package, mediaType: string): void {
  pkg.parts[MIMETYPE_PART] = { kind: 'binary', base64: bytesToBase64(new TextEncoder().encode(mediaType)) };
}
