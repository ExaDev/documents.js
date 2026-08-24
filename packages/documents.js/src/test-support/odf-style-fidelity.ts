import type { Package, XmlElement } from "odf.js";
import { buildXml } from "odf.js";

const CONTENT_PART_PATH = "content.xml";

function findAutomaticStyles(pkg: Package): XmlElement | undefined {
  const part = pkg.parts[CONTENT_PART_PATH];
  const root =
    part?.kind === "xml"
      ? part.nodes.find((n): n is XmlElement => n.type === "element")
      : undefined;
  if (root === undefined) {
    return undefined;
  }
  for (const child of root.children) {
    if (child.type === "element" && child.tag === "office:automatic-styles") {
      return child;
    }
  }
  return undefined;
}

function countBy(values: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

// Snapshots office:automatic-styles' own children as serialized XML strings -- identity via content, not object reference, since a style:style element already present before an edit is a genuinely different JS object after a decodePackage/encodePackage round trip, so structural content is the only identity that survives that -- and asserts every entry present BEFORE an edit is still present (at least as many times) AFTER it. New entries appended by the edit are fine, that is exactly what interning a new style is supposed to do; anything removed, or present-but-changed (which shows up here as the old serialized form simply no longer occurring), is the specific failure this exists to catch: it would mean odf.js's own StyleRegistry.intern, or one of this package's own hand-rolled append-only style helpers (src/edit/odt/automatic-styles.ts, src/edit/odt/table.ts's internTableColumnWidth), had mutated or evicted an EXISTING entry in place -- breaking the "live view, byte-faithful for untouched content" guarantee style interning is supposed to preserve for every OTHER style already in the document.
export function assertAutomaticStylesOnlyAppended(
  before: Package,
  after: Package,
): void {
  const beforeEntries = (findAutomaticStyles(before)?.children ?? []).map((n) =>
    buildXml([n]),
  );
  const afterEntries = (findAutomaticStyles(after)?.children ?? []).map((n) =>
    buildXml([n]),
  );
  const beforeCounts = countBy(beforeEntries);
  const afterCounts = countBy(afterEntries);
  for (const [entry, count] of beforeCounts) {
    const afterCount = afterCounts.get(entry) ?? 0;
    if (afterCount < count) {
      throw new Error(
        `office:automatic-styles lost a pre-existing entry (present ${count}x before the edit, only ${afterCount}x after) -- style interning must only ever append a new entry or reuse an existing one, never mutate or remove one: ${entry}`,
      );
    }
  }
}
