// Package-relative path resolution shared by src/read.ts (resolving a manifest href against the OPF's own directory, and an <img src> against its own XHTML document's directory) and src/write.ts (deriving each part's own path). Deliberately hand-written rather than reaching for a URL-based resolver: package paths are zip entry keys, not URLs, and this package's own writer never emits anything more exotic than a same-level or one-directory-down relative reference, so a a full RFC 3986 resolution algorithm would be solving a problem this package's own corpus never poses (see README's corpus-tolerance scope note).

export function dirname(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

// Resolves a relative reference against a base directory, honouring "./" and "../" segments -- a manifest href like "../images/cover.png" from an OPF at "OEBPS/content.opf" (base directory "OEBPS") resolves to "images/cover.png". An absolute-looking reference (starting with "/") or one already carrying a URI scheme is returned unchanged: the former is not how this format's relative package paths are spelled (and this package should not invent a leading-slash convention no real producer uses), the latter is an external/absolute link no zip-entry lookup could resolve regardless.
export function resolvePackagePath(baseDir: string, relative: string): string {
  if (relative.startsWith("/") || /^[a-z][a-z0-9+.-]*:/iu.test(relative)) {
    return relative;
  }
  const baseSegments = baseDir.length > 0 ? baseDir.split("/") : [];
  const segments = [...baseSegments];
  for (const part of relative.split("/")) {
    if (part === "" || part === ".") {
      continue;
    }
    if (part === "..") {
      segments.pop();
      continue;
    }
    segments.push(part);
  }
  return segments.join("/");
}
