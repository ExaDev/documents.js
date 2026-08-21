import type { PdfDiagnosticSink } from './diagnostics';
import type { PdfObjectResolver } from './interpret';
import type { LayoutStructureElement } from './layout';
import type { PdfDict, PdfObject } from './objects';
import { asArray, asName, asNumber, dictGet } from './objects';
import { decodePdfString } from './pdf-text';

// Tagged-structure reading (#760, ISO 32000-1 14.7): the /StructTreeRoot element tree and the (page, MCID) association that tells an extracted item which element owns it. Two channels in the file serve two different jobs and neither can do the other's: the /K recursion states the element tree itself (nesting, types, attributes), while /ParentTree states ownership -- a number tree keyed by each page's own /StructParents value (a producer-chosen integer, not the page's position) whose entry is that page's array of owning elements indexed by MCID. The tree walk therefore ignores /K's integer and MCR content items entirely (they duplicate what the parent tree states, without the page context they need), and the association lookup never guesses a page from the tree.

export interface StructureContext {
  readonly tree: readonly LayoutStructureElement[];
  // The id of the element owning marked content `mcid` on page `pageIndex`, or undefined when the parent tree declares no owner for it.
  readonly ownerOf: (pageIndex: number, mcid: number) => string | undefined;
}

export function readStructure(catalog: PdfDict, pages: readonly PdfDict[], resolver: PdfObjectResolver, sink: PdfDiagnosticSink): StructureContext {
  const root = resolver.resolveDict(dictGet(catalog, 'StructTreeRoot'));
  if (root === undefined) {
    return { tree: [], ownerOf: () => undefined };
  }

  // /RoleMap (14.7.3): custom type name -> standard type name. Applied at read so the table's `type` field is the standard vocabulary a consumer queries ('H1', not the producer's own 'Chapter'); an unmapped custom name passes through verbatim, the honest spelling when no standard mapping exists.
  const roleMap = new Map<string, string>();
  const roleMapDict = resolver.resolveDict(dictGet(root, 'RoleMap'));
  for (const [custom, standard] of roleMapDict?.entries ?? []) {
    const target = asName(standard);
    if (target !== undefined) {
      roleMap.set(custom, target);
    }
  }

  // /ClassMap (14.7.5.2): class name -> attribute dict. An element referencing a class through /C inherits that class's attributes -- the ones with semantic meaning here are the same three the element itself can carry, and an element's OWN entry always wins over a class's. A /C entry may also be an inline attribute dict rather than a class name, which 14.7.5.2 permits.
  const classAttributes = new Map<string, ElementAttributes>();
  const classMapDict = resolver.resolveDict(dictGet(root, 'ClassMap'));
  for (const [className, value] of classMapDict?.entries ?? []) {
    const attributes = elementAttributes(resolver.resolveDict(value));
    if (attributes !== undefined) {
      classAttributes.set(className, attributes);
    }
  }

  const idByDict = new Map<PdfDict, string>();
  const tree: LayoutStructureElement[] = [];
  const visited = new Set<PdfDict>();
  let minted = 0;
  const readElement = (dict: PdfDict): LayoutStructureElement | undefined => {
    if (visited.has(dict)) {
      sink({ code: 'pdf/structure-cycle', severity: 'warning', message: 'the structure tree contains a cycle; stopping descent at the repeated element' });
      return undefined;
    }
    visited.add(dict);
    const ownType = asName(dictGet(dict, 'S'));
    if (ownType === undefined) {
      sink({ code: 'pdf/structure-element-invalid', severity: 'warning', message: 'a structure element carries no /S type; skipping it' });
      return undefined;
    }
    minted += 1;
    const id = `struct${minted}`;
    idByDict.set(dict, id);
    const children: LayoutStructureElement[] = [];
    for (const kid of elementKids(dict, resolver)) {
      const child = readElement(kid);
      if (child !== undefined) {
        children.push(child);
      }
    }
    return { id, type: roleMap.get(ownType) ?? ownType, ...mergedAttributes(dict, resolver, classAttributes), children };
  };
  for (const kid of elementKids(root, resolver)) {
    const element = readElement(kid);
    if (element !== undefined) {
      tree.push(element);
    }
  }

  return { tree, ownerOf: parentTreeOwners(root, pages, resolver, idByDict, sink) };
}

// The string-valued attributes an element or a class-attribute dict can carry.
interface ElementAttributes {
  readonly title?: string;
  readonly language?: string;
  readonly alt?: string;
  readonly actualText?: string;
}

type AttributeKey = keyof ElementAttributes;
const ATTRIBUTE_KEYS: readonly AttributeKey[] = ['title', 'language', 'alt', 'actualText'];
const ATTRIBUTE_SOURCES: readonly (readonly [AttributeKey, string])[] = [
  ['title', 'T'],
  ['language', 'Lang'],
  ['alt', 'Alt'],
  ['actualText', 'ActualText'],
];

function elementAttributes(dict: PdfDict | undefined): ElementAttributes | undefined {
  if (dict === undefined) {
    return undefined;
  }
  const stringField = (key: string): string | undefined => {
    const obj = dictGet(dict, key);
    return obj?.kind === 'string' ? decodePdfString(obj.bytes) : undefined;
  };
  const values = new Map<AttributeKey, string>();
  for (const [field, source] of ATTRIBUTE_SOURCES) {
    const value = stringField(source);
    if (value !== undefined) {
      values.set(field, value);
    }
  }
  if (values.size === 0) {
    return undefined;
  }
  return Object.fromEntries(values);
}

// An element's effective attributes: its own /T /Lang /Alt /ActualText, with /ClassMap entries (referenced through /C) filling only the ones the element itself does not state.
function mergedAttributes(dict: PdfDict, resolver: PdfObjectResolver, classAttributes: Map<string, ElementAttributes>): ElementAttributes {
  const own = elementAttributes(dict);
  const classAttributeList: ElementAttributes[] = [];
  for (const classObj of asArray(dictGet(dict, 'C')) ?? []) {
    const name = asName(classObj);
    const attributes = name !== undefined ? classAttributes.get(name) : elementAttributes(resolver.resolveDict(classObj));
    if (attributes !== undefined) {
      classAttributeList.push(attributes);
    }
  }
  const values = new Map<AttributeKey, string>();
  for (const key of ATTRIBUTE_KEYS) {
    const ownValue = own?.[key];
    if (ownValue !== undefined) {
      values.set(key, ownValue);
      continue;
    }
    for (const attributes of classAttributeList) {
      const value = attributes[key];
      if (value !== undefined) {
        values.set(key, value);
        break;
      }
    }
  }
  return Object.fromEntries(values);
}

// A /K value's element children: each kid that resolves to a dictionary CARRYING /S is a nested structure element. Everything else a /K holds -- an integer MCID, an MCR or OBJR reference dict -- is a content item, the parent tree's channel, not a tree node. A single element in place of the array is legal (14.7.2), hence the asArray-or-single handling.
function elementKids(dict: PdfDict, resolver: PdfObjectResolver): PdfDict[] {
  const kids: PdfDict[] = [];
  const k = dictGet(dict, 'K');
  for (const kid of asArray(k) ?? (k !== undefined ? [k] : [])) {
    const resolved = resolver.resolveDict(kid);
    if (resolved !== undefined && dictGet(resolved, 'S') !== undefined) {
      kids.push(resolved);
    }
  }
  return kids;
}

// One number-tree leaf entry pair, flattened in tree order (ISO 32000-1 7.9.7: a node's own /Nums come before its /Kids' contents). Non-integer keys and unresolvable /Kids entries are skipped silently, matching names.ts's own behaviour for the string-keyed twin -- the surrounding document still reads.
function numberTreeEntries(node: PdfDict, resolver: PdfObjectResolver, visited: Set<PdfDict>): [number, PdfObject][] {
  if (visited.has(node)) {
    return [];
  }
  visited.add(node);
  const entries: [number, PdfObject][] = [];
  const nums = asArray(dictGet(node, 'Nums'));
  for (let i = 0; nums !== undefined && i + 1 < nums.length; i += 2) {
    const key = asNumber(nums[i]);
    if (key !== undefined) {
      entries.push([key, nums[i + 1]!]);
    }
  }
  for (const kid of asArray(dictGet(node, 'Kids')) ?? []) {
    const dict = resolver.resolveDict(kid);
    if (dict !== undefined) {
      entries.push(...numberTreeEntries(dict, resolver, visited));
    }
  }
  return entries;
}

// The (page, MCID) -> element-id map built from /ParentTree (14.7.4.4). A page's key in the document-level number tree is the value of that page's OWN /StructParents page-dictionary entry -- a producer-chosen integer with no required relation to the page's position in the page tree -- and the entry it names is an array of element references indexed by MCID (14.7.4.4: a sequence's marked-content identifier is a zero-based index into the array). Keys no page claims carry the OBJR channel instead -- a single element reference naming the owner of a whole referenced object, whose /StructParent lives on the object itself -- which this reader recognises by shape (a non-array value under a page's key can only be that) and skips, as it is outside the (page, MCID) channel's scope. Array entries that resolve to no element (the null a producer writes for an unused MCID, an unresolvable reference) stamp nothing.
function parentTreeOwners(root: PdfDict, pages: readonly PdfDict[], resolver: PdfObjectResolver, idByDict: Map<PdfDict, string>, sink: PdfDiagnosticSink): (pageIndex: number, mcid: number) => string | undefined {
  const documentTree = resolver.resolveDict(dictGet(root, 'ParentTree'));
  if (documentTree === undefined) {
    if (dictGet(root, 'ParentTree') !== undefined) {
      sink({ code: 'pdf/parent-tree-unresolved', severity: 'warning', message: 'the /ParentTree did not resolve to a dictionary; no marked-content ownership can be associated' });
    }
    return () => undefined;
  }
  const entries = new Map(numberTreeEntries(documentTree, resolver, new Set()));
  const owners = new Map<string, string>();
  pages.forEach((page, pageIndex) => {
    const structParents = asNumber(dictGet(page, 'StructParents'));
    if (structParents === undefined) {
      return; // a page declaring no /StructParents states no MCID numbering of its own: nothing it paints can be associated
    }
    const entry = entries.get(structParents);
    if (entry === undefined) {
      sink({ code: 'pdf/parent-tree-missing-entry', severity: 'warning', pageIndex, message: `page ${pageIndex} declares /StructParents ${structParents} but the /ParentTree carries no entry for that key; its marked content resolves to no owner` });
      return;
    }
    const mcidOwners = asArray(entry);
    if (mcidOwners === undefined) {
      return; // a non-array entry under a page's key is the OBJR channel's shape, not an MCID-indexed array
    }
    mcidOwners.forEach((element, mcid) => {
      const id = idByDict.get(resolver.resolveDict(element) ?? NEVER_DICT);
      if (id !== undefined) {
        owners.set(`${pageIndex}:${mcid}`, id);
      }
    });
  });
  return (pageIndex: number, mcid: number): string | undefined => owners.get(`${pageIndex}:${mcid}`);
}

// A sentinel that is never a key in idByDict, so `idByDict.get(x ?? NEVER_DICT)` reads as undefined for an unresolvable value without an assertion or a cast.
const NEVER_DICT: PdfDict = { kind: 'dict', entries: new Map() };
