import type { Package, Part } from "ooxml.js";

function partsEqual(a: Part | undefined, b: Part | undefined): boolean {
  if (a === undefined || b === undefined) {
    return a === b;
  }
  if (a.kind !== b.kind) {
    return false;
  }
  if (a.kind === "binary" && b.kind === "binary") {
    return a.base64 === b.base64;
  }
  if (a.kind === "xml" && b.kind === "xml") {
    // Structural equality of the parsed node forest is equivalent to byte-identical serialized XML, since ooxml.js's own encodePackage/decodePackage round trip is faithful (established by its own test suite) -- this avoids re-serializing to a string just to compare it.
    return JSON.stringify(a.nodes) === JSON.stringify(b.nodes);
  }
  return false;
}

// Asserts that every part in `after` is identical to its counterpart in `before`, except the parts listed in `touchedPaths` -- the fidelity guarantee the live-view editor (src/edit/*) exists to provide: mutating one part must never change any other part's serialized content. Throws a descriptive error naming the first unexpectedly-changed (or added/removed) part, rather than a generic assertion failure a caller would have to dig into.
export function assertPartsUnchangedExcept(
  before: Package,
  after: Package,
  touchedPaths: readonly string[],
): void {
  const touched = new Set(touchedPaths);
  const allPaths = new Set([
    ...Object.keys(before.parts),
    ...Object.keys(after.parts),
  ]);
  for (const path of allPaths) {
    if (touched.has(path)) {
      continue;
    }
    if (!partsEqual(before.parts[path], after.parts[path])) {
      throw new Error(
        `part '${path}' changed unexpectedly (it is not in the touched-paths list: [${[...touched].join(", ")}])`,
      );
    }
  }
}
