import type {
  ConstructDescriptor,
  ContentBlock,
  ContentControlDescriptor,
  ContentDocument,
  ContentImageBlock,
  ContentSection,
  ProvenanceDescriptor,
} from "document-schema.js";
import {} from "document-schema.js";
import type { Package, XmlPart } from "../../model/package";
import type { XmlElement, XmlNode } from "../../model/node";
import { el, txt } from "../../xml/fragment";
import { encodeXmlText } from "../../xml/entities";
import { parseXml } from "../../xml/parse";
import type { DocumentMetadata } from "../shared/metadata";
import {} from "../shared/units";
import {
  NOOP_DOCX_WRITE_DIAGNOSTIC_SINK,
  type DocxWriteDiagnosticSink,
} from "./diagnostics";
import { TABLE_OF_CONTENTS_GALLERY } from "./constructs";
import type {
  Comment,
  Footnote,
  HeaderFooterPart,
  SectionHeaderFooterReferences,
} from "./read-schemas";
import type { NumberingDefinitions } from "./numbering";
import { NUMBERING_PART_PATH, buildNumberingElement } from "./numbering";
import {
  COMMENTS_PART_PATH,
  CONTENT_TYPES_NS,
  CORE_PROPS_NS,
  CT_COMMENTS,
  CT_CORE_PROPS,
  CT_DOCUMENT,
  CT_ENDNOTES,
  CT_EXTENDED_PROPS,
  CT_FOOTER,
  CT_FOOTNOTES,
  CT_HEADER,
  CT_NUMBERING,
  CT_STYLES,
  DCTERMS_NS,
  DC_NS,
  DOCUMENT_PART_PATH,
  DRAWINGML_NS,
  DRAWING_PIC_NS,
  DRAWING_WP_NS,
  EMBEDDED_PART_CONTENT_TYPES,
  ENDNOTES_PART_PATH,
  EXTENDED_PROPS_NS,
  FOOTNOTES_PART_PATH,
  MARKUP_COMPAT_NS,
  PKG_RELS_NS,
  REL_COMMENTS,
  REL_CORE_PROPS,
  REL_ENDNOTES,
  REL_EXTENDED_PROPS,
  REL_FOOTNOTES,
  REL_HYPERLINK,
  REL_IMAGE,
  REL_NS,
  REL_NUMBERING,
  REL_OFFICE_DOCUMENT,
  REL_STYLES,
  STYLES_PART_PATH,
  VML_OFFICE_NS,
  W14_NS,
  W15_NS,
  WML_NS,
  XSI_NS,
} from "./write-constants";
import { buildBlockFlow, findParagraph } from "./write-constructs";
import {
  buildCommentsPart,
  buildHeaderFooterParts,
  buildNotesPart,
  buildSectionHeaderFooterReferences,
  buildSectionProperties,
  buildStylesPart,
  collectParagraphStyleIds,
} from "./write-parts";
import type { EmbeddedPayload } from "./write-embedded";

// ContentSection[] -> Package: the write side of readDocxContent, and this package's second writer of genuinely new content after typed/xlsx/build.ts's buildXlsxPackageFromContent (whose part-scaffolding conventions this follows). It builds a complete, fresh docx package — content types, package and document relationships, media parts, core/extended properties, and word/document.xml — rather than editing a decoded one, so a ContentDocument that never came from a docx writes out just as well as one that did.
//
// This is the flat, content-level half of the docx write pair: buildDocxPackage (typed/document-tree.ts) is the primary name, flattening a tree-form DocumentTree (styles-table refs materialised away) and handing the result straight to this function.
//
// It is readDocxContent's honest inverse over ContentSection: page geometry, paragraphs with their fully-resolved direct formatting, runs (including external hyperlinks), lists (against real word/numbering.xml abstractNum/num definitions, when DocxContent.numbering carries any), headings, tables (grids, spans, shading, borders, row heights), page breaks, images, embedded objects, comments, footnotes, endnotes, header/footer parts, and the block-scoped construct markers all survive a round trip through the pair — a degraded gallery's w:docPartObj included, restored from the descriptor's residue (restoreGalleryElement below). What does NOT survive, stated rather than implied:
// - A paragraph's own styleId now always resolves to a real word/styles.xml entry (buildStylesPart below) rather than a dangling w:pStyle reference, but that entry carries no formatting of its own: ContentParagraph.styleId is documented as "round-trip-only... meaningful only to a consumer that already knows that producer's naming convention" (document-schema.js), because resolveParagraphProperties/resolveRunProperties (styles.ts) fully materialise the read-time style cascade into direct formatting and nothing keeps the original cascade, basedOn chain, or display name around to write back. Visual fidelity is unaffected — every property a real style would have contributed is already spelled as direct formatting on the paragraphs/runs that used it — but a consumer expecting styles.xml to carry a style's actual properties (as opposed to merely a name every reference now safely resolves to) will not find them there.
// - An embedded object's VML preview picture is not regenerated: the reader never read one into the model (no VML reader exists, and real producers ship WMF/EMF previews this ecosystem has no writer for), so the written w:object carries only its o:OLEObject payload reference and Word shows a blank until activated. An embedded presentation serialises through the injected port (options.serialiseEmbeddedPresentation — EmbeddedPresentationSerialiser's own comment states why it is a port); without one injected, and for a nested document of any other kind this package cannot serialise (drawing/formula — ODF/MathML spellings), the block is refused with a thrown error rather than silently dropped, inverting the reader's degrade-tier rule at the write boundary where the caller has explicitly asked for a document.
// - Three construct shapes are written as their content with no wrapper, because WordprocessingML has no block-level element for them: a `link` (its own hyperlink is run-level, so a block-scoped link has no element to be), a `division` (no block container answers to one), and a `provenance` whose change is `formatChange` (w:pPrChange is a child of w:pPr describing one paragraph's old properties, not a wrapper over a block flow). A block-scoped `anchor` whose type is `comment` DOES get a wrapper now (a w:commentRangeStart/End pair, mirroring the bookmark case immediately above it in buildConstructNodes); `footnote`/`endnote` anchors have no block-scoped spelling to begin with, since a note reference is inherently a single point, never a multi-paragraph range.
// - Of a paragraph's run-level construct extents (ContentParagraph.constructs), bookmark anchors write back as their w:bookmarkStart/End halves, a comment extent as its w:commentRangeStart/End halves (using the SAME w:id as its word/comments.xml entry, the join key a reader pairs them back through — see interleaveRunConstructExtents below), a comment/footnote/endnote reference mark by injecting its own w:commentReference/footnoteReference/endnoteReference into the run element already sitting at its own recorded index, and fields as their w:fldChar begin/instruction/separate/end characters — all between the runs their ranges name, the exact inverse of the reader's run-position walk. Internal links write back as one w:hyperlink/@w:anchor wrapping exactly the runs they cover. A run extent of any other kind — a contentControl from a legacy w:ffData form field — writes its paragraph's content untouched and loses only the descriptor (rebuilding the ffData control payload is out of scope), and an extent whose range does not name real runs is refused with a thrown error rather than written at a made-up position.
// - A field construct whose extent contains no paragraph at all, and a section whose last block is not a paragraph, each gain one empty paragraph on the way out (the field characters and the section break both need a paragraph to live in). Everything readDocxContent itself produces already has one.
// - A page break immediately before a table or an image — w:pageBreakBefore is a paragraph property, so neither can carry it directly — becomes its own empty paragraph carrying the break, immediately before that content rather than displaced to the end of the flow.

export interface DocxContent {
  readonly metadata?: DocumentMetadata;
  readonly sections: readonly ContentSection[];
  readonly comments?: readonly Comment[];
  readonly footnotes?: readonly Footnote[];
  readonly endnotes?: readonly Footnote[];
  readonly headerFooterParts?: readonly HeaderFooterPart[];
  readonly sectionHeaderFooters?: readonly SectionHeaderFooterReferences[];
  readonly numbering?: NumberingDefinitions;
}

// The port that lets a docx carrying an embedded presentation round-trip (#742): presentation ContentDocument -> whole pptx file bytes. This package has no PresentationML writer of its own (pptx is read-only here), and the one pptx writer in the ecosystem — documents.js's editor scaffold — lives one layer up, where this package cannot reach it without inverting the family's dependency direction. The port resolves that without the inversion: a caller holding a pptx serialiser injects it, and the writer serialises the embedded presentation into a genuine word/embeddings/oleObjectN.pptx payload exactly as an embedded workbook serialises through buildXlsxPackageFromContent. The returned bytes are the OLE payload verbatim — the reader detects the payload by ZIP magic and decodes its flavour from the nested package's own entry part, never by extension or content type, so any conforming pptx byte stream round-trips. An embedded presentation with no serialiser injected is still refused with a thrown error: a silent drop would re-create exactly the read-once-never-written loss the embedded emitter exists to close.
export type EmbeddedPresentationSerialiser = (
  document: Extract<ContentDocument, { kind: "presentation" }>,
) => Uint8Array<ArrayBuffer>;

export interface BuildDocxContentOptions {
  readonly serialiseEmbeddedPresentation?: EmbeddedPresentationSerialiser;
  // The write-side degrade channel (ExaDev/documents.js#1398), reporting a construct this writer could not carry into WordprocessingML at all — today, only a table column's own isHeader (see diagnostics.ts's own TABLE_HEADER_COLUMN_DROPPED comment). Defaults to NOOP_DOCX_WRITE_DIAGNOSTIC_SINK, the same discard-everything default every sink in this family uses when a caller supplies none.
  readonly onDiagnostic?: DocxWriteDiagnosticSink;
}

interface WriteRelationship {
  readonly id: string;
  readonly type: string;
  readonly target: string;
  readonly external: boolean;
}

// The two id-minting counters, pulled out of WriteState proper and shared by reference across every part's own state (buildPartState below): a wp:docPr id only has to be unique within its own containing part per ECMA-376, and a bookmark/tracked-change w:id is conventionally minted document-wide by real producers, so sharing one pair of counters across the document body and every header/footer part it carries costs nothing and avoids the alternative of two different sharing rules for two different id kinds.
interface WriteCounters {
  nextDrawingId: number;
  nextMarkerId: number;
  // Media/embedding FILE names (word/media/imageN.ext, word/embeddings/oleObjectN.ext) are minted from a counter shared across every part for the same reason the ids above are: each header/footer part below gets its own, part-local mediaParts/embeddingParts registry (so a header's own relationship ids never collide with the body's), and those per-part registries are merged into one flat word/media/ and word/embeddings/ folder when the package is assembled — a per-part `size + 1` naming scheme would mint colliding file names (two different parts each writing their own "image1.png") the instant more than one part carries media.
  nextMediaFileId: number;
  nextEmbeddingFileId: number;
  // Content-addressed file minting, shared across every part: one word/media (or word/embeddings) FILE per distinct payload in the whole document, however many parts reference it. Without this, N header/footer parts each carrying the same S-byte payload mint N files totalling N x S — and a hostile input of many near-empty header parts all referencing one large image amplifies a 1 MiB PNG into gigabytes of decoded entries on round trip, exactly the resource-exhaustion shape SECURITY.md's media paragraph names. A part's RELATIONSHIP to the file stays part-local (only that is scoped to the part's own _rels); the bytes are not.
  readonly mediaFiles: Map<string, string>;
  readonly embeddingFiles: Map<string, string>;
}

export interface WriteState {
  readonly relationships: WriteRelationship[];
  readonly hyperlinkIds: Map<string, string>;
  readonly mediaIds: Map<string, string>;
  readonly mediaParts: Map<
    string,
    { format: "png" | "jpeg" | "gif"; base64: string }
  >;
  readonly embeddingIds: Map<string, string>;
  readonly embeddingParts: Map<string, EmbeddedPayload>;
  readonly serialiseEmbeddedPresentation:
    EmbeddedPresentationSerialiser | undefined;
  readonly onDiagnostic: DocxWriteDiagnosticSink;
  readonly counters: WriteCounters;
}

// One WriteState per emitted part (the document body, and each header/footer part below): relationships and hyperlink/media/embedding RELATIONSHIP dedup are deliberately part-local rather than shared — a relationship id (rId1, rId2, ...) is only meaningful within the one part whose own _rels file declares it, so a header reusing an image the body already embedded gets its own relationship, never risking a body-scoped id read back through a header's own relationships. The media/embedding FILES those relationships point at are content-addressed through the shared counters instead (one file per distinct payload document-wide, see WriteCounters' own note), so the per-part mediaParts/embeddingParts registries below are bookkeeping for the assembly merge and content-types build, not copies: two parts referencing one image both record the same file name. `counters` is the one piece of state genuinely shared across every part, for the reason WriteCounters' own comment states.
export function newWriteState(
  options: BuildDocxContentOptions | undefined,
  counters?: WriteCounters,
): WriteState {
  return {
    relationships: [],
    hyperlinkIds: new Map(),
    mediaIds: new Map(),
    mediaParts: new Map(),
    embeddingIds: new Map(),
    embeddingParts: new Map(),
    serialiseEmbeddedPresentation: options?.serialiseEmbeddedPresentation,
    onDiagnostic: options?.onDiagnostic ?? NOOP_DOCX_WRITE_DIAGNOSTIC_SINK,
    counters: counters ?? {
      nextDrawingId: 1,
      nextMarkerId: 1,
      nextMediaFileId: 1,
      nextEmbeddingFileId: 1,
      mediaFiles: new Map(),
      embeddingFiles: new Map(),
    },
  };
}

export function addRelationship(
  state: WriteState,
  type: string,
  target: string,
  external: boolean,
): string {
  const id = `rId${state.relationships.length + 1}`;
  state.relationships.push({ id, type, target, external });
  return id;
}

// One relationship per distinct external target and one media part per distinct image payload: a hyperlink or logo repeated through a document is one relationship and one part, not one per occurrence.
export function hyperlinkRelationshipId(
  state: WriteState,
  uri: string,
): string {
  const existing = state.hyperlinkIds.get(uri);
  if (existing !== undefined) {
    return existing;
  }
  const id = addRelationship(state, REL_HYPERLINK, encodeXmlText(uri), true);
  state.hyperlinkIds.set(uri, id);
  return id;
}

// WordprocessingML's a:blip references a relationship whose target is a raster part Word decodes directly — PNG, JPEG, and GIF are all in that directly-decodable set. SVG is not: rendering one needs the modern a:svgBlip extension (an a:extLst entry pointing at the SVG part, alongside a required raster fallback a plain a:blip can fall back to for older Word), which this writer does not build — writing a bare a:blip pointed at an SVG part would produce a docx no version of Word can actually render, worse than refusing it outright.
// Reached only if this raster-only format union ever gains a member mediaExtension's own switch does not match: every current member is covered there, so `value` narrows to `never` at the real call site, and adding an uncovered format makes that narrowing fail and this call stop compiling. That is the real safety net. Exported so write.test.ts can exercise the throw directly with a forced-invalid cast: it is otherwise unreachable, since every real member is already handled by a case in mediaExtension.
export function assertNeverRasterImageFormat(value: never): never {
  throw new Error(
    `mediaExtension: unhandled image format ${JSON.stringify(value)}`,
  );
}

function mediaExtension(format: "png" | "jpeg" | "gif"): string {
  switch (format) {
    case "png":
      return "png";
    case "jpeg":
      return "jpeg";
    case "gif":
      return "gif";
  }
  return assertNeverRasterImageFormat(format);
}

export function imageRelationshipId(
  state: WriteState,
  image: ContentImageBlock,
): string {
  if (image.format === "svg") {
    throw new Error(
      "buildDocxPackageFromContent: an image block in svg format has no OOXML blip this writer can produce (WordprocessingML's a:blip only references a raster part Word decodes directly — png/jpeg/gif — and this writer does not build the a:svgBlip extension plus raster-fallback pair SVG needs to render at all)",
    );
  }
  const key = `${image.format}:${image.base64}`;
  const existing = state.mediaIds.get(key);
  if (existing !== undefined) {
    return existing;
  }
  let name = state.counters.mediaFiles.get(key);
  if (name === undefined) {
    name = `image${String(state.counters.nextMediaFileId++)}.${mediaExtension(image.format)}`;
    state.counters.mediaFiles.set(key, name);
  }
  state.mediaParts.set(name, { format: image.format, base64: image.base64 });
  const id = addRelationship(state, REL_IMAGE, `media/${name}`, false);
  state.mediaIds.set(key, id);
  return id;
}

function xmlDeclaration(): XmlNode {
  return {
    type: "declaration",
    attributes: [
      { name: "version", value: "1.0" },
      { name: "encoding", value: "UTF-8" },
      { name: "standalone", value: "yes" },
    ],
  };
}

export function xmlPart(root: XmlElement): XmlPart {
  return { kind: "xml", nodes: [xmlDeclaration(), root] };
}

// --- runs -----------------------------------------------------------------------------------------------------------

// ST_OnOff spelled explicitly in both directions: an absent w:b is "inherit" to the read-side cascade, not "off", so a run whose bold is false must say so rather than omitting the element.
export function toggleElement(tag: string, value: boolean): XmlElement {
  return el(tag, { "w:val": value ? "1" : "0" });
}

// docx `w:id` values a reference-mark run's own child element carries, one per AnchorType this writer gives a run-level spelling to beyond bookmarks and comment ranges.
export const NOTE_REFERENCE_TAG: Readonly<
  Record<"comment" | "footnote" | "endnote", string>
> = {
  comment: "w:commentReference",
  footnote: "w:footnoteReference",
  endnote: "w:endnoteReference",
};

// The run-element identities of an interleaved paragraph content list, keyed by their positions in the runs the paragraph carries — what wrapInternalLinks locates a link's slice by, since the markers and field characters interleaved between runs shift raw array indices. Moved above interleaveRunConstructExtents, which is the first (and only earlier) reader.
export class RunPositions {
  private readonly indexOfElement = new Map<XmlElement, number>();

  constructor(runElements: readonly XmlElement[]) {
    runElements.forEach((element, index) => {
      this.indexOfElement.set(element, index);
    });
  }

  positionOf(element: XmlElement): number | undefined {
    return this.indexOfElement.get(element);
  }
}

// The four ContentStrokeStyle members' own ST_Border keywords. 'solid' writes as 'single', the plain one-line border readCellBorderEdge maps straight back to solid; the other three are their own keywords.
export const STROKE_STYLE_KEYWORD: Readonly<
  Record<"solid" | "dashed" | "dotted" | "double", string>
> = { solid: "single", dashed: "dashed", dotted: "dotted", double: "double" };

// CT_TrackChange's own w:id and w:author are both required attributes (ECMA-376's schema, not merely convention); w:date is optional. ProvenanceDescriptor.author is optional — not every ContentDocument source records one — so an absent author falls back to this rather than the writer omitting a required attribute. Each call mints its own w:id, since every tracked-change element (a paragraph mark's rPr/w:ins and the run wrapper around its content alike) needs a unique one, not one id shared across a whole multi-paragraph extent.
const UNKNOWN_PROVENANCE_AUTHOR = "Unknown";

export function trackChangeAttrs(
  state: WriteState,
  descriptor: ProvenanceDescriptor,
): Record<string, string> {
  const attrs: Record<string, string> = {
    "w:id": String(state.counters.nextMarkerId++),
    "w:author": encodeXmlText(descriptor.author ?? UNKNOWN_PROVENANCE_AUTHOR),
  };
  if (descriptor.dateIso !== undefined) {
    attrs["w:date"] = encodeXmlText(descriptor.dateIso);
  }
  return attrs;
}

const SDT_TYPE_ELEMENT: Readonly<
  Record<ContentControlDescriptor["controlType"], string | undefined>
> = {
  richText: "w:richText",
  plainText: "w:text",
  checkbox: "w14:checkbox",
  dropDown: "w:dropDownList",
  comboBox: "w:comboBox",
  date: "w:date",
  picture: "w:picture",
  repeatingSection: "w15:repeatingSection",
  group: "w:group",
  // A push button has no WordprocessingML control of its own (it comes from the PDF and ODF form vocabularies), and an index is a docPartObj gallery rather than a control type — both are written below rather than through this table.
  button: undefined,
  index: undefined,
};

const SDT_LOCK_VALUE: Readonly<
  Record<"content" | "container" | "both", string>
> = {
  content: "contentLocked",
  container: "sdtLocked",
  both: "sdtContentLocked",
};

export function buildSdtProperties(
  descriptor: ContentControlDescriptor,
): XmlElement {
  const children: XmlElement[] = [];
  if (descriptor.alias !== undefined) {
    children.push(el("w:alias", { "w:val": encodeXmlText(descriptor.alias) }));
  }
  if (descriptor.tag !== undefined) {
    children.push(el("w:tag", { "w:val": encodeXmlText(descriptor.tag) }));
  }
  if (descriptor.lock !== undefined) {
    children.push(el("w:lock", { "w:val": SDT_LOCK_VALUE[descriptor.lock] }));
  }
  if (descriptor.controlType === "index") {
    children.push(
      el("w:docPartObj", {}, [
        el("w:docPartGallery", { "w:val": TABLE_OF_CONTENTS_GALLERY }),
        el("w:docPartUnique"),
      ]),
    );
    return el("w:sdtPr", {}, children);
  }
  const options = descriptor.options ?? [];
  if (
    descriptor.controlType === "dropDown" ||
    descriptor.controlType === "comboBox"
  ) {
    const items = options.map((option) =>
      el("w:listItem", {
        "w:displayText": encodeXmlText(option),
        "w:value": encodeXmlText(option),
      }),
    );
    children.push(
      el(
        descriptor.controlType === "dropDown" ? "w:dropDownList" : "w:comboBox",
        {},
        items,
      ),
    );
    return el("w:sdtPr", {}, children);
  }
  if (descriptor.controlType === "checkbox") {
    children.push(
      el("w14:checkbox", {}, [
        el("w14:checked", {
          "w14:val": descriptor.checked === true ? "1" : "0",
        }),
      ]),
    );
    return el("w:sdtPr", {}, children);
  }
  if (descriptor.controlType === "date") {
    children.push(
      el(
        "w:date",
        descriptor.value === undefined
          ? {}
          : { "w:fullDate": encodeXmlText(descriptor.value) },
      ),
    );
    return el("w:sdtPr", {}, children);
  }
  const restored = restoreGalleryElement(descriptor);
  if (restored !== undefined) {
    children.push(restored);
    return el("w:sdtPr", {}, children);
  }
  const typeTag = SDT_TYPE_ELEMENT[descriptor.controlType];
  children.push(el(typeTag ?? "w:richText"));
  return el("w:sdtPr", {}, children);
}

// The restorable tier's first consumer: a richText control that degraded from a docx gallery (constructs.ts) carries its w:docPartObj/w:docPartList element verbatim in descriptor.source, and this re-emits that element in place of the default w:richText type element — the same-format pair loses the gallery name no longer. Re-serialising opaque residue text is re-emission, not interpretation (the channel's own contract), and the parse here is the honest inverse of the buildXml that minted the text — a deserialisation of a value this package's own reader produced, not the hand-written-XML-string pattern src/xml/fragment.ts's convention exists to discourage. The gate is the mint condition exactly — controlType 'richText', the only verdict constructs.ts ever attaches this residue to — not residue shape alone, so a hand-built descriptor of any other controlType keeps its own semantic type element and the residue stays quarantined. One restoration site, one residue shape: docx residue of any other shape has no sdtPr spelling, and docx residue that does not parse as XML at all is malformed producer data (this package's own reader never mints unparseable text) and fails loudly rather than writing a control that silently pretends it carried none.
function restoreGalleryElement(
  descriptor: ContentControlDescriptor,
): XmlElement | undefined {
  if (descriptor.controlType !== "richText") {
    return undefined;
  }
  const source = descriptor.source;
  if (source?.format !== "docx") {
    return undefined;
  }
  let nodes: XmlNode[];
  try {
    nodes = parseXml(source.xml);
  } catch (error) {
    throw new Error(
      `buildDocxPackageFromContent: a content control carries docx residue that does not parse as XML: ${source.xml}`,
      { cause: error },
    );
  }
  const first = nodes[0];
  if (
    nodes.length !== 1 ||
    first?.type !== "element" ||
    (first.tag !== "w:docPartObj" && first.tag !== "w:docPartList")
  ) {
    return undefined;
  }
  return first;
}

// The reader turns a matched marker pair back into a construct by bracket position, so the writer works from the same shape: the flat list is parsed into the nesting its brackets already describe, and each construct then chooses whether it is an element wrapping its extent (w:sdt, w:ins) or a pair of sibling markers around it (w:bookmarkStart/End) or characters injected into the extent's own paragraphs (a field).
export type FlowItem =
  | { readonly kind: "block"; readonly block: ContentBlock }
  | {
      readonly kind: "construct";
      readonly descriptor: ConstructDescriptor;
      readonly children: FlowItem[];
    };

// --- styles.xml -------------------------------------------------------------------------------------------------------

export const NORMAL_STYLE_ID = "Normal";

// The body node list attachSectionBreak appends a fresh sectPr-carrying paragraph onto when the section's own content ends without a paragraph to hang the break on. Wrapped rather than passed as a bare array so the parameter stays out of prefer-readonly-array-param's scope while the array it holds stays genuinely mutable.
interface NodeSink {
  readonly nodes: XmlNode[];
}

function attachSectionBreak(
  sink: NodeSink,
  section: ContentSection,
  headerFooterReferences: readonly XmlElement[],
): void {
  const nodes = sink.nodes;
  const properties = buildSectionProperties(section, headerFooterReferences);
  const target = findParagraph(nodes, true);
  if (target === undefined) {
    nodes.push(el("w:p", {}, [el("w:pPr", {}, [properties])]));
    return;
  }
  const first = target.children[0];
  if (first?.type === "element" && first.tag === "w:pPr") {
    first.children.push(properties);
    return;
  }
  target.children.unshift(el("w:pPr", {}, [properties]));
}

function buildDocumentPart(
  sections: readonly ContentSection[],
  state: WriteState,
  sectionHeaderFooters: readonly (SectionHeaderFooterReferences | undefined)[],
  headerFooterRelIdByPath: ReadonlyMap<string, string>,
): XmlPart {
  const bodyChildren: XmlNode[] = [];
  sections.forEach((section, index) => {
    const nodes = buildBlockFlow(section.blocks, state, false);
    const references = buildSectionHeaderFooterReferences(
      sectionHeaderFooters[index],
      headerFooterRelIdByPath,
    );
    if (index === sections.length - 1) {
      bodyChildren.push(...nodes, buildSectionProperties(section, references));
      return;
    }
    attachSectionBreak({ nodes }, section, references);
    bodyChildren.push(...nodes);
  });
  const root = el(
    "w:document",
    {
      "xmlns:w": WML_NS,
      "xmlns:r": REL_NS,
      "xmlns:a": DRAWINGML_NS,
      "xmlns:wp": DRAWING_WP_NS,
      "xmlns:pic": DRAWING_PIC_NS,
      "xmlns:mc": MARKUP_COMPAT_NS,
      "xmlns:o": VML_OFFICE_NS,
      "xmlns:w14": W14_NS,
      "xmlns:w15": W15_NS,
      "mc:Ignorable": "w14 w15",
    },
    [el("w:body", {}, bodyChildren)],
  );
  return xmlPart(root);
}

// --- package scaffolding ----------------------------------------------------------------------------------------------

// The embeddings parts are declared per part (Override) rather than per extension (Default): each carries the content type of the format the nested document serialised into, and an Override names exactly the part written without making any claim about other files sharing its extension elsewhere in someone else's package. `mediaParts`/`embeddingParts` are the MERGED registries across every part this package writes (the document body and every header/footer, each with its own WriteState — see WriteCounters' own comment), not any one part's own local map, so a media format or embedded payload that only ever appears inside a header still gets declared here. `extraOverrides` carries every other part's own Override — styles.xml, numbering.xml, comments.xml, footnotes.xml, endnotes.xml, and each header/footer part — built by the caller, which is the only place that already knows exactly which of those parts exist.
function buildContentTypesPart(
  mediaParts: ReadonlyMap<string, { format: "png" | "jpeg" | "gif" }>,
  embeddingParts: ReadonlyMap<string, EmbeddedPayload>,
  extraOverrides: readonly XmlElement[],
): XmlPart {
  const mediaFormats = new Set(
    [...mediaParts.values()].map((media) => media.format),
  );
  const defaults: XmlElement[] = [
    el("Default", {
      Extension: "rels",
      ContentType: "application/vnd.openxmlformats-package.relationships+xml",
    }),
    el("Default", { Extension: "xml", ContentType: "application/xml" }),
  ];
  if (mediaFormats.has("png")) {
    defaults.push(
      el("Default", { Extension: "png", ContentType: "image/png" }),
    );
  }
  if (mediaFormats.has("jpeg")) {
    defaults.push(
      el("Default", { Extension: "jpeg", ContentType: "image/jpeg" }),
    );
  }
  if (mediaFormats.has("gif")) {
    defaults.push(
      el("Default", { Extension: "gif", ContentType: "image/gif" }),
    );
  }
  const embeddingOverrides = [...embeddingParts].map(([name, payload]) =>
    el("Override", {
      PartName: `/word/embeddings/${name}`,
      ContentType: EMBEDDED_PART_CONTENT_TYPES[payload.extension],
    }),
  );
  const root = el("Types", { xmlns: CONTENT_TYPES_NS }, [
    ...defaults,
    el("Override", {
      PartName: `/${DOCUMENT_PART_PATH}`,
      ContentType: CT_DOCUMENT,
    }),
    el("Override", {
      PartName: "/docProps/core.xml",
      ContentType: CT_CORE_PROPS,
    }),
    el("Override", {
      PartName: "/docProps/app.xml",
      ContentType: CT_EXTENDED_PROPS,
    }),
    ...embeddingOverrides,
    ...extraOverrides,
  ]);
  return xmlPart(root);
}

function buildPackageRelsPart(): XmlPart {
  const root = el("Relationships", { xmlns: PKG_RELS_NS }, [
    el("Relationship", {
      Id: "rId1",
      Type: REL_OFFICE_DOCUMENT,
      Target: DOCUMENT_PART_PATH,
    }),
    el("Relationship", {
      Id: "rId2",
      Type: REL_CORE_PROPS,
      Target: "docProps/core.xml",
    }),
    el("Relationship", {
      Id: "rId3",
      Type: REL_EXTENDED_PROPS,
      Target: "docProps/app.xml",
    }),
  ]);
  return xmlPart(root);
}

export function buildDocumentRelsPart(state: WriteState): XmlPart {
  const relationships = state.relationships.map((rel) =>
    el(
      "Relationship",
      rel.external
        ? {
            Id: rel.id,
            Type: rel.type,
            Target: rel.target,
            TargetMode: "External",
          }
        : { Id: rel.id, Type: rel.type, Target: rel.target },
    ),
  );
  return xmlPart(el("Relationships", { xmlns: PKG_RELS_NS }, relationships));
}

function buildCorePropertiesPart(metadata: DocumentMetadata): XmlPart {
  const children: XmlElement[] = [];
  if (metadata.title !== undefined) {
    children.push(el("dc:title", {}, [txt(encodeXmlText(metadata.title))]));
  }
  if (metadata.author !== undefined) {
    children.push(el("dc:creator", {}, [txt(encodeXmlText(metadata.author))]));
  }
  if (metadata.subject !== undefined) {
    children.push(el("dc:subject", {}, [txt(encodeXmlText(metadata.subject))]));
  }
  if (metadata.keywords !== undefined && metadata.keywords.length > 0) {
    children.push(
      el("cp:keywords", {}, [txt(encodeXmlText(metadata.keywords.join(", ")))]),
    );
  }
  if (metadata.createdIso !== undefined) {
    children.push(
      el("dcterms:created", { "xsi:type": "dcterms:W3CDTF" }, [
        txt(encodeXmlText(metadata.createdIso)),
      ]),
    );
  }
  if (metadata.modifiedIso !== undefined) {
    children.push(
      el("dcterms:modified", { "xsi:type": "dcterms:W3CDTF" }, [
        txt(encodeXmlText(metadata.modifiedIso)),
      ]),
    );
  }
  return xmlPart(
    el(
      "cp:coreProperties",
      {
        "xmlns:cp": CORE_PROPS_NS,
        "xmlns:dc": DC_NS,
        "xmlns:dcterms": DCTERMS_NS,
        "xmlns:xsi": XSI_NS,
      },
      children,
    ),
  );
}

function buildExtendedPropertiesPart(metadata: DocumentMetadata): XmlPart {
  const children: XmlElement[] = [];
  if (metadata.creator !== undefined) {
    children.push(
      el("Application", {}, [txt(encodeXmlText(metadata.creator))]),
    );
  }
  return xmlPart(el("Properties", { xmlns: EXTENDED_PROPS_NS }, children));
}

// ContentSection[] (plus optional document metadata) -> a complete docx Package, built part by part rather than edited into an existing one. The read-side inverse is readDocxContent; see this module's own header for exactly what survives the pair and what does not.
export function buildDocxPackageFromContent(
  content: DocxContent,
  options?: BuildDocxContentOptions,
): Package {
  const state = newWriteState(options);
  const sections =
    content.sections.length === 0
      ? [
          {
            pageSize: { widthPt: 612, heightPt: 792 },
            margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
            blocks: [],
          },
        ]
      : content.sections;

  // Headers/footers are built before the document part: each section's own w:sectPr needs the header/footer parts' relationship ids already registered on `state` (headerFooterRelIdByPath) by the time buildDocumentPart resolves its own w:headerReference/w:footerReference elements.
  const headerFooterParts = content.headerFooterParts ?? [];
  const {
    parts: headerFooterPartFiles,
    relIdByPath: headerFooterRelIdByPath,
    mediaParts: headerFooterMediaParts,
    embeddingParts: headerFooterEmbeddingParts,
  } = buildHeaderFooterParts(headerFooterParts, state, options);

  // The document part is built next so every hyperlink, image, and header/footer relationship it needs already exists by the time the relationship and content-type parts are written.
  const documentPart = buildDocumentPart(
    sections,
    state,
    content.sectionHeaderFooters ?? [],
    headerFooterRelIdByPath,
  );

  const styleIds = new Set<string>();
  for (const section of sections) {
    collectParagraphStyleIds(section.blocks, styleIds);
  }
  for (const part of headerFooterParts) {
    collectParagraphStyleIds(part.blocks, styleIds);
  }
  const stylesPart = buildStylesPart(styleIds);
  addRelationship(state, REL_STYLES, "styles.xml", false);

  const numberingElement = buildNumberingElement(content.numbering ?? {});
  const comments = content.comments ?? [];
  const footnotes = content.footnotes ?? [];
  const endnotes = content.endnotes ?? [];

  const extraOverrides: XmlElement[] = [
    el("Override", {
      PartName: `/${STYLES_PART_PATH}`,
      ContentType: CT_STYLES,
    }),
  ];
  const metadata = content.metadata ?? {};
  const parts: Package["parts"] = {
    "_rels/.rels": buildPackageRelsPart(),
    [DOCUMENT_PART_PATH]: documentPart,
    [STYLES_PART_PATH]: stylesPart,
    "docProps/core.xml": buildCorePropertiesPart(metadata),
    "docProps/app.xml": buildExtendedPropertiesPart(metadata),
    ...headerFooterPartFiles,
  };

  if (numberingElement !== undefined) {
    addRelationship(state, REL_NUMBERING, "numbering.xml", false);
    parts[NUMBERING_PART_PATH] = xmlPart(numberingElement);
    extraOverrides.push(
      el("Override", {
        PartName: `/${NUMBERING_PART_PATH}`,
        ContentType: CT_NUMBERING,
      }),
    );
  }
  if (comments.length > 0) {
    addRelationship(state, REL_COMMENTS, "comments.xml", false);
    parts[COMMENTS_PART_PATH] = buildCommentsPart(comments);
    extraOverrides.push(
      el("Override", {
        PartName: `/${COMMENTS_PART_PATH}`,
        ContentType: CT_COMMENTS,
      }),
    );
  }
  if (footnotes.length > 0) {
    addRelationship(state, REL_FOOTNOTES, "footnotes.xml", false);
    parts[FOOTNOTES_PART_PATH] = xmlPart(
      buildNotesPart("w:footnote", footnotes),
    );
    extraOverrides.push(
      el("Override", {
        PartName: `/${FOOTNOTES_PART_PATH}`,
        ContentType: CT_FOOTNOTES,
      }),
    );
  }
  if (endnotes.length > 0) {
    addRelationship(state, REL_ENDNOTES, "endnotes.xml", false);
    parts[ENDNOTES_PART_PATH] = xmlPart(buildNotesPart("w:endnote", endnotes));
    extraOverrides.push(
      el("Override", {
        PartName: `/${ENDNOTES_PART_PATH}`,
        ContentType: CT_ENDNOTES,
      }),
    );
  }
  headerFooterParts.forEach((part, index) => {
    const partName = `word/${part.kind}${String(index + 1)}.xml`;
    extraOverrides.push(
      el("Override", {
        PartName: `/${partName}`,
        ContentType: part.kind === "header" ? CT_HEADER : CT_FOOTER,
      }),
    );
  });

  // `state.relationships` is complete only now — addRelationship above (numbering/comments/footnotes/endnotes) and buildHeaderFooterParts/buildDocumentPart earlier (headers/footers/hyperlinks/images/embeddings) have all had their chance to register a relationship — so document.xml.rels and [Content_Types].xml are built last, exactly as they were before this writer emitted more than two parts.
  parts["word/_rels/document.xml.rels"] = buildDocumentRelsPart(state);

  for (const [name, media] of state.mediaParts) {
    parts[`word/media/${name}`] = { kind: "binary", base64: media.base64 };
  }
  for (const [name, payload] of state.embeddingParts) {
    parts[`word/embeddings/${name}`] = {
      kind: "binary",
      base64: payload.base64,
    };
  }

  const mergedMediaParts = new Map([
    ...state.mediaParts,
    ...headerFooterMediaParts,
  ]);
  const mergedEmbeddingParts = new Map([
    ...state.embeddingParts,
    ...headerFooterEmbeddingParts,
  ]);
  parts["[Content_Types].xml"] = buildContentTypesPart(
    mergedMediaParts,
    mergedEmbeddingParts,
    extraOverrides,
  );

  return { parts };
}
