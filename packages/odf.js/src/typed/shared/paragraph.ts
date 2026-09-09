import type {
  AnchorDescriptor,
  ContentBlock,
  ProvenanceDescriptor,
  ContentParagraph,
  ContentRun,
  DefinitionEntry,
  FieldDescriptor,
  RunConstructExtent,
} from "document-schema.js";
import type { XmlElement, XmlNode } from "../../model/node";
import type { Package } from "../../model/package";
import type { StyleProperties } from "../../styles/properties";
import type { StyleRegistry } from "../../styles/registry";
import { canonicalPropertiesString } from "../../styles/serialize";
import { attrValue, childrenWithTag, findChildElement } from "../../xml/query";
import { decodeXmlText, encodeXmlText } from "../../xml/entities";
import { el, txt } from "../../xml/fragment";
import {
  getOdfSpaceCount,
  decodeOdfText,
  isOdfFieldElement,
  buildOdfInlineNodes,
  segmentOdfText,
} from "./text";
import { resolveStyle } from "./cascade";
import {
  mintOdfListNumId,
  readOdfListParagraphs,
  type OdfListIdState,
} from "./list";
import {
  isOdfBlockScopedHalf,
  isOdfExtensionElement,
  odfAttributeElement,
  odfBookmarkAnchorDescriptor,
  odfFieldDescriptor,
  odfResidue,
  odfRunConstructWriteKind,
  pairOdfMarkerHalves,
  parseOdfFieldInstruction,
  writeOdfChangeEnd,
  writeOdfChangePoint,
  writeOdfChangeStart,
  writeOdfBookmarkEnd,
  writeOdfBookmarkPoint,
  writeOdfBookmarkStart,
  type OdfDefinitionsSink,
  type OdfMarkerHalf,
  type OdfResidueFormat,
} from "./constructs";
import { resolveStyleElementChain } from "./cascade";
import {
  parseParagraphProperties,
  parseTextProperties,
} from "../../styles/properties";

// Reads a text:p (any inline-text container ODF shapes this document sits in -- odt is a later task, but a draw:text-box's own text:p is content-model-identical) into document-schema.js's ContentParagraph/ContentRun, the read-and-write counterpart to text.ts's own decodeOdfText: where that module projects a container's children to a plain string, this module projects the SAME node shapes (text, text:s, text:tab, text:line-break, text:span) to per-run objects carrying resolved formatting, dispatching on the identical node shapes text.ts's own top-of-file note establishes -- see that module for why text:s/text:tab/text:line-break must never be treated as zero-length whitespace.
//
// A single text:span's own resolved properties (via the 'text' family cascade) are layered ON TOP of the enclosing paragraph's own resolved properties (via the 'paragraph' family cascade, which itself may carry style:text-properties as the paragraph's own default run formatting) as a base -- mirroring how ooxml.js's own pptx paragraph reader merges a paragraph-level cascade base with each run's own explicit override (see readParagraph/mergeRunProperties in ooxml.js's src/typed/pptx/read.ts). This merge is NOT something cascade.ts's own resolveStyle does for you: resolveStyle only ever resolves ONE style-name reference within ONE family's own default-style + parent-chain (ODF's genuinely two-layer cascade, per cascade.ts's own top-of-file note) -- how a SPAN's resolved properties compose with its ENCLOSING PARAGRAPH's own resolved properties is a separate, consuming-layer concern this module owns.
//
// INLINE CONSTRUCTS: a field element reads as a run carrying its cached text plus a run-level field extent covering exactly that run (the *-ref cross-reference displays are fields, per the tag set in text.ts); a text:bookmark or text:reference-mark reads as a point anchor extent; bookmark and reference-mark range halves pairing inside one paragraph become run extents, each within its own pairing family (typed/shared/constructs.ts owns the descriptor shapes and the scope rules). Every reader that uses this module gets the same treatment -- an odt paragraph, an ods cell, and an odp text frame all carry their fields as paragraph constructs.

// The mutable walk state one paragraph's run collection threads: the run-level extents discovered so far, the paired-marker halves at their run positions, the document-order counter that keeps discovery order deterministic, the tracked-change region map, the definitions sink note and annotation bodies mint into, and the list-identity counter note and annotation bodies mint their own text:list numIds from -- the document-wide state when the caller supplied one (every list in one document walk shares one identity space, the numId-as-identity contract list.ts's own header states), a fresh local counter otherwise.
interface RunWalkState {
  readonly extents: RunConstructExtent[];
  readonly halves: OdfMarkerHalf[];
  // The inline elements this walk met that no run vocabulary models (text:ruby, text:meta, a vendor-extension element): quarantined as the paragraph's own residue, in discovery order, alongside whatever the style chain's unmodellable half contributed.
  readonly residueElements: XmlElement[];
  order: number;
  readonly provenanceRegions:
    ReadonlyMap<string, ProvenanceDescriptor> | undefined;
  readonly definitions: OdfDefinitionsSink | undefined;
  readonly listIdState: OdfListIdState;
}

// What a caller reading a paragraph in a document-level context supplies: the tracked-change regions a text:change/text:change-start/text:change-end marker resolves its id against, the out-array every marker half is reported to for block-scope pairing by the reader that owns the block flow, the definitions sink note and annotation bodies mint into, and the list-identity counter those bodies mint their own text:list numIds from -- one document-wide state so no two lists anywhere in one document share a numId. All absent when the caller has no document context -- a bare readOdfParagraph call reads runs and run-level extents; change markers with no region map contribute nothing (their id names a region the caller never collected), and notes read only their citation run, since an anchor naming a definition key no table holds would be malformed.
export interface OdfParagraphContext {
  readonly provenanceRegions?: ReadonlyMap<string, ProvenanceDescriptor>;
  readonly markersOut?: OdfMarkerHalf[];
  readonly definitions?: OdfDefinitionsSink;
  readonly listIdState?: OdfListIdState;
  readonly format?: OdfResidueFormat;
}

// One note or annotation body's own block flow (and a master page's header/footer body's -- the same shape ODF reuses for every detached block container that is not the document body itself): text:p paragraphs and text:list lists, read through the same shared walkers the main body uses, in the body's own document order. Anything else in a body contributes nothing, exactly as readBlocks treats unknown block-level elements -- an annotation's dc:creator/dc:date children land here and are skipped, having already been read into the entry's own fields.
export function readOdfConstructBodyBlocks(
  body: XmlElement,
  pkg: Package,
  context: OdfParagraphContext,
  listIdState: OdfListIdState,
): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  const bodyContext: OdfParagraphContext = { ...context, listIdState };
  for (const child of body.children) {
    if (child.type !== "element") {
      continue;
    }
    if (child.tag === "text:p" || child.tag === "text:h") {
      blocks.push(readOdfParagraph(child, pkg, bodyContext));
    } else if (child.tag === "text:list") {
      const numId = mintOdfListNumId(pkg, child, listIdState);
      blocks.push(
        ...readOdfListParagraphs(child, { numId, level: 0 }, (element) =>
          readOdfParagraph(element, pkg, bodyContext),
        ),
      );
    }
  }
  return blocks;
}

function collectRuns(
  container: XmlElement,
  baseProperties: StyleProperties,
  pkg: Package,
  out: ContentRun[],
  walk: RunWalkState,
  hyperlinkTarget?: string,
): void {
  for (const node of container.children) {
    if (node.type === "text") {
      if (node.value.length > 0) {
        pushRun(
          out,
          runFromText(decodeXmlText(node.value), baseProperties),
          hyperlinkTarget,
        );
      }
      continue;
    }
    if (node.type !== "element") {
      continue;
    }
    if (node.tag === "text:s") {
      pushRun(
        out,
        runFromText(" ".repeat(getOdfSpaceCount(node)), baseProperties),
        hyperlinkTarget,
      );
    } else if (node.tag === "text:tab") {
      pushRun(out, runFromText("\t", baseProperties), hyperlinkTarget);
    } else if (node.tag === "text:line-break") {
      pushRun(out, runFromText("\n", baseProperties), hyperlinkTarget);
    } else if (node.tag === "text:span") {
      const styleName = attrValue(node, "text:style-name");
      const spanProperties: StyleProperties = {
        ...baseProperties,
        ...resolveStyle(styleName, "text", pkg).properties,
      };
      collectRuns(node, spanProperties, pkg, out, walk, hyperlinkTarget);
    } else if (node.tag === "text:a") {
      // A text:a is an inline hyperlink: its xlink:href is the link target, its children (text, text:span, text:s/tab/line-break, even a nested text:a) are the link's visible content. Threading the href as hyperlinkTarget through the recursion lets a text:span inside the link still resolve its own "text"-family formatting AND carry the hyperlink on every run it emits -- mirroring ooxml.js's own docx reader, which threads the resolved w:hyperlink target through w:ins/w:fldSimple recursion and stamps { ...run, hyperlink: target } on every leaf run. A text:a with no xlink:href is malformed (ODF makes href mandatory) but its visible text still reads; an enclosing text:a's own target is inherited in that case so an inner link's text is not lost.
      // Entity-decoded, like every other text this reader projects out of the lossless model: a real href routinely carries an ampersand between query parameters, which the source XML spells &amp;. ContentRun.hyperlink is a resolved URI, not a fragment of XML, and leaving it encoded would also make the write direction double-encode it on every cycle.
      const rawHref = attrValue(node, "xlink:href");
      const href = rawHref === undefined ? undefined : decodeXmlText(rawHref);
      collectRuns(
        node,
        baseProperties,
        pkg,
        out,
        walk,
        href ?? hyperlinkTarget,
      );
    } else if (isOdfFieldElement(node)) {
      // An inline field's own children are its cached display content, so they read as ordinary runs at the field's position with the field's base formatting -- this is the fix for the long-standing drop where a field's cached text vanished along with its field-ness. The extent covers exactly the runs the field contributed: startRun === endRun when the producer cached nothing, which is the point-anchor spelling of an uncached field.
      const startRun = out.length;
      collectRuns(node, baseProperties, pkg, out, walk, hyperlinkTarget);
      walk.extents.push({
        descriptor: odfFieldDescriptor(node),
        startRun,
        endRun: out.length,
      });
    } else if (
      node.tag === "text:bookmark" ||
      node.tag === "text:reference-mark"
    ) {
      // A point bookmark: zero-width, named, addressed -- a point anchor extent at its run position. text:reference-mark is ODF's second point-target spelling (the target a text:reference-ref display names) and reads identically: the harmonised anchor vocabulary has one bookmark anchorType for both (document-schema.js's AnchorTypeSchema names them together). text:name is required by the ODF schema; a mark without one is malformed and skipped, matching this reader's general salvage posture.
      const name = attrValue(node, "text:name");
      if (name !== undefined) {
        const runPosition = out.length;
        walk.extents.push({
          descriptor: odfBookmarkAnchorDescriptor(decodeXmlText(name)),
          startRun: runPosition,
          endRun: runPosition,
        });
      }
    } else if (
      node.tag === "text:reference-mark-start" ||
      node.tag === "text:reference-mark-end"
    ) {
      // A reference-mark range half: the target half of ODF's cross-reference system, paired by text:name exactly the way a bookmark half pairs -- in-paragraph into a run-level anchor extent, at paragraph edges into the block-scope pair -- but as its OWN pairing family, since ODF keeps reference-mark names and bookmark names in separate namespaces and a same-named bookmark and reference-mark must each pair with their own spelling.
      const name = attrValue(node, "text:name");
      if (name !== undefined) {
        walk.halves.push({
          kind: "referenceMark",
          side: node.tag === "text:reference-mark-start" ? "start" : "end",
          key: decodeXmlText(name),
          element: node,
          parent: container,
          runPosition: out.length,
          order: walk.order++,
          descriptor: () => odfBookmarkAnchorDescriptor(decodeXmlText(name)),
        });
      }
    } else if (
      node.tag === "text:bookmark-start" ||
      node.tag === "text:bookmark-end"
    ) {
      // A ranged bookmark's half, recorded for pairing once the walk finishes: paired in-paragraph into a run extent, at paragraph edges into the block-scope marker pair the odt reader emits. The element and its parent are kept so that scope test can be made after the fact.
      const name = attrValue(node, "text:name");
      if (name !== undefined) {
        walk.halves.push({
          kind: "bookmark",
          side: node.tag === "text:bookmark-start" ? "start" : "end",
          key: decodeXmlText(name),
          element: node,
          parent: container,
          runPosition: out.length,
          order: walk.order++,
          descriptor: () => odfBookmarkAnchorDescriptor(decodeXmlText(name)),
        });
      }
    } else if (node.tag === "text:change") {
      // A point tracked-change marker: its text:change-id names a text:changed-region the document-level context resolves into the provenance descriptor. With no region (or no region map at all) there is no change kind to report and the marker contributes nothing.
      const changeId = attrValue(node, "text:change-id");
      const descriptor =
        changeId === undefined
          ? undefined
          : walk.provenanceRegions?.get(decodeXmlText(changeId));
      if (descriptor !== undefined) {
        const runPosition = out.length;
        walk.extents.push({
          descriptor,
          startRun: runPosition,
          endRun: runPosition,
        });
      }
    } else if (
      node.tag === "text:change-start" ||
      node.tag === "text:change-end"
    ) {
      // A tracked-change range half, paired exactly the way a bookmark half pairs: in-paragraph into a run-level provenance extent, at paragraph edges into a block-scope pair. The descriptor is deferred because it resolves through the region map, which may hold no entry for this id.
      const changeId = attrValue(node, "text:change-id");
      if (changeId !== undefined) {
        walk.halves.push({
          kind: "change",
          side: node.tag === "text:change-start" ? "start" : "end",
          key: decodeXmlText(changeId),
          element: node,
          parent: container,
          runPosition: out.length,
          order: walk.order++,
          descriptor: () =>
            walk.provenanceRegions?.get(decodeXmlText(changeId)),
        });
      }
    } else if (node.tag === "text:note") {
      // A footnote/endnote: ODF carries the body INLINE inside the note element, so this is local reading -- the citation mark becomes a run at the note's position, the body mints a definitions entry, and an anchor extent covers the citation run naming that entry's key. Without a definitions sink (or a name to hang either on: text:id absent, nothing to mint with) only the citation run reads -- an anchor naming a definition key no table holds would be malformed. A note with no readable text:note-class is malformed and contributes nothing at all.
      const noteClass = attrValue(node, "text:note-class");
      if (noteClass === "footnote" || noteClass === "endnote") {
        const rawId = attrValue(node, "text:id");
        const name =
          rawId !== undefined
            ? decodeXmlText(rawId)
            : walk.definitions === undefined
              ? undefined
              : `note${walk.definitions.nextNoteOrdinal++}`;
        const startRun = out.length;
        const citationElement = findChildElement(
          node.children,
          "text:note-citation",
        );
        const citation =
          citationElement === undefined ? "" : decodeOdfText(citationElement);
        if (citation.length > 0) {
          pushRun(out, runFromText(citation, baseProperties), hyperlinkTarget);
        }
        if (name !== undefined) {
          if (walk.definitions !== undefined) {
            const entry: DefinitionEntry = { kind: noteClass, body: [] };
            if (citation.length > 0) {
              entry.citation = citation;
            }
            const bodyElement = findChildElement(
              node.children,
              "text:note-body",
            );
            if (bodyElement !== undefined) {
              entry.body = readOdfConstructBodyBlocks(
                bodyElement,
                pkg,
                {
                  provenanceRegions: walk.provenanceRegions,
                  definitions: walk.definitions,
                },
                walk.listIdState,
              );
            }
            walk.definitions.entries[`note:${name}`] = entry;
          }
          walk.extents.push({
            descriptor: {
              kind: "anchor",
              anchorType: noteClass,
              name,
              definition: `note:${name}`,
            },
            startRun,
            endRun: out.length,
          });
        }
      }
    } else if (node.tag === "office:annotation") {
      // A comment anchor: its body and author mint a definitions entry (office:annotation carries its body inline, dc:creator and dc:date beside text:p content), and the anchor itself is a marker HALF rather than an immediate extent -- a named annotation pairs with its office:annotation-end over a range, and only an unpaired one falls back to a point anchor (the pairing and that fallback happen after the walk, in readOdfParagraph). An annotation with no definitions sink reads nothing but leaves the text flow untouched, the same sink-less degrade a note takes.
      if (walk.definitions !== undefined) {
        const rawName = attrValue(node, "office:name");
        const name =
          rawName !== undefined
            ? decodeXmlText(rawName)
            : `annotation${walk.definitions.nextAnnotationOrdinal++}`;
        const entry: DefinitionEntry = { kind: "comment", body: [] };
        for (const child of node.children) {
          if (child.type !== "element") {
            continue;
          }
          if (child.tag === "dc:creator") {
            entry.author = decodeOdfText(child);
          } else if (child.tag === "dc:date") {
            entry.dateIso = decodeOdfText(child);
          }
        }
        entry.body = readOdfConstructBodyBlocks(
          node,
          pkg,
          {
            provenanceRegions: walk.provenanceRegions,
            definitions: walk.definitions,
          },
          walk.listIdState,
        );
        walk.definitions.entries[`comment:${name}`] = entry;
        walk.halves.push({
          kind: "annotation",
          side: "start",
          key: name,
          element: node,
          parent: container,
          runPosition: out.length,
          order: walk.order++,
          descriptor: () => ({
            kind: "anchor",
            anchorType: "comment",
            name,
            definition: `comment:${name}`,
          }),
        });
      }
    } else if (node.tag === "office:annotation-end") {
      // The closing half of a ranged comment, keyed by office:name -- the pairing attribute ODF 1.2 added; an unnamed end has nothing to pair with and is ignored.
      const rawName = attrValue(node, "office:name");
      if (rawName !== undefined) {
        walk.halves.push({
          kind: "annotation",
          side: "end",
          key: decodeXmlText(rawName),
          element: node,
          parent: container,
          runPosition: out.length,
          order: walk.order++,
          descriptor: () => undefined,
        });
      }
    } else if (
      node.tag === "text:ruby" ||
      node.tag === "text:meta" ||
      isOdfExtensionElement(node)
    ) {
      // Inline vocabulary with no cross-format analogue: a phonetic-annotation ruby pair, an RDF metadata anchor, a producer-private extension element. What renders as flow text reads as ordinary runs while the element itself quarantines, so nothing is lost on either side -- the residue half carries what the construct WAS, the runs carry what it SAID. A ruby's rendered text is its ruby-base ALONE (the ruby-text is the small gloss above it, not flow content -- recursing into the whole ruby would inline the annotation as if it were body text); a text:meta wraps ordinary content, so the whole element recurses.
      if (node.tag === "text:ruby") {
        for (const base of childrenWithTag(node, "text:ruby-base")) {
          collectRuns(base, baseProperties, pkg, out, walk, hyperlinkTarget);
        }
      } else {
        collectRuns(node, baseProperties, pkg, out, walk, hyperlinkTarget);
      }
      walk.residueElements.push(node);
    }
    // Any other child (change-tracking markup, an anchored draw:frame) contributes no run at all -- matching text.ts's own established zero-length treatment of the same node shapes, not a new gap introduced here.
  }
}

function pushRun(
  out: ContentRun[],
  run: ContentRun,
  hyperlinkTarget: string | undefined,
): void {
  out.push(
    hyperlinkTarget === undefined
      ? run
      : { ...run, hyperlink: hyperlinkTarget },
  );
}

function runFromText(text: string, properties: StyleProperties): ContentRun {
  return {
    text,
    bold: properties.bold,
    italic: properties.italic,
    underline: properties.underline,
    strike: properties.strike,
    fontFamily: properties.fontFamily,
    sizePt: properties.sizePt,
    color: properties.color,
  };
}

// ODF's predefined "Preformatted Text" paragraph style, spelled the way LibreOffice actually writes it: a predefined common-style name with a space in its display name is serialised with the space encoded as "_20_", never a literal space or underscore -- confirmed against this package's own odt fixtures, whose styles.xml carries "Heading_20_1" for "Heading 1", "Text_20_body" for "Text body", and "Table_20_Contents" for "Table Contents", all the identical convention. "Preformatted_Text" (the spelling ExaDev/documents.js#1020 guessed at) is not real ODF output.
const PREFORMATTED_STYLE_NAME = "Preformatted_20_Text";

// A bare marker element for PREFORMATTED_STYLE_NAME: no properties of its own, matching this package's own established minimal-infra-style convention (typed/odt/write.ts's sectionBreakStyleElement carries nothing but the one attribute it exists to trigger) -- visual formatting for a preformatted paragraph still comes entirely from its own runs and its own interned automatic style, never from this marker's own defaults. Exists purely so resolveStyleElementChain's by-name lookup succeeds when a written paragraph's own style (or an ancestor of it) names PREFORMATTED_STYLE_NAME as its parent -- without a real element here, the chain walk stops at the missing name and readOdfParagraph's own preformatted check never sees it. A caller of writeOdfParagraph is responsible for pushing this into its own document's office:styles exactly once (idempotently or not -- ODF tolerates a style:name appearing only once per family regardless, so a caller that already knows it writes at most once per document, as typed/odt/write.ts's own top-level setup does, needs no existence check of its own).
export function preformattedStyleElement(): XmlElement {
  return el("style:style", {
    "style:name": PREFORMATTED_STYLE_NAME,
    "style:family": "paragraph",
  });
}

// Reads one text:p element (the caller is responsible for confirming it IS a text:p before calling -- this module has no opinion on where in a document's tree that element sits). Paragraph-level fields (alignment, spacing, indents) come only from the paragraph's OWN resolved 'paragraph'-family properties, never from a span: a text:span's style-name always resolves against the 'text' family, which style.ts/registry.ts's own STYLE_FAMILIES never lets carry paragraph-level properties in practice. The optional context supplies the document-level facts a paragraph cannot know on its own -- the tracked-change regions its change markers resolve against, and the out-array its block-edge marker halves are reported to for the reader that owns the block flow to pair.
export function readOdfParagraph(
  pElement: XmlElement,
  pkg: Package,
  context: OdfParagraphContext = {},
): ContentParagraph {
  const styleName = attrValue(pElement, "text:style-name");
  const paragraphProperties = resolveStyle(
    styleName,
    "paragraph",
    pkg,
  ).properties;
  const styleChain = resolveStyleElementChain(
    styleName,
    "paragraph",
    pkg,
  ).elements;
  // document-schema.js's own cross-format "whitespace inside this paragraph's own runs is significant" signal (ExaDev/documents.js#1020): true when the paragraph's own style, or any ancestor reached via style:parent-style-name, IS PREFORMATTED_STYLE_NAME. Checked against the whole resolved chain rather than only the paragraph's own direct styleName, since real content pasted as preformatted text typically references an automatic style (style:name="P3", say) whose style:parent-style-name resolves to the predefined style rather than naming it directly.
  const isPreformatted = styleChain.some(
    (style) => attrValue(style, "style:name") === PREFORMATTED_STYLE_NAME,
  );

  const runs: ContentRun[] = [];
  const walk: RunWalkState = {
    extents: [],
    halves: [],
    residueElements: [],
    order: 0,
    provenanceRegions: context.provenanceRegions,
    definitions: context.definitions,
    listIdState: context.listIdState ?? { next: 1 },
  };
  collectRuns(pElement, paragraphProperties, pkg, runs, walk);

  // The paragraph's own residue, one value for everything this format carries that the run/paragraph vocabulary does not model: the unmodellable half of its own style chain (every style:paragraph-properties/style:text-properties element in the resolved chain that properties.ts cannot fully model -- hasUnknown -- fo:keep-with-next, a style:map child, anything StyleProperties carries no field for), the inline no-analogue elements the run walk quarantined (text:ruby, text:meta, vendor extensions), and the element's own text:is-list-header flag (a heading-is-a-list-header marker with no cross-format analogue, carried as a children-stripped element spelling its own tag). Only when the context names the reading format -- residue's format member states which reader produced it, and this shared reader serves seven of them. Span-run and table/graphic-style unknowns stay dropped (documented): the run- and table-level channels exist, but the resolved-styles fact this row lands is the paragraph's own chain.
  let source: ContentParagraph["source"];
  if (context.format !== undefined) {
    const residueElements: XmlElement[] = [];
    if (styleName !== undefined) {
      residueElements.push(
        ...styleChain.flatMap((style) => [
          ...childrenWithTag(style, "style:paragraph-properties").filter(
            (properties) => parseParagraphProperties(properties).hasUnknown,
          ),
          ...childrenWithTag(style, "style:text-properties").filter(
            (properties) => parseTextProperties(properties).hasUnknown,
          ),
        ]),
      );
    }
    if (attrValue(pElement, "text:is-list-header") !== undefined) {
      residueElements.push(
        odfAttributeElement(pElement, "text:is-list-header"),
      );
    }
    residueElements.push(...walk.residueElements);
    if (residueElements.length > 0) {
      source = odfResidue(context.format, ...residueElements);
    }
  }

  const { extents: pairedExtents, paired } = pairOdfMarkerHalves(
    walk.halves,
    pElement,
  );
  walk.extents.push(...pairedExtents);
  // An annotation whose office:annotation-end never arrived (the end element is optional -- a single-position comment needs none) falls back to the point anchor at its run position, unless it sat at a paragraph edge -- an edge half is the block-scope reader's, and that reader makes the same fallback itself against the whole flow.
  for (const half of walk.halves) {
    if (
      half.kind === "annotation" &&
      half.side === "start" &&
      !paired.has(half.element) &&
      !isOdfBlockScopedHalf(half, pElement)
    ) {
      const descriptor = half.descriptor();
      if (descriptor !== undefined) {
        walk.extents.push({
          descriptor,
          startRun: half.runPosition,
          endRun: half.runPosition,
        });
      }
    }
  }
  if (context.markersOut !== undefined) {
    context.markersOut.push(...walk.halves);
  }

  // Assembled from the four flat borderLeft/Right/Top/Bottom StyleProperties fields (properties.ts's own top-of-file note on why they stay flat through cascade resolution rather than living as one nested object) into document-schema.js's own nested ContentParagraphBordersSchema shape -- only once, here, after resolveStyle has already folded the whole style chain down to one final, effective set of edges. Omitted entirely (not `borders: {}`) when no edge survived resolution, matching source/constructs' own conditional-spread convention just above.
  const borders =
    paragraphProperties.borderLeft !== undefined ||
    paragraphProperties.borderRight !== undefined ||
    paragraphProperties.borderTop !== undefined ||
    paragraphProperties.borderBottom !== undefined
      ? {
          ...(paragraphProperties.borderLeft !== undefined
            ? { left: paragraphProperties.borderLeft }
            : {}),
          ...(paragraphProperties.borderRight !== undefined
            ? { right: paragraphProperties.borderRight }
            : {}),
          ...(paragraphProperties.borderTop !== undefined
            ? { top: paragraphProperties.borderTop }
            : {}),
          ...(paragraphProperties.borderBottom !== undefined
            ? { bottom: paragraphProperties.borderBottom }
            : {}),
        }
      : undefined;

  return {
    kind: "paragraph",
    runs,
    ...(source !== undefined ? { source } : {}),
    ...(walk.extents.length > 0 ? { constructs: walk.extents } : {}),
    styleId: styleName,
    ...(isPreformatted ? { preformatted: true } : {}),
    alignment: paragraphProperties.alignment,
    spacingBeforePt: paragraphProperties.spacingBeforePt,
    spacingAfterPt: paragraphProperties.spacingAfterPt,
    lineSpacing: paragraphProperties.lineSpacing,
    indentLeftPt: paragraphProperties.indentLeftPt,
    indentFirstLinePt: paragraphProperties.indentFirstLinePt,
    pageBreakBefore: paragraphProperties.pageBreakBefore,
    pageBreakAfter: paragraphProperties.pageBreakAfter,
    ...(borders !== undefined ? { borders } : {}),
  };
}

// text:outline-level's ODF schema default when the attribute is absent is 1 (OASIS ODF 1.2 part 1); an unparseable or non-positive value degrades to the same default rather than throwing, matching this reader family's general "malformed-but-salvageable input degrades gracefully" posture (none of these readers has a diagnostics channel to report it through).
function readOutlineLevel(headingElement: XmlElement): number {
  const raw = attrValue(headingElement, "text:outline-level");
  if (raw === undefined) {
    return 1;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

// The heading-identity step every text:h-reading walk applies over the tag-agnostic readOdfParagraph: the shared reader reads a text:h's style/run content exactly as it would a text:p's, but a heading's real @text:style-name (e.g. "Heading_20_1") is a producer-chosen ODF string with no cross-format meaning, so this function overrides ONLY the heading identity for a text:h, synthesising the same "Heading1"/"Heading2" shape docx's own real w:pStyle values already use for its built-in heading styles -- giving downstream consumers one consistent heading convention across both formats -- while the parsed text:outline-level number itself is kept as headingLevel, document-schema.js's canonical numeric heading field, so numeric consumers never have to parse it back out of the styleId string. Lives here in typed/shared rather than in the odt reader (its original home) because a table:table-cell carries text:h under the identical convention (typed/shared/table.ts's cell walk is this function's second caller): office:text's body, a text:list-item, and a table cell are the three ODF containers whose content models carry text:h at all.
export function readParagraphOrHeading(
  element: XmlElement,
  paragraph: ContentParagraph,
): ContentParagraph {
  if (element.tag === "text:h") {
    const outlineLevel = readOutlineLevel(element);
    paragraph.styleId = `Heading${outlineLevel}`;
    // The parsed text:outline-level number itself is the schema's canonical headingLevel (schema #13): styleId encodes it for styleId-keyed consumers, headingLevel carries it verbatim for numeric consumers, and both always agree because they derive from this one parse.
    paragraph.headingLevel = outlineLevel;
  }
  return paragraph;
}

// --- the write direction: a ContentParagraph -> the text:p/text:h element readOdfParagraph reads back ---
//
// The inverse of everything above, and deliberately its module neighbour for the same reason text.ts carries both directions of the inline content model: the two halves have to agree about which ODF spelling carries which pivot fact, and that agreement is easiest to keep when one module states both. ODF has no direct formatting at all, so where the reader resolves a style-name reference through the cascade, the writer INTERNS the formatting it finds into a named automatic style (styles/registry.ts) and references that -- the same StyleRegistry the read side's adoption rules are written against, never a second minting mechanism beside it.

// A ContentRun's own formatting as the property bag StyleRegistry interns. hyperlink is not part of it: a hyperlink is a text:a wrapper element in ODF, never a style property (see writeOdfParagraphChildren below).
export function odfRunProperties(run: ContentRun): StyleProperties {
  const properties: StyleProperties = {};
  if (run.bold !== undefined) {
    properties.bold = run.bold;
  }
  if (run.italic !== undefined) {
    properties.italic = run.italic;
  }
  if (run.underline !== undefined) {
    properties.underline = run.underline;
  }
  if (run.strike !== undefined) {
    properties.strike = run.strike;
  }
  if (run.fontFamily !== undefined) {
    properties.fontFamily = run.fontFamily;
  }
  if (run.sizePt !== undefined) {
    properties.sizePt = run.sizePt;
  }
  if (run.color !== undefined) {
    properties.color = run.color;
  }
  return properties;
}

// A ContentParagraph's own paragraph-level formatting as the same property bag. The heading identity (headingLevel) is deliberately absent: it is structural in ODF -- a text:h element carrying text:outline-level -- not a style property, which is exactly why a heading's styleId survives a write/read round trip when nothing else's does.
export function odfParagraphProperties(
  paragraph: ContentParagraph,
): StyleProperties {
  const properties: StyleProperties = {};
  if (paragraph.alignment !== undefined) {
    properties.alignment = paragraph.alignment;
  }
  if (paragraph.spacingBeforePt !== undefined) {
    properties.spacingBeforePt = paragraph.spacingBeforePt;
  }
  if (paragraph.spacingAfterPt !== undefined) {
    properties.spacingAfterPt = paragraph.spacingAfterPt;
  }
  if (paragraph.lineSpacing !== undefined) {
    properties.lineSpacing = paragraph.lineSpacing;
  }
  if (paragraph.indentLeftPt !== undefined) {
    properties.indentLeftPt = paragraph.indentLeftPt;
  }
  if (paragraph.indentFirstLinePt !== undefined) {
    properties.indentFirstLinePt = paragraph.indentFirstLinePt;
  }
  if (paragraph.pageBreakBefore !== undefined) {
    properties.pageBreakBefore = paragraph.pageBreakBefore;
  }
  if (paragraph.pageBreakAfter !== undefined) {
    properties.pageBreakAfter = paragraph.pageBreakAfter;
  }
  return properties;
}

const KEY_SEPARATOR = " "; // NUL -- forbidden outright in well-formed XML 1.0 content, so it can never appear inside a canonical property string or a real hyperlink target (registry.ts's own fingerprint separator makes the same choice for the same reason).

// Two runs share a formatting key exactly when a single text:span (or a single bare text node) can carry both -- identical resolved formatting AND identical hyperlink target. Built from styles/serialize.ts's own canonical property string rather than JSON.stringify, so key equality means exactly what style interning means by it.
function runFormattingKey(run: ContentRun): string {
  const hyperlink =
    run.hyperlink === undefined ? "" : `link${KEY_SEPARATOR}${run.hyperlink}`;
  return `${canonicalPropertiesString(odfRunProperties(run))}${KEY_SEPARATOR}${hyperlink}`;
}

// The construct-aware generalisation of paragraph run canonicalisation: identical to the degenerate no-constructs case below in every respect, but additionally refuses to let two adjacent ORIGINAL runs merge, or a single run's own text-segmentation swallow one, across any boundary the caller has protected -- which a run-level construct's own startRun/endRun always is (see writeOdfParagraphChildren below). This is sound because RunConstructExtent's bounds are themselves defined as gaps BETWEEN whole original runs, never a position inside one (document-schema.js's own RunConstructExtentSchema doc comment): a protected boundary therefore always coincides with the start of a genuinely new merge-group once merging across it is disabled, so `boundaryMap` can report, for every protected boundary, exactly which canonical run index that gap maps to once segmentation has run, with no approximation. A protected boundary that happened to sit on a dropped (zero-length) run resolves to wherever the next surviving group begins (or to the canonical run count, if none survives after it) -- the same "nothing there to split" fact a zero-width construct at that position would want anyway.
export interface OdfSegmentedParagraphRuns {
  readonly canonical: ContentRun[];
  readonly boundaryMap: ReadonlyMap<number, number>;
}

export function segmentOdfParagraphRunsMapped(
  runs: readonly ContentRun[],
  protectedBoundaries: ReadonlySet<number>,
): OdfSegmentedParagraphRuns {
  // Pass 1: merge adjacent original runs sharing identical formatting into groups, never crossing a protected boundary. Zero-length runs are dropped outright -- there is no empty text node in a serialized document -- so they contribute no group of their own.
  const groups: ContentRun[] = [];
  const groupStartBoundary: number[] = [];
  for (let index = 0; index < runs.length; index += 1) {
    const run = runs[index]!;
    if (run.text.length === 0) {
      continue;
    }
    const previous = groups[groups.length - 1];
    const canMerge =
      previous !== undefined &&
      !protectedBoundaries.has(index) &&
      runFormattingKey(previous) === runFormattingKey(run);
    if (canMerge) {
      groups[groups.length - 1] = {
        ...previous,
        text: previous.text + run.text,
      };
    } else {
      groups.push(run);
      groupStartBoundary.push(index);
    }
  }

  // Pass 2: segment each group's own text into the pieces ODF's inline content model can carry (a tab, a hard line break, and a collapsing space run are ELEMENTS, so a run whose text contains one splits at it) -- identical to the original segmentOdfParagraphRuns algorithm, just walking groups instead of the flat merged list it used to build inline.
  const canonical: ContentRun[] = [];
  const groupCanonicalStart: number[] = [];
  for (const [index, run] of groups.entries()) {
    groupCanonicalStart.push(canonical.length);
    const previousText = groups[index - 1]?.text;
    const nextText = groups[index + 1]?.text;
    const protectLeading =
      previousText === undefined || previousText.endsWith(" ");
    const protectTrailing = nextText === undefined || nextText.startsWith(" ");
    for (const segment of segmentOdfText(
      run.text,
      protectLeading,
      protectTrailing,
    )) {
      canonical.push({ ...run, text: segment.text });
    }
  }

  // Pass 3: resolve every requested boundary against the groups just built.
  const boundaryMap = new Map<number, number>();
  for (const boundary of protectedBoundaries) {
    if (boundary <= 0) {
      boundaryMap.set(boundary, 0);
      continue;
    }
    if (boundary >= runs.length) {
      boundaryMap.set(boundary, canonical.length);
      continue;
    }
    const groupIndex = groupStartBoundary.indexOf(boundary);
    if (groupIndex !== -1) {
      boundaryMap.set(boundary, groupCanonicalStart[groupIndex]!);
      continue;
    }
    let resolved = canonical.length;
    for (const [group, start] of groupStartBoundary.entries()) {
      if (start >= boundary) {
        resolved = groupCanonicalStart[group]!;
        break;
      }
    }
    boundaryMap.set(boundary, resolved);
  }

  return { canonical, boundaryMap };
}

// The canonical run list an ODF paragraph can actually carry, and therefore exactly what reading a written paragraph back produces -- the no-constructs degenerate case of segmentOdfParagraphRunsMapped above (protecting only the paragraph's own two outer edges, which never changes the merge/segment result since every interior boundary stays free to merge exactly as it always did). Exported because the write path's own round-trip law is stated against it: reading back what writeOdt produced yields this list, not the caller's original one, whenever the original was not already canonical.
export function segmentOdfParagraphRuns(
  runs: readonly ContentRun[],
): ContentRun[] {
  return segmentOdfParagraphRunsMapped(runs, new Set([0, runs.length]))
    .canonical;
}

// --- run-level constructs: splicing fields and bookmarks into the run-writing pipeline --------------------------
//
// A field CONSUMES a contiguous run of canonical runs as one opaque element (the reconstructed field itself, wrapping the runs its own extent covers); a bookmark is a zero-width marker that has to land as a genuine sibling at an exact position among the paragraph's own children, splitting whatever formatting/hyperlink group would otherwise have run straight through it. Both need the run-grouping walk below to never merge or wrap across the boundary they sit at, which is why every function from here down threads a `protected boundary` set the way segmentOdfParagraphRunsMapped already does at the run level -- this is that same discipline one level up, over ITEMS (a run, or one already-built field element standing in for the runs it consumed) rather than over runs directly.

interface OdfParagraphRunItem {
  readonly kind: "run";
  readonly run: ContentRun;
}
interface OdfParagraphFieldItem {
  readonly kind: "field";
  readonly node: XmlElement;
}
type OdfParagraphItem = OdfParagraphRunItem | OdfParagraphFieldItem;

interface OdfBookmarkMarker {
  readonly side: "start" | "end" | "point";
  readonly name: string;
}

interface OdfChangeMarker {
  readonly side: "start" | "end" | "point";
  readonly id: string;
}

interface OdfParagraphConstructPlan {
  readonly fieldRanges: readonly {
    readonly start: number;
    readonly end: number;
    readonly descriptor: FieldDescriptor;
  }[];
  readonly noteRanges: readonly {
    readonly start: number;
    readonly end: number;
    readonly descriptor: AnchorDescriptor;
    readonly entry: DefinitionEntry;
  }[];
  // Canonical run boundary -> the markers whose event happens there, already ordered end-before-start the way insertOdfConstructMarkers orders block-scope markers at a shared position.
  readonly markersAt: ReadonlyMap<number, readonly OdfBookmarkMarker[]>;
  // The identical map for tracked-change markers, keyed apart from bookmarks because the two families pair within themselves and never share a key vocabulary.
  readonly changeMarkersAt: ReadonlyMap<number, readonly OdfChangeMarker[]>;
}

// Resolves a paragraph's own constructs field against the canonical run list segmentOdfParagraphRunsMapped's boundaryMap already mapped every extent's startRun/endRun onto, splitting the field extents (which consume their own run range) from the bookmark point/range markers (which are zero-width events at a boundary). Every entry here has already passed odfRunConstructWriteKind -- the caller (writeOdfParagraphChildren) is responsible for refusing a paragraph carrying anything this function does not resolve, exactly as assertWritableParagraph does before this ever runs.
function planOdfParagraphConstructs(
  extents: readonly RunConstructExtent[],
  boundaryMap: ReadonlyMap<number, number>,
  definitions?: Readonly<Record<string, DefinitionEntry>>,
  changeIds?: ReadonlyMap<ProvenanceDescriptor, string>,
): OdfParagraphConstructPlan {
  const fieldRanges: {
    start: number;
    end: number;
    descriptor: FieldDescriptor;
  }[] = [];
  const noteRanges: {
    start: number;
    end: number;
    descriptor: AnchorDescriptor;
    entry: DefinitionEntry;
  }[] = [];
  const startsAt = new Map<number, OdfBookmarkMarker[]>();
  const endsAt = new Map<number, OdfBookmarkMarker[]>();
  const changeStartsAt = new Map<number, OdfChangeMarker[]>();
  const changeEndsAt = new Map<number, OdfChangeMarker[]>();
  for (const extent of extents) {
    const kind = odfRunConstructWriteKind(extent, definitions, changeIds);
    const start = boundaryMap.get(extent.startRun)!;
    const end = boundaryMap.get(extent.endRun)!;
    if (kind === "field") {
      fieldRanges.push({
        start,
        end,
        descriptor: extent.descriptor as FieldDescriptor,
      });
    } else if (kind === "bookmarkPoint") {
      const name = (extent.descriptor as AnchorDescriptor).name;
      const list = startsAt.get(start) ?? [];
      list.push({ side: "point", name });
      startsAt.set(start, list);
    } else if (kind === "bookmarkRange") {
      const name = (extent.descriptor as AnchorDescriptor).name;
      const startList = startsAt.get(start) ?? [];
      startList.push({ side: "start", name });
      startsAt.set(start, startList);
      const endList = endsAt.get(end) ?? [];
      endList.push({ side: "end", name });
      endsAt.set(end, endList);
    } else if (kind === "changePoint" || kind === "changeRange") {
      const id = changeIds!.get(extent.descriptor as ProvenanceDescriptor)!;
      if (kind === "changePoint") {
        const list = changeStartsAt.get(start) ?? [];
        list.push({ side: "point", id });
        changeStartsAt.set(start, list);
      } else {
        const startList = changeStartsAt.get(start) ?? [];
        startList.push({ side: "start", id });
        changeStartsAt.set(start, startList);
        const endList = changeEndsAt.get(end) ?? [];
        endList.push({ side: "end", id });
        changeEndsAt.set(end, endList);
      }
    } else if (kind === "note" || kind === "comment") {
      const descriptor = extent.descriptor as AnchorDescriptor;
      const entry = definitions?.[descriptor.definition!];
      if (entry !== undefined) {
        noteRanges.push({ start, end, descriptor, entry });
      }
    }
  }
  noteRanges.sort((a, b) => a.start - b.start);
  fieldRanges.sort((a, b) => a.start - b.start);
  const markersAt = new Map<number, OdfBookmarkMarker[]>();
  for (const boundary of new Set([...startsAt.keys(), ...endsAt.keys()])) {
    markersAt.set(boundary, [
      ...(endsAt.get(boundary) ?? []),
      ...(startsAt.get(boundary) ?? []),
    ]);
  }
  const changeMarkersAt = new Map<number, OdfChangeMarker[]>();
  for (const boundary of new Set([
    ...changeStartsAt.keys(),
    ...changeEndsAt.keys(),
  ])) {
    changeMarkersAt.set(boundary, [
      ...(changeEndsAt.get(boundary) ?? []),
      ...(changeStartsAt.get(boundary) ?? []),
    ]);
  }
  return { fieldRanges, noteRanges, markersAt, changeMarkersAt };
}

// Field runs, formatted with the same span-grouping the top-level paragraph uses (never hyperlink-wrapped: a hyperlink carried by a run strictly inside a field's own cached text has no ODF spelling this writer produces, a narrow and documented gap rather than a silent drop -- ContentRun.hyperlink on such a run is simply not honoured).
function writeOdfFieldElement(
  descriptor: FieldDescriptor,
  runs: readonly ContentRun[],
  registry: StyleRegistry,
): XmlElement {
  const element = parseOdfFieldInstruction(descriptor.instruction);
  const items: OdfParagraphItem[] = runs.map((run) => ({ kind: "run", run }));
  const children = writeOdfItemFormattedNodes(
    items,
    0,
    items.length,
    registry,
    new Set([0, items.length]),
  );
  return { ...element, children };
}

// Builds the item sequence writeOdfParagraphChildren emits from: a run item per surviving canonical run, except where a field's own range consumes a contiguous stretch of them into one field element.
function buildOdfParagraphItems(
  canonical: readonly ContentRun[],
  fieldRanges: OdfParagraphConstructPlan["fieldRanges"],
  noteRanges: OdfParagraphConstructPlan["noteRanges"],
  registry: StyleRegistry,
  definitions: Readonly<Record<string, DefinitionEntry>> | undefined,
  definitionsOpenNoteKeys: Set<string> | undefined,
): OdfParagraphItem[] {
  // Fields and notes are both range-CONSUMING constructs -- each swallows the canonical runs its extent covers and emits one opaque element in their place -- so they walk one merged, start-sorted stream: two ranges can never overlap (a protected boundary always coincides with the start of a genuinely non-overlapping extent), and interleaving them in one cursor loop keeps the consumption arithmetic single-sourced.
  const consumed: (
    | {
        kind: "field";
        start: number;
        end: number;
        range: OdfParagraphConstructPlan["fieldRanges"][number];
      }
    | {
        kind: "note";
        start: number;
        end: number;
        range: OdfParagraphConstructPlan["noteRanges"][number];
      }
  )[] = [
    ...fieldRanges.map((range) => ({
      kind: "field" as const,
      start: range.start,
      end: range.end,
      range,
    })),
    ...noteRanges.map((range) => ({
      kind: "note" as const,
      start: range.start,
      end: range.end,
      range,
    })),
  ].sort((a, b) => a.start - b.start);
  const items: OdfParagraphItem[] = [];
  let cursor = 0;
  for (const slot of consumed) {
    while (cursor < slot.start) {
      items.push({ kind: "run", run: canonical[cursor]! });
      cursor += 1;
    }
    const covered = canonical.slice(slot.start, Math.max(slot.end, slot.start));
    if (slot.kind === "field") {
      items.push({
        kind: "field",
        node: writeOdfFieldElement(slot.range.descriptor, covered, registry),
      });
    } else {
      items.push({
        kind: "field",
        node: writeOdfNoteElement(
          slot.range.descriptor,
          slot.range.entry,
          covered,
          registry,
          definitions,
          definitionsOpenNoteKeys,
        ),
      });
    }
    cursor = Math.max(cursor, slot.end);
  }
  while (cursor < canonical.length) {
    items.push({ kind: "run", run: canonical[cursor]! });
    cursor += 1;
  }
  return items;
}

// DefinitionEntry's body is deliberately loose (document-schema.js's own tenant-generic shape -- this package does not enumerate another tenant's fields), so a type guard narrows it rather than a cast: an entry the reader minted always carries ContentBlock[] here, and anything else is not a paragraph this writer can place.
function isNoteBodyParagraph(value: unknown): value is ContentParagraph {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  if (!("kind" in value) || value.kind !== "paragraph") {
    return false;
  }
  return Array.isArray((value as ContentParagraph).runs);
}

// The write-side inverse of the text:note reading in this module's own run walk: the note element carries its class and id, a citation rebuilt from the definitions entry (falling back to the covered runs' own text -- the reader pushed the citation text as the extent's run, so the two agree on everything this reader produces), and a body written from the entry's own blocks. Body blocks are written with the same paragraph writer that builds the containing paragraph -- a note body is ordinary block flow, not a special container.
function writeOdfNoteElement(
  descriptor: AnchorDescriptor,
  entry: DefinitionEntry,
  citationRuns: readonly ContentRun[],
  registry: StyleRegistry,
  definitions: Readonly<Record<string, DefinitionEntry>> | undefined,
  openNoteKeys: Set<string> | undefined,
): XmlElement {
  const key = descriptor.definition ?? descriptor.name;
  if (openNoteKeys?.has(key)) {
    // A hostile or corrupt document can reuse a text:id inside its own note body: the reader assigns the outer entry AFTER parsing the body, so the inner anchor resolves to the same entry and the write would recurse until the stack is exhausted. Refusing by name beats either crashing or silently dropping the cycle.
    throw new Error(
      `writeOdt: a cyclic note definition -- note "${descriptor.name}" whose body refers back to the entry still being written`,
    );
  }
  const citation =
    typeof entry.citation === "string"
      ? entry.citation
      : citationRuns.map((run) => run.text).join("");
  const body: unknown = entry.body;
  const bodyChildren: XmlNode[] = [];
  if (Array.isArray(body)) {
    const openKeys = openNoteKeys ?? new Set<string>();
    openKeys.add(key);
    try {
      for (const candidate of body) {
        if (isNoteBodyParagraph(candidate)) {
          bodyChildren.push(
            writeOdfParagraph(candidate, registry, {
              definitions,
              openNoteKeys: openKeys,
            }),
          );
        }
      }
    } finally {
      openKeys.delete(key);
    }
  }
  if (descriptor.anchorType === "comment") {
    // A comment anchor: office:annotation carries its body INLINE (text:p children beside the dc:creator/dc:date the reader lifts into the entry), and office:name keys its pairing half -- the reader's own annotation-half walk reads exactly this shape back.
    const commentAttributes: Record<string, string> = {
      "office:name": encodeXmlText(descriptor.name),
    };
    const commentChildren: XmlNode[] = [];
    if (typeof entry.author === "string") {
      commentChildren.push(el("dc:creator", {}, [txt(entry.author)]));
    }
    if (typeof entry.dateIso === "string") {
      commentChildren.push(el("dc:date", {}, [txt(entry.dateIso)]));
    }
    commentChildren.push(...bodyChildren);
    return el("office:annotation", commentAttributes, commentChildren);
  }
  return el(
    "text:note",
    {
      "text:note-class": descriptor.anchorType,
      "text:id": encodeXmlText(descriptor.name),
    },
    [
      el("text:note-citation", {}, [txt(citation)]),
      el("text:note-body", {}, bodyChildren),
    ],
  );
}

// Maps a canonical RUN boundary onto the corresponding ITEM boundary in the sequence buildOdfParagraphItems produced: a boundary strictly inside a field's own consumed range has no item position of its own to land on (the field is one opaque unit by the time a bookmark marker would need to split it), so it clamps to the item boundary immediately after that field -- a narrow, documented simplification for the rare case of a bookmark nested inside a field's own cached text, rather than an attempt to split the reconstructed field element apart.
function odfParagraphItemBoundary(
  canonicalBoundary: number,
  fieldRanges: OdfParagraphConstructPlan["fieldRanges"],
): number {
  let items = 0;
  let position = 0;
  for (const range of fieldRanges) {
    if (position >= canonicalBoundary) {
      break;
    }
    if (range.start >= canonicalBoundary) {
      items += canonicalBoundary - position;
      position = canonicalBoundary;
      break;
    }
    items += range.start - position;
    items += 1; // the field item itself
    position = range.end;
  }
  if (position < canonicalBoundary) {
    items += canonicalBoundary - position;
  }
  return items;
}

function odfItemFormattingKey(item: OdfParagraphItem): string | undefined {
  return item.kind === "run"
    ? canonicalPropertiesString(odfRunProperties(item.run))
    : undefined;
}

function odfItemHyperlink(item: OdfParagraphItem): string | undefined {
  return item.kind === "run" ? item.run.hyperlink : undefined;
}

// The inline nodes for items [from, to), grouped so each maximal stretch of consecutive RUN items sharing one resolved formatting is ONE text:span rather than one per run -- a field item is never merged into a surrounding span (it is already its own element) and never lets a group straddle a protected boundary (where a bookmark marker needs to land). Whitespace protection is computed against each run's true neighbours in the WHOLE item sequence (a neighbouring field, or the paragraph's own edge, both count as "no neighbouring text" and are protected accordingly), never against the group's own edges, mirroring the original algorithm this generalises.
function writeOdfItemFormattedNodes(
  items: readonly OdfParagraphItem[],
  from: number,
  to: number,
  registry: StyleRegistry,
  protectedBoundaries: ReadonlySet<number>,
): XmlNode[] {
  const nodes: XmlNode[] = [];
  let index = from;
  while (index < to) {
    const item = items[index]!;
    if (item.kind === "field") {
      nodes.push(item.node);
      index += 1;
      continue;
    }
    const key = odfItemFormattingKey(item);
    let end = index + 1;
    while (
      end < to &&
      !protectedBoundaries.has(end) &&
      items[end]!.kind === "run" &&
      odfItemFormattingKey(items[end]!) === key
    ) {
      end += 1;
    }
    const inner: XmlNode[] = [];
    for (let position = index; position < end; position += 1) {
      const run = (items[position] as OdfParagraphRunItem).run;
      const previous = items[position - 1];
      const next = items[position + 1];
      const previousText =
        previous?.kind === "run" ? previous.run.text : undefined;
      const nextText = next?.kind === "run" ? next.run.text : undefined;
      inner.push(
        ...buildOdfInlineNodes(
          segmentOdfText(
            run.text,
            previousText === undefined || previousText.endsWith(" "),
            nextText === undefined || nextText.startsWith(" "),
          ),
        ),
      );
    }
    const properties = odfRunProperties(
      (items[index] as OdfParagraphRunItem).run,
    );
    if (Object.keys(properties).length === 0) {
      nodes.push(...inner);
    } else {
      nodes.push(
        el(
          "text:span",
          {
            "text:style-name": encodeXmlText(
              registry.intern({ properties, family: "text" }),
            ),
          },
          inner,
        ),
      );
    }
    index = end;
  }
  return nodes;
}

function writeOdfBookmarkMarker(marker: OdfBookmarkMarker): XmlElement {
  switch (marker.side) {
    case "point":
      return writeOdfBookmarkPoint(marker.name);
    case "start":
      return writeOdfBookmarkStart(marker.name);
    case "end":
      return writeOdfBookmarkEnd(marker.name);
  }
}

// A paragraph's own inline children: each maximal stretch of consecutive items sharing one hyperlink target wrapped in a single text:a (a field item never carries a hyperlink of its own, so it always breaks a hyperlink group open around it), with the formatting grouping above running inside it, and every run-level construct the paragraph carries spliced in at its own exact boundary -- a field consuming its own run range as one element (buildOdfParagraphItems), a bookmark point/start/end sitting as a bare sibling exactly where its extent's boundary maps to. Refusing a construct this function does not resolve is assertWritableParagraph's job (typed/odt/write.ts), called before this ever runs; every extent reaching here has already passed odfRunConstructWriteKind.
export function writeOdfChangeMarker(marker: OdfChangeMarker): XmlElement {
  if (marker.side === "point") {
    return writeOdfChangePoint(marker.id);
  }
  return marker.side === "start"
    ? writeOdfChangeStart(marker.id)
    : writeOdfChangeEnd(marker.id);
}

function writeOdfParagraphChildren(
  paragraph: ContentParagraph,
  registry: StyleRegistry,
  definitions?: Readonly<Record<string, DefinitionEntry>>,
  openNoteKeys?: Set<string>,
  changeIds?: ReadonlyMap<ProvenanceDescriptor, string>,
): XmlNode[] {
  const runs = paragraph.runs;
  const extents = paragraph.constructs ?? [];
  const protectedRunBoundaries = new Set<number>([0, runs.length]);
  for (const extent of extents) {
    protectedRunBoundaries.add(extent.startRun);
    protectedRunBoundaries.add(extent.endRun);
  }
  const { canonical, boundaryMap } = segmentOdfParagraphRunsMapped(
    runs,
    protectedRunBoundaries,
  );
  const plan = planOdfParagraphConstructs(
    extents,
    boundaryMap,
    definitions,
    changeIds,
  );
  const items = buildOdfParagraphItems(
    canonical,
    plan.fieldRanges,
    plan.noteRanges,
    registry,
    definitions,
    openNoteKeys,
  );

  const protectedItemBoundaries = new Set<number>([0, items.length]);
  const markersAtItemBoundary = new Map<number, OdfBookmarkMarker[]>();
  for (const [canonicalBoundary, markers] of plan.markersAt) {
    const itemBoundary = odfParagraphItemBoundary(
      canonicalBoundary,
      plan.fieldRanges,
    );
    protectedItemBoundaries.add(itemBoundary);
    const existing = markersAtItemBoundary.get(itemBoundary) ?? [];
    markersAtItemBoundary.set(itemBoundary, [...existing, ...markers]);
  }
  const changeMarkersAtItemBoundary = new Map<number, OdfChangeMarker[]>();
  for (const [canonicalBoundary, markers] of plan.changeMarkersAt) {
    const itemBoundary = odfParagraphItemBoundary(
      canonicalBoundary,
      plan.fieldRanges,
    );
    protectedItemBoundaries.add(itemBoundary);
    const existing = changeMarkersAtItemBoundary.get(itemBoundary) ?? [];
    changeMarkersAtItemBoundary.set(itemBoundary, [...existing, ...markers]);
  }
  const emitMarkers = (children: XmlNode[], boundary: number): void => {
    for (const marker of markersAtItemBoundary.get(boundary) ?? []) {
      children.push(writeOdfBookmarkMarker(marker));
    }
    for (const marker of changeMarkersAtItemBoundary.get(boundary) ?? []) {
      children.push(writeOdfChangeMarker(marker));
    }
  };

  const children: XmlNode[] = [];
  emitMarkers(children, 0);
  let index = 0;
  while (index < items.length) {
    const target = odfItemHyperlink(items[index]!);
    let end = index + 1;
    while (
      end < items.length &&
      !protectedItemBoundaries.has(end) &&
      odfItemHyperlink(items[end]!) === target
    ) {
      end += 1;
    }
    const nodes = writeOdfItemFormattedNodes(
      items,
      index,
      end,
      registry,
      protectedItemBoundaries,
    );
    if (target === undefined) {
      children.push(...nodes);
    } else {
      children.push(
        el(
          "text:a",
          { "xlink:type": "simple", "xlink:href": encodeXmlText(target) },
          nodes,
        ),
      );
    }
    index = end;
    emitMarkers(children, index);
  }
  return children;
}

export interface OdfParagraphWriteOptions {
  // The named style this paragraph's formatting hangs off: written as style:parent-style-name on the minted automatic style, or -- when the paragraph carries no direct formatting for an automatic style to hold -- as the paragraph's own text:style-name. The odt writer uses it for a section's page-style switch, which ODF states as a style:master-page-name on a paragraph style and nowhere else.
  readonly parentStyleName?: string;
  // Nodes appended after the paragraph's own inline content -- the anchored draw:frame elements an image block contributes, which ODF anchors inside a paragraph rather than beside one.
  readonly trailingNodes?: readonly XmlNode[];
  // The definitions table note anchors resolve against: a footnote/endnote anchor writes its inline text:note (citation plus body) only when the entry its descriptor names is present here. Absent means the caller has no bodies to write (the flat writeOdtContent path) and note anchors were already refused upstream.
  readonly definitions?: Readonly<Record<string, DefinitionEntry>>;
  // The note-definition keys on the write stack RIGHT NOW: a cyclic definition (a note body whose own anchor resolves back to an entry still being written) would recurse until the stack is exhausted, so the writer refuses one by name instead. Internal to the note write path -- never set by a caller.
  readonly openNoteKeys?: Set<string>;
  // The tracked-change descriptor -> minted text:changed-region id map: a provenance extent writes its inline markers only when its descriptor has a region id here. The odt writer mints the ids document-wide and emits the matching text:tracked-changes container.
  readonly changeIds?: ReadonlyMap<ProvenanceDescriptor, string>;
}

// Writes one ContentParagraph as the text:p (or, for a paragraph carrying a headingLevel, text:h) element readOdfParagraph reads back. Every formatting difference becomes an interned automatic style, since ODF has no other way to state one.
export function writeOdfParagraph(
  paragraph: ContentParagraph,
  registry: StyleRegistry,
  options: OdfParagraphWriteOptions = {},
): XmlElement {
  const properties = odfParagraphProperties(paragraph);
  const attributes: Record<string, string> = {};
  // A preformatted paragraph from a foreign producer (markdown-codec's fenced code block, an EPUB <pre>, ...) has no ODF attribute of its own to carry the fact forward -- the only way readOdfParagraph recognises it on the way back in is by finding PREFORMATTED_STYLE_NAME somewhere in the resolved style chain, so it is referenced here as this paragraph's own parent style, exactly like any other parentStyleName request. options.parentStyleName -- the odt writer's own page-style-switch mechanism, whose style:master-page-name is reachable only through one specific shared, per-section named style -- wins when both are requested on the identical paragraph: ODF's style:parent-style-name is single-valued, so the two facts cannot both be encoded through this one slot at once, and losing a section's own page geometry is the more damaging loss of the two. That collision is narrow (only the very FIRST paragraph of a second-or-later section can ever carry a page-style-switch request at all) and is a documented, non-silent trade-off, not a bug -- every other preformatted paragraph in the document still round-trips normally. Actually resolving PREFORMATTED_STYLE_NAME back on read depends on that style existing as a real element in the target part's own office:styles -- see preformattedStyleElement below; a caller of this shared function is responsible for ensuring one is present exactly once wherever it mints its own document-level named styles.
  const parentStyleName =
    options.parentStyleName ??
    (paragraph.preformatted === true ? PREFORMATTED_STYLE_NAME : undefined);
  if (Object.keys(properties).length > 0) {
    attributes["text:style-name"] = encodeXmlText(
      registry.intern({
        properties,
        family: "paragraph",
        ...(parentStyleName === undefined ? {} : { parentStyleName }),
      }),
    );
  } else if (parentStyleName !== undefined) {
    attributes["text:style-name"] = encodeXmlText(parentStyleName);
  }
  if (paragraph.headingLevel !== undefined) {
    attributes["text:outline-level"] = String(paragraph.headingLevel);
  }
  return el(
    paragraph.headingLevel === undefined ? "text:p" : "text:h",
    attributes,
    [
      ...writeOdfParagraphChildren(
        paragraph,
        registry,
        options.definitions,
        options.openNoteKeys,
        options.changeIds,
      ),
      ...(options.trailingNodes ?? []),
    ],
  );
}
