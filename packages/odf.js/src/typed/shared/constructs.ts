import type { AnchorDescriptor, ConstructDescriptor, ContentBlock, ContentControlDescriptor, DefinitionEntry, DivisionDescriptor, FieldDescriptor, ProvenanceDescriptor, RunConstructExtent, SourceResidue } from 'document-schema.js';
import type { XmlElement, XmlNode } from '../../model/node';
import type { Package } from '../../model/package';
import { buildXml } from '../../xml/build';
import { attrValue, childrenWithTag, elementsWithTag, findChildElement, rootElement } from '../../xml/query';
import { decodeOdfText, isOdfFieldElement } from './text';

// The ODF side of document-schema.js's fidelity construct vocabulary (its src/construct.ts): reading ODF's inline construct elements into ConstructDescriptor payloads and RunConstructExtent entries on the paragraph that carries them (typed/shared/paragraph.ts's run walk calls in here), plus the block-scope half of the same vocabulary the odt reader drives (typed/odt/read.ts -- divisions, index wrappers, forms, and the cross-paragraph marker pairs). One module owns both halves so the descriptor shapes and the scope rules the two readers must agree on stay stated once, the same discipline ooxml.js's own typed/docx/constructs.ts follows for WordprocessingML.
//
// EXTENT SCOPE, the constraint that decides where each ODF construct lands: a construct covering a sub-sequence of ONE paragraph's runs is an entry on that paragraph's constructs field; a construct bracketing whole blocks is a constructStart/constructEnd marker pair in the block list. ODF spells its inline constructs exactly the way the run-level mechanism wants -- a field or a note is ONE element sitting at a position in the character flow -- so fields are run-level, always. ODF's range constructs (text:bookmark-start/-end, text:reference-mark-start/-end, text:change-start/-end, office:annotation/-end) are paired marker halves keyed by name or id: both halves inside one paragraph pair into a run extent; both halves at paragraph edges pair across blocks; everything else (one half interior, the other elsewhere) has no encoding and is dropped, mirroring the qualification ooxml.js applies to w:bookmarkStart/End for the identical reason -- document-schema.js's marker contract ratifies the straddling drop. The inline field tag set itself lives in text.ts beside the content-model predicates that share it.

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

export function odfResidue(format: OdfResidueFormat, ...elements: XmlElement[]): SourceResidue {
  return { format, xml: buildXml(elements) };
}

// The vendor-extension namespace prefixes this family's stated policy never chases (LibreOffice's loext:/calcext:/officeooo:/ooo:/oooc:/ooow:/formx:/field:/drawooo:/tableooo: and their kin): an element in one of them is producer-private vocabulary, quarantined as residue wherever a walk meets it rather than interpreted. Membership is by prefix, not full namespace URI, because the parser preserves prefixes verbatim and every one of these is prefix-stable across real producers; the list is the inventory's own, not a claim that it is closed -- an unknown prefix is simply not extension residue by this test and stays subject to each reader's own unknown-element handling.
const ODF_EXTENSION_NAMESPACE_PREFIXES: ReadonlySet<string> = new Set([
  'loext:',
  'calcext:',
  'officeooo:',
  'ooo:',
  'oooc:',
  'ooow:',
  'formx:',
  'field:',
  'drawooo:',
  'tableooo:',
]);

export function isOdfExtensionElement(element: XmlElement): boolean {
  return [...ODF_EXTENSION_NAMESPACE_PREFIXES].some((prefix) => element.tag.startsWith(prefix));
}

// The draw:page-level shape kinds no page reader maps today (the residue rows of ExaDev/documents.js#769): a 3D scene, the two line-with-semantics kinds a connector and a measure are, and the three embedded-foreign-content shapes. Each quarantines on the page it sits in rather than degrading to a generic shape it is not -- a connector is not a bare line (its endpoints glue to shapes), a measure is a line plus its dimension text, and applet/plugin/floating-frame are foreign-content containers.
export const ODF_UNMAPPED_SHAPE_TAGS: ReadonlySet<string> = new Set(['dr3d:scene', 'draw:connector', 'draw:measure', 'draw:applet', 'draw:plugin', 'draw:floating-frame']);

// Collects the unmapped shape kinds and vendor-extension elements from a shape container the page walkers themselves walk -- a draw:page's own children, recursing into draw:g exactly as the walkers do and no further (a draw:frame's own content is read content, not a sibling shape). This mirrors the walkers' own recursion boundary deliberately, so precisely the elements the walkers contribute nothing for are the elements collected here: no more (a frame's inner shapes belong to the frame's read) and no less (a connector inside a nested group is still collected).
export function collectOdfUnmappedShapeResidue(children: readonly XmlNode[], out: XmlElement[]): void {
  for (const node of children) {
    if (node.type !== 'element') {
      continue;
    }
    if (node.tag === 'draw:g') {
      collectOdfUnmappedShapeResidue(node.children, out);
    } else if (ODF_UNMAPPED_SHAPE_TAGS.has(node.tag) || isOdfExtensionElement(node)) {
      out.push(node);
    }
  }
}

// The element a fact-carrying ATTRIBUTE quarantines onto: residue's shape is serialised elements, so an attribute no element owns rides a children-stripped copy of its own element carrying only the quarantined attributes -- the same children-stripped spell odfFieldDescriptor's instruction takes. A same-format writer re-emitting the fragment knows the element it re-serialises, so the tag needs no separate channel.
export function odfAttributeElement(element: XmlElement, ...attributeNames: readonly string[]): XmlElement {
  return { ...element, children: [], attributes: element.attributes.filter((attribute) => attributeNames.includes(attribute.name)) };
}

// Appends serialised elements to one key of a package-tier residue table, concatenating onto whatever the key already holds -- several occurrences of one tenant (two xforms models, a run of same-tagged extension elements) are one entry, exactly as odfResidue itself concatenates several elements into one value.
export function addOdfPackageResidue(out: Record<string, SourceResidue>, key: string, format: OdfResidueFormat, ...elements: XmlElement[]): void {
  if (elements.length === 0) {
    return;
  }
  const addition = buildXml(elements);
  const existing = out[key];
  out[key] = existing === undefined ? { format, xml: addition } : { format, xml: `${existing.xml}${addition}` };
}

// The parts a document reader consumes itself -- everything else XML-typed is a non-content part. Binary parts (media, thumbnails, ObjectReplacements previews) never quarantine: the residue channel carries text, and the lossless package tier already preserves those bytes byte-for-byte, which is the fidelity tier that owns them.
export const ODF_CONSUMED_PART_PATHS: ReadonlySet<string> = new Set(['content.xml', 'styles.xml', 'meta.xml', 'META-INF/manifest.xml']);

// An embedded sub-document's own parts -- the "Object N" directory convention every real producer's draw:object href actually names (confirmed against real LibreOffice output: "Object 1/content.xml", "Object 1/styles.xml", "Object 1/settings.xml" under a draw:object xlink:href="./Object 1"). Those parts are consumed by the embedded-object readers into their own whole ContentDocuments, so quarantining them too would put one sub-document in two channels at once. This helper cannot see hrefs, so it excludes the whole convention-shaped range rather than ever double-carrying a sub-document; the cost of a false exclusion is only a residue row the semantic channel already carries, while the cost of a false inclusion is the double-carry itself.
function isEmbeddedObjectPart(path: string): boolean {
  const [firstSegment] = path.split('/');
  return firstSegment !== undefined && /^Object \d+$/.test(firstSegment);
}

// Every non-content XML part of the package, quarantined at the package tier keyed by its own part path -- the producer's own identifier for what the entry reconstructs. A reader splices the result into its document-level residue table, so a package whose only extra part is a settings.xml yields exactly source['settings.xml'].
export function collectOdfNonContentPartResidue(pkg: Package, format: OdfResidueFormat, out: Record<string, SourceResidue>): void {
  for (const [path, part] of Object.entries(pkg.parts)) {
    if (part.kind !== 'xml' || ODF_CONSUMED_PART_PATHS.has(path) || isEmbeddedObjectPart(path)) {
      continue;
    }
    const elements = part.nodes.filter((node): node is XmlElement => node.type === 'element');
    if (elements.length > 0) {
      out[path] = odfResidue(format, ...elements);
    }
  }
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

// One text:section element -> its DivisionDescriptor: name (text:name), protected (text:protected), the column count its own style sets over its flow, the external-chapter link when the section carries a text:section-source (`linked`), and that source's own text:filter-name -- an importer instruction with no cross-format meaning -- as residue (`source`), now that #743's rename of the landed `linked` field frees `source` for it.
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
      const linked: DivisionDescriptor['linked'] = { href };
      const sectionName = attrValue(sourceElement, 'text:section-name');
      if (sectionName !== undefined) {
        linked.sectionName = sectionName;
      }
      descriptor.linked = linked;
    }
    if (attrValue(sourceElement, 'text:filter-name') !== undefined) {
      descriptor.source = odfResidue('odt', odfAttributeElement(sourceElement, 'text:filter-name'));
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

// One half of a paired marker construct encountered during a paragraph's run walk: bookmark halves pair by text:name, reference-mark range halves by their own text:name (a separate pairing family -- ODF keeps bookmark names and reference-mark names in separate namespaces, so one document may legally carry a bookmark and a reference-mark under the same name and each must pair only with its own spelling), tracked-change markers by text:change-id, annotations by office:name. `parent` is kept so the pairing can ask whether the half is a DIRECT child of the paragraph element (only a direct child can sit at a paragraph edge and qualify for block scope); a half nested inside a text:span or text:a is interior to the paragraph's run sequence by construction. `runPosition` is the count of runs the walk had emitted when it reached the half -- exactly what a RunConstructExtent's startRun/endRun names. `descriptor` is deferred so the payload is built only for a half that actually wins a pairing, and may resolve to undefined -- a tracked-change half whose text:change-id names no text:changed-region has no descriptor to carry, and both pairings below drop such a pair rather than emitting a marker shell with nothing inside it.
export type OdfMarkerKind = 'bookmark' | 'referenceMark' | 'change' | 'annotation';

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

// The block index a block-scoped half opens or closes at: a leading half sits at its own paragraph's block position, a trailing one just past it (so a leading start with a trailing end in the same paragraph brackets exactly that paragraph), advanced past the lifted-frame blocks that physically precede the half in the paragraph's own child order -- a reader that lifts a paragraph's anchored frames to blocks after it passes that count, so a bookmark ending after a frame covers the frame's block while one ending before it does not. Undefined when the half is not block-scoped -- interior to the paragraph's run sequence, or nested inside a container element.
export function odfMarkerHalfEventIndex(half: OdfMarkerHalf, paragraphElement: XmlElement, paragraphStartIndex: number, liftedBlocksBeforeHalf = 0): number | undefined {
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
  return edge === 'trailing' ? paragraphStartIndex + 1 + liftedBlocksBeforeHalf : undefined;
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

// Pairs one paragraph's own marker halves by their key into run-level construct extents (document-schema.js's RunConstructExtent): a pair both of whose halves sit in THIS paragraph and are not both block-scoped becomes an entry on the paragraph's constructs field. A pair with both halves block-scoped is skipped -- that is the block-marker path's extent (the odt reader emits its constructStart/constructEnd pair, and one occurrence must never carry both encodings); a half whose partner sits in a different paragraph is never seen here at all, so the block reader alone decides its fate. Everything else mirrors the docx rules: exactly one start and one end per pairing family and key (grouped `kind key`, the identical discrimination resolveOdfMarkerEvents applies at block scope -- a bookmark and a reference-mark may share a name and must never pair across their families), and an end that does not precede its start. Crossing pairs need no special case -- run ranges are data, not brackets, so two extents that overlap are two entries. The returned `paired` set names the half ELEMENTS a completed pair consumed, so the caller can give an unpaired annotation start its point-anchor fallback without re-emitting a paired one.
export function pairOdfMarkerHalves(halves: readonly OdfMarkerHalf[], paragraphElement: XmlElement): { extents: RunConstructExtent[]; paired: Set<XmlElement> } {
  const byKey = new Map<string, OdfMarkerHalf[]>();
  for (const half of halves) {
    const existing = byKey.get(`${half.kind} ${half.key}`);
    if (existing === undefined) {
      byKey.set(`${half.kind} ${half.key}`, [half]);
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

// A marker half promoted to block scope: the block index it opens or closes at (a leading half at its own paragraph's position, a trailing one just past it, advanced past the lifted-frame blocks physically preceding the half -- mirroring how ooxml.js's bookmark events index a leading half at the paragraph and a trailing one at endIndex), whether it actually qualified, and the discovery order.
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

// --- data styles and font declarations ------------------------------------------------------------------------------

// The number:* data-style family ODF attaches to cell and field styles: number formats are styles in ODF (office:automatic-styles residents referenced by style:data-style-name), and no harmonised number-format vocabulary exists yet, so each declared style reads as a definitions entry carrying its name and its element VERBATIM -- consumable by name, restorable by a same-format writer, and honest about carrying no interpretation of the format code.
const ODF_DATA_STYLE_TAGS: ReadonlySet<string> = new Set([
  'number:boolean-style',
  'number:currency-style',
  'number:date-style',
  'number:number-style',
  'number:percentage-style',
  'number:text-style',
  'number:time-style',
]);

export function collectOdfDataStyleDefinitions(nodes: readonly XmlNode[], out: Record<string, DefinitionEntry>): void {
  for (const tag of ODF_DATA_STYLE_TAGS) {
    for (const element of elementsWithTag(nodes, tag)) {
      const name = attrValue(element, 'style:name');
      if (name === undefined) {
        continue;
      }
      out[`dataStyle:${name}`] = { kind: 'dataStyle', name, xml: buildXml([element]) };
    }
  }
}

// office:font-face-decls/style:font-face -- font declarations are style definitions in ODF's own model, declared in EITHER part (content.xml and styles.xml each carry their own office:font-face-decls). The declaration's own name and family are structured; the generic and pitch classify for substitution and ride as plain strings.
export function collectOdfFontFaceDefinitions(nodes: readonly XmlNode[], out: Record<string, DefinitionEntry>): void {
  for (const face of elementsWithTag(nodes, 'style:font-face')) {
    const name = attrValue(face, 'style:name');
    const family = attrValue(face, 'svg:font-family');
    if (name === undefined || family === undefined) {
      continue;
    }
    const entry: DefinitionEntry = { kind: 'fontFace', name, fontFamily: family };
    const generic = attrValue(face, 'style:font-family-generic');
    if (generic !== undefined) {
      entry.familyGeneric = generic;
    }
    const pitch = attrValue(face, 'style:font-pitch');
    if (pitch !== undefined) {
      entry.pitch = pitch;
    }
    out[`fontFace:${name}`] = entry;
  }
}

// --- named expressions (ods) ----------------------------------------------------------------------------------------

// A spreadsheet's table:named-expressions declarations into the definitions table: the spreadsheet sibling of field masters, and the natural shared target with xlsx's defined names. table:named-range carries a cell-range-address; table:named-expression carries an OpenFormula expression string -- both verbatim, with the base cell each declaration also states. Keys are namespaced per kind because a range and an expression may legally share a bare name.
export function collectOdfNamedExpressions(nodes: readonly XmlNode[], out: Record<string, DefinitionEntry>): void {
  for (const container of elementsWithTag(nodes, 'table:named-expressions')) {
    for (const child of container.children) {
      if (child.type !== 'element') {
        continue;
      }
      const name = attrValue(child, 'table:name');
      if (name === undefined) {
        continue;
      }
      const baseCellAddress = attrValue(child, 'table:base-cell-address');
      if (child.tag === 'table:named-range') {
        const cellRangeAddress = attrValue(child, 'table:cell-range-address');
        if (cellRangeAddress === undefined) {
          continue;
        }
        const entry: DefinitionEntry = { kind: 'namedRange', name, cellRangeAddress };
        if (baseCellAddress !== undefined) {
          entry.baseCellAddress = baseCellAddress;
        }
        out[`named-range:${name}`] = entry;
      } else if (child.tag === 'table:named-expression') {
        const expression = attrValue(child, 'table:expression');
        if (expression === undefined) {
          continue;
        }
        const entry: DefinitionEntry = { kind: 'namedExpression', name, expression };
        if (baseCellAddress !== undefined) {
          entry.baseCellAddress = baseCellAddress;
        }
        out[`named-expression:${name}`] = entry;
      }
    }
  }
}
