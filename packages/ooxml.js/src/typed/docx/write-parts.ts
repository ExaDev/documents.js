import type { BuildDocxContentOptions, WriteState } from "./write";
import type { EmbeddedPayload } from "./write-embedded";
import type {
  Comment,
  Footnote,
  HeaderFooterPart,
  SectionHeaderFooterReferences,
} from "./read-schemas";
import type { ContentBlock, ContentSection } from "document-schema.js";
import {
  DRAWINGML_NS,
  DRAWING_PIC_NS,
  DRAWING_WP_NS,
  MARKUP_COMPAT_NS,
  REL_FOOTER,
  REL_HEADER,
  REL_NS,
  VML_OFFICE_NS,
  W14_NS,
  W15_NS,
  WML_NS,
} from "./write-constants";
import {
  NORMAL_STYLE_ID,
  addRelationship,
  buildDocumentRelsPart,
  newWriteState,
  xmlPart,
} from "./write";
import { buildRunContent } from "./write-run";
import type { Package, XmlPart } from "../../model/package";
import type { XmlElement } from "../../model/node";
import { buildBlockFlow } from "./write-constructs";
import { el } from "../../xml/fragment";
import { encodeXmlText } from "../../xml/entities";
import { ptToTwips } from "../shared/units";
// The package-part builders of the docx writer, split from write.ts: styles, comments, footnotes/endnotes, header/footer parts and their section references. write.ts keeps the document part itself and the top-level assembly.
// Every distinct ContentParagraph.styleId a document's own blocks reference, recursed into table cells (the only place a block flow nests inside this schema — a construct's own children stay in the same flat array, per parseFlow's own doc comment above). Collected across every section AND every header/footer part, since a w:pStyle inside a header is exactly as dangling as one in the body if styles.xml never defines it.
export function collectParagraphStyleIds(
  blocks: readonly ContentBlock[],
  styleIds: Set<string>,
): void {
  for (const block of blocks) {
    if (block.kind === "paragraph") {
      if (block.styleId !== undefined) {
        styleIds.add(block.styleId);
      }
    } else if (block.kind === "table") {
      for (const row of block.rows) {
        for (const cell of row.cells) {
          collectParagraphStyleIds(cell.blocks, styleIds);
        }
      }
    }
  }
}

// document-schema.js's own styleId field comment states the constraint this writer works under: "round-trip-only: a producer's own style name, meaningful only to a consumer that already knows that producer's naming convention" — ContentParagraph carries no basedOn chain, no resolved paragraph/run properties, not even a human-readable display name for a styleId, because resolveParagraphProperties/resolveRunProperties (styles.ts) fully materialise the style cascade into direct formatting at read time and nothing keeps the original cascade around. So this is not a lossy shortcut around a richer model this package chooses not to use — there is no richer model to write from. What this DOES fix is the defect the issue names: previously a paragraph's own w:pStyle referenced a styleId that resolved to nothing at all, because styles.xml was never written; every styleId this writer has ever seen referenced now resolves to a real, valid w:style entry (empty of properties, since the properties it would have carried are already spelled as direct formatting on every paragraph/run that used it — Word renders identically whether or not this stub carries them). w:docDefaults and a w:default="1" Normal/DefaultParagraphFont pair are always written, even for a document that references no styleId at all, matching what a real Word-produced styles.xml always carries and keeping every producer's file shape uniform rather than making the part's very presence a signal about paragraph content.
export function buildStylesPart(styleIds: ReadonlySet<string>): XmlPart {
  const styles: XmlElement[] = [
    el("w:docDefaults", {}, [el("w:rPrDefault"), el("w:pPrDefault")]),
    el(
      "w:style",
      { "w:type": "paragraph", "w:default": "1", "w:styleId": NORMAL_STYLE_ID },
      [el("w:name", { "w:val": NORMAL_STYLE_ID })],
    ),
    el(
      "w:style",
      {
        "w:type": "character",
        "w:default": "1",
        "w:styleId": "DefaultParagraphFont",
      },
      [el("w:name", { "w:val": "Default Paragraph Font" })],
    ),
  ];
  const orderedIds = [...styleIds]
    .filter((id) => id !== NORMAL_STYLE_ID)
    .sort();
  for (const id of orderedIds) {
    const encoded = encodeXmlText(id);
    styles.push(
      el("w:style", { "w:type": "paragraph", "w:styleId": encoded }, [
        el("w:name", { "w:val": encoded }),
        el("w:basedOn", { "w:val": NORMAL_STYLE_ID }),
      ]),
    );
  }
  return xmlPart(el("w:styles", { "xmlns:w": WML_NS }, styles));
}

// --- comments, footnotes, and endnotes ---------------------------------------------------------------------------------

// readComment's inverse: one w:comment per Comment, its text as a single paragraph. A comment with no id (Comment.id is optional — see read.ts's own field comment) gets one minted here starting past every explicitly-carried numeric id, so every comment this writer emits has a real w:id even though nothing in `content` can then reference it by name; every comment produced by readDocxContent itself always carries the id its own w:comment/@w:id supplied, so this path is only ever exercised by a hand-built DocxContent.
export function buildCommentsPart(comments: readonly Comment[]): XmlPart {
  const explicitIds = comments
    .map((comment) => Number(comment.id))
    .filter((id) => Number.isInteger(id));
  let nextMintedId =
    explicitIds.length === 0 ? 1 : Math.max(...explicitIds) + 1;
  const children = comments.map((comment) => {
    const id = comment.id ?? String(nextMintedId++);
    const attrs: Record<string, string> = { "w:id": encodeXmlText(id) };
    if (comment.author !== undefined) {
      attrs["w:author"] = encodeXmlText(comment.author);
    }
    return el("w:comment", attrs, [
      el("w:p", {}, [el("w:r", {}, buildRunContent(comment.text, false))]),
    ]);
  });
  return xmlPart(el("w:comments", { "xmlns:w": WML_NS }, children));
}

// The two boilerplate notes every real footnotes.xml/endnotes.xml carries — ids -1 (separator, the short horizontal rule Word draws above the first note) and 0 (continuationSeparator, the longer rule drawn when a note continues onto another page) — which readNotesPart (read.ts) deliberately filters out of DocxDocument.footnotes/endnotes, so a genuine reader of this writer's own output round-trips cleanly even though the source w:footnotes/w:endnotes element these two live in does not.
export function noteBoilerplate(tag: "w:footnote" | "w:endnote"): XmlElement[] {
  return [
    el(tag, { "w:type": "separator", "w:id": "-1" }, [
      el("w:p", {}, [el("w:r", {}, [el("w:separator")])]),
    ]),
    el(tag, { "w:type": "continuationSeparator", "w:id": "0" }, [
      el("w:p", {}, [el("w:r", {}, [el("w:continuationSeparator")])]),
    ]),
  ];
}

// readFootnote's inverse, shared between word/footnotes.xml and word/endnotes.xml exactly as readNotesPart shares the read side. A note's own w:id is written back verbatim when Footnote.id is present — load-bearing, since a paragraph's own footnote/endnote reference-mark construct (interleaveRunConstructExtents above) carries that SAME id as its descriptor.name, the join key WordprocessingML pairs a w:footnoteReference/w:endnoteReference to its body through; minting a fresh id here instead would silently break every reference mark this writer also emits. A note with no id (the same optional-field, hand-built-content case buildCommentsPart's own comment explains) gets one minted past every explicitly-carried numeric id, on the same reasoning: nothing in a hand-built `content` could have referenced it by name anyway. w:type is written only when the source recorded one other than the ordinary "normal" implied by its absence.
export function buildNotesPart(
  tag: "w:footnote" | "w:endnote",
  notes: readonly Footnote[],
): XmlElement {
  const explicitIds = notes
    .map((note) => Number(note.id))
    .filter((id) => Number.isInteger(id));
  let nextMintedId =
    explicitIds.length === 0 ? 1 : Math.max(...explicitIds) + 1;
  const noteElements = notes.map((note) => {
    const id = note.id ?? String(nextMintedId++);
    const attrs: Record<string, string> = { "w:id": encodeXmlText(id) };
    if (note.type !== undefined && note.type !== "normal") {
      attrs["w:type"] = encodeXmlText(note.type);
    }
    return el(tag, attrs, [
      el("w:p", {}, [el("w:r", {}, buildRunContent(note.text, false))]),
    ]);
  });
  return el(
    tag === "w:footnote" ? "w:footnotes" : "w:endnotes",
    {
      "xmlns:w": WML_NS,
    },
    [...noteBoilerplate(tag), ...noteElements],
  );
}

// --- headers and footers ------------------------------------------------------------------------------------------

// One header/footer part's own body — the same block-flow machinery the document body itself is built through, so an image or hyperlink inside a header resolves through THIS part's own relationships (registered on the fresh WriteState passed in), never the document's — readHeaderFooterParts' own doc comment states this is exactly how it is read back.
export function buildHeaderFooterPart(
  part: HeaderFooterPart,
  partState: WriteState,
): XmlPart {
  const nodes = buildBlockFlow(part.blocks, partState, false);
  const root = el(
    part.kind === "header" ? "w:hdr" : "w:ftr",
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
    nodes,
  );
  return xmlPart(root);
}

export interface BuiltHeaderFooterParts {
  // Every emitted part keyed by its OWN package path (word/header1.xml, word/_rels/header1.xml.rels, and any word/media|embeddings file its own WriteState minted) — merged straight into the package's own `parts` record by buildDocxPackageFromContent.
  readonly parts: Package["parts"];
  // The document-level relationship id (registered on the BODY's own WriteState/document.xml.rels, since that is what a w:headerReference/w:footerReference's own r:id resolves against) for each header/footer part, keyed by that part's ORIGINAL path — the exact string DocxContent.sectionHeaderFooters names a slot's target with, so resolving a section's own reference is a straight map lookup.
  readonly relIdByPath: ReadonlyMap<string, string>;
  // Every header/footer part's own media/embeddings registry, merged: buildContentTypesPart needs the format/extension metadata behind these files (a word/media/*.png's own Default entry, an embeddings part's own Override) that the flat binary `parts` record above does not carry back out on its own.
  readonly mediaParts: ReadonlyMap<
    string,
    { format: "png" | "jpeg" | "gif"; base64: string }
  >;
  readonly embeddingParts: ReadonlyMap<string, EmbeddedPayload>;
}

// Builds every header/footer part DocxContent carries, registering one document-level relationship per part (shared by every section that references it, exactly as Word itself shares one relationship across several w:headerReference/w:footerReference elements) on `documentState` — the same WriteState buildDocumentPart's own sections will be built against, so its word/_rels/document.xml.rels ends up carrying these relationships too.
export function buildHeaderFooterParts(
  headerFooterParts: readonly HeaderFooterPart[],
  documentState: WriteState,
  options: BuildDocxContentOptions | undefined,
): BuiltHeaderFooterParts {
  const parts: Package["parts"] = {};
  const relIdByPath = new Map<string, string>();
  const mediaParts = new Map<
    string,
    { format: "png" | "jpeg" | "gif"; base64: string }
  >();
  const embeddingParts = new Map<string, EmbeddedPayload>();
  headerFooterParts.forEach((part, index) => {
    const partState = newWriteState(options, documentState.counters);
    const partName = `word/${part.kind}${String(index + 1)}.xml`;
    parts[partName] = buildHeaderFooterPart(part, partState);
    if (partState.relationships.length > 0) {
      parts[`word/_rels/${part.kind}${String(index + 1)}.xml.rels`] =
        buildDocumentRelsPart(partState);
    }
    for (const [name, media] of partState.mediaParts) {
      parts[`word/media/${name}`] = { kind: "binary", base64: media.base64 };
      mediaParts.set(name, media);
    }
    for (const [name, payload] of partState.embeddingParts) {
      parts[`word/embeddings/${name}`] = {
        kind: "binary",
        base64: payload.base64,
      };
      embeddingParts.set(name, payload);
    }
    const relType = part.kind === "header" ? REL_HEADER : REL_FOOTER;
    const rId = addRelationship(
      documentState,
      relType,
      `${part.kind}${String(index + 1)}.xml`,
      false,
    );
    relIdByPath.set(part.path, rId);
  });
  return { parts, relIdByPath, mediaParts, embeddingParts };
}

// One section's own w:headerReference/w:footerReference elements, resolved from DocxDocument.sectionHeaderFooters' own path-keyed slots through the relationship ids buildHeaderFooterParts registered — a slot naming a path that was not itself in DocxContent.headerFooterParts (a caller error; never true of readDocxContent's own output, which always emits the referenced part alongside the reference) resolves to no element rather than a reference with no relationship behind it.
export function buildSectionHeaderFooterReferences(
  references: SectionHeaderFooterReferences | undefined,
  relIdByPath: ReadonlyMap<string, string>,
): XmlElement[] {
  if (references === undefined) {
    return [];
  }
  const elements: XmlElement[] = [];
  const slots = ["default", "first", "even"] as const;
  for (const tag of ["w:headerReference", "w:footerReference"] as const) {
    const slotRefs =
      tag === "w:headerReference" ? references.header : references.footer;
    if (slotRefs === undefined) {
      continue;
    }
    for (const slot of slots) {
      const path = slotRefs[slot];
      const rId = path === undefined ? undefined : relIdByPath.get(path);
      if (rId !== undefined) {
        elements.push(el(tag, { "w:type": slot, "r:id": rId }));
      }
    }
  }
  return elements;
}

// --- sections and the document part ---------------------------------------------------------------------------------

export function buildSectionProperties(
  section: ContentSection,
  headerFooterReferences: readonly XmlElement[] = [],
): XmlElement {
  // CT_SectPr's own child sequence puts EG_HdrFtrReferences (headerReference*/footerReference*) before w:type before w:pgSz, so the reference elements lead, then an emitted break kind lands ahead of the geometry it qualifies. An absent breakType writes no w:type at all: that absence IS WordprocessingML's own nextPage default, and spelling it would turn "no break kind declared" into "break kind declared as the default" on the way back in.
  const type =
    section.breakType === undefined
      ? []
      : [el("w:type", { "w:val": section.breakType })];
  return el("w:sectPr", {}, [
    ...headerFooterReferences,
    ...type,
    el("w:pgSz", {
      "w:w": String(ptToTwips(section.pageSize.widthPt)),
      "w:h": String(ptToTwips(section.pageSize.heightPt)),
    }),
    el("w:pgMar", {
      "w:top": String(ptToTwips(section.margins.topPt)),
      "w:right": String(ptToTwips(section.margins.rightPt)),
      "w:bottom": String(ptToTwips(section.margins.bottomPt)),
      "w:left": String(ptToTwips(section.margins.leftPt)),
    }),
  ]);
}

// A mid-document section break rides on the last paragraph of the section it closes — the shape readSections reads it back from, which keeps that paragraph as content rather than adding one. That paragraph is not necessarily nodes' own last element: a bookmark closing the section trails a childless w:bookmarkEnd marker, and a content control closing it wraps its content in w:sdt, so findParagraph (searching from the end, the same way buildFieldNodes locates a field's own paragraphs) descends through whatever construct wrapper sits last to find the real one. Only the final section's w:sectPr is a direct child of w:body; a section with no paragraph anywhere in its flow gets an empty one to carry the break.
