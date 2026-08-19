import type { Package } from '../../model/package';

// A synthetic sub-Package view over an embedded ODF sub-document's own directory inside a larger package. An embedded sub-document (a .odb's forms/<PersistentName>/ or reports/<PersistentName>/ directory; a .odt's "Object 1/" embedded Math object) is a COMPLETE, self-contained ODF document whose parts happen to be stored under a path prefix rather than at the package root -- content.xml, styles.xml, settings.xml and meta.xml all sit at "<prefix>/content.xml" and friends, exactly as they would at the root of a standalone file. Re-keying those parts relative to the prefix therefore produces a genuine Package that every existing typed reader in this package (readOdtContent, readOdsContent, readOdpContent, readOdgContent, readOdfFormulaMathMl) accepts unmodified, with no sub-document-aware variant of any of them needed.
//
// This is deliberately a plain re-keying of the SAME Part values (not a deep copy): a Part is treated as immutable by every reader here, and copying a large binary part's base64 for no reason would be pure waste. Nothing outside the prefix is carried over -- notably NOT the outer package's own META-INF/manifest.xml, which describes the OUTER package and would be actively misleading inside the sub-package (its entries are all outer-package-relative paths). A sub-document that ships its own manifest under "<prefix>/META-INF/manifest.xml" gets it re-keyed like any other part; real LibreOffice .odb output does not write one (a real form sub-document directory holds content.xml, styles.xml, settings.xml, manifest.rdf and an empty Configurations2/ entry, and nothing else -- see typed/odb/form.ts's own top-of-file note).

export interface SubDocumentPackageOptions {
  // When true, a prefix with no "<prefix>/content.xml" part still returns an (possibly empty) Package rather than throwing. Off by default: every caller in this package wants a readable sub-document, and a missing content.xml means the reference is broken, which is worth surfacing loudly rather than degrading to an empty package a downstream reader would then throw about less clearly.
  allowMissingContent?: boolean;
}

const CONTENT_PART = 'content.xml';

// Every part of `pkg` stored under `prefix` (with or without a trailing slash), re-keyed relative to it. Throws when the prefix holds no content.xml at all, unless allowMissingContent is set.
export function subDocumentPackage(pkg: Package, prefix: string, options: SubDocumentPackageOptions = {}): Package {
  const normalised = prefix.endsWith('/') ? prefix : `${prefix}/`;
  const parts: Record<string, Package['parts'][string]> = {};
  for (const [path, part] of Object.entries(pkg.parts)) {
    if (!path.startsWith(normalised)) {
      continue;
    }
    const relative = path.slice(normalised.length);
    if (relative.length > 0) {
      parts[relative] = part;
    }
  }
  if (options.allowMissingContent !== true && parts[CONTENT_PART] === undefined) {
    throw new Error(`subDocumentPackage: package has no ${normalised}${CONTENT_PART} part`);
  }
  return { parts };
}
