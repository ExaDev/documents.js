// The .rels part for a given part path: word/document.xml -> word/_rels/document.xml.rels. Mirrors ooxml.js's own internal (unexported) relsPathFor -- duplicated here because opc/rels.ts needs it for parts that may not have a .rels file yet, a case ooxml.js's own (read-only) resolveRelationships never needs to handle.
export function relsPathFor(partPath: string): string {
  const lastSlash = partPath.lastIndexOf("/");
  const dir = lastSlash === -1 ? "" : partPath.slice(0, lastSlash);
  const fileName = lastSlash === -1 ? partPath : partPath.slice(lastSlash + 1);
  return `${dir}/_rels/${fileName}.rels`;
}

function dirSegments(partPath: string): string[] {
  const lastSlash = partPath.lastIndexOf("/");
  if (lastSlash === -1) {
    return [];
  }
  return partPath.slice(0, lastSlash).split("/");
}

// A package-relative part path (e.g. "word/media/image1.png") -> a Relationship Target value relative to fromPartPath's own directory (e.g. "media/image1.png" when fromPartPath is "word/document.xml", or "../media/image1.png" when fromPartPath is "ppt/slides/slide1.xml"). The inverse of ooxml.js's internal resolveRelTarget, needed when adding a NEW relationship rather than resolving an existing one.
export function buildRelativeTarget(
  fromPartPath: string,
  toPartPath: string,
): string {
  const fromDirs = dirSegments(fromPartPath);
  const toDirs = dirSegments(toPartPath);
  const toFileName = toPartPath.slice(toPartPath.lastIndexOf("/") + 1);

  let common = 0;
  while (
    common < fromDirs.length &&
    common < toDirs.length &&
    fromDirs[common] === toDirs[common]
  ) {
    common++;
  }

  const ups = Array<string>(fromDirs.length - common).fill("..");
  const downs = toDirs.slice(common);
  return [...ups, ...downs, toFileName].join("/");
}
