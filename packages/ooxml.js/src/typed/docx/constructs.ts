import type { AnchorDescriptor, ConstructDescriptor, ContentBlock, ContentControlDescriptor, ContentControlLock, ContentControlType, ProvenanceChange, ProvenanceDescriptor, SourceResidue } from 'document-schema.js';
import type { XmlElement } from '../../model/node';
import { buildXml } from '../../xml/build';
import { attr, childrenWithTag, decodeEntities, textContent } from '../util';

// The docx side of document-schema.js's fidelity construct vocabulary (its src/construct.ts): reading a WordprocessingML construct into a ConstructDescriptor, and placing the flat form's constructStart/constructEnd marker pair around the blocks that construct spans. Shared by the reader (typed/docx/read.ts) and the writer (typed/docx/write.ts), so one module owns both the descriptor shapes and the bracket placement rules the two halves must agree on.
//
// EXTENT SCOPE, the single constraint that decides which real-world docx constructs are representable here at all: a marker pair brackets whole BLOCKS. document-schema.js states this on the marker schemas themselves -- a construct group wraps a section's, cell's, or shape's block flow, never a sub-sequence of one paragraph's runs, because a run-level extent is not expressible without changing ContentParagraph's own shape. So a field, bookmark, SDT, or tracked change spanning one or more whole paragraphs becomes a marker pair, and the same construct sitting mid-paragraph (a PAGE field inside a sentence, a bookmark over three words, a few inserted words in an otherwise untouched paragraph) has no encoding and is not emitted. The reader's own qualification tests below are exactly that distinction, made per construct.

// The element children of a w:p that carry no visible content of their own: paragraph properties, and the range/annotation markers that punctuate a paragraph without contributing to it. Everything else -- w:r, w:hyperlink, w:fldSimple, w:ins, w:del, w:sdt, w:smartTag, mc:AlternateContent, m:oMath -- is content-bearing. This set is what "first content-bearing child" and "last content-bearing child" mean in the qualification tests below: a bookmark or field marker sitting outside every content-bearing child brackets the whole paragraph, one sitting between them brackets a sub-sequence of its runs and is out of scope.
const NON_CONTENT_PARAGRAPH_CHILDREN: ReadonlySet<string> = new Set([
  'w:pPr',
  'w:bookmarkStart',
  'w:bookmarkEnd',
  'w:commentRangeStart',
  'w:commentRangeEnd',
  'w:proofErr',
  'w:permStart',
  'w:permEnd',
  'w:moveFromRangeStart',
  'w:moveFromRangeEnd',
  'w:moveToRangeStart',
  'w:moveToRangeEnd',
]);

// A w:r carrying nothing but its own w:rPr (and Word's own rendering hint) produces no output, so it must not count as content -- otherwise Word's habit of appending a bare formatting run after a field's closing w:fldChar would disqualify every such field from block scope for a run that renders nothing.
const INERT_RUN_CHILDREN: ReadonlySet<string> = new Set(['w:rPr', 'w:lastRenderedPageBreak']);

function isContentBearingChild(child: XmlElement): boolean {
  if (NON_CONTENT_PARAGRAPH_CHILDREN.has(child.tag)) {
    return false;
  }
  if (child.tag !== 'w:r') {
    return true;
  }
  return child.children.some((grandChild) => grandChild.type === 'element' && !INERT_RUN_CHILDREN.has(grandChild.tag));
}

// A paragraph's element children paired with the positions of its first and last content-bearing one (-1 each when the paragraph has none), the shape every qualification test below reads. Computed once per paragraph rather than per marker, since a paragraph can carry several bookmarks and field characters at once.
export interface ParagraphContentIndex {
  readonly elements: readonly XmlElement[];
  readonly firstContentIndex: number;
  readonly lastContentIndex: number;
}

export function indexParagraphContent(paragraph: XmlElement): ParagraphContentIndex {
  const elements: XmlElement[] = [];
  for (const child of paragraph.children) {
    if (child.type === 'element') {
      elements.push(child);
    }
  }
  let firstContentIndex = -1;
  let lastContentIndex = -1;
  elements.forEach((element, index) => {
    if (!isContentBearingChild(element)) {
      return;
    }
    if (firstContentIndex === -1) {
      firstContentIndex = index;
    }
    lastContentIndex = index;
  });
  return { elements, firstContentIndex, lastContentIndex };
}

// The content-bearing children only, in order -- what the field qualification test indexes into ("is the begin fldChar the first of these, and the end fldChar the last").
export function contentBearingChildren(index: ParagraphContentIndex): XmlElement[] {
  return index.elements.filter(isContentBearingChild);
}

// --- construct extents ---------------------------------------------------------------------------------------------

// One construct's span over a block list, half-open: `startIndex` is the first block it covers and `endIndex` one past the last, so a point construct (a bookmark with no range) has startIndex === endIndex. `order` is discovery order in the source, the deterministic tie-break between two extents covering the identical range.
export interface ConstructExtent {
  readonly startIndex: number;
  readonly endIndex: number;
  readonly order: number;
  readonly descriptor: ConstructDescriptor;
}

// Outermost first at a shared start (longer extent opens before the one nested inside it), then source order.
function compareExtents(a: ConstructExtent, b: ConstructExtent): number {
  return a.startIndex - b.startIndex || b.endIndex - a.endIndex || a.order - b.order;
}

// The flat form pairs markers as balanced brackets, so an extent that starts inside another and ends outside it has no encoding at all: bracket matching would silently re-pair the two into a different nesting than the source meant. WordprocessingML's own marker-paired constructs (w:bookmarkStart/End keyed by w:id, w:fldChar begin/end) are free to overlap that way, so the crossing case is real input rather than a malformed one -- it is dropped here, exactly as a run-level extent is, rather than being emitted as a pair that would decode to the wrong nesting. Structural constructs (w:sdt, w:ins, w:del) are XML elements and so nest by construction; only bookmark and field extents can ever be rejected here.
function acceptProperlyNested(extents: readonly ConstructExtent[]): ConstructExtent[] {
  const sorted = [...extents].sort(compareExtents);
  const accepted: ConstructExtent[] = [];
  const open: ConstructExtent[] = [];
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

// Splices each extent's constructStart/constructEnd pair into the block list around the blocks it covers, producing the flat encoding document-schema.js's findConstructMarkerImbalance validates: markers balance, and a close always matches the nearest still-open start in the same list.
export function insertConstructMarkers(blocks: readonly ContentBlock[], extents: readonly ConstructExtent[]): ContentBlock[] {
  if (extents.length === 0) {
    return [...blocks];
  }
  const nested = acceptProperlyNested(extents);
  const openingAt = new Map<number, ConstructExtent[]>();
  for (const extent of nested) {
    const existing = openingAt.get(extent.startIndex);
    if (existing === undefined) {
      openingAt.set(extent.startIndex, [extent]);
    } else {
      existing.push(extent);
    }
  }

  const out: ContentBlock[] = [];
  const open: ConstructExtent[] = [];
  for (let index = 0; index <= blocks.length; index++) {
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

// --- content controls (w:sdt) --------------------------------------------------------------------------------------

// w:sdtPr's own type child names the control kind. Word spells the checkbox and repeating-section controls in its later extension namespaces (w14/w15) rather than in w:, so both prefixes are accepted for those two; everything else is plain w:. A w:sdtPr with no type child at all is a rich-text control, which is also what ECMA-376 makes the default.
const CONTROL_TYPE_BY_TAG: ReadonlyMap<string, ContentControlType> = new Map([
  ['w:richText', 'richText'],
  ['w:text', 'plainText'],
  ['w:comboBox', 'comboBox'],
  ['w:dropDownList', 'dropDown'],
  ['w:date', 'date'],
  ['w:picture', 'picture'],
  ['w:group', 'group'],
  ['w:checkbox', 'checkbox'],
  ['w14:checkbox', 'checkbox'],
  ['w:repeatingSection', 'repeatingSection'],
  ['w15:repeatingSection', 'repeatingSection'],
]);

const LOCK_BY_VALUE: ReadonlyMap<string, ContentControlLock> = new Map([
  ['contentLocked', 'content'],
  ['sdtLocked', 'container'],
  ['sdtContentLocked', 'both'],
]);

// The one w:docPartObj gallery that is an index rather than an ordinary building-block container -- document-schema.js's `index` member names docx's TOC-as-SDT explicitly, and every other gallery (Cover Pages, Watermarks, Quick Parts) is a container of arbitrary content with no index semantics, so those degrade to richText with the whole w:docPartObj/w:docPartList element quarantined verbatim in the descriptor's residue (the residue channel's first consumer).
export const TABLE_OF_CONTENTS_GALLERY = 'Table of Contents';

// What a w:sdtPr's own type child says the control is, plus the docPart residue when that payload is what degraded to richText: one walk decides both, so the semantic verdict and the quarantined original can never disagree about which element won. The residue carries the element subtree as the lossless layer's own builder serialises it -- the same equivalence class that layer round-trips within, so a same-format writer can re-emit it (write.ts does) without this typed layer ever interpreting the text.
interface ControlTypeReading {
  readonly controlType: ContentControlType;
  readonly galleryResidue: SourceResidue | undefined;
}

function readControlType(sdtPr: XmlElement | undefined): ControlTypeReading {
  if (sdtPr === undefined) {
    return { controlType: 'richText', galleryResidue: undefined };
  }
  for (const child of sdtPr.children) {
    if (child.type !== 'element') {
      continue;
    }
    const mapped = CONTROL_TYPE_BY_TAG.get(child.tag);
    if (mapped !== undefined) {
      return { controlType: mapped, galleryResidue: undefined };
    }
    if (child.tag === 'w:docPartObj' || child.tag === 'w:docPartList') {
      const gallery = childrenWithTag(child, 'w:docPartGallery')[0];
      if ((gallery === undefined ? undefined : attr(gallery, 'w:val')) === TABLE_OF_CONTENTS_GALLERY) {
        return { controlType: 'index', galleryResidue: undefined };
      }
      return { controlType: 'richText', galleryResidue: { format: 'docx', xml: buildXml([child]) } };
    }
  }
  return { controlType: 'richText', galleryResidue: undefined };
}

function readListItemOptions(sdtPr: XmlElement): string[] | undefined {
  const list = childrenWithTag(sdtPr, 'w:dropDownList')[0] ?? childrenWithTag(sdtPr, 'w:comboBox')[0];
  if (list === undefined) {
    return undefined;
  }
  const options: string[] = [];
  for (const item of childrenWithTag(list, 'w:listItem')) {
    const value = attr(item, 'w:displayText') ?? attr(item, 'w:value');
    if (value !== undefined) {
      options.push(decodeEntities(value));
    }
  }
  return options.length === 0 ? undefined : options;
}

// w14:checkbox's own w14:checked/@w14:val, accepting the plain-w spelling too for the same reason readControlType does. ECMA-376's ST_OnOff spelling ('0'/'false'/'off' being the only false values) matches the toggle convention used throughout typed/docx/styles.ts.
function readCheckboxState(sdtPr: XmlElement): boolean | undefined {
  const checkbox = childrenWithTag(sdtPr, 'w14:checkbox')[0] ?? childrenWithTag(sdtPr, 'w:checkbox')[0];
  if (checkbox === undefined) {
    return undefined;
  }
  const checked = childrenWithTag(checkbox, 'w14:checked')[0] ?? childrenWithTag(checkbox, 'w:checked')[0];
  if (checked === undefined) {
    return false;
  }
  const val = attr(checked, 'w14:val') ?? attr(checked, 'w:val');
  return val === undefined || (val !== '0' && val !== 'false' && val !== 'off');
}

export function readContentControlDescriptor(sdt: XmlElement): ContentControlDescriptor {
  const sdtPr = childrenWithTag(sdt, 'w:sdtPr')[0];
  const { controlType, galleryResidue } = readControlType(sdtPr);
  const descriptor: ContentControlDescriptor = { kind: 'contentControl', controlType };
  if (galleryResidue !== undefined) {
    descriptor.source = galleryResidue;
  }
  if (sdtPr === undefined) {
    return descriptor;
  }
  const tag = childrenWithTag(sdtPr, 'w:tag')[0];
  const tagVal = tag === undefined ? undefined : attr(tag, 'w:val');
  if (tagVal !== undefined) {
    descriptor.tag = decodeEntities(tagVal);
  }
  const alias = childrenWithTag(sdtPr, 'w:alias')[0];
  const aliasVal = alias === undefined ? undefined : attr(alias, 'w:val');
  if (aliasVal !== undefined) {
    descriptor.alias = decodeEntities(aliasVal);
  }
  const lock = childrenWithTag(sdtPr, 'w:lock')[0];
  const lockVal = lock === undefined ? undefined : attr(lock, 'w:val');
  const mappedLock = lockVal === undefined ? undefined : LOCK_BY_VALUE.get(lockVal);
  if (mappedLock !== undefined) {
    descriptor.lock = mappedLock;
  }
  const options = readListItemOptions(sdtPr);
  if (options !== undefined) {
    descriptor.options = options;
  }
  const checked = readCheckboxState(sdtPr);
  if (checked !== undefined) {
    descriptor.checked = checked;
  }
  const date = childrenWithTag(sdtPr, 'w:date')[0];
  const fullDate = date === undefined ? undefined : attr(date, 'w:fullDate');
  if (fullDate !== undefined) {
    descriptor.value = decodeEntities(fullDate);
  }
  return descriptor;
}

// --- tracked changes (w:ins / w:del / w:moveFrom / w:moveTo) ---------------------------------------------------------

export const PROVENANCE_CHANGE_BY_TAG: ReadonlyMap<string, ProvenanceChange> = new Map([
  ['w:ins', 'insertion'],
  ['w:del', 'deletion'],
  ['w:moveFrom', 'moveFrom'],
  ['w:moveTo', 'moveTo'],
]);

// Whether a tracked-change element's own content is deleted text -- w:del and w:moveFrom both spell their runs with w:delText rather than w:t, since both mean "this text is gone from the current revision".
export function isDeletedChange(change: ProvenanceChange): boolean {
  return change === 'deletion' || change === 'moveFrom';
}

export function readProvenanceDescriptor(element: XmlElement, change: ProvenanceChange): ProvenanceDescriptor {
  const descriptor: ProvenanceDescriptor = { kind: 'provenance', change };
  const author = attr(element, 'w:author');
  if (author !== undefined) {
    descriptor.author = decodeEntities(author);
  }
  const date = attr(element, 'w:date');
  if (date !== undefined) {
    descriptor.dateIso = decodeEntities(date);
  }
  return descriptor;
}

// --- bookmarks (w:bookmarkStart / w:bookmarkEnd) ---------------------------------------------------------------------

export function bookmarkAnchorDescriptor(name: string): AnchorDescriptor {
  return { kind: 'anchor', anchorType: 'bookmark', name };
}

// --- fields (w:fldChar / w:instrText / w:fldSimple) -------------------------------------------------------------------

// A run's own field-code text. w:instrText is the live spelling and w:delInstrText the spelling a field code takes once the field itself has been deleted under tracked changes; both are the same instruction as far as the descriptor is concerned.
export function runInstructionText(run: XmlElement): string {
  let text = '';
  for (const child of run.children) {
    if (child.type === 'element' && (child.tag === 'w:instrText' || child.tag === 'w:delInstrText')) {
      text += textContent(child);
    }
  }
  return text;
}

export function fieldCharType(run: XmlElement): string | undefined {
  const fldChar = childrenWithTag(run, 'w:fldChar')[0];
  return fldChar === undefined ? undefined : attr(fldChar, 'w:fldCharType');
}
