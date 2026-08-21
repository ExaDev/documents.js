import type { AnchorDescriptor, ContentControlDescriptor, DivisionDescriptor, FieldDescriptor, RunConstructExtent, SourceResidue } from 'document-schema.js';
import type { XmlElement, XmlNode } from '../../model/node';
import type { Package } from '../../model/package';
import { buildXml } from '../../xml/build';
import { attrValue, childrenWithTag, findChildElement, rootElement } from '../../xml/query';
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

// One half of a paired marker construct encountered during a paragraph's run walk: bookmark halves pair by text:name, tracked-change markers by text:change-id, annotations by office:name. `parent` is kept so the pairing can ask whether the half is a DIRECT child of the paragraph element (only a direct child can sit at a paragraph edge and qualify for block scope); a half nested inside a text:span or text:a is interior to the paragraph's run sequence by construction. `runPosition` is the count of runs the walk had emitted when it reached the half -- exactly what a RunConstructExtent's startRun/endRun names. `descriptor` is deferred so the payload is built only for a half that actually wins a pairing.
export type OdfMarkerKind = 'bookmark' | 'change' | 'annotation';

export interface OdfMarkerHalf {
  readonly kind: OdfMarkerKind;
  readonly side: 'start' | 'end';
  readonly key: string;
  readonly element: XmlElement;
  readonly parent: XmlElement;
  readonly runPosition: number;
  readonly order: number;
  readonly descriptor: () => RunConstructExtent['descriptor'];
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
function isEdgeIndex(siblings: readonly XmlNode[], index: number): boolean {
  let leading = true;
  for (let before = 0; before < index; before += 1) {
    if (isContentBearingNode(siblings[before]!)) {
      leading = false;
      break;
    }
  }
  if (leading) {
    return true;
  }
  for (let after = index + 1; after < siblings.length; after += 1) {
    if (isContentBearingNode(siblings[after]!)) {
      return false;
    }
  }
  return true;
}

// Whether a half brackets whole blocks rather than a run sub-sequence: a direct child of the paragraph sitting outside every content-bearing sibling. A half whose parent is not the paragraph element (one nested inside a text:span or text:a) is never block-scoped, since its parent is itself content.
export function isOdfBlockScopedHalf(half: OdfMarkerHalf, paragraphElement: XmlElement): boolean {
  if (half.parent !== paragraphElement) {
    return false;
  }
  const index = half.parent.children.indexOf(half.element);
  return index !== -1 && isEdgeIndex(half.parent.children, index);
}

// Pairs one paragraph's own marker halves by their key into run-level construct extents (document-schema.js's RunConstructExtent): a pair both of whose halves sit in THIS paragraph and are not both block-scoped becomes an entry on the paragraph's constructs field. A pair with both halves block-scoped is skipped -- that is the block-marker path's extent (the odt reader emits its constructStart/constructEnd pair, and one occurrence must never carry both encodings); a half whose partner sits in a different paragraph is never seen here at all, so the block reader alone decides its fate. Everything else mirrors the docx rules: exactly one start and one end per key, and an end that does not precede its start. Crossing pairs need no special case -- run ranges are data, not brackets, so two extents that overlap are two entries.
export function pairOdfMarkerHalves(halves: readonly OdfMarkerHalf[], paragraphElement: XmlElement): RunConstructExtent[] {
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
    extents.push({ descriptor: open.descriptor(), startRun: open.runPosition, endRun: close.runPosition });
  }
  return extents;
}
