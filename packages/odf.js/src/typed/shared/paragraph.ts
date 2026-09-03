import type {
  ContentBlock,
  ContentParagraph,
  ContentRun,
  DefinitionEntry,
  ProvenanceDescriptor,
  RunConstructExtent,
} from "document-schema.js";
import type { XmlElement, XmlNode } from "../../model/node";
import type { Package } from "../../model/package";
import type { StyleProperties } from "../../styles/properties";
import type { StyleRegistry } from "../../styles/registry";
import { canonicalPropertiesString } from "../../styles/serialize";
import { attrValue, childrenWithTag, findChildElement } from "../../xml/query";
import { decodeXmlText, encodeXmlText } from "../../xml/entities";
import { el } from "../../xml/fragment";
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
  pairOdfMarkerHalves,
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
        ...resolveStyleElementChain(
          styleName,
          "paragraph",
          pkg,
        ).elements.flatMap((style) => [
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

  return {
    kind: "paragraph",
    runs,
    ...(source !== undefined ? { source } : {}),
    ...(walk.extents.length > 0 ? { constructs: walk.extents } : {}),
    styleId: styleName,
    alignment: paragraphProperties.alignment,
    spacingBeforePt: paragraphProperties.spacingBeforePt,
    spacingAfterPt: paragraphProperties.spacingAfterPt,
    lineSpacing: paragraphProperties.lineSpacing,
    indentLeftPt: paragraphProperties.indentLeftPt,
    indentFirstLinePt: paragraphProperties.indentFirstLinePt,
    pageBreakBefore: paragraphProperties.pageBreakBefore,
    pageBreakAfter: paragraphProperties.pageBreakAfter,
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

// The canonical run list an ODF paragraph can actually carry, and therefore exactly what reading a written paragraph back produces. Three normalisations, each forced by ODF's own inline content model rather than chosen here:
// 1. A zero-length run has no spelling at all -- there is no empty text node in a serialized document -- so it is dropped.
// 2. Adjacent runs whose formatting is identical are one text node or one text:span; two of them would serialize as one and read back as one, so they are merged here rather than left to be silently merged later.
// 3. A tab, a hard line break, and a collapsing space run are ELEMENTS (text:tab, text:line-break, text:s), so a run whose text contains one is split at it -- the reader emits one run per node it meets, and no ODF spelling exists that would keep "a\tb" a single run.
// Exported because the write path's own round-trip law is stated against it: reading back what writeOdt produced yields this list, not the caller's original one, whenever the original was not already canonical.
export function segmentOdfParagraphRuns(
  runs: readonly ContentRun[],
): ContentRun[] {
  const merged: ContentRun[] = [];
  for (const run of runs) {
    if (run.text.length === 0) {
      continue;
    }
    const previous = merged[merged.length - 1];
    if (
      previous !== undefined &&
      runFormattingKey(previous) === runFormattingKey(run)
    ) {
      merged[merged.length - 1] = {
        ...previous,
        text: previous.text + run.text,
      };
      continue;
    }
    merged.push(run);
  }

  const canonical: ContentRun[] = [];
  for (const [index, run] of merged.entries()) {
    const previousText = merged[index - 1]?.text;
    const nextText = merged[index + 1]?.text;
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
  return canonical;
}

// The inline nodes for canonical runs [from, to), grouped so each maximal stretch of consecutive runs sharing one resolved formatting is ONE text:span rather than one per run: a span is the formatting unit, and two adjacent spans referencing the same style say exactly what one does while saying it twice. Runs with no formatting at all contribute bare nodes -- ODF producers never wrap unformatted text in an empty span, and doing so would make every plain paragraph mint a style that states nothing. Whitespace protection is computed against each run's true neighbours in the whole paragraph, never against the group's own edges, since a space at a group boundary is still interior to the paragraph.
function writeOdfFormattedRunNodes(
  canonical: readonly ContentRun[],
  from: number,
  to: number,
  registry: StyleRegistry,
): XmlNode[] {
  const nodes: XmlNode[] = [];
  let index = from;
  while (index < to) {
    const properties = odfRunProperties(canonical[index]!);
    const key = canonicalPropertiesString(properties);
    let end = index + 1;
    while (
      end < to &&
      canonicalPropertiesString(odfRunProperties(canonical[end]!)) === key
    ) {
      end += 1;
    }
    const inner: XmlNode[] = [];
    for (let position = index; position < end; position += 1) {
      const previousText = canonical[position - 1]?.text;
      const nextText = canonical[position + 1]?.text;
      inner.push(
        ...buildOdfInlineNodes(
          segmentOdfText(
            canonical[position]!.text,
            previousText === undefined || previousText.endsWith(" "),
            nextText === undefined || nextText.startsWith(" "),
          ),
        ),
      );
    }
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

// A paragraph's own inline children: each maximal stretch of consecutive runs sharing one hyperlink target wrapped in a single text:a, with the formatting grouping above running inside it. Grouping rather than one text:a per run matches how the reader threads a link's target down through whatever spans sit inside it, so a link whose text changes formatting part-way is one anchor, not several.
function writeOdfParagraphChildren(
  runs: readonly ContentRun[],
  registry: StyleRegistry,
): XmlNode[] {
  const canonical = segmentOdfParagraphRuns(runs);
  const children: XmlNode[] = [];
  let index = 0;
  while (index < canonical.length) {
    const target = canonical[index]!.hyperlink;
    let end = index + 1;
    while (end < canonical.length && canonical[end]!.hyperlink === target) {
      end += 1;
    }
    const nodes = writeOdfFormattedRunNodes(canonical, index, end, registry);
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
  }
  return children;
}

export interface OdfParagraphWriteOptions {
  // The named style this paragraph's formatting hangs off: written as style:parent-style-name on the minted automatic style, or -- when the paragraph carries no direct formatting for an automatic style to hold -- as the paragraph's own text:style-name. The odt writer uses it for a section's page-style switch, which ODF states as a style:master-page-name on a paragraph style and nowhere else.
  readonly parentStyleName?: string;
  // Nodes appended after the paragraph's own inline content -- the anchored draw:frame elements an image block contributes, which ODF anchors inside a paragraph rather than beside one.
  readonly trailingNodes?: readonly XmlNode[];
}

// Writes one ContentParagraph as the text:p (or, for a paragraph carrying a headingLevel, text:h) element readOdfParagraph reads back. Every formatting difference becomes an interned automatic style, since ODF has no other way to state one.
export function writeOdfParagraph(
  paragraph: ContentParagraph,
  registry: StyleRegistry,
  options: OdfParagraphWriteOptions = {},
): XmlElement {
  const properties = odfParagraphProperties(paragraph);
  const attributes: Record<string, string> = {};
  if (Object.keys(properties).length > 0) {
    attributes["text:style-name"] = encodeXmlText(
      registry.intern({
        properties,
        family: "paragraph",
        ...(options.parentStyleName === undefined
          ? {}
          : { parentStyleName: options.parentStyleName }),
      }),
    );
  } else if (options.parentStyleName !== undefined) {
    attributes["text:style-name"] = encodeXmlText(options.parentStyleName);
  }
  if (paragraph.headingLevel !== undefined) {
    attributes["text:outline-level"] = String(paragraph.headingLevel);
  }
  return el(
    paragraph.headingLevel === undefined ? "text:p" : "text:h",
    attributes,
    [
      ...writeOdfParagraphChildren(paragraph.runs, registry),
      ...(options.trailingNodes ?? []),
    ],
  );
}
