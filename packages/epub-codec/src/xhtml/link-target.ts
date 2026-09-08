import { dirname, resolvePackagePath } from "../path";

// Resolves an <a href> to the specific in-package (document, fragment) pair it names, or undefined for anything this package cannot resolve to one: an external URI (carries a scheme, RFC 3986 -- the same test src/xhtml/inline.ts's own LINK_TARGET_EXTERNAL_ONLY diagnostic already uses), an empty href, or an href with no fragment at all. The last case is deliberate, not an oversight: document-schema.js's internal `link` target and `anchor` construct both name a specific addressable point in the document, and a bare "chapter2.xhtml" (no "#id") names the whole document, which has no addressable name of its own in this package's vocabulary (ContentSection is a page-geometry container, not a named construct) -- so it is left unresolved here and falls through to this package's existing external-style hyperlink degrade, exactly as before this module existed.
//
// A same-document fragment ("#note1") resolves against sourceHref itself; any other href resolves its own path portion against sourceHref's own directory via src/path.ts's resolvePackagePath, the identical resolution src/read.ts already applies to a manifest href and an <img src>.
export interface HrefTarget {
  readonly targetHref: string;
  readonly fragment: string;
}

const URI_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/iu;

export function resolveHrefTarget(
  sourceHref: string,
  href: string,
): HrefTarget | undefined {
  if (href.length === 0 || URI_SCHEME_PATTERN.test(href)) {
    return undefined;
  }
  const hashIndex = href.indexOf("#");
  if (hashIndex === -1) {
    return undefined;
  }
  const fragment = href.slice(hashIndex + 1);
  if (fragment.length === 0) {
    return undefined;
  }
  const pathPart = href.slice(0, hashIndex);
  const targetHref =
    pathPart.length === 0
      ? sourceHref
      : resolvePackagePath(dirname(sourceHref), pathPart);
  return { targetHref, fragment };
}
