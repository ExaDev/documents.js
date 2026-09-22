// The .rels part for a given part path: word/document.xml -> word/_rels/document.xml.rels. Mirrors ooxml.js's own internal (unexported) relsPathFor — duplicated here because opc/rels.ts needs it for parts that may not have a .rels file yet, a case ooxml.js's own (read-only) resolveRelationships never needs to handle.
export function relsPathFor(partPath: string): string {
  const lastSlash = partPath.lastIndexOf("/");
  const dir = lastSlash === -1 ? "" : partPath.slice(0, lastSlash);
  // No lastSlash === -1 ternary guard here (unlike dir above): slicing from lastSlash + 1 already returns the whole path when there is no slash at all (lastIndexOf yields -1, so the slice starts at 0), making a guard for that case redundant — see src/mathml/nodes.ts's localName for the identical pattern and reasoning.
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
  // No explicit length bound at all — once `common` reaches the end of the shorter array, indexing it yields `undefined`, which can never strictly equal a real path segment, so the loop already stops there on its own. An explicit bound (either two independently-ANDed length checks, or a single Math.min/Math.max of the two) is provably redundant for the same reason and, worse, is an equivalent mutant no test can ever kill: every mutation on such a bound is masked by the fromDirs[common] === toDirs[common] comparison already failing the instant one side runs out. Dropping the bound removes the mutation opportunity outright rather than leaving it unkillable.
  while (
    fromDirs[common] !== undefined &&
    fromDirs[common] === toDirs[common]
  ) {
    common++;
  }

  const ups = Array<string>(fromDirs.length - common).fill("..");
  const downs = toDirs.slice(common);
  return [...ups, ...downs, toFileName].join("/");
}

// The directory a part sits in, with no trailing slash: "word/document.xml" -> "word", "document2.xml" -> "". Used to place a new sibling part (a media directory, a slides directory) beside whichever part a package actually named as its main one, rather than at the directory the convention would have put it in.
export function partDirectory(partPath: string): string {
  const lastSlash = partPath.lastIndexOf("/");
  return lastSlash === -1 ? "" : partPath.slice(0, lastSlash);
}

// A directory beside `partPath`, named `name`: "word/document.xml" + "media" -> "word/media", and "document2.xml" + "media" -> "media" for a main part sitting at the package root.
export function siblingDirectory(partPath: string, name: string): string {
  const dir = partDirectory(partPath);
  return dir === "" ? name : `${dir}/${name}`;
}

// Escapes every character that carries meaning in a regular expression, so a part-path segment can be embedded in one as a literal. Shared by the two places that scan pkg.parts for an indexed part name under a directory whose own path is a value rather than a literal (opc/media.ts's nextMediaIndex, edit/pptx/editor.ts's nextSlidePartIndex).
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
