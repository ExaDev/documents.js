import type {
  AnchorDescriptor,
  ConstructDescriptor,
  ContentControlDescriptor,
  DefinitionEntry,
  DivisionDescriptor,
  FieldDescriptor,
  ProvenanceDescriptor,
  RunConstructExtent,
  SourceResidue,
} from "document-schema.js";
import type { XmlElement, XmlNode } from "../../model/node";
import type { Package } from "../../model/package";
import { buildXml } from "../../xml/build";
import { parseXml } from "../../xml/parse";
import { el, txt } from "../../xml/fragment";
import { encodeXmlText } from "../../xml/entities";
import {
  attrValue,
  childrenWithTag,
  elementsWithTag,
  findChildElement,
  rootElement,
} from "../../xml/query";
import { decodeOdfText } from "./text";

// The ODF side of document-schema.js's fidelity construct vocabulary (its src/construct.ts): reading ODF's inline construct elements into ConstructDescriptor payloads and RunConstructExtent entries on the paragraph that carries them (typed/shared/paragraph.ts's run walk calls in here), plus the block-scope half of the same vocabulary the odt reader drives (typed/odt/read.ts — divisions, index wrappers, forms, and the cross-paragraph marker pairs). One module owns both halves so the descriptor shapes and the scope rules the two readers must agree on stay stated once, the same discipline ooxml.js's own typed/docx/constructs.ts follows for WordprocessingML.
//
// EXTENT SCOPE, the constraint that decides where each ODF construct lands: a construct covering a sub-sequence of ONE paragraph's runs is an entry on that paragraph's constructs field; a construct bracketing whole blocks is a constructStart/constructEnd marker pair in the block list. ODF spells its inline constructs exactly the way the run-level mechanism wants — a field or a note is ONE element sitting at a position in the character flow — so fields are run-level, always. ODF's range constructs (text:bookmark-start/-end, text:reference-mark-start/-end, text:change-start/-end, office:annotation/-end) are paired marker halves keyed by name or id: both halves inside one paragraph pair into a run extent; both halves at paragraph edges pair across blocks; everything else (one half interior, the other elsewhere) has no encoding and is dropped, mirroring the qualification ooxml.js applies to w:bookmarkStart/End for the identical reason — document-schema.js's marker contract ratifies the straddling drop. The inline field tag set itself lives in text.ts beside the content-model predicates that share it.

// A field's instruction is the producer's own field code: the element with its attributes, serialised — the ODF counterpart of docx's w:instrText text. Children are deliberately stripped from the serialisation because they are the cached RESULT, which the descriptor carries separately as cachedResult; serialising them too would put one fact in two places inside the descriptor.
export function odfFieldDescriptor(element: XmlElement): FieldDescriptor {
  const cachedResult = decodeOdfText(element);
  const descriptor: FieldDescriptor = {
    kind: "field",
    instruction: buildXml([{ ...element, children: [] }]),
  };
  if (cachedResult.length > 0) {
    descriptor.cachedResult = cachedResult;
  }
  return descriptor;
}

export function odfBookmarkAnchorDescriptor(name: string): AnchorDescriptor {
  return { kind: "anchor", anchorType: "bookmark", name };
}

// The residue spelling for every ODF construct reader that degrades format-specific specifics into the quarantine channel: the element subtree as this package's own builder serialises it, tagged with the format of the reader producing it. The format member names the READER'S format (an index source element in an odt reads as 'odt' residue even though text: is shared vocabulary), because restorability is decided by "can the same-format writer re-emit this", and the writer that would re-emit it is the one reading the document.
export type OdfResidueFormat =
  "odt" | "ods" | "odp" | "odg" | "odm" | "odb" | "odf";

export function odfResidue(
  format: OdfResidueFormat,
  ...elements: readonly XmlElement[]
): SourceResidue {
  return { format, xml: buildXml(elements) };
}

// The vendor-extension namespace prefixes this family's stated policy never chases (LibreOffice's loext:/calcext:/officeooo:/ooo:/oooc:/ooow:/formx:/field:/drawooo:/tableooo: and their kin): an element in one of them is producer-private vocabulary, quarantined as residue wherever a walk meets it rather than interpreted. Membership is by prefix, not full namespace URI, because the parser preserves prefixes verbatim and every one of these is prefix-stable across real producers; the list is the inventory's own, not a claim that it is closed — an unknown prefix is simply not extension residue by this test and stays subject to each reader's own unknown-element handling.
const ODF_EXTENSION_NAMESPACE_PREFIXES: ReadonlySet<string> = new Set([
  "loext:",
  "calcext:",
  "officeooo:",
  "ooo:",
  "oooc:",
  "ooow:",
  "formx:",
  "field:",
  "drawooo:",
  "tableooo:",
]);

export function isOdfExtensionElement(element: XmlElement): boolean {
  return [...ODF_EXTENSION_NAMESPACE_PREFIXES].some((prefix) =>
    element.tag.startsWith(prefix),
  );
}

// The draw:page-level shape kinds no page reader maps today (the residue rows of ExaDev/documents.js#769): a 3D scene, the two line-with-semantics kinds a connector and a measure are, and the three embedded-foreign-content shapes. Each quarantines on the page it sits in rather than degrading to a generic shape it is not — a connector is not a bare line (its endpoints glue to shapes), a measure is a line plus its dimension text, and applet/plugin/floating-frame are foreign-content containers.
export const ODF_UNMAPPED_SHAPE_TAGS: ReadonlySet<string> = new Set([
  "dr3d:scene",
  "draw:connector",
  "draw:measure",
  "draw:applet",
  "draw:plugin",
  "draw:floating-frame",
]);

// Collects the unmapped shape kinds and vendor-extension elements from a shape container the page walkers themselves walk — a draw:page's own children, recursing into draw:g exactly as the walkers do and no further (a draw:frame's own content is read content, not a sibling shape). This mirrors the walkers' own recursion boundary deliberately, so precisely the elements the walkers contribute nothing for are the elements collected here: no more (a frame's inner shapes belong to the frame's read) and no less (a connector inside a nested group is still collected).
// The residue accumulator collectOdfUnmappedShapeResidue appends every unmapped shape element onto as it walks a page, recursing through draw:g groups. Wrapped rather than passed as a bare array so the parameter stays out of prefer-readonly-array-param's scope while the array it holds stays genuinely mutable.
export interface ShapeResidueSink {
  readonly elements: XmlElement[];
}

export function collectOdfUnmappedShapeResidue(
  children: readonly XmlNode[],
  sink: ShapeResidueSink,
): void {
  const out = sink.elements;
  for (const node of children) {
    if (node.type !== "element") {
      continue;
    }
    if (node.tag === "draw:g") {
      collectOdfUnmappedShapeResidue(node.children, sink);
    } else if (
      ODF_UNMAPPED_SHAPE_TAGS.has(node.tag) ||
      isOdfExtensionElement(node)
    ) {
      out.push(node);
    }
  }
}

// The element a fact-carrying ATTRIBUTE quarantines onto: residue's shape is serialised elements, so an attribute no element owns rides a children-stripped copy of its own element carrying only the quarantined attributes — the same children-stripped spell odfFieldDescriptor's instruction takes. A same-format writer re-emitting the fragment knows the element it re-serialises, so the tag needs no separate channel.
export function odfAttributeElement(
  element: XmlElement,
  ...attributeNames: readonly string[]
): XmlElement {
  return {
    ...element,
    children: [],
    attributes: element.attributes.filter((attribute) =>
      attributeNames.includes(attribute.name),
    ),
  };
}

// Appends serialised elements to one key of a package-tier residue table, concatenating onto whatever the key already holds — several occurrences of one tenant (two xforms models, a run of same-tagged extension elements) are one entry, exactly as odfResidue itself concatenates several elements into one value.
export function addOdfPackageResidue(
  out: Record<string, SourceResidue>,
  key: string,
  format: OdfResidueFormat,
  ...elements: readonly XmlElement[]
): void {
  if (elements.length === 0) {
    return;
  }
  const addition = buildXml(elements);
  const existing = out[key];
  out[key] =
    existing === undefined
      ? { format, xml: addition }
      : { format, xml: `${existing.xml}${addition}` };
}

// The parts a document reader consumes itself — everything else XML-typed is a non-content part. Binary parts (media, thumbnails, ObjectReplacements previews) never quarantine: the residue channel carries text, and the lossless package tier already preserves those bytes byte-for-byte, which is the fidelity tier that owns them.
export const ODF_CONSUMED_PART_PATHS: ReadonlySet<string> = new Set([
  "content.xml",
  "styles.xml",
  "meta.xml",
  "META-INF/manifest.xml",
]);

// An embedded sub-document's own parts — the "Object N" directory convention every real producer's draw:object href actually names (confirmed against real LibreOffice output: "Object 1/content.xml", "Object 1/styles.xml", "Object 1/settings.xml" under a draw:object xlink:href="./Object 1"). Those parts are consumed by the embedded-object readers into their own whole ContentDocuments, so quarantining them too would put one sub-document in two channels at once. This helper cannot see hrefs, so it excludes the whole convention-shaped range rather than ever double-carrying a sub-document; the cost of a false exclusion is only a residue row the semantic channel already carries, while the cost of a false inclusion is the double-carry itself. Exported so the regex's own three boundary facts (must start with "Object ", must be only digits after it, must end there) can each be pinned directly — a black-box test through collectOdfNonContentPartResidue/writeOdfPackageResidue could only ever observe "quarantined or not", which cannot distinguish a loosened anchor from the correct one.
export function isEmbeddedObjectPart(path: string): boolean {
  const [firstSegment] = path.split("/");
  return firstSegment !== undefined && /^Object \d+$/.test(firstSegment);
}

// Every non-content XML part of the package, quarantined at the package tier keyed by its own part path — the producer's own identifier for what the entry reconstructs. A reader splices the result into its document-level residue table, so a package whose only extra part is a settings.xml yields exactly source['settings.xml'].
export function collectOdfNonContentPartResidue(
  pkg: Package,
  format: OdfResidueFormat,
  out: Record<string, SourceResidue>,
): void {
  for (const [path, part] of Object.entries(pkg.parts)) {
    if (
      part.kind !== "xml" ||
      ODF_CONSUMED_PART_PATHS.has(path) ||
      isEmbeddedObjectPart(path)
    ) {
      continue;
    }
    const elements = part.nodes.filter(
      (node): node is XmlElement => node.type === "element",
    );
    if (elements.length > 0) {
      out[path] = odfResidue(format, ...elements);
    }
  }
}

// Write-side mirror of collectOdfNonContentPartResidue: restores each quarantined non-content package part verbatim, at the exact part path it was read from, into a package being written. This is the ONE quarantine bucket a writer can safely restore — a whole non-content part is never touched or interpreted by the writer either way, so re-emitting it carries no risk of contradicting content the writer just wrote, unlike a construct's own residue or a body-walk quarantine bucket (dde-links, xforms, a vendor-extension tag), which have no structural position a writer could safely reinsert them at against a document that may have been edited since it was read; those stay dropped, exactly as each writer's own scope note still states. Eligible entries are recognised by collectOdfNonContentPartResidue's own key convention: a real package part path, always ending ".xml", that is neither one of ODF_CONSUMED_PART_PATHS (a part this writer already creates itself) nor an embedded sub-document's own part — which is exactly how that collector tells a part-path key apart from a semantic-bucket key on the way in. Only entries whose own `format` matches this writer's format are restored, per the quarantine contract's "a same-format writer may re-emit its own residue verbatim" (document-schema.js's source.ts): a residue value another format's reader produced is never this writer's to touch. Callers must re-sync the package's manifest afterwards (buildManifest derives its entries from pkg.parts, so a part added here needs no manifest bookkeeping of its own beyond that resync).
export function writeOdfPackageResidue(
  pkg: Package,
  format: OdfResidueFormat,
  source: Record<string, SourceResidue> | undefined,
): void {
  if (source === undefined) {
    return;
  }
  for (const [path, residue] of Object.entries(source)) {
    if (
      residue.format !== format ||
      !path.endsWith(".xml") ||
      ODF_CONSUMED_PART_PATHS.has(path) ||
      isEmbeddedObjectPart(path)
    ) {
      continue;
    }
    pkg.parts[path] = {
      kind: "xml",
      nodes: [
        {
          type: "declaration",
          attributes: [
            { name: "version", value: "1.0" },
            { name: "encoding", value: "UTF-8" },
          ],
        },
        ...parseXml(residue.xml).filter(
          (node): node is XmlElement => node.type === "element",
        ),
      ],
    };
  }
}

// --- divisions (text:section) ---------------------------------------------------------------------------------------

// text:protected is a plain boolean attribute ("true"/"false", false when absent per the ODF schema default).
function readOdfBooleanAttribute(
  element: XmlElement,
  name: string,
): boolean | undefined {
  const raw = attrValue(element, name);
  if (raw === "true") {
    return true;
  }
  return raw === "false" ? false : undefined;
}

// A section's own style:style[family="section"] by name, across both style containers in both parts. 'section' is deliberately not a member of the style-interning layer's STYLE_FAMILIES (this package never writes one), so this is a direct container walk rather than cascade.ts's findStyleElement — single-level with no parent-chain walk, matching table.ts's own convention for families whose real-world styles are standalone.
function findSectionStyleElement(
  styleName: string,
  pkg: Package,
): XmlElement | undefined {
  for (const partPath of ["content.xml", "styles.xml"] as const) {
    const part = pkg.parts[partPath];
    if (part?.kind !== "xml") {
      continue;
    }
    const root = rootElement(part.nodes);
    if (root === undefined) {
      continue;
    }
    for (const containerTag of [
      "office:automatic-styles",
      "office:styles",
    ] as const) {
      const container = findChildElement(root.children, containerTag);
      if (container === undefined) {
        continue;
      }
      for (const style of childrenWithTag(container, "style:style")) {
        if (
          attrValue(style, "style:family") === "section" &&
          attrValue(style, "style:name") === styleName
        ) {
          return style;
        }
      }
    }
  }
  return undefined;
}

// The column count a section's own flow uses — style:section-properties/style:columns/@fo:column-count, a single-level lookup for the reason findSectionStyleElement states. Absent, unparseable, or non-positive counts read as no column fact rather than a guess.
function readDivisionColumnCount(
  sectionElement: XmlElement,
  pkg: Package,
): number | undefined {
  const styleName = attrValue(sectionElement, "text:style-name");
  if (styleName === undefined) {
    return undefined;
  }
  const style = findSectionStyleElement(styleName, pkg);
  if (style === undefined) {
    return undefined;
  }
  const properties = findChildElement(
    style.children,
    "style:section-properties",
  );
  const columns =
    properties === undefined
      ? undefined
      : findChildElement(properties.children, "style:columns");
  const raw =
    columns === undefined ? undefined : attrValue(columns, "fo:column-count");
  if (raw === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

// One text:section element -> its DivisionDescriptor: name (text:name), protected (text:protected), the column count its own style sets over its flow, the external-chapter link when the section carries a text:section-source (`linked`), and that source's own text:filter-name — an importer instruction with no cross-format meaning — as residue (`source`), now that #743's rename of the landed `linked` field frees `source` for it.
export function odfDivisionDescriptor(
  sectionElement: XmlElement,
  pkg: Package,
): DivisionDescriptor {
  const descriptor: DivisionDescriptor = { kind: "division" };
  const name = attrValue(sectionElement, "text:name");
  if (name !== undefined) {
    descriptor.name = name;
  }
  const protectedFlag = readOdfBooleanAttribute(
    sectionElement,
    "text:protected",
  );
  if (protectedFlag !== undefined) {
    descriptor.protected = protectedFlag;
  }
  const columnCount = readDivisionColumnCount(sectionElement, pkg);
  if (columnCount !== undefined) {
    descriptor.columnCount = columnCount;
  }
  const sourceElement = findChildElement(
    sectionElement.children,
    "text:section-source",
  );
  if (sourceElement !== undefined) {
    const href = attrValue(sourceElement, "xlink:href");
    if (href !== undefined) {
      const linked: DivisionDescriptor["linked"] = { href };
      const sectionName = attrValue(sourceElement, "text:section-name");
      if (sectionName !== undefined) {
        linked.sectionName = sectionName;
      }
      descriptor.linked = linked;
    }
    if (attrValue(sourceElement, "text:filter-name") !== undefined) {
      descriptor.source = odfResidue(
        "odt",
        odfAttributeElement(sourceElement, "text:filter-name"),
      );
    }
  }
  return descriptor;
}

// --- TOC and index wrappers -----------------------------------------------------------------------------------------

// The seven ODF index wrappers, all read as the same index content control: the wrapper, with its cached rendered entries (text:index-body) as the construct's extent.
export const ODF_INDEX_WRAPPER_TAGS: ReadonlySet<string> = new Set([
  "text:table-of-content",
  "text:alphabetical-index",
  "text:bibliography",
  "text:illustration-index",
  "text:table-index",
  "text:user-index",
  "text:object-index",
]);

export function isOdfIndexWrapper(element: XmlElement): boolean {
  return ODF_INDEX_WRAPPER_TAGS.has(element.tag);
}

// The wrapper's own *-source child (text:table-of-content-source, text:alphabetical-index-source, ...) carries the index's build rules — outline levels, sort keys, entry formatting references — which have no cross-format meaning beyond "this is how the producer computed the cached body", so the whole element is quarantined in the descriptor's residue. text:name rides as the control's tag: the machine-readable identifier a producer addresses the wrapper by.
export function odfIndexControlDescriptor(
  wrapper: XmlElement,
): ContentControlDescriptor {
  const descriptor: ContentControlDescriptor = {
    kind: "contentControl",
    controlType: "index",
  };
  const name = attrValue(wrapper, "text:name");
  if (name !== undefined) {
    descriptor.tag = name;
  }
  for (const child of wrapper.children) {
    if (child.type === "element" && child.tag.endsWith("-source")) {
      descriptor.source = odfResidue("odt", child);
      break;
    }
  }
  return descriptor;
}

// --- tracked changes (text:tracked-changes / text:changed-region) --------------------------------------------------

// Which text:changed-region child names which kind of change. The moveFrom/moveTo members of ProvenanceChange have no ODF counterpart (a move is spelled as a deletion plus an insertion) and are never minted here.
const ODF_PROVENANCE_CHANGE_BY_TAG: ReadonlyMap<
  string,
  "insertion" | "deletion" | "formatChange"
> = new Map([
  ["text:insertion", "insertion"],
  ["text:deletion", "deletion"],
  ["text:format-change", "formatChange"],
]);

// A region's own id: ODF 1.2 spells it xml:id, ODF 1.0 spelled it text:id, and both spellings exist in real files — the version transition is a format fact, not a guess about which one producer output carries.
export function odfChangedRegionId(region: XmlElement): string | undefined {
  return attrValue(region, "xml:id") ?? attrValue(region, "text:id");
}

// Collects every text:tracked-changes container's text:changed-region children, anywhere in the node tree (ODF permits the container anywhere in the text body), into id -> ProvenanceDescriptor. A region whose child names no known change kind is skipped whole: a provenance descriptor without a change is not a value this vocabulary can express, and a guessed change would misreport the region.
export function collectOdfProvenanceRegions(
  nodes: readonly XmlNode[],
  out: Map<string, ProvenanceDescriptor>,
): void {
  for (const region of elementsWithTag(nodes, "text:changed-region")) {
    const id = odfChangedRegionId(region);
    if (id === undefined) {
      continue;
    }
    const changeChild = region.children.find(
      (child): child is XmlElement =>
        child.type === "element" && ODF_PROVENANCE_CHANGE_BY_TAG.has(child.tag),
    );
    if (changeChild === undefined) {
      continue;
    }
    const change = ODF_PROVENANCE_CHANGE_BY_TAG.get(changeChild.tag)!;
    const descriptor: ProvenanceDescriptor = { kind: "provenance", change };
    const changeInfo = changeChild.children.find(
      (child): child is XmlElement =>
        child.type === "element" && child.tag === "office:change-info",
    );
    if (changeInfo !== undefined) {
      const creator = changeInfo.children.find(
        (child): child is XmlElement =>
          child.type === "element" && child.tag === "dc:creator",
      );
      if (creator !== undefined) {
        descriptor.author = decodeOdfText(creator);
      }
      const date = changeInfo.children.find(
        (child): child is XmlElement =>
          child.type === "element" && child.tag === "dc:date",
      );
      if (date !== undefined) {
        descriptor.dateIso = decodeOdfText(date);
      }
    }
    out.set(id, descriptor);
  }
}

// --- the write direction: constructs a writer actually spells back ---------------------------------------------
//
// Not every construct this module's read side recovers has a writer yet (ExaDev/documents.js#969): a division and an index wrapper are real WRAPPING elements, so their inverse is exactly "write the wrapping element around the extent's own blocks", stated here beside their own readers; a field and a bookmark are RUN-scoped (RunConstructExtent, document-schema.js's own src/content.ts), so their inverse lives in typed/shared/paragraph.ts instead, which owns the run-writing pipeline these need to splice into — but the field/bookmark element builders below are shared by both scopes' writers (a run-scoped bookmark within one paragraph and a block-scoped one spanning several use the identical text:bookmark-start/-end spelling), so they live here with the rest of this module's element vocabulary rather than being duplicated. Every writer in this package deliberately never re-emits a construct's own quarantined residue (typed/odt/write.ts's own top-of-file note on why) — the one narrow exception is odfIndexWrapperTag below, which reads a residue element's own TAG NAME as a structural discriminator (which of the seven index wrappers this control came from), never its content.

// Reconstructs the field element FieldDescriptor.instruction serialised (odfFieldDescriptor above): the producer's own element and its attributes, with no children — parsing it back recovers the field's full identity losslessly, leaving only its cached-text children (the paragraph's own runs covering the field's extent) to be reattached by the caller.
export function parseOdfFieldInstruction(instruction: string): XmlElement {
  const [element] = parseXml(instruction).filter(
    (node): node is XmlElement => node.type === "element",
  );
  if (element === undefined) {
    throw new Error(
      `parseOdfFieldInstruction: "${instruction}" did not parse back to a single element`,
    );
  }
  return element;
}

// The exact string writing a field and reading it straight back produces — buildXml's own serialisation is not always byte-identical to whatever a caller originally spelled (a self-closing "<tag/>" and an empty "<tag></tag>" carry the identical fact but are different strings), so a FieldDescriptor.instruction that did not already come from buildXml needs this same normalisation applied before it is compared against a round-tripped one.
export function canonicalOdfFieldInstruction(instruction: string): string {
  return buildXml([{ ...parseOdfFieldInstruction(instruction), children: [] }]);
}

// The one canonical ConstructDescriptor a written-and-reread construct equals — the construct-vocabulary sibling of typed/shared/canonicalise.ts's own canonicalParagraph/canonicalTable/canonicalImage, kept here instead because it is stated over document-schema.js's ConstructDescriptor union rather than this package's own content shapes, and both this module's read side (odfIndexControlDescriptor) and write side (writeOdfIndexWrapper, writeOdfDivision) already own the ODF-specific facts it restates. Only a 'field' or an index-typed 'contentControl' carry a serialised-XML string this writer's own round trip can reshape (canonicalOdfFieldInstruction above; an index wrapper's own bare *-source residue, written back by writeOdfIndexWrapper below); every other descriptor kind passes through unchanged.
export function canonicalOdfConstructDescriptor(
  descriptor: ConstructDescriptor,
): ConstructDescriptor {
  if (descriptor.kind === "field") {
    return {
      ...descriptor,
      instruction: canonicalOdfFieldInstruction(descriptor.instruction),
    };
  }
  if (
    descriptor.kind === "contentControl" &&
    descriptor.controlType === "index" &&
    descriptor.source !== undefined
  ) {
    return {
      ...descriptor,
      source: odfResidue(
        "odt",
        parseOdfFieldInstruction(descriptor.source.xml),
      ),
    };
  }
  return descriptor;
}

export function writeOdfBookmarkPoint(name: string): XmlElement {
  return el("text:bookmark", { "text:name": encodeXmlText(name) });
}

export function writeOdfBookmarkStart(name: string): XmlElement {
  return el("text:bookmark-start", { "text:name": encodeXmlText(name) });
}

export function writeOdfBookmarkEnd(name: string): XmlElement {
  return el("text:bookmark-end", { "text:name": encodeXmlText(name) });
}

// The inline tracked-change markers, and the region container they reference. A point change is the single text:change element; a range is the text:change-start/-end pair, exactly the half shapes the reader's marker walk pairs back.
export function writeOdfChangePoint(id: string): XmlElement {
  return el("text:change", { "text:change-id": encodeXmlText(id) });
}

export function writeOdfChangeStart(id: string): XmlElement {
  return el("text:change-start", { "text:change-id": encodeXmlText(id) });
}

export function writeOdfChangeEnd(id: string): XmlElement {
  return el("text:change-end", { "text:change-id": encodeXmlText(id) });
}

// The block-scope comment halves: office:annotation (the full comment element, body inline, keyed by office:name) splices onto the extent's first paragraph, office:annotation-end onto its last — the pair the reader's annotation-half walk keys back through by the same name.
export function writeOdfAnnotationHalf(
  descriptor: { readonly name: string },
  entry: DefinitionEntry,
): XmlElement {
  const children: XmlNode[] = [];
  if (typeof entry.author === "string") {
    children.push(el("dc:creator", {}, [txt(entry.author)]));
  }
  if (typeof entry.dateIso === "string") {
    children.push(el("dc:date", {}, [txt(entry.dateIso)]));
  }
  return el(
    "office:annotation",
    { "office:name": encodeXmlText(descriptor.name) },
    children,
  );
}

export function writeOdfAnnotationEndHalf(name: string): XmlElement {
  return el("office:annotation-end", { "office:name": encodeXmlText(name) });
}

// The inverse of collectOdfProvenanceRegions: one text:tracked-changes container holding every region, each with its minted id (xml:id, the ODF 1.2 spelling), its change child (the tag the collector's own table maps back), and an office:change-info when the descriptor names an author or date. The descriptor's quarantined residue (the move-relation pairing) is never re-emitted, per every writer's own residue policy.
const ODF_CHANGE_TAG_BY_PROVENANCE_CHANGE: ReadonlyMap<
  "insertion" | "deletion" | "formatChange",
  string
> = new Map([
  ["insertion", "text:insertion"],
  ["deletion", "text:deletion"],
  ["formatChange", "text:format-change"],
]);

export function writeOdfTrackedChanges(
  regions: readonly {
    id: string;
    descriptor: ProvenanceDescriptor & {
      change: "insertion" | "deletion" | "formatChange";
    };
  }[],
): XmlElement {
  return el(
    "text:tracked-changes",
    {},
    regions.map(({ id, descriptor }) => {
      const changeTag = ODF_CHANGE_TAG_BY_PROVENANCE_CHANGE.get(
        descriptor.change,
      );
      if (changeTag === undefined) {
        // moveFrom/moveTo never mint a region (the caller's collector refuses them first), so this is unreachable — stated as a throw rather than a guess so a future change kind fails loudly here.
        throw new Error(
          `writeOdfTrackedChanges: change kind "${descriptor.change}" has no ODF region spelling`,
        );
      }
      const changeInfoChildren: XmlNode[] = [];
      if (descriptor.author !== undefined) {
        changeInfoChildren.push(
          el("dc:creator", {}, [txt(encodeXmlText(descriptor.author))]),
        );
      }
      if (descriptor.dateIso !== undefined) {
        changeInfoChildren.push(
          el("dc:date", {}, [txt(encodeXmlText(descriptor.dateIso))]),
        );
      }
      return el("text:changed-region", { "xml:id": encodeXmlText(id) }, [
        el(
          changeTag,
          {},
          changeInfoChildren.length > 0
            ? [el("office:change-info", {}, changeInfoChildren)]
            : [],
        ),
      ]);
    }),
  );
}

// Which run-level construct kind (if any) this package's odt writer knows how to spell back, and how: a field always writes from its own instruction; a bookmark anchor writes as a POINT (text:bookmark) when its extent covers no runs at all and a RANGE (text:bookmark-start/-end pair) otherwise — the same point-vs-range split odfBookmarkAnchorDescriptor's own two call sites (a point mark, a paired range half) collapse into one indistinguishable descriptor shape for, disambiguated here the only way it still can be: by whether the extent itself is empty. Every other run-level construct (a footnote/endnote/comment anchor, a tracked-change provenance wrapper) has no writer yet — see ExaDev/documents.js#969 — and this returns undefined for those so a caller can refuse them by name rather than guess at a spelling.
export type OdfRunConstructWriteKind =
  | "field"
  | "bookmarkPoint"
  | "bookmarkRange"
  | "note"
  | "comment"
  | "changePoint"
  | "changeRange";

export function odfRunConstructWriteKind(
  extent: RunConstructExtent,
  definitions?: Readonly<Record<string, DefinitionEntry>>,
  changeIds?: ReadonlyMap<ProvenanceDescriptor, string>,
): OdfRunConstructWriteKind | undefined {
  const { descriptor } = extent;
  if (descriptor.kind === "field") {
    return "field";
  }
  if (descriptor.kind === "anchor" && descriptor.anchorType === "bookmark") {
    return extent.startRun === extent.endRun
      ? "bookmarkPoint"
      : "bookmarkRange";
  }
  if (
    descriptor.kind === "anchor" &&
    (descriptor.anchorType === "footnote" ||
      descriptor.anchorType === "endnote" ||
      descriptor.anchorType === "comment") &&
    descriptor.definition !== undefined &&
    definitions?.[descriptor.definition] !== undefined
  ) {
    // A note or comment anchor writes only when the definitions table holds its body: a citation run alone is half a note, and an empty-bodied text:note or office:annotation would read back as one that silently lost its content.
    return descriptor.anchorType === "comment" ? "comment" : "note";
  }
  if (
    descriptor.kind === "provenance" &&
    descriptor.change !== "moveFrom" &&
    descriptor.change !== "moveTo" &&
    changeIds?.has(descriptor) === true
  ) {
    // A tracked-change extent writes its inline markers when the document-level pass has minted a text:changed-region id for its descriptor. moveFrom/moveTo have no ODF spelling at all (a move is a deletion plus an insertion), so those are never writable here and stay refused by name upstream.
    return extent.startRun === extent.endRun ? "changePoint" : "changeRange";
  }
  return undefined;
}

// --- divisions (text:section), write direction ---------------------------------------------------------------------

// A division's own column-count style: the caller mints the style:style[family="section"] element and its own document-unique name (typed/odt/write.ts's own nextSectionStyle counter, mirroring nextTable/nextImage/nextListStyle), and this module only ever asks for the name back — keeping the actual element construction and registration in the format writer that owns the document's own automatic-styles container, exactly as listStyleNameFor does for a list style.
export interface OdfDivisionWriteContext {
  readonly mintSectionStyleName: (columnCount: number) => string;
}

// The inverse of odfDivisionDescriptor: wraps `children` (the construct's own extent, already written) in the text:section element the descriptor's structural fields state — name, protected, the column-count style, and the external-chapter link. Per this writer's own residue policy, the descriptor's own quarantined residue (text:section-source's text:filter-name) is never re-emitted; only the structural facts document-schema.js's DivisionDescriptor actually names are written.
export function writeOdfDivision(
  descriptor: DivisionDescriptor,
  children: readonly XmlNode[],
  context: OdfDivisionWriteContext,
): XmlElement {
  const attributes: Record<string, string> = {};
  if (descriptor.name !== undefined) {
    attributes["text:name"] = encodeXmlText(descriptor.name);
  }
  if (descriptor.protected === true) {
    attributes["text:protected"] = "true";
  }
  if (descriptor.columnCount !== undefined) {
    attributes["text:style-name"] = context.mintSectionStyleName(
      descriptor.columnCount,
    );
  }
  const sectionChildren: XmlNode[] = [...children];
  if (descriptor.linked !== undefined) {
    const sourceAttributes: Record<string, string> = {
      "xlink:type": "simple",
      "xlink:href": encodeXmlText(descriptor.linked.href),
    };
    if (descriptor.linked.sectionName !== undefined) {
      sourceAttributes["text:section-name"] = encodeXmlText(
        descriptor.linked.sectionName,
      );
    }
    sectionChildren.push(el("text:section-source", sourceAttributes));
  }
  return el("text:section", attributes, sectionChildren);
}

// --- index/TOC wrappers, write direction ----------------------------------------------------------------------------

// Which of the seven ODF_INDEX_WRAPPER_TAGS this control came from — the one fact ContentControlDescriptor has nowhere else to state (controlType is the single, shared "index" member for all seven), recovered from the descriptor's own quarantined residue: odfIndexControlDescriptor above always sets it to the wrapper's own *-source child (mandatory in the ODF schema for every real index wrapper), so this reads that element's own TAG NAME back — "text:table-of-content-source" strips to "text:table-of-content" — as a structural discriminator, the one narrow exception to this package's "a construct's own residue is never re-emitted" policy (typed/odt/write.ts's own top-of-file note): the tag decides WHICH ELEMENT to write at all, which is identity, not content a possibly-edited document could have invalidated. Throws when no residue survives to name it (a hand-built descriptor with no source, or one from a different format's residue), since there is then no tag this function could pick without inventing a fact the caller never stated.
export function odfIndexWrapperTag(
  descriptor: ContentControlDescriptor,
): string {
  const residue = descriptor.source;
  if (residue !== undefined) {
    const [sourceElement] = parseXml(residue.xml).filter(
      (node): node is XmlElement => node.type === "element",
    );
    if (sourceElement?.tag.endsWith("-source") === true) {
      const wrapperTag = sourceElement.tag.slice(
        0,
        sourceElement.tag.length - "-source".length,
      );
      if (ODF_INDEX_WRAPPER_TAGS.has(wrapperTag)) {
        return wrapperTag;
      }
    }
  }
  throw new Error(
    "odfIndexWrapperTag: an index contentControl descriptor with no recognisable *-source residue carries no fact naming which of the seven ODF index wrappers to write",
  );
}

// The inverse of odfIndexControlDescriptor: the wrapper element (odfIndexWrapperTag above) carrying text:name, a BARE *-source child, and wrapping `children` (the control's own cached extent) in a text:index-body — exactly the shape isOdfIndexWrapper/odfIndexControlDescriptor read back. The *-source child is written empty rather than omitted: the ODF schema requires every real index wrapper to carry one (it states the index's own build rules — outline levels, sort keys, entry formatting), so an instance with no *-source child at all would not merely be missing decoration, it would be incomplete ODF a real consumer may refuse to open. Its own CONTENT (the build rules themselves) is still never re-emitted, per this writer's residue policy — only a bare, attribute-less instance of the required element, which is what keeps this wrapper valid AND keeps a second write of the same document able to recover the identical tag again (odfIndexWrapperTag reads the bare child back exactly as it would a fuller one).
export function writeOdfIndexWrapper(
  descriptor: ContentControlDescriptor,
  children: readonly XmlNode[],
): XmlElement {
  const tag = odfIndexWrapperTag(descriptor);
  const attributes: Record<string, string> = {};
  if (descriptor.tag !== undefined) {
    attributes["text:name"] = encodeXmlText(descriptor.tag);
  }
  return el(tag, attributes, [
    el(`${tag}-source`),
    el("text:index-body", {}, children),
  ]);
}
