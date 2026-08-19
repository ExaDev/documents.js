import type { Package } from '../../model/package';
import { childrenWithTag, elementsWithTag, rootElement, textContent } from '../util';

// Shared strings: each <si> holds one or more <t> runs (plain text, or rich-text runs nested in <r>); their text concatenates into the indexed string value. Shared verbatim between the lossy xlsx.ts's readXlsxWorkbook and this directory's own richer readXlsxContent -- both need the identical shared-string table, just consumed differently, so this lives as one function rather than two near-identical copies.
export function loadSharedStrings(pkg: Package): string[] {
  const root = rootElement(pkg.parts['xl/sharedStrings.xml']);
  if (root === undefined) {
    return [];
  }
  const strings: string[] = [];
  for (const si of childrenWithTag(root, 'si')) {
    let value = '';
    for (const t of elementsWithTag(si.children, 't')) {
      value += textContent(t);
    }
    strings.push(value);
  }
  return strings;
}

// The write-side counterpart: deduplicates every text value a writer wants to store as a shared string, handing back the index each one will be written at. Used by typed/xlsx/build.ts while it walks cells -- a text value seen twice gets the same index both times, matching how Excel/LibreOffice themselves always deduplicate the shared-string table rather than repeating identical strings.
export class SharedStringTable {
  private readonly indexByValue = new Map<string, number>();
  private readonly values: string[] = [];

  // Returns the (possibly newly assigned) index for `value` in this table.
  intern(value: string): number {
    const existing = this.indexByValue.get(value);
    if (existing !== undefined) {
      return existing;
    }
    const index = this.values.length;
    this.indexByValue.set(value, index);
    this.values.push(value);
    return index;
  }

  // The final, index-ordered list of unique strings, ready to serialize as one <si><t>...</t></si> per entry.
  entries(): readonly string[] {
    return this.values;
  }

  get size(): number {
    return this.values.length;
  }
}
