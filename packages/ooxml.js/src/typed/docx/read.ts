import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import type {
  ContentBlock,
  ContentListMembership,
  ContentParagraph,
  ContentRun,
  ContentSection,
  Margins,
  PageSize,
  RunConstructExtent,
} from "document-schema.js";
import { PAGE_SIZE_LETTER, clampHeadingLevel } from "document-schema.js";
import { readCoreProperties } from "../shared/metadata";
import type { Relationship } from "../util";
import {
  attr,
  childrenWithTag,
  elementsWithTag,
  resolveRelationships,
  rootElement,
  textContent,
} from "../util";
import { findRelatedPartPath } from "../opc";
import type { DocxStyleContext } from "./styles";
import { resolveParagraphProperties } from "./styles";
import { readNumberingDefinitions } from "./numbering";
import type { ParagraphContentIndex } from "./constructs";
import { indexParagraphContent, runRangeMarkerExtents } from "./constructs";
import type { Comment, DocxDocument, Footnote } from "./read-schemas";
import { readParagraphBorders } from "./read-table";
import {
  readDocumentTheme,
  readHeaderFooterParts,
  readSections,
  resolveDocxMainPartPath,
} from "./read-flow";
import type {
  LiftedPosition,
  ParagraphPageBreakEvent,
  ParagraphRunEvents,
  RunFieldEvent,
  RunSimpleFieldEvent,
} from "./read-runs";
import {
  newParagraphRunEvents,
  readParagraphLiftedBlocks,
  readParagraphRuns,
} from "./read-runs";
import { twipsToPt } from "../shared/units";

// Package -> DocxDocument. Walks word/document.xml directly, resolving the full style cascade (docDefaults -> named-style basedOn chains -> paragraph-mark run properties -> character styles -> direct formatting) and DrawingML theme references for each run, so document order, styling, and geometry are all preserved — unlike a naive reader that flattens paragraphs/tables into separate arrays with no shared ordering. Headers/footers are read as the structural model alone: headerFooterParts carries each word/header*/word/footer* part as block flow walked by the same machinery as the body (referenced or not), and sectionHeaderFooters names which section references which part at which of the default/first/even slots. Live PAGE/NUMPAGES field substitution is not implemented — fields resolve to their cached result text (Word already computed it), which is correct for every field except one whose value would change under a different pagination this reader doesn't perform. Ported from documents.js's src/ooxml/docx/read.ts (the section/style-cascade walk) merged with this package's own prior comment/footnote/header/footer reading.
//
// This is the flat, content-level half of the docx read pair: readDocx (typed/document-tree.ts) wraps it into a tree-form DocumentTree, which is the primary name and the shape a caller holding a whole document wants. Reach for this one when you need what the tree has no spelling for — the comments, footnotes, header/footer parts, and numbering definitions DocxDocument carries outside `sections` — or when driving a pipeline that already works in flat ContentSection[].
//
// The conventional names every mainstream producer gives these parts. OPC itself names each of them through a relationship (the package root's officeDocument relationship for the body, the body part's own relationships for the rest), so each is used only as the fallback for a package that declares no usable relationship of that type — see typed/opc.ts.
export const CONVENTIONAL_DOCUMENT_PART_PATH = "word/document.xml";
const CONVENTIONAL_STYLES_PART_PATH = "word/styles.xml";
const CONVENTIONAL_COMMENTS_PART_PATH = "word/comments.xml";
const CONVENTIONAL_FOOTNOTES_PART_PATH = "word/footnotes.xml";
const CONVENTIONAL_ENDNOTES_PART_PATH = "word/endnotes.xml";
const STYLES_REL_SUFFIX = "/styles";
const COMMENTS_REL_SUFFIX = "/comments";
const FOOTNOTES_REL_SUFFIX = "/footnotes";
const ENDNOTES_REL_SUFFIX = "/endnotes";
export const HEADER_REL_SUFFIX = "/header";
export const FOOTER_REL_SUFFIX = "/footer";
export const THEME_REL_SUFFIX = "/theme";

// Everything the block walk needs that does not change as it descends: the style/theme cascade context, the containing part's own relationships, and the package the media parts live in.
export interface DocxReadContext {
  readonly styles: DocxStyleContext;
  readonly rels: ReadonlyMap<string, Relationship>;
  readonly pkg: Package;
}

// Word's own default page margins (1 inch each side) and page size (US Letter), used whenever a section's w:sectPr omits w:pgMar/w:pgSz.
const DEFAULT_MARGIN_PT = 72;
export const DEFAULT_MARGINS: Margins = {
  topPt: DEFAULT_MARGIN_PT,
  rightPt: DEFAULT_MARGIN_PT,
  bottomPt: DEFAULT_MARGIN_PT,
  leftPt: DEFAULT_MARGIN_PT,
};

export function readPageSize(sectPr: XmlElement): PageSize {
  const pgSz = childrenWithTag(sectPr, "w:pgSz")[0];
  const w = pgSz === undefined ? undefined : attr(pgSz, "w:w");
  const h = pgSz === undefined ? undefined : attr(pgSz, "w:h");
  return w === undefined || h === undefined
    ? PAGE_SIZE_LETTER
    : { widthPt: twipsToPt(Number(w)), heightPt: twipsToPt(Number(h)) };
}

export function readMargins(sectPr: XmlElement): Margins {
  const pgMar = childrenWithTag(sectPr, "w:pgMar")[0];
  if (pgMar === undefined) {
    return DEFAULT_MARGINS;
  }
  const top = attr(pgMar, "w:top");
  const right = attr(pgMar, "w:right");
  const bottom = attr(pgMar, "w:bottom");
  const left = attr(pgMar, "w:left");
  return {
    topPt: top === undefined ? DEFAULT_MARGIN_PT : twipsToPt(Number(top)),
    rightPt: right === undefined ? DEFAULT_MARGIN_PT : twipsToPt(Number(right)),
    bottomPt:
      bottom === undefined ? DEFAULT_MARGIN_PT : twipsToPt(Number(bottom)),
    leftPt: left === undefined ? DEFAULT_MARGIN_PT : twipsToPt(Number(left)),
  };
}

// w:sectPr/w:type names how the section it closes BEGINS relative to the one before it. An absent or unrecognised @w:val leaves the field absent rather than storing WordprocessingML's own default (nextPage): the default is what every consumer already assumes, so only a spelled break kind carries information worth recording.
export function readSectionBreakType(
  sectPr: XmlElement,
): ContentSection["breakType"] {
  const type = childrenWithTag(sectPr, "w:type")[0];
  const val = type === undefined ? undefined : attr(type, "w:val");
  return val === "nextPage" ||
    val === "continuous" ||
    val === "evenPage" ||
    val === "oddPage"
    ? val
    : undefined;
}

function readListMembership(
  pPr: XmlElement | undefined,
): ContentListMembership | undefined {
  const numPr =
    pPr === undefined ? undefined : childrenWithTag(pPr, "w:numPr")[0];
  if (numPr === undefined) {
    return undefined;
  }
  const numIdEl = childrenWithTag(numPr, "w:numId")[0];
  const numId = numIdEl === undefined ? undefined : attr(numIdEl, "w:val");
  if (numId === undefined) {
    return undefined;
  }
  const ilvlEl = childrenWithTag(numPr, "w:ilvl")[0];
  const ilvlVal = ilvlEl === undefined ? undefined : attr(ilvlEl, "w:val");
  return { numId, level: ilvlVal === undefined ? 0 : Number(ilvlVal) };
}

export function readToggle(el: XmlElement | undefined): boolean {
  if (el === undefined) {
    return false;
  }
  const val = attr(el, "w:val");
  // An absent @w:val needs no explicit disjunct: undefined !== "0" (and "false"/"off") are all true, so the conjunction alone already spells "absent means on".
  return val !== "0" && val !== "false" && val !== "off";
}

export function hasPageBreakBefore(paragraph: XmlElement): boolean {
  const pPr = childrenWithTag(paragraph, "w:pPr")[0];
  return readToggle(
    pPr === undefined
      ? undefined
      : childrenWithTag(pPr, "w:pageBreakBefore")[0],
  );
}

// A complex field is block-scoped exactly when its begin run is the paragraph's first content-bearing child and its end run the last — the whole-paragraph shape scanParagraphFields brackets as a marker pair, which this assembly must therefore not also encode as a run extent. A begin or end nested inside a container (w:hyperlink, w:ins) is never a direct child, so it cannot be block-scoped — and scanParagraphFields, which walks only direct children, never saw it either: the two paths partition the occurrences between them by construction. No "found among direct children" guard is needed on the indexOf lookups: the walk that produced this event only reaches a begin through containers that are all themselves content-bearing (w:hyperlink, w:fldSimple, w:ins, w:sdt), so a paragraph with a field event always has a content-bearing direct child and firstContentIndex/lastContentIndex are never -1 here — an unfound element indexes at -1 and simply fails the equality that follows.
function isBlockScopedField(
  event: RunFieldEvent,
  index: ParagraphContentIndex,
): boolean {
  const begin = index.elements.indexOf(event.beginElement);
  const end = index.elements.indexOf(event.endElement);
  return begin === index.firstContentIndex && end === index.lastContentIndex;
}

// A w:fldSimple is block-scoped when it is its paragraph's only content-bearing child — scanParagraphFields' own test for the simple spelling. The same no-indexOf-guard reasoning as isBlockScopedField applies: a fldSimple the walk saw is either a direct content-bearing child itself or nested inside one.
function isBlockScopedSimpleField(
  event: RunSimpleFieldEvent,
  index: ParagraphContentIndex,
): boolean {
  const position = index.elements.indexOf(event.element);
  return (
    index.firstContentIndex === position && index.lastContentIndex === position
  );
}

// Assembles the run walk's collected events into the paragraph's constructs field: paired range markers (bookmarks, comment extents) first in discovery order, then the walk-order events (closed fields, simple fields, internal links, point anchors). Deterministic in the markup's own order, with the two families concatenated rather than interleaved — ranges are data on the paragraph, never brackets, so no ordering between families is load-bearing.
function assembleRunConstructs(
  events: ParagraphRunEvents,
  index: ParagraphContentIndex,
): RunConstructExtent[] {
  const extents: RunConstructExtent[] = runRangeMarkerExtents(
    events.halves,
    index,
  );
  for (const field of events.fields) {
    if (!isBlockScopedField(field, index)) {
      extents.push({
        descriptor: field.descriptor,
        startRun: field.startRun,
        endRun: field.endRun,
      });
    }
  }
  for (const simple of events.simpleFields) {
    if (!isBlockScopedSimpleField(simple, index)) {
      extents.push({
        descriptor: simple.descriptor,
        startRun: simple.startRun,
        endRun: simple.endRun,
      });
    }
  }
  for (const link of events.links) {
    extents.push({
      descriptor: {
        kind: "link",
        target: { kind: "internal", anchor: link.anchor },
      },
      startRun: link.startRun,
      endRun: link.endRun,
    });
  }
  for (const anchor of events.pointAnchors) {
    extents.push({
      descriptor: anchor.descriptor,
      startRun: anchor.runPosition,
      endRun: anchor.runPosition,
    });
  }
  return extents;
}

interface ReadParagraphResult {
  readonly paragraph: ContentParagraph;
  readonly pageBreak: ParagraphPageBreakEvent | undefined;
  readonly liftedPositions: ReadonlyMap<XmlElement, LiftedPosition>;
}

function readParagraph(
  paragraph: XmlElement,
  ctx: DocxReadContext,
  carryDeletions: boolean,
): ReadParagraphResult {
  const pPr = childrenWithTag(paragraph, "w:pPr")[0];
  const pStyleEl =
    pPr === undefined ? undefined : childrenWithTag(pPr, "w:pStyle")[0];
  const props = resolveParagraphProperties(paragraph, ctx.styles);
  // The paragraph's own run-level construct extents: the run walk's events, paired and scope-filtered against the content index so a block-scoped occurrence stays on the marker path. Absent rather than empty when the paragraph carries none — the common case costs nothing.
  const events = newParagraphRunEvents();
  const runs = readParagraphRuns(paragraph, ctx, carryDeletions, events);
  const constructs = assembleRunConstructs(
    events,
    indexParagraphContent(paragraph),
  );
  return {
    paragraph: {
      kind: "paragraph",
      runs,
      ...(constructs.length > 0 ? { constructs } : {}),
      styleId: pStyleEl === undefined ? undefined : attr(pStyleEl, "w:val"),
      // w:outlineLvl is 0-based (0 is a level-1 heading). Word's own outline levels run 1-9 while the schema's heading domain is 1-6, so clampHeadingLevel narrows levels 7-9 onto 6 — the same closest-matching-value convention readAlignment (styles.ts) applies to w:jc's both/distribute.
      headingLevel:
        props.outlineLvl === undefined
          ? undefined
          : clampHeadingLevel(props.outlineLvl + 1),
      alignment: props.alignment,
      list: readListMembership(pPr),
      spacingBeforePt: props.spacingBeforePt,
      spacingAfterPt: props.spacingAfterPt,
      lineSpacing: props.lineSpacing,
      indentLeftPt: props.indentLeftPt,
      indentFirstLinePt: props.indentFirstLinePt,
      direction:
        props.bidi === undefined ? undefined : props.bidi ? "rtl" : "ltr",
      borders: readParagraphBorders(pPr),
    },
    pageBreak: events.pageBreak,
    liftedPositions: events.liftedPositions,
  };
}

// Splits a single run at the character offset a mid-run page-type w:br was found at (findRunPageBreakOffset), returning the run's own text before and after the break as two ContentRuns sharing every OTHER field of the original (bold/italic/colour/hyperlink/...) unchanged — a page break splits a run's text, never its formatting. Either half is omitted from the result when the break sits at that half's own edge (charIndex 0 has no "before" text; charIndex === text.length has no "after" text), so a run that happens to end or begin exactly at the break contributes only the one real half rather than an empty stand-in run.
function splitRunAtOffset(
  run: ContentRun,
  charIndex: number,
): {
  readonly before: ContentRun | undefined;
  readonly after: ContentRun | undefined;
} {
  const beforeText = run.text.slice(0, charIndex);
  // The break's own character (readRunText's unconditional single '\n' for any w:br, page-type included) belongs to neither half — it is the split point itself, not literal content — so the after-text starts one character past charIndex, not at it.
  const afterText = run.text.slice(charIndex + 1);
  return {
    before: beforeText.length > 0 ? { ...run, text: beforeText } : undefined,
    after: afterText.length > 0 ? { ...run, text: afterText } : undefined,
  };
}

// Splits one already-assembled ContentParagraph into [before, pageBreak, after] at a mid-run page-type w:br, or returns it unchanged as a single-element array when the paragraph carries none. Both halves inherit the original paragraph's own paragraph-level formatting (styleId/alignment/spacing/borders/...) unchanged — a page break inside one paragraph does not create two logically distinct paragraph styles in Word, so nothing here invents a difference between them. A run-level construct extent (bookmark, field, internal link, footnote/endnote/comment anchor — every RunConstructExtent, since assembleRunConstructs has already folded all of them into this one array by the time this runs) that sits entirely before or after the split run keeps its own descriptor, re-indexed onto whichever half it landed in; one that spans the split run itself is dropped rather than mis-encoded, mirroring constructs.ts's own established "a crossing extent has no clean encoding, so it is dropped, not guessed at" rule for the analogous block-boundary case.
function splitParagraphAtPageBreak(
  paragraph: ContentParagraph,
  pageBreak: ParagraphPageBreakEvent,
): ContentBlock[] {
  // The event's runIndex is the index the run walk assigned the break's own run as it pushed it, and the runs array is append-only from that point to this assembly, so the index always names a real run — no undefined fallback exists to take.
  const splitRun = paragraph.runs[pageBreak.runIndex]!;
  const { before: beforeHalf, after: afterHalf } = splitRunAtOffset(
    splitRun,
    pageBreak.charIndex,
  );

  const runsBefore = [
    ...paragraph.runs.slice(0, pageBreak.runIndex),
    ...(beforeHalf === undefined ? [] : [beforeHalf]),
  ];
  const runsAfter = [
    ...(afterHalf === undefined ? [] : [afterHalf]),
    ...paragraph.runs.slice(pageBreak.runIndex + 1),
  ];
  const afterRunOffset =
    pageBreak.runIndex + 1 - (afterHalf === undefined ? 0 : 1);

  const constructsBefore: RunConstructExtent[] = [];
  const constructsAfter: RunConstructExtent[] = [];
  for (const extent of paragraph.constructs ?? []) {
    if (extent.endRun <= pageBreak.runIndex) {
      constructsBefore.push(extent);
    } else if (extent.startRun >= pageBreak.runIndex + 1) {
      constructsAfter.push({
        ...extent,
        startRun: extent.startRun - afterRunOffset,
        endRun: extent.endRun - afterRunOffset,
      });
    }
    // The remaining case — startRun <= pageBreak.runIndex && endRun > pageBreak.runIndex — spans the split run itself and is dropped, per this function's own doc comment.
  }

  return [
    {
      ...paragraph,
      runs: runsBefore,
      constructs: constructsBefore.length > 0 ? constructsBefore : undefined,
    },
    { kind: "pageBreak" },
    {
      ...paragraph,
      runs: runsAfter,
      constructs: constructsAfter.length > 0 ? constructsAfter : undefined,
    },
  ];
}

// The one entry point collectParagraph calls: reads a w:p as its own real ContentBlock array, honouring a mid-run page-type w:br by splitting into [before, pageBreak, after] rather than folding it into one paragraph's own literal '\n' text, and appending the paragraph's lifted media blocks after whichever halves the split produced. A paragraph that splits carries no lifted anchors: the two halves' own runs arrays are re-indexed and re-shaped by the split, so a pre-split run index would name a position in one half or the other ambiguously — exactly the "no clean encoding, so dropped rather than mis-encoded" rule the split itself applies to a construct spanning the break — and an unsplit paragraph (the overwhelmingly common case) anchors every lifted image it has.
export function readParagraphBlocks(
  paragraph: XmlElement,
  ctx: DocxReadContext,
  carryDeletions: boolean,
): ContentBlock[] {
  const read = readParagraph(paragraph, ctx, carryDeletions);
  const lifted = readParagraphLiftedBlocks(
    paragraph,
    ctx,
    carryDeletions,
    read.paragraph.runs,
    read.pageBreak === undefined
      ? read.liftedPositions
      : new Map<XmlElement, LiftedPosition>(),
  );
  return read.pageBreak === undefined
    ? [read.paragraph, ...lifted]
    : [...splitParagraphAtPageBreak(read.paragraph, read.pageBreak), ...lifted];
}

function readComment(comment: XmlElement): Comment {
  const id = attr(comment, "w:id");
  const author = attr(comment, "w:author");
  const text = elementsWithTag(comment.children, "w:t")
    .map(textContent)
    .join("");
  const result: Comment = { text };
  if (id !== undefined) {
    result.id = id;
  }
  if (author !== undefined) {
    result.author = author;
  }
  return result;
}

function readFootnote(footnote: XmlElement): Footnote {
  const id = attr(footnote, "w:id");
  const type = attr(footnote, "w:type");
  const text = elementsWithTag(footnote.children, "w:t")
    .map(textContent)
    .join("");
  const result: Footnote = { text };
  if (id !== undefined) {
    result.id = id;
  }
  if (type !== undefined) {
    result.type = type;
  }
  return result;
}

function readComments(pkg: Package, documentPartPath: string): Comment[] {
  const root = rootElement(
    pkg.parts[
      findRelatedPartPath(pkg, documentPartPath, COMMENTS_REL_SUFFIX) ??
        CONVENTIONAL_COMMENTS_PART_PATH
    ],
  );
  if (root === undefined) {
    return [];
  }
  return childrenWithTag(root, "w:comment").map(readComment);
}

// One walk for both note flavours: word/footnotes.xml and word/endnotes.xml share the identical shape (a container of w:footnote/w:endnote elements, each with its own w:id and the separator/continuationSeparator machinery types skipped), so endnotes are the same read against their own part.
function readNotesPart(
  pkg: Package,
  path: string,
  noteTag: "w:footnote" | "w:endnote",
): Footnote[] {
  const root = rootElement(pkg.parts[path]);
  if (root === undefined) {
    return [];
  }
  const out: Footnote[] = [];
  for (const note of childrenWithTag(root, noteTag)) {
    const type = attr(note, "w:type");
    if (type === "separator" || type === "continuationSeparator") {
      continue;
    }
    out.push(readFootnote(note));
  }
  return out;
}

// Resolves a generic OOXML Package into DocxDocument: the WordprocessingML style cascade, DrawingML theme resolution (including w:themeColor run-colour references, resolved against the theme's own colour scheme), ordered sections of paragraphs/tables/page-breaks/images (document order preserved, including inside tables, with cell background AND border styling read from w:tcBorders), the block-scoped fidelity constructs (structured document tags, fields, bookmarks, tracked changes) as constructStart/constructEnd marker pairs, plus comments, footnotes, header/footer parts, and word/numbering.xml's own abstractNum/num level definitions (numbering.ts's readNumberingDefinitions). An inline (wp:inline) or floating/anchored (wp:anchor) w:drawing is resolved to a real ContentImageBlock via the containing part's own relationships, sniffed from its actual media-part bytes rather than trusted from any extension/content-type; a floating image's own wp:anchor position (wp:positionH/wp:positionV) is read into ContentImageBlock.floatPosition (document-schema.js, ExaDev/documents.js#1087), while an inline image simply has none, landing in the block flow at the point its w:drawing was encountered instead. A w:object/o:OLEObject whose payload part is itself a ZIP archive (a modern producer's embedded xlsx/docx/pptx) is decoded through the shared embedded-object helper (typed/embedded.ts) into a sibling ContentEmbeddedObjectBlock sized from w:dxaOrig/w:dyaOrig and lifted through the same convention as an image block; a payload that does not decode as one of the three OOXML flavours degrades to no embedded block rather than failing the read.
//
// Information not modelled here is still dropped: live PAGE/NUMPAGES field re-evaluation; w:themeShade/w:themeTint refinement of a resolved theme colour; a floating image's own anchored position; any image whose bytes don't sniff as PNG/JPEG; a w:object's VML preview picture (v:imagedata — no VML reader exists here, and real producers ship WMF/EMF previews anyway); a w:object sitting inside a footnote (footnotes ride DocxDocument.footnotes as text, so there is no block flow to lift an object into — a header/footer's own objects DO recover now, since those parts are walked as block flow); the evenAndOddHeaders setting in word/settings.xml that gates whether a section's even-page slot renders (the references themselves are recorded as spelled); Word's header/footer slot-inheritance rule (a section reusing the previous section's part when it spells no reference of its own — a consumer concern, since this records exactly what the file spells); the classic non-ZIP OLE compound-file payload (.bin — opaque external-application data, left skipped exactly as unhandled markup) and a ZIP payload that does not decode as one of the three OOXML flavours (both degrade to no embedded block, never a failed read); and the run-level construct occurrences still without an encoding here — an inline SDT or partial tracked change, and a bookmark whose two halves sit in different paragraphs (a same-paragraph bookmark pair, crossing included, lands on ContentParagraph.constructs; see typed/docx/constructs.ts for the scope rules, and typed/docx/write.ts for the write side of what does survive).
export function readDocxContent(pkg: Package): DocxDocument {
  const documentPartPath = resolveDocxMainPartPath(pkg);
  const documentRoot = rootElement(pkg.parts[documentPartPath]);
  if (documentRoot === undefined) {
    throw new Error(`readDocxContent: package has no ${documentPartPath} part`);
  }
  const body = childrenWithTag(documentRoot, "w:body")[0];
  if (body === undefined) {
    throw new Error(
      `readDocxContent: ${documentPartPath} has no w:body element`,
    );
  }

  const docRels = resolveRelationships(pkg, documentPartPath);
  const ctx: DocxReadContext = {
    styles: {
      stylesRoot: rootElement(
        pkg.parts[
          findRelatedPartPath(pkg, documentPartPath, STYLES_REL_SUFFIX) ??
            CONVENTIONAL_STYLES_PART_PATH
        ],
      ),
      theme: readDocumentTheme(pkg, docRels),
    },
    rels: docRels,
    pkg,
  };

  const { sections, headerFooters } = readSections(body, ctx);
  return {
    metadata: readCoreProperties(pkg),
    sections,
    comments: readComments(pkg, documentPartPath),
    footnotes: readNotesPart(
      pkg,
      findRelatedPartPath(pkg, documentPartPath, FOOTNOTES_REL_SUFFIX) ??
        CONVENTIONAL_FOOTNOTES_PART_PATH,
      "w:footnote",
    ),
    endnotes: readNotesPart(
      pkg,
      findRelatedPartPath(pkg, documentPartPath, ENDNOTES_REL_SUFFIX) ??
        CONVENTIONAL_ENDNOTES_PART_PATH,
      "w:endnote",
    ),
    headerFooterParts: readHeaderFooterParts(pkg, documentPartPath, ctx),
    sectionHeaderFooters: headerFooters,
    numbering: readNumberingDefinitions(pkg),
  };
}
