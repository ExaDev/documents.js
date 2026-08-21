import type { ContentBlock, ContentParagraph, ContentRun, DefinitionEntry, ProvenanceDescriptor, RunConstructExtent } from 'document-schema.js';
import type { XmlElement } from '../../model/node';
import type { Package } from '../../model/package';
import type { StyleProperties } from '../../styles/properties';
import { attrValue, childrenWithTag, findChildElement } from '../../xml/query';
import { decodeXmlText } from '../../xml/entities';
import { getOdfSpaceCount, decodeOdfText, isOdfFieldElement } from './text';
import { resolveStyle } from './cascade';
import { mintOdfListNumId, readOdfListParagraphs, type OdfListIdState } from './list';
import { isOdfBlockScopedHalf, odfBookmarkAnchorDescriptor, odfFieldDescriptor, odfResidue, pairOdfMarkerHalves, type OdfDefinitionsSink, type OdfMarkerHalf, type OdfResidueFormat } from './constructs';
import { resolveStyleElementChain } from './cascade';
import { parseParagraphProperties, parseTextProperties } from '../../styles/properties';

// Reads a text:p (any inline-text container ODF shapes this document sits in -- odt is a later task, but a draw:text-box's own text:p is content-model-identical) into document-schema.js's ContentParagraph/ContentRun, the read-and-write counterpart to text.ts's own decodeOdfText: where that module projects a container's children to a plain string, this module projects the SAME node shapes (text, text:s, text:tab, text:line-break, text:span) to per-run objects carrying resolved formatting, dispatching on the identical node shapes text.ts's own top-of-file note establishes -- see that module for why text:s/text:tab/text:line-break must never be treated as zero-length whitespace.
//
// A single text:span's own resolved properties (via the 'text' family cascade) are layered ON TOP of the enclosing paragraph's own resolved properties (via the 'paragraph' family cascade, which itself may carry style:text-properties as the paragraph's own default run formatting) as a base -- mirroring how ooxml.js's own pptx paragraph reader merges a paragraph-level cascade base with each run's own explicit override (see readParagraph/mergeRunProperties in ooxml.js's src/typed/pptx/read.ts). This merge is NOT something cascade.ts's own resolveStyle does for you: resolveStyle only ever resolves ONE style-name reference within ONE family's own default-style + parent-chain (ODF's genuinely two-layer cascade, per cascade.ts's own top-of-file note) -- how a SPAN's resolved properties compose with its ENCLOSING PARAGRAPH's own resolved properties is a separate, consuming-layer concern this module owns.
//
// INLINE CONSTRUCTS: a field element reads as a run carrying its cached text plus a run-level field extent covering exactly that run; a text:bookmark reads as a point anchor extent; bookmark halves pairing inside one paragraph become run extents (typed/shared/constructs.ts owns the descriptor shapes and the scope rules). Every reader that uses this module gets the same treatment -- an odt paragraph, an ods cell, and an odp text frame all carry their fields as paragraph constructs.

// The mutable walk state one paragraph's run collection threads: the run-level extents discovered so far, the paired-marker halves at their run positions, the document-order counter that keeps discovery order deterministic, the tracked-change region map, the definitions sink note and annotation bodies mint into, and the list-identity counter a note body's own text:list elements need (a fresh counter per document walk, threaded from the caller where one exists -- a note body's lists get identities independent of the enclosing body's, which is honest for a footnote's own private list numbering).
interface RunWalkState {
  readonly extents: RunConstructExtent[];
  readonly halves: OdfMarkerHalf[];
  order: number;
  readonly provenanceRegions: ReadonlyMap<string, ProvenanceDescriptor> | undefined;
  readonly definitions: OdfDefinitionsSink | undefined;
  readonly listIdState: OdfListIdState;
}

// What a caller reading a paragraph in a document-level context supplies: the tracked-change regions a text:change/text:change-start/text:change-end marker resolves its id against, the out-array every marker half is reported to for block-scope pairing by the reader that owns the block flow, and the definitions sink note and annotation bodies mint into. All absent when the caller has no document context -- a bare readOdfParagraph call reads runs and run-level extents; change markers with no region map contribute nothing (their id names a region the caller never collected), and notes read only their citation run, since an anchor naming a definition key no table holds would be malformed.
export interface OdfParagraphContext {
  readonly provenanceRegions?: ReadonlyMap<string, ProvenanceDescriptor>;
  readonly markersOut?: OdfMarkerHalf[];
  readonly definitions?: OdfDefinitionsSink;
  readonly format?: OdfResidueFormat;
}

// One note/annotation body's own block flow: text:p paragraphs and text:list lists, read through the same shared walkers the main body uses. Anything else in a body contributes nothing, exactly as readBlocks treats unknown block-level elements.
function readOdfNoteBodyBlocks(body: XmlElement, pkg: Package, context: OdfParagraphContext, listIdState: OdfListIdState): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  for (const child of body.children) {
    if (child.type !== 'element') {
      continue;
    }
    if (child.tag === 'text:p' || child.tag === 'text:h') {
      blocks.push(readOdfParagraph(child, pkg, context));
    } else if (child.tag === 'text:list') {
      const numId = mintOdfListNumId(pkg, child, listIdState);
      blocks.push(...readOdfListParagraphs(child, { numId, level: 0 }, (element) => readOdfParagraph(element, pkg, context)));
    }
  }
  return blocks;
}

function collectRuns(container: XmlElement, baseProperties: StyleProperties, pkg: Package, out: ContentRun[], walk: RunWalkState, hyperlinkTarget: string | undefined = undefined): void {
  for (const node of container.children) {
    if (node.type === 'text') {
      if (node.value.length > 0) {
        pushRun(out, runFromText(decodeXmlText(node.value), baseProperties), hyperlinkTarget);
      }
      continue;
    }
    if (node.type !== 'element') {
      continue;
    }
    if (node.tag === 'text:s') {
      pushRun(out, runFromText(' '.repeat(getOdfSpaceCount(node)), baseProperties), hyperlinkTarget);
    } else if (node.tag === 'text:tab') {
      pushRun(out, runFromText('\t', baseProperties), hyperlinkTarget);
    } else if (node.tag === 'text:line-break') {
      pushRun(out, runFromText('\n', baseProperties), hyperlinkTarget);
    } else if (node.tag === 'text:span') {
      const styleName = attrValue(node, 'text:style-name');
      const spanProperties: StyleProperties = { ...baseProperties, ...resolveStyle(styleName, 'text', pkg).properties };
      collectRuns(node, spanProperties, pkg, out, walk, hyperlinkTarget);
    } else if (node.tag === 'text:a') {
      // A text:a is an inline hyperlink: its xlink:href is the link target, its children (text, text:span, text:s/tab/line-break, even a nested text:a) are the link's visible content. Threading the href as hyperlinkTarget through the recursion lets a text:span inside the link still resolve its own "text"-family formatting AND carry the hyperlink on every run it emits -- mirroring ooxml.js's own docx reader, which threads the resolved w:hyperlink target through w:ins/w:fldSimple recursion and stamps { ...run, hyperlink: target } on every leaf run. A text:a with no xlink:href is malformed (ODF makes href mandatory) but its visible text still reads; an enclosing text:a's own target is inherited in that case so an inner link's text is not lost.
      const href = attrValue(node, 'xlink:href');
      collectRuns(node, baseProperties, pkg, out, walk, href ?? hyperlinkTarget);
    } else if (isOdfFieldElement(node)) {
      // An inline field's own children are its cached display content, so they read as ordinary runs at the field's position with the field's base formatting -- this is the fix for the long-standing drop where a field's cached text vanished along with its field-ness. The extent covers exactly the runs the field contributed: startRun === endRun when the producer cached nothing, which is the point-anchor spelling of an uncached field.
      const startRun = out.length;
      collectRuns(node, baseProperties, pkg, out, walk, hyperlinkTarget);
      walk.extents.push({ descriptor: odfFieldDescriptor(node), startRun, endRun: out.length });
    } else if (node.tag === 'text:bookmark') {
      // A point bookmark: zero-width, named, addressed -- a point anchor extent at its run position. text:name is required by the ODF schema; a bookmark without one is malformed and skipped, matching this reader's general salvage posture.
      const name = attrValue(node, 'text:name');
      if (name !== undefined) {
        const runPosition = out.length;
        walk.extents.push({ descriptor: odfBookmarkAnchorDescriptor(decodeXmlText(name)), startRun: runPosition, endRun: runPosition });
      }
    } else if (node.tag === 'text:bookmark-start' || node.tag === 'text:bookmark-end') {
      // A ranged bookmark's half, recorded for pairing once the walk finishes: paired in-paragraph into a run extent, at paragraph edges into the block-scope marker pair the odt reader emits. The element and its parent are kept so that scope test can be made after the fact.
      const name = attrValue(node, 'text:name');
      if (name !== undefined) {
        walk.halves.push({
          kind: 'bookmark',
          side: node.tag === 'text:bookmark-start' ? 'start' : 'end',
          key: decodeXmlText(name),
          element: node,
          parent: container,
          runPosition: out.length,
          order: walk.order++,
          descriptor: () => odfBookmarkAnchorDescriptor(decodeXmlText(name)),
        });
      }
    } else if (node.tag === 'text:change') {
      // A point tracked-change marker: its text:change-id names a text:changed-region the document-level context resolves into the provenance descriptor. With no region (or no region map at all) there is no change kind to report and the marker contributes nothing.
      const changeId = attrValue(node, 'text:change-id');
      const descriptor = changeId === undefined ? undefined : walk.provenanceRegions?.get(decodeXmlText(changeId));
      if (descriptor !== undefined) {
        const runPosition = out.length;
        walk.extents.push({ descriptor, startRun: runPosition, endRun: runPosition });
      }
    } else if (node.tag === 'text:change-start' || node.tag === 'text:change-end') {
      // A tracked-change range half, paired exactly the way a bookmark half pairs: in-paragraph into a run-level provenance extent, at paragraph edges into a block-scope pair. The descriptor is deferred because it resolves through the region map, which may hold no entry for this id.
      const changeId = attrValue(node, 'text:change-id');
      if (changeId !== undefined) {
        walk.halves.push({
          kind: 'change',
          side: node.tag === 'text:change-start' ? 'start' : 'end',
          key: decodeXmlText(changeId),
          element: node,
          parent: container,
          runPosition: out.length,
          order: walk.order++,
          descriptor: () => walk.provenanceRegions?.get(decodeXmlText(changeId)),
        });
      }
    } else if (node.tag === 'text:note') {
      // A footnote/endnote: ODF carries the body INLINE inside the note element, so this is local reading -- the citation mark becomes a run at the note's position, the body mints a definitions entry, and an anchor extent covers the citation run naming that entry's key. Without a definitions sink (or a name to hang either on: text:id absent, nothing to mint with) only the citation run reads -- an anchor naming a definition key no table holds would be malformed. A note with no readable text:note-class is malformed and contributes nothing at all.
      const noteClass = attrValue(node, 'text:note-class');
      if (noteClass === 'footnote' || noteClass === 'endnote') {
        const rawId = attrValue(node, 'text:id');
        const name = rawId !== undefined ? decodeXmlText(rawId) : walk.definitions === undefined ? undefined : `note${walk.definitions.nextNoteOrdinal++}`;
        const startRun = out.length;
        const citationElement = findChildElement(node.children, 'text:note-citation');
        const citation = citationElement === undefined ? '' : decodeOdfText(citationElement);
        if (citation.length > 0) {
          pushRun(out, runFromText(citation, baseProperties), hyperlinkTarget);
        }
        if (name !== undefined) {
          if (walk.definitions !== undefined) {
            const entry: DefinitionEntry = { kind: noteClass, body: [] };
            if (citation.length > 0) {
              entry.citation = citation;
            }
            const bodyElement = findChildElement(node.children, 'text:note-body');
            if (bodyElement !== undefined) {
              entry.body = readOdfNoteBodyBlocks(bodyElement, pkg, { provenanceRegions: walk.provenanceRegions, definitions: walk.definitions }, walk.listIdState);
            }
            walk.definitions.entries[`note:${name}`] = entry;
          }
          walk.extents.push({
            descriptor: { kind: 'anchor', anchorType: noteClass, name, definition: `note:${name}` },
            startRun,
            endRun: out.length,
          });
        }
      }
    } else if (node.tag === 'office:annotation') {
      // A comment anchor: its body and author mint a definitions entry (office:annotation carries its body inline, dc:creator and dc:date beside text:p content), and the anchor itself is a marker HALF rather than an immediate extent -- a named annotation pairs with its office:annotation-end over a range, and only an unpaired one falls back to a point anchor (the pairing and that fallback happen after the walk, in readOdfParagraph). An annotation with no definitions sink reads nothing but leaves the text flow untouched, the same sink-less degrade a note takes.
      if (walk.definitions !== undefined) {
        const rawName = attrValue(node, 'office:name');
        const name = rawName !== undefined ? decodeXmlText(rawName) : `annotation${walk.definitions.nextAnnotationOrdinal++}`;
        const entry: DefinitionEntry = { kind: 'comment', body: [] };
        for (const child of node.children) {
          if (child.type !== 'element') {
            continue;
          }
          if (child.tag === 'dc:creator') {
            entry.author = decodeOdfText(child);
          } else if (child.tag === 'dc:date') {
            entry.dateIso = decodeOdfText(child);
          }
        }
        const paragraphs = childrenWithTag(node, 'text:p').map((paragraph) => readOdfParagraph(paragraph, pkg, { provenanceRegions: walk.provenanceRegions, definitions: walk.definitions }));
        const lists = childrenWithTag(node, 'text:list').map((list) => {
          const numId = mintOdfListNumId(pkg, list, walk.listIdState);
          return readOdfListParagraphs(list, { numId, level: 0 }, (element) => readOdfParagraph(element, pkg, { provenanceRegions: walk.provenanceRegions, definitions: walk.definitions }));
        });
        entry.body = [...paragraphs, ...lists];
        walk.definitions.entries[`comment:${name}`] = entry;
        walk.halves.push({
          kind: 'annotation',
          side: 'start',
          key: name,
          element: node,
          parent: container,
          runPosition: out.length,
          order: walk.order++,
          descriptor: () => ({ kind: 'anchor', anchorType: 'comment', name, definition: `comment:${name}` }),
        });
      }
    } else if (node.tag === 'office:annotation-end') {
      // The closing half of a ranged comment, keyed by office:name -- the pairing attribute ODF 1.2 added; an unnamed end has nothing to pair with and is ignored.
      const rawName = attrValue(node, 'office:name');
      if (rawName !== undefined) {
        walk.halves.push({
          kind: 'annotation',
          side: 'end',
          key: decodeXmlText(rawName),
          element: node,
          parent: container,
          runPosition: out.length,
          order: walk.order++,
          descriptor: () => undefined,
        });
      }
    }
    // Any other child (change-tracking markup, an anchored draw:frame, a text:meta) contributes no run at all -- matching text.ts's own established zero-length treatment of the same node shapes, not a new gap introduced here.
  }
}

function pushRun(out: ContentRun[], run: ContentRun, hyperlinkTarget: string | undefined): void {
  out.push(hyperlinkTarget === undefined ? run : { ...run, hyperlink: hyperlinkTarget });
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
export function readOdfParagraph(pElement: XmlElement, pkg: Package, context: OdfParagraphContext = {}): ContentParagraph {
  const styleName = attrValue(pElement, 'text:style-name');
  const paragraphProperties = resolveStyle(styleName, 'paragraph', pkg).properties;

  // The unmodellable half of the paragraph's own style chain quarantines as per-node residue: every style:paragraph-properties/style:text-properties element in the resolved chain that properties.ts cannot fully model (hasUnknown -- fo:keep-with-next, a style:map child, anything StyleProperties carries no field for) serialises into the paragraph's source, so a same-format writer can restore what the resolved fields could not hold. Only when the context names the reading format -- residue's format member states which reader produced it, and this shared reader serves seven of them. Span-run and table/graphic-style unknowns stay dropped (documented): the run- and table-level channels exist, but the resolved-styles fact this row lands is the paragraph's own chain.
  let source: ContentParagraph['source'];
  if (context.format !== undefined && styleName !== undefined) {
    const unknownElements = resolveStyleElementChain(styleName, 'paragraph', pkg).elements.flatMap((style) =>
      [
        ...childrenWithTag(style, 'style:paragraph-properties').filter((properties) => parseParagraphProperties(properties).hasUnknown),
        ...childrenWithTag(style, 'style:text-properties').filter((properties) => parseTextProperties(properties).hasUnknown),
      ],
    );
    if (unknownElements.length > 0) {
      source = odfResidue(context.format, ...unknownElements);
    }
  }

  const runs: ContentRun[] = [];
  const walk: RunWalkState = { extents: [], halves: [], order: 0, provenanceRegions: context.provenanceRegions, definitions: context.definitions, listIdState: { next: 1 } };
  collectRuns(pElement, paragraphProperties, pkg, runs, walk);
  const { extents: pairedExtents, paired } = pairOdfMarkerHalves(walk.halves, pElement);
  walk.extents.push(...pairedExtents);
  // An annotation whose office:annotation-end never arrived (the end element is optional -- a single-position comment needs none) falls back to the point anchor at its run position, unless it sat at a paragraph edge -- an edge half is the block-scope reader's, and that reader makes the same fallback itself against the whole flow.
  for (const half of walk.halves) {
    if (half.kind === 'annotation' && half.side === 'start' && !paired.has(half.element) && !isOdfBlockScopedHalf(half, pElement)) {
      const descriptor = half.descriptor();
      if (descriptor !== undefined) {
        walk.extents.push({ descriptor, startRun: half.runPosition, endRun: half.runPosition });
      }
    }
  }
  if (context.markersOut !== undefined) {
    context.markersOut.push(...walk.halves);
  }

  return {
    kind: 'paragraph',
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
  };
}
