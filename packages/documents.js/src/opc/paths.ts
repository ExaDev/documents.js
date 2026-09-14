// The .rels part for a given part path: word/document.xml -> word/_rels/document.xml.rels. Mirrors ooxml.js's own internal (unexported) relsPathFor -- duplicated here because opc/rels.ts needs it for parts that may not have a .rels file yet, a case ooxml.js's own (read-only) resolveRelationships never needs to handle.
export function relsPathFor(partPath: string): string {
  const lastSlash = partPath.lastIndexOf("/");
  const dir = lastSlash === -1 ? "" : partPath.slice(0, lastSlash);
  // No lastSlash === -1 ternary guard here (unlike dir above): slicing from lastSlash + 1 already returns the whole path when there is no slash at all (lastIndexOf yields -1, so the slice starts at 0), making a guard for that case redundant -- see src/mathml/nodes.ts's localName for the identical pattern and reasoning.
  const fileName = partPath.slice(lastSlash + 1);
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
  // A single combined bound, not two independently-ANDed length checks: with two separate `common < fromDirs.length && common < toDirs.length` clauses, relaxing (or dropping) either one in isolation never changes the loop's outcome on its own -- the OTHER, still-correct clause independently stops the loop at the same `common`, and wherever the two arrays' lengths genuinely differ, the fromDirs[common] === toDirs[common] comparison itself already fails once one side runs out (a real segment can never equal undefined). That made every mutation on either individual clause (and on the && joining them) permanently equivalent. A single combinedLimit bound has no sibling clause left to compensate, so a boundary mutation on it is only masked when the two paths share every directory segment all the way to a shared length -- covered by the identical-directories case below.
  const combinedLimit = Math.min(fromDirs.length, toDirs.length);
  while (common < combinedLimit && fromDirs[common] === toDirs[common]) {
    common++;
  }

  const ups = Array<string>(fromDirs.length - common).fill("..");
  const downs = toDirs.slice(common);
  return [...ups, ...downs, toFileName].join("/");
}
