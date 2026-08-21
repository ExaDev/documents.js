import type { AnchorDescriptor, ConstructDescriptor, ContentBlock, ContentControlDescriptor, DefinitionEntry, DivisionDescriptor, FieldDescriptor, ProvenanceDescriptor, RunConstructExtent, SourceResidue } from 'document-schema.js';
import type { XmlElement, XmlNode } from '../../model/node';
import type { Package } from '../../model/package';
import { buildXml } from '../../xml/build';
import { attrValue, childrenWithTag, elementsWithTag, findChildElement, rootElement } from '../../xml/query';
import { decodeOdfText, isOdfFieldElement } from './text';

// The ODF side of document-schema.js's fidelity construct vocabulary (its src/construct.ts): reading ODF's inline construct elements into ConstructDescriptor payloads and RunConstructExtent entries on the paragraph that carries them (typed/shared/paragraph.ts's run walk calls in here), plus the block-scope half of the same vocabulary the odt reader drives (typed/odt/read.ts -- divisions, index wrappers, forms, and the cross-paragraph marker pairs). One module owns both halves so the descriptor shapes and the scope rules the two readers must agree on stay stated once, the same discipline ooxml.js's own typed/docx/constructs.ts follows for WordprocessingML.
//
// EXTENT SCOPE, the constraint that decides where each ODF construct lands: a construct covering a sub-sequence of ONE paragraph's runs is an entry on that paragraph's constructs field; a construct bracketing whole blocks is a constructStart/constructEnd marker pair in the block list. ODF spells its inline constructs exactly the way the run-level mechanism wants -- a field or a note is ONE element sitting at a position in the character flow -- so fields are run-level, always. ODF's range constructs (text:bookmark-start/-end, text:change-start/-end, office:annotation/-end) are paired marker halves keyed by name or id: both halves inside one paragraph pair into a run extent; both halves at paragraph edges pair across blocks; everything else (one half interior, the other elsewhere) has no encoding and is dropped, mirroring the qualification ooxml.js applies to w:bookmarkStart/End for the identical reason -- document-schema.js's marker contract ratifies the straddling drop. The inline field tag set itself lives in text.ts beside the content-model predicates that share it.

// A field's instruction is the producer's own field code: the element with its attributes, serialised -- the ODF counterpart of docx's w:instrText text. Children are deliberately stripped from the serialisation because they are the cached RESULT, which the descriptor carries separately as cachedResult; serialising them too would put one fact in two places inside the descriptor.
export function odfFieldDescriptor(element: XmlElement): FieldDescriptor {
  const cachedResult = decodeOdfText(element);
  const descriptor: FieldDescriptor = { kind: 'field', instruction: buildXml([{ ...element, children: [] }]) };
  if (cachedResult.length > 0) {
    descriptor.cachedResult = cachedResult;
  }
  return descriptor;
}

export function odfBookmarkAnchorDescriptor(name: string): AnchorDescriptor {
  return { kind: 'anchor', anchorType: 'bookmark', name };
}

// The residue spelling for every ODF construct reader that degrades format-specific specifics into the quarantine channel: the element subtree as this package's own builder serialises it, tagged with the format of the reader producing it. The format member names the READER'S format (an index source element in an odt reads as 'odt' residue even though text: is shared vocabulary), because restorability is decided by "can the same-format writer re-emit this", and the writer that would re-emit it is the one reading the document.
export type OdfResidueFormat = 'odt' | 'ods' | 'odp' | 'odg' | 'odm' | 'odb' | 'odf';

export function odfResidue(format: OdfResidueFormat, element: XmlElement): SourceResidue {
  return { format, xml: buildXml([element]) };
}

// --- divisions (text:section) ---------------------------------------------------------------------------------------

// text:protected is a plain boolean attribute ("true"/"false", false when absent per the ODF schema default).
function readOdfBooleanAttribute(element: XmlElement, name: string): boolean | undefined {
  const raw = attrValue(element, name);
  if (raw === 'true') {
    return true;
  }
  return raw === 'false' ? false : undefined;
}

// A section's own style:style[family="section"] by name, across both style containers in both parts. 'section' is deliberately not a member of the style-interning layer's STYLE_FAMILIES (this package never writes one), so this is a direct container walk rather than cascade.ts's findStyleElement -- single-level with no parent-chain walk, matching table.ts's own convention for families whose real-world styles are standalone.
function findSectionStyleElement(styleName: string, pkg: Package): XmlElement | undefined {
  for (const partPath of ['content.xml', 'styles.xml'] as const) {
    const part = pkg.parts[partPath];
    if (part?.kind !== 'xml') {
      continue;
    }
    const root = rootElement(part.nodes);
    if (root === undefined) {
      continue;
    }
    for (const containerTag of ['office:automatic-styles', 'office:styles'] as const) {
      const container = findChildElement(root.children, containerTag);
      if (container === undefined) {
        continue;
      }
      for (const style of childrenWithTag(container, 'style:style')) {
        if (attrValue(style, 'style:family') === 'section' && attrValue(style, 'style:name') === styleName) {
          return style;
        }
      }
    }
  }
  return undefined;
}

// The column count a section's own flow uses -- style:section-properties/style:columns/@fo:column-count, a single-level lookup for the reason findSectionStyleElement states. Absent, unparseable, or non-positive counts read as no column fact rather than a guess.
function readDivisionColumnCount(sectionElement: XmlElement, pkg: Package): number | undefined {
  const styleName = attrValue(sectionElement, 'text:style-name');
  if (styleName === undefined) {
    return undefined;
  }
  const style = findSectionStyleElement(styleName, pkg);
  if (style === undefined) {
    return undefined;
  }
  const properties = findChildElement(style.children, 'style:section-properties');
  const columns = properties === undefined ? undefined : findChildElement(properties.children, 'style:columns');
  const raw = columns === undefined ? undefined : attrValue(columns, 'fo:column-count');
  if (raw === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

// One text:section element -> its DivisionDescriptor: name (text:name), protected (text:protected), the column count its own style sets over its flow, and the external-chapter link when the section carries a text:section-source. text:filter-name on that source deliberately rides nowhere: DivisionDescriptor's own source field already names the external-chapter link, so the filter name -- an importer instruction with no cross-format meaning -- would have to ride division residue, and the schema's residue refusal on this one descriptor (one name cannot mean two facts) leaves the row waiting on the #743 rename of the landed field.
export function odfDivisionDescriptor(sectionElement: XmlElement, pkg: Package): DivisionDescriptor {
  const descriptor: DivisionDescriptor = { kind: 'division' };
  const name = attrValue(sectionElement, 'text:name');
  if (name !== undefined) {
    descriptor.name = name;
  }
  const protectedFlag = readOdfBooleanAttribute(sectionElement, 'text:protected');
  if (protectedFlag !== undefined) {
    descriptor.protected = protectedFlag;
  }
  const columnCount = readDivisionColumnCount(sectionElement, pkg);
  if (columnCount !== undefined) {
    descriptor.columnCount = columnCount;
  }
  const sourceElement = findChildElement(sectionElement.children, 'text:section-source');
  if (sourceElement !== undefined) {
    const href = attrValue(sourceElement, 'xlink:href');
    if (href !== undefined) {
      const source: DivisionDescriptor['source'] = { href };
      const sectionName = attrValue(sourceElement, 'text:section-name');
      if (sectionName !== undefined) {
        source.sectionName = sectionName;
      }
      descriptor.source = source;
    }
  }
  return descriptor;
}

// --- TOC and index wrappers -----------------------------------------------------------------------------------------

// The seven ODF index wrappers, all read as the same index content control: the wrapper, with its cached rendered entries (text:index-body) as the construct's extent.
export const ODF_INDEX_WRAPPER_TAGS: ReadonlySet<string> = new Set([
  'text:table-of-content',
  'text:alphabetical-index',
  'text:bibliography',
  'text:illustration-index',
  'text:table-index',
  'text:user-index',
  'text:object-index',
]);

export function isOdfIndexWrapper(element: XmlElement): boolean {
  return ODF_INDEX_WRAPPER_TAGS.has(element.tag);
}

// The wrapper's own *-source child (text:table-of-content-source, text:alphabetical-index-source, ...) carries the index's build rules -- outline levels, sort keys, entry formatting references -- which have no cross-format meaning beyond "this is how the producer computed the cached body", so the whole element is quarantined in the descriptor's residue. text:name rides as the control's tag: the machine-readable identifier a producer addresses the wrapper by.
export function odfIndexControlDescriptor(wrapper: XmlElement): ContentControlDescriptor {
  const descriptor: ContentControlDescriptor = { kind: 'contentControl', controlType: 'index' };
  const name = attrValue(wrapper, 'text:name');
  if (name !== undefined) {
    descriptor.tag = name;
  }
  for (const child of wrapper.children) {
    if (child.type === 'element' && child.tag.endsWith('-source')) {
      descriptor.source = odfResidue('odt', child);
      break;
    }
  }
  return descriptor;
}

// One half of a paired marker construct encountered during a paragraph's run walk: bookmark halves pair by text:name, tracked-change markers by text:change-id, annotations by office:name. `parent` is kept so the pairing can ask whether the half is a DIRECT child of the paragraph element (only a direct child can sit at a paragraph edge and qualify for block scope); a half nested inside a text:span or text:a is interior to the paragraph's run sequence by construction. `runPosition` is the count of runs the walk had emitted when it reached the half -- exactly what a RunConstructExtent's startRun/endRun names. `descriptor` is deferred so the payload is built only for a half that actually wins a pairing, and may resolve to undefined -- a tracked-change half whose text:change-id names no text:changed-region has no descriptor to carry, and both pairings below drop such a pair rather than emitting a marker shell with nothing inside it.
export type OdfMarkerKind = 'bookmark' | 'change' | 'annotation';

export interface OdfMarkerHalf {
  readonly kind: OdfMarkerKind;
  readonly side: 'start' | 'end';
  readonly key: string;
  readonly element: XmlElement;
  readonly parent: XmlElement;
  readonly runPosition: number;
  readonly order: number;
  readonly descriptor: () => RunConstructExtent['descriptor'] | undefined;
}

// Whether a node contributes content to its paragraph's run sequence: every child kind the run walk turns into at least one possible run, plus the constructs whose cached text renders (fields, notes, annotations). Markers that never render (bookmark halves, an empty field) are not content, which is what makes "sitting outside every content-bearing child" the test for a paragraph edge. A field with no cached text renders nothing but is still counted as content, deliberately: an edge test that depended on whether a producer cached a value would make the block-versus-run-scope verdict depend on a rendering accident, and the conservative failure (a bookmark half judged interior, dropping only that pair) is strictly safer than the alternative (a half judged at an edge it does not occupy).
function isContentBearingNode(node: XmlNode): boolean {
  if (node.type === 'text') {
    return node.value.length > 0;
  }
  if (node.type !== 'element') {
    return false;
  }
  return (
    isOdfFieldElement(node) ||
    node.tag === 'text:s' ||
    node.tag === 'text:tab' ||
    node.tag === 'text:line-break' ||
    node.tag === 'text:span' ||
    node.tag === 'text:a' ||
    node.tag === 'text:note' ||
    node.tag === 'office:annotation'
  );
}

// A direct-child index is at a paragraph edge when no content-bearing sibling precedes it (leading) or none follows it (trailing).
function edgePosition(siblings: readonly XmlNode[], index: number): 'leading' | 'trailing' | undefined {
  let leading = true;
  for (let before = 0; before < index; before += 1) {
    if (isContentBearingNode(siblings[before]!)) {
      leading = false;
      break;
    }
  }
  if (leading) {
    return 'leading';
  }
  for (let after = index + 1; after < siblings.length; after += 1) {
    if (isContentBearingNode(siblings[after]!)) {
      return undefined;
    }
  }
  return 'trailing';
}

// The block index a block-scoped half opens or closes at: a leading half sits at its own paragraph's block position, a trailing one just past it (so a leading start with a trailing end in the same paragraph brackets exactly that paragraph). Undefined when the half is not block-scoped -- interior to the paragraph's run sequence, or nested inside a container element.
export function odfMarkerHalfEventIndex(half: OdfMarkerHalf, paragraphElement: XmlElement, paragraphStartIndex: number): number | undefined {
  if (half.parent !== paragraphElement) {
    return undefined;
  }
  const index = half.parent.children.indexOf(half.element);
  if (index === -1) {
    return undefined;
  }
  const edge = edgePosition(half.parent.children, index);
  if (edge === 'leading') {
    return paragraphStartIndex;
  }
  return edge === 'trailing' ? paragraphStartIndex + 1 : undefined;
}

// Whether a half brackets whole blocks rather than a run sub-sequence: a direct child of the paragraph sitting outside every content-bearing sibling. A half whose parent is not the paragraph element (one nested inside a text:span or text:a) is never block-scoped, since its parent is itself content.
export function isOdfBlockScopedHalf(half: OdfMarkerHalf, paragraphElement: XmlElement): boolean {
  return odfMarkerHalfEventIndex(half, paragraphElement, 0) !== undefined;
}

// The document-level sink a paragraph's note and annotation reading reports definitions entries into, carrying the two deterministic ordinal counters that mint names for the constructs ODF leaves nameless (a note without text:id, an annotation without office:name -- both optional attributes in the schema even though every real producer writes them). One sink per document, threaded by reference, so minted names are unique across the whole body exactly the way list numIds are.
export interface OdfDefinitionsSink {
  readonly entries: Record<string, DefinitionEntry>;
  nextNoteOrdinal: number;
  nextAnnotationOrdinal: number;
}

// Pairs one paragraph's own marker halves by their key into run-level construct extents (document-schema.js's RunConstructExtent): a pair both of whose halves sit in THIS paragraph and are not both block-scoped becomes an entry on the paragraph's constructs field. A pair with both halves block-scoped is skipped -- that is the block-marker path's extent (the odt reader emits its constructStart/constructEnd pair, and one occurrence must never carry both encodings); a half whose partner sits in a different paragraph is never seen here at all, so the block reader alone decides its fate. Everything else mirrors the docx rules: exactly one start and one end per key, and an end that does not precede its start. Crossing pairs need no special case -- run ranges are data, not brackets, so two extents that overlap are two entries. The returned `paired` set names the half ELEMENTS a completed pair consumed, so the caller can give an unpaired annotation start its point-anchor fallback without re-emitting a paired one.
export function pairOdfMarkerHalves(halves: readonly OdfMarkerHalf[], paragraphElement: XmlElement): { extents: RunConstructExtent[]; paired: Set<XmlElement> } {
  const byKey = new Map<string, OdfMarkerHalf[]>();
  for (const half of halves) {
    const existing = byKey.get(half.key);
    if (existing === undefined) {
      byKey.set(half.key, [half]);
    } else {
      existing.push(half);
    }
  }
  const extents: RunConstructExtent[] = [];
  const paired = new Set<XmlElement>();
  for (const pair of byKey.values()) {
    const starts = pair.filter((half) => half.side === 'start');
    const ends = pair.filter((half) => half.side === 'end');
    const open = starts[0];
    const close = ends[0];
    if (starts.length !== 1 || ends.length !== 1 || open === undefined || close === undefined) {
      continue;
    }
    if (close.runPosition < open.runPosition) {
      continue;
    }
    if (isOdfBlockScopedHalf(open, paragraphElement) && isOdfBlockScopedHalf(close, paragraphElement)) {
      continue;
    }
    const descriptor = open.descriptor();
    if (descriptor === undefined) {
      continue;
    }
    extents.push({ descriptor, startRun: open.runPosition, endRun: close.runPosition });
    paired.add(open.element);
    paired.add(close.element);
  }
  return { extents, paired };
}

// --- block-scope construct extents and marker splicing ------------------------------------------------------------

// One construct's span over a block list, half-open: startIndex is the first block it covers, endIndex one past the last, so a point construct has startIndex === endIndex. `order` is discovery order in the source, the deterministic tie-break between two extents covering the identical range.
export interface OdfConstructExtent {
  readonly startIndex: number;
  readonly endIndex: number;
  readonly order: number;
  readonly descriptor: ConstructDescriptor;
}

// Outermost first at a shared start (the longer extent opens before the one nested inside it), then source order.
function compareOdfExtents(a: OdfConstructExtent, b: OdfConstructExtent): number {
  return a.startIndex - b.startIndex || b.endIndex - a.endIndex || a.order - b.order;
}

// The flat form pairs markers as balanced brackets, so a crossing extent -- one that opens inside another and closes outside it -- has no encoding at all: bracket matching would re-pair the two into a nesting the source never had. Crossing pairs are dropped here, which is the drop document-schema.js ratifies for block-scoped crossings; within one paragraph, by contrast, crossing extents stay as two entries on the paragraph's constructs field, because run ranges are data rather than brackets. Wrapper elements (text:section, an index wrapper) nest by XML construction and can never cross; only the paired-marker families (bookmarks, tracked changes, annotations) can produce a crossing pair.
function acceptProperlyNestedOdfExtents(extents: readonly OdfConstructExtent[]): OdfConstructExtent[] {
  const sorted = [...extents].sort(compareOdfExtents);
  const accepted: OdfConstructExtent[] = [];
  const open: OdfConstructExtent[] = [];
  for (const extent of sorted) {
    while (open.length > 0 && open[open.length - 1]!.endIndex <= extent.startIndex) {
      open.pop();
    }
    const enclosing = open[open.length - 1];
    if (enclosing !== undefined && enclosing.endIndex < extent.endIndex) {
      continue;
    }
    accepted.push(extent);
    open.push(extent);
  }
  return accepted;
}

// Splices each extent's constructStart/constructEnd pair into the block list around the blocks it covers, producing the flat encoding document-schema.js's findConstructMarkerImbalance validates: markers balance, and a close always matches the nearest still-open start in the same list. The identical algorithm ooxml.js's typed/docx/constructs.ts runs over WordprocessingML, reimplemented here because odf.js deliberately does not depend on that package.
export function insertOdfConstructMarkers(blocks: readonly ContentBlock[], extents: readonly OdfConstructExtent[]): ContentBlock[] {
  if (extents.length === 0) {
    return [...blocks];
  }
  const nested = acceptProperlyNestedOdfExtents(extents);
  const openingAt = new Map<number, OdfConstructExtent[]>();
  for (const extent of nested) {
    const existing = openingAt.get(extent.startIndex);
    if (existing === undefined) {
      openingAt.set(extent.startIndex, [extent]);
    } else {
      existing.push(extent);
    }
  }

  const out: ContentBlock[] = [];
  const open: OdfConstructExtent[] = [];
  for (let index = 0; index <= blocks.length; index += 1) {
    while (open.length > 0 && open[open.length - 1]!.endIndex === index) {
      open.pop();
      out.push({ kind: 'constructEnd' });
    }
    for (const extent of openingAt.get(index) ?? []) {
      out.push({ kind: 'constructStart', descriptor: extent.descriptor });
      if (extent.endIndex === index) {
        out.push({ kind: 'constructEnd' });
      } else {
        open.push(extent);
      }
    }
    const block = blocks[index];
    if (block !== undefined) {
      out.push(block);
    }
  }
  return out;
}

// A marker half promoted to block scope: the block index it opens or closes at (a leading half at its own paragraph's position, a trailing one just past it -- mirroring how ooxml.js's bookmark events index a leading half at the paragraph and a trailing one at endIndex), whether it actually qualified, and the discovery order.
export interface OdfMarkerEvent {
  readonly kind: OdfMarkerKind;
  readonly side: 'start' | 'end';
  readonly key: string;
  readonly index: number;
  readonly qualified: boolean;
  readonly order: number;
  readonly descriptor: () => RunConstructExtent['descriptor'] | undefined;
  readonly element: XmlElement;
}

// Pairs the flow's marker events by (kind, key) into block-scoped extents. A pair survives only when it has exactly one start and one end, both halves qualified (sat at a paragraph edge), a descriptor that resolves, and an end that does not precede its start. Everything else -- a half whose partner sits interior to some paragraph, a pair split across two block lists (inside a table cell and outside it), a dangling half -- has no block-scoped encoding and stays dropped, the same rules the docx flow applies to w:bookmarkStart/End for the same reasons. The returned `paired` set names the half ELEMENTS a completed pair consumed, for the same unpaired-annotation fallback the paragraph-level pairing reports.
export function resolveOdfMarkerEvents(events: readonly OdfMarkerEvent[]): { extents: OdfConstructExtent[]; paired: Set<XmlElement> } {
  const byKey = new Map<string, OdfMarkerEvent[]>();
  for (const event of events) {
    const mapKey = `${event.kind} ${event.key}`;
    const existing = byKey.get(mapKey);
    if (existing === undefined) {
      byKey.set(mapKey, [event]);
    } else {
      existing.push(event);
    }
  }
  const extents: OdfConstructExtent[] = [];
  const paired = new Set<XmlElement>();
  for (const pair of byKey.values()) {
    const starts = pair.filter((event) => event.side === 'start' && event.qualified);
    const ends = pair.filter((event) => event.side === 'end' && event.qualified);
    const open = starts[0];
    const close = ends[0];
    if (starts.length !== 1 || ends.length !== 1 || open === undefined || close === undefined) {
      continue;
    }
    if (close.index < open.index) {
      continue;
    }
    const descriptor = open.descriptor();
    if (descriptor === undefined) {
      continue;
    }
    extents.push({ startIndex: open.index, endIndex: close.index, order: open.order, descriptor });
    paired.add(open.element);
    paired.add(close.element);
  }
  return { extents, paired };
}

// --- tracked changes (text:tracked-changes / text:changed-region) --------------------------------------------------

// Which text:changed-region child names which kind of change. The moveFrom/moveTo members of ProvenanceChange have no ODF counterpart (a move is spelled as a deletion plus an insertion) and are never minted here.
const ODF_PROVENANCE_CHANGE_BY_TAG: ReadonlyMap<string, 'insertion' | 'deletion' | 'formatChange'> = new Map([
  ['text:insertion', 'insertion'],
  ['text:deletion', 'deletion'],
  ['text:format-change', 'formatChange'],
]);

// A region's own id: ODF 1.2 spells it xml:id, ODF 1.0 spelled it text:id, and both spellings exist in real files -- the version transition is a format fact, not a guess about which one producer output carries.
export function odfChangedRegionId(region: XmlElement): string | undefined {
  return attrValue(region, 'xml:id') ?? attrValue(region, 'text:id');
}

// Collects every text:tracked-changes container's text:changed-region children, anywhere in the node tree (ODF permits the container anywhere in the text body), into id -> ProvenanceDescriptor. A region whose child names no known change kind is skipped whole: a provenance descriptor without a change is not a value this vocabulary can express, and a guessed change would misreport the region.
export function collectOdfProvenanceRegions(nodes: readonly XmlNode[], out: Map<string, ProvenanceDescriptor>): void {
  for (const region of elementsWithTag(nodes, 'text:changed-region')) {
    const id = odfChangedRegionId(region);
    if (id === undefined) {
      continue;
    }
    const changeChild = region.children.find((child): child is XmlElement => child.type === 'element' && ODF_PROVENANCE_CHANGE_BY_TAG.has(child.tag));
    if (changeChild === undefined) {
      continue;
    }
    const change = ODF_PROVENANCE_CHANGE_BY_TAG.get(changeChild.tag)!;
    const descriptor: ProvenanceDescriptor = { kind: 'provenance', change };
    const changeInfo = changeChild.children.find((child): child is XmlElement => child.type === 'element' && child.tag === 'office:change-info');
    if (changeInfo !== undefined) {
      const creator = changeInfo.children.find((child): child is XmlElement => child.type === 'element' && child.tag === 'dc:creator');
      if (creator !== undefined) {
        descriptor.author = decodeOdfText(creator);
      }
      const date = changeInfo.children.find((child): child is XmlElement => child.type === 'element' && child.tag === 'dc:date');
      if (date !== undefined) {
        descriptor.dateIso = decodeOdfText(date);
      }
    }
    out.set(id, descriptor);
  }
}

// --- field master declarations (text:*-decls) ------------------------------------------------------------------------

const ODF_FIELD_MASTER_CONTAINERS: ReadonlyMap<string, string> = new Map([
  ['text:variable-decls', 'variable'],
  ['text:user-field-decls', 'user-field'],
  ['text:sequence-decls', 'sequence'],
]);

// The declaration attributes a definitions entry carries, keyed as the entry spells them. Values stay verbatim strings -- office:value-type names the interpretation, and coercing it here would freeze a typing the entry vocabulary has not settled. text:display-outline-level is the one integer (a sequence's outline association), parsed when it is one and carried as nothing when it is not.
function readOdfFieldMasterEntry(family: string, decl: XmlElement): { key: string; entry: DefinitionEntry } | undefined {
  const name = attrValue(decl, 'text:name');
  if (name === undefined) {
    return undefined;
  }
  const entry: DefinitionEntry = { kind: 'fieldMaster', family, name };
  const valueType = attrValue(decl, 'office:value-type');
  if (valueType !== undefined) {
    entry.valueType = valueType;
  }
  const value = attrValue(decl, 'office:value');
  if (value !== undefined) {
    entry.value = value;
  }
  const stringValue = attrValue(decl, 'office:string-value');
  if (stringValue !== undefined) {
    entry.stringValue = stringValue;
  }
  const formula = attrValue(decl, 'text:formula');
  if (formula !== undefined) {
    entry.formula = formula;
  }
  const displayOutlineLevel = attrValue(decl, 'text:display-outline-level');
  if (displayOutlineLevel !== undefined) {
    const parsed = Number.parseInt(displayOutlineLevel, 10);
    if (Number.isInteger(parsed) && parsed >= 0) {
      entry.displayOutlineLevel = parsed;
    }
  }
  return { key: `${family}:${name}`, entry };
}

// Collects every field-master declaration container, anywhere in the node tree, into the definitions table the package root carries: the declaration side of ODF's field system, the sibling of the run-level field instances paragraph.ts reads. Keys are namespaced per family (variable:total, user-field:rate, sequence:Table) because ODF style-like name uniqueness does not hold across the three families -- the same bare name may legally be declared twice in different families, and one definitions table is one key namespace.
export function collectOdfFieldMasterDefinitions(nodes: readonly XmlNode[], out: Record<string, DefinitionEntry>): void {
  for (const [containerTag, family] of ODF_FIELD_MASTER_CONTAINERS) {
    for (const container of elementsWithTag(nodes, containerTag)) {
      for (const decl of container.children) {
        if (decl.type !== 'element') {
          continue;
        }
        const read = readOdfFieldMasterEntry(family, decl);
        if (read !== undefined) {
          out[read.key] = read.entry;
        }
      }
    }
  }
}
