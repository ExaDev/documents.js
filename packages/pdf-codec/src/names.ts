import type { PdfDiagnosticSink } from './diagnostics';
import type { PdfObjectResolver } from './interpret';
import type { PdfDict, PdfObject } from './objects';
import { asArray, asDict, dictGet } from './objects';
import { decodePdfString } from './pdf-text';

// The document-level name tree walker (ISO 32000-1 7.9.6): flattens one category's tree (/Names /Dests, /Names /EmbeddedFiles, ...) into an ordered name/value list, recursing through /Kids. One walker serves every names-tree tenant a reader grows -- the #721 verdict's stated reason for building it before any single consumer. /Limits arrays are search optimisation only and never consulted: this walk is exhaustive, so the limits would tell it nothing it does not already learn by visiting the node.

export interface NameTreeEntry {
  readonly name: string;
  readonly value: PdfObject;
}

// A node whose /Kids points back into its own ancestry would loop forever without this guard -- a corrupt or adversarial file, not something a real producer emits (the same stance document.ts's page-tree cycle guard takes).
export function walkNameTree(root: PdfObject | undefined, resolver: PdfObjectResolver, sink: PdfDiagnosticSink): NameTreeEntry[] {
  const entries: NameTreeEntry[] = [];
  collectNameTreeEntries(root, resolver, sink, entries, new Set());
  return entries;
}

function collectNameTreeEntries(node: PdfObject | undefined, resolver: PdfObjectResolver, sink: PdfDiagnosticSink, entries: NameTreeEntry[], visited: Set<PdfDict>): void {
  const dict = asDict(resolver.resolve(node));
  if (dict === undefined) {
    if (node !== undefined) {
      sink({ code: 'pdf/name-tree-node-invalid', severity: 'warning', message: 'a name tree node did not resolve to a dictionary; skipping it' });
    }
    return;
  }
  if (visited.has(dict)) {
    sink({ code: 'pdf/name-tree-cycle', severity: 'warning', message: 'the name tree contains a cycle; stopping descent at the repeated node' });
    return;
  }
  visited.add(dict);
  // A node's own /Names pairs come before its /Kids' contents in tree order -- an intermediate node may carry both, and the flattening preserves document order.
  const names = asArray(dictGet(dict, 'Names'));
  if (names !== undefined) {
    for (let i = 0; i + 1 < names.length; i += 2) {
      const key = names[i];
      if (key?.kind === 'string') {
        entries.push({ name: decodePdfString(key.bytes), value: names[i + 1]! });
      }
    }
  }
  const kids = asArray(dictGet(dict, 'Kids'));
  if (kids !== undefined) {
    for (const kid of kids) {
      collectNameTreeEntries(kid, resolver, sink, entries, visited);
    }
  }
}
