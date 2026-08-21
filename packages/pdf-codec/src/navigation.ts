import type { PdfDiagnosticSink } from './diagnostics';
import type { PdfObjectResolver } from './interpret';
import type { LayoutDestination, LayoutDestinationTarget, LayoutOutlineItem } from './layout';
import { walkNameTree } from './names';
import type { PdfDict, PdfObject } from './objects';
import { asArray, asName, asNumber, dictGet } from './objects';
import { decodePdfString } from './pdf-text';

// Document-level navigation reading (#721's core cluster): named destinations (ISO 32000-1 12.3.2 -- the old-style catalog /Dests dictionary AND the /Names /Dests name tree, one table for both), and the /Outlines bookmark tree (12.3.3). Everything resolves to a destination NAME, because that is the cross-format key downstream consumers target: a link construct's internal arm and an outline entry both name a row of the destinations table, never a bare page index -- a direct destination array names nothing, so the registry mints a stable `destN` for it.

export type PageIndexLookup = (obj: PdfObject | undefined) => number | undefined;

// A destination array's coordinates after the view type name -- `null` (and any non-numeric malformation) surfaces as an absent field, never as 0, which would assert a position the file did not state.
function coordinateAt(arr: readonly PdfObject[], index: number): number | undefined {
  return asNumber(arr[index]);
}

// [page /Type ...coordinates...] (ISO 32000-1 Table 151). The page element is an indirect reference in a real file; PDF 2.0 additionally permits a bare integer page number, so both spellings resolve.
export function parseDestination(value: PdfObject | undefined, resolver: PdfObjectResolver, pageIndex: PageIndexLookup, sink: PdfDiagnosticSink): { pageIndex: number; target: LayoutDestinationTarget } | undefined {
  const arr = asArray(resolver.resolve(value));
  if (arr === undefined || arr.length < 2) {
    sink({ code: 'pdf/destination-invalid', severity: 'warning', message: 'a destination is not a display destination array; skipping it' });
    return undefined;
  }
  const pageEl = arr[0];
  const resolvedPageIndex = pageEl?.kind === 'number' ? (Number.isInteger(pageEl.value) && pageEl.value >= 0 ? pageEl.value : undefined) : pageIndex(pageEl);
  if (resolvedPageIndex === undefined) {
    sink({ code: 'pdf/destination-invalid', severity: 'warning', message: 'a destination names a page that is not in the document\'s page tree; skipping it' });
    return undefined;
  }
  const type = asName(arr[1]);
  if (type === 'XYZ') {
    return { pageIndex: resolvedPageIndex, target: { kind: 'xyz', ...optionalCoords(arr, [['leftPt', 2], ['topPt', 3], ['zoom', 4]]) } };
  }
  if (type === 'Fit') {
    return { pageIndex: resolvedPageIndex, target: { kind: 'fit' } };
  }
  if (type === 'FitH') {
    return { pageIndex: resolvedPageIndex, target: { kind: 'fitH', ...optionalCoords(arr, [['topPt', 2]]) } };
  }
  if (type === 'FitV') {
    return { pageIndex: resolvedPageIndex, target: { kind: 'fitV', ...optionalCoords(arr, [['leftPt', 2]]) } };
  }
  if (type === 'FitR') {
    return { pageIndex: resolvedPageIndex, target: { kind: 'fitR', ...optionalCoords(arr, [['leftPt', 2], ['bottomPt', 3], ['rightPt', 4], ['topPt', 5]]) } };
  }
  if (type === 'FitB') {
    return { pageIndex: resolvedPageIndex, target: { kind: 'fitB' } };
  }
  if (type === 'FitBH') {
    return { pageIndex: resolvedPageIndex, target: { kind: 'fitBH', ...optionalCoords(arr, [['topPt', 2]]) } };
  }
  if (type === 'FitBV') {
    return { pageIndex: resolvedPageIndex, target: { kind: 'fitBV', ...optionalCoords(arr, [['leftPt', 2]]) } };
  }
  sink({ code: 'pdf/destination-invalid', severity: 'warning', message: `a destination carries unknown display type /${type ?? '?'}; skipping it` });
  return undefined;
}

type DestinationCoordinateField = Exclude<keyof LayoutDestinationTarget, 'kind'>;

function optionalCoords(arr: readonly PdfObject[], fields: readonly (readonly [DestinationCoordinateField, number])[]): Partial<LayoutDestinationTarget> {
  const out: Partial<LayoutDestinationTarget> = {};
  for (const [field, index] of fields) {
    const value = coordinateAt(arr, index);
    if (value !== undefined) {
      out[field] = value;
    }
  }
  return out;
}

// The one table every navigation consumer resolves against: the document's named destinations plus reader-minted entries for direct destination arrays. `intern` is the single entry point both link annotations and outline items go through, so a direct array shared by a link and a bookmark mints ONE destination, not two.
export interface DestinationRegistry {
  readonly entries: readonly LayoutDestination[];
  // A named destination (PDF string) resolves to its own name when the table carries it; a direct destination array mints a fresh collision-free `destN` entry. Returns undefined (with a diagnostic) for a dangling name or an unparseable array.
  intern(obj: PdfObject | undefined): string | undefined;
}

export function createDestinationRegistry(catalog: PdfDict, resolver: PdfObjectResolver, pageIndex: PageIndexLookup, sink: PdfDiagnosticSink): DestinationRegistry {
  const entries: LayoutDestination[] = [];
  const byName = new Map<string, LayoutDestination>();

  const add = (name: string, parsed: { pageIndex: number; target: LayoutDestinationTarget }): void => {
    const entry = { name, pageIndex: parsed.pageIndex, target: parsed.target };
    entries.push(entry);
    byName.set(name, entry);
  };

  // The old-style dictionary (PDF 1.1, still widely emitted): name -> destination array, as direct dict entries.
  const destsDict = resolver.resolveDict(dictGet(catalog, 'Dests'));
  if (destsDict !== undefined) {
    for (const [name, value] of destsDict.entries) {
      if (byName.has(name)) {
        sink({ code: 'pdf/destination-duplicate', severity: 'warning', message: `destination name "${name}" is declared more than once; keeping the first` });
        continue;
      }
      const parsed = parseDestination(value, resolver, pageIndex, sink);
      if (parsed !== undefined) {
        add(name, parsed);
      }
    }
  }

  // The /Names /Dests name tree (PDF 1.2+), flattened through the shared walker.
  const namesRoot = resolver.resolveDict(dictGet(catalog, 'Names'));
  for (const entry of walkNameTree(namesRoot === undefined ? undefined : dictGet(namesRoot, 'Dests'), resolver, sink)) {
    if (byName.has(entry.name)) {
      sink({ code: 'pdf/destination-duplicate', severity: 'warning', message: `destination name "${entry.name}" is declared more than once; keeping the first` });
      continue;
    }
    const parsed = parseDestination(entry.value, resolver, pageIndex, sink);
    if (parsed !== undefined) {
      add(entry.name, parsed);
    }
  }

  const minted = (obj: PdfObject): string | undefined => {
    const parsed = parseDestination(obj, resolver, pageIndex, sink);
    if (parsed === undefined) {
      return undefined;
    }
    let n = 1;
    while (byName.has(`dest${n}`)) {
      n++;
    }
    const name = `dest${n}`;
    add(name, parsed);
    return name;
  };

  return {
    entries,
    intern(obj: PdfObject | undefined): string | undefined {
      const resolved = resolver.resolve(obj);
      if (resolved?.kind === 'string') {
        const name = decodePdfString(resolved.bytes);
        if (byName.has(name)) {
          return name;
        }
        sink({ code: 'pdf/destination-unresolved', severity: 'warning', message: `a destination names "${name}", which no /Dests or /Names /Dests entry declares` });
        return undefined;
      }
      if (resolved?.kind === 'array') {
        return minted(resolved);
      }
      return undefined;
    },
  };
}

// The bookmark tree: /First sibling chains through /Next, children through another /First. Titles decode as ordinary PDF strings; an item's destination is its /Dest or its /A /GoTo /D action, interned through the same registry a link annotation uses. The visited set spans the whole walk -- a /Next chain that loops back would otherwise recurse forever.
export function readOutline(catalog: PdfDict, registry: DestinationRegistry, resolver: PdfObjectResolver, sink: PdfDiagnosticSink): LayoutOutlineItem[] {
  const root = resolver.resolveDict(dictGet(catalog, 'Outlines'));
  const first = root === undefined ? undefined : resolver.resolveDict(dictGet(root, 'First'));
  if (first === undefined) {
    return [];
  }
  const items: LayoutOutlineItem[] = [];
  const visited = new Set<PdfDict>();
  walkOutlineSiblings(first, items, registry, resolver, sink, visited);
  return items;
}

function walkOutlineSiblings(node: PdfDict, out: LayoutOutlineItem[], registry: DestinationRegistry, resolver: PdfObjectResolver, sink: PdfDiagnosticSink, visited: Set<PdfDict>): void {
  let current: PdfDict | undefined = node;
  while (current !== undefined) {
    if (visited.has(current)) {
      sink({ code: 'pdf/outline-cycle', severity: 'warning', message: 'the outline contains a cycle; stopping the sibling chain at the repeated item' });
      return;
    }
    visited.add(current);
    const titleObj = dictGet(current, 'Title');
    const children: LayoutOutlineItem[] = [];
    const childFirst = resolver.resolveDict(dictGet(current, 'First'));
    if (childFirst !== undefined) {
      walkOutlineSiblings(childFirst, children, registry, resolver, sink, visited);
    }
    const destination = internOutlineDestination(current, registry, resolver);
    out.push({
      title: titleObj?.kind === 'string' ? decodePdfString(titleObj.bytes) : '',
      ...(destination !== undefined ? { destination } : {}),
      children,
    });
    current = resolver.resolveDict(dictGet(current, 'Next'));
  }
}

function internOutlineDestination(node: PdfDict, registry: DestinationRegistry, resolver: PdfObjectResolver): string | undefined {
  const dest = dictGet(node, 'Dest');
  if (dest !== undefined) {
    return registry.intern(dest);
  }
  const action = resolver.resolveDict(dictGet(node, 'A'));
  if (action !== undefined && asName(dictGet(action, 'S')) === 'GoTo') {
    return registry.intern(dictGet(action, 'D'));
  }
  return undefined;
}
