import type { ContentParagraph, ContentRun, ProvenanceDescriptor, RunConstructExtent } from 'document-schema.js';
import type { XmlElement } from '../../model/node';
import type { Package } from '../../model/package';
import type { StyleProperties } from '../../styles/properties';
import { attrValue } from '../../xml/query';
import { decodeXmlText } from '../../xml/entities';
import { getOdfSpaceCount, isOdfFieldElement } from './text';
import { resolveStyle } from './cascade';
import { odfBookmarkAnchorDescriptor, odfFieldDescriptor, pairOdfMarkerHalves, type OdfMarkerHalf } from './constructs';

// Reads a text:p (any inline-text container ODF shapes this document sits in -- odt is a later task, but a draw:text-box's own text:p is content-model-identical) into document-schema.js's ContentParagraph/ContentRun, the read-and-write counterpart to text.ts's own decodeOdfText: where that module projects a container's children to a plain string, this module projects the SAME node shapes (text, text:s, text:tab, text:line-break, text:span) to per-run objects carrying resolved formatting, dispatching on the identical node shapes text.ts's own top-of-file note establishes -- see that module for why text:s/text:tab/text:line-break must never be treated as zero-length whitespace.
//
// A single text:span's own resolved properties (via the 'text' family cascade) are layered ON TOP of the enclosing paragraph's own resolved properties (via the 'paragraph' family cascade, which itself may carry style:text-properties as the paragraph's own default run formatting) as a base -- mirroring how ooxml.js's own pptx paragraph reader merges a paragraph-level cascade base with each run's own explicit override (see readParagraph/mergeRunProperties in ooxml.js's src/typed/pptx/read.ts). This merge is NOT something cascade.ts's own resolveStyle does for you: resolveStyle only ever resolves ONE style-name reference within ONE family's own default-style + parent-chain (ODF's genuinely two-layer cascade, per cascade.ts's own top-of-file note) -- how a SPAN's resolved properties compose with its ENCLOSING PARAGRAPH's own resolved properties is a separate, consuming-layer concern this module owns.
//
// INLINE CONSTRUCTS: a field element reads as a run carrying its cached text plus a run-level field extent covering exactly that run; a text:bookmark reads as a point anchor extent; bookmark halves pairing inside one paragraph become run extents (typed/shared/constructs.ts owns the descriptor shapes and the scope rules). Every reader that uses this module gets the same treatment -- an odt paragraph, an ods cell, and an odp text frame all carry their fields as paragraph constructs.

// The mutable walk state one paragraph's run collection threads: the run-level extents discovered so far, the paired-marker halves at their run positions, and the document-order counter that keeps discovery order deterministic.
interface RunWalkState {
  readonly extents: RunConstructExtent[];
  readonly halves: OdfMarkerHalf[];
  order: number;
  readonly provenanceRegions: ReadonlyMap<string, ProvenanceDescriptor> | undefined;
}

// What a caller reading a paragraph in a document-level context supplies: the tracked-change regions a text:change/text:change-start/text:change-end marker resolves its id against, and the out-array every marker half is reported to for block-scope pairing by the reader that owns the block flow. Both absent when the caller has no document context -- a bare readOdfParagraph call reads runs and run-level extents, and change markers with no region map to resolve against contribute nothing (their id names a region the caller never collected).
export interface OdfParagraphContext {
  readonly provenanceRegions?: ReadonlyMap<string, ProvenanceDescriptor>;
  readonly markersOut?: OdfMarkerHalf[];
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

  const runs: ContentRun[] = [];
  const walk: RunWalkState = { extents: [], halves: [], order: 0, provenanceRegions: context.provenanceRegions };
  collectRuns(pElement, paragraphProperties, pkg, runs, walk);
  walk.extents.push(...pairOdfMarkerHalves(walk.halves, pElement));
  if (context.markersOut !== undefined) {
    context.markersOut.push(...walk.halves);
  }

  return {
    kind: 'paragraph',
    runs,
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
