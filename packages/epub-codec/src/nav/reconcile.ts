// Compares a nav/NCX-derived href sequence against the spine's own reading order (both already fragment-stripped) -- EPUB 3.3 permits the two to name overlapping but non-identical structure (a nav landmarks/page-list entry, a nav toc entry with no matching spine item at all, front matter present in one but not the other), and this package's own read.ts always follows the spine for content order regardless of what the nav says, per ExaDev/documents.js#801's own explicit "the spine wins" decision. This is the one check that decides whether that divergence is worth recording.
export function navMatchesSpine(
  navHrefs: readonly string[],
  spineHrefs: readonly string[],
): boolean {
  if (navHrefs.length !== spineHrefs.length) {
    return false;
  }
  return navHrefs.every((href, index) => href === spineHrefs[index]);
}
