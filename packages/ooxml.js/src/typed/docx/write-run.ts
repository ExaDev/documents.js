import type {
  Alignment,
  ContentParagraph,
  ContentRun,
  ProvenanceChange,
  ProvenanceDescriptor,
} from "document-schema.js";
import type { WriteState } from "./write";
import type { XmlElement } from "../../model/node";
import { colorToRgbHex } from "document-schema.js";
import { el, txt } from "../../xml/fragment";
import { encodeXmlText } from "../../xml/entities";
import {
  hyperlinkRelationshipId,
  toggleElement,
  trackChangeAttrs,
} from "./write";
import { interleaveRunConstructExtents } from "./write-links";
import { ptToHalfPoints, ptToTwips } from "../shared/units";
// The run- and paragraph-emission family of the docx writer, split from write.ts: run properties and content, justification and line-spacing tables, and paragraph properties. write.ts keeps the paragraph/table flow assembly and the package parts.
export function buildRunProperties(run: ContentRun): XmlElement | undefined {
  const children: XmlElement[] = [];
  if (run.fontFamily !== undefined) {
    const font = encodeXmlText(run.fontFamily);
    children.push(el("w:rFonts", { "w:ascii": font, "w:hAnsi": font }));
  }
  if (run.bold !== undefined) {
    children.push(toggleElement("w:b", run.bold));
  }
  if (run.italic !== undefined) {
    children.push(toggleElement("w:i", run.italic));
  }
  if (run.strike !== undefined) {
    children.push(toggleElement("w:strike", run.strike));
  }
  if (run.color !== undefined) {
    children.push(el("w:color", { "w:val": colorToRgbHex(run.color) }));
  }
  if (run.sizePt !== undefined) {
    children.push(el("w:sz", { "w:val": String(ptToHalfPoints(run.sizePt)) }));
  }
  if (run.underline !== undefined) {
    children.push(el("w:u", { "w:val": run.underline ? "single" : "none" }));
  }
  if (run.verticalAlign !== undefined) {
    children.push(el("w:vertAlign", { "w:val": run.verticalAlign }));
  }
  // An explicitly left-to-right run says so with the off spelling, mirroring bold: false — an absent w:rtl is "inherit" to the read-side cascade, not "left-to-right", so a resolved ltr must be spelled rather than omitted.
  if (run.direction !== undefined) {
    children.push(toggleElement("w:rtl", run.direction === "rtl"));
  }
  return children.length === 0 ? undefined : el("w:rPr", {}, children);
}

// readRunText's inverse: a tab is its own w:tab element and a newline its own w:br, so the text either side of them stays in w:t elements that round-trip character for character. xml:space="preserve" keeps leading and trailing spaces, which Word otherwise collapses.
export function buildRunContent(text: string, deleted: boolean): XmlElement[] {
  const textTag = deleted ? "w:delText" : "w:t";
  const children: XmlElement[] = [];
  for (const piece of text.split(/(\t|\n)/)) {
    if (piece === "\t") {
      children.push(el("w:tab"));
    } else if (piece === "\n") {
      children.push(el("w:br"));
    } else if (piece.length > 0) {
      children.push(
        el(textTag, { "xml:space": "preserve" }, [txt(encodeXmlText(piece))]),
      );
    }
  }
  if (children.length === 0) {
    children.push(el(textTag, { "xml:space": "preserve" }));
  }
  return children;
}

export function buildRun(
  run: ContentRun,
  state: WriteState,
  deleted: boolean,
): XmlElement {
  const rPr = buildRunProperties(run);
  const runElement = el("w:r", {}, [
    ...(rPr === undefined ? [] : [rPr]),
    ...buildRunContent(run.text, deleted),
  ]);
  if (run.hyperlink === undefined) {
    return runElement;
  }
  return el(
    "w:hyperlink",
    { "r:id": hyperlinkRelationshipId(state, run.hyperlink) },
    [runElement],
  );
}

// --- paragraphs -------------------------------------------------------------------------------------------------------

export const JUSTIFICATION_BY_ALIGNMENT: Readonly<Record<Alignment, string>> = {
  left: "left",
  center: "center",
  right: "right",
  justify: "both",
};

// w:spacing/@w:line's own 240ths-of-a-line unit, the write-side counterpart of shared/units.ts's lineUnitsToMultiplier — kept local rather than exported from there because nothing else writes it.
export const LINE_UNITS_PER_LINE = 240;

// CT_PPr's own child sequence, which Word enforces: pStyle, pageBreakBefore, numPr, bidi, spacing, ind, jc, outlineLvl. An indentFirstLinePt is w:firstLine when positive and w:hanging (the signed inverse) when negative, matching the convention readParagraphPropertiesLayer reads it back through.
export function buildParagraphProperties(
  paragraph: ContentParagraph,
  pageBreakBefore: boolean,
): XmlElement | undefined {
  const children: XmlElement[] = [];
  if (paragraph.styleId !== undefined) {
    children.push(
      el("w:pStyle", { "w:val": encodeXmlText(paragraph.styleId) }),
    );
  }
  if (pageBreakBefore) {
    children.push(el("w:pageBreakBefore"));
  }
  if (paragraph.list !== undefined) {
    const numPrChildren: XmlElement[] = [
      el("w:ilvl", { "w:val": String(paragraph.list.level) }),
    ];
    if (paragraph.list.numId !== undefined) {
      numPrChildren.push(
        el("w:numId", { "w:val": encodeXmlText(paragraph.list.numId) }),
      );
    }
    children.push(el("w:numPr", {}, numPrChildren));
  }
  // CT_PPrBase places bidi between the numPr family and spacing; an explicitly left-to-right paragraph says so with the off spelling, the same discipline w:rtl's own writer below applies at run level.
  if (paragraph.direction !== undefined) {
    children.push(toggleElement("w:bidi", paragraph.direction === "rtl"));
  }
  const spacing: Record<string, string> = {};
  if (paragraph.spacingBeforePt !== undefined) {
    spacing["w:before"] = String(ptToTwips(paragraph.spacingBeforePt));
  }
  if (paragraph.spacingAfterPt !== undefined) {
    spacing["w:after"] = String(ptToTwips(paragraph.spacingAfterPt));
  }
  if (paragraph.lineSpacing !== undefined) {
    spacing["w:line"] = String(
      Math.round(paragraph.lineSpacing * LINE_UNITS_PER_LINE),
    );
    spacing["w:lineRule"] = "auto";
  }
  if (Object.keys(spacing).length > 0) {
    children.push(el("w:spacing", spacing));
  }
  const indent: Record<string, string> = {};
  if (paragraph.indentLeftPt !== undefined) {
    indent["w:left"] = String(ptToTwips(paragraph.indentLeftPt));
  }
  if (paragraph.indentFirstLinePt !== undefined) {
    if (paragraph.indentFirstLinePt < 0) {
      indent["w:hanging"] = String(ptToTwips(-paragraph.indentFirstLinePt));
    } else {
      indent["w:firstLine"] = String(ptToTwips(paragraph.indentFirstLinePt));
    }
  }
  if (Object.keys(indent).length > 0) {
    children.push(el("w:ind", indent));
  }
  if (paragraph.alignment !== undefined) {
    children.push(
      el("w:jc", { "w:val": JUSTIFICATION_BY_ALIGNMENT[paragraph.alignment] }),
    );
  }
  if (paragraph.headingLevel !== undefined) {
    children.push(
      el("w:outlineLvl", { "w:val": String(paragraph.headingLevel - 1) }),
    );
  }
  return children.length === 0 ? undefined : el("w:pPr", {}, children);
}

// A tracked change carrying a whole paragraph still has to mark the paragraph's own mark as changed (w:pPr/w:rPr/w:ins and kin), or Word shows the change as covering the text but not the paragraph break that ends it — CT_PPr puts that w:rPr after every property element and before w:sectPr, which is exactly where appending it lands. The change element itself wraps the paragraph's RUNS, never the w:p: CT_RunTrackChange (reached through EG_RunLevelElts) has no w:p in its content model, so a change wrapping whole paragraphs is not valid WordprocessingML even though the reader tolerates it as input. A paragraph carrying no runs at all still gets an empty change element (rather than none), since that empty element is exactly what marks the paragraph as wholly changed to a reader walking its content-bearing children.
// Moved above buildParagraph, which is the first (and only earlier) reader: the four tracked-change elements that wrap a block flow. formatChange has no entry: w:pPrChange is a child of w:pPr recording one paragraph's superseded properties, not a wrapper over blocks, so a formatChange construct writes its content unwrapped rather than as an element that would not parse where it sits.
export const TRACKED_CHANGE_TAG_BY_CHANGE: Readonly<
  Record<ProvenanceChange, string | undefined>
> = {
  insertion: "w:ins",
  deletion: "w:del",
  moveFrom: "w:moveFrom",
  moveTo: "w:moveTo",
  formatChange: undefined,
};

export function buildParagraph(
  paragraph: ContentParagraph,
  state: WriteState,
  pageBreakBefore: boolean,
  deleted: boolean,
  provenance: ProvenanceDescriptor | undefined,
): XmlElement {
  const properties = buildParagraphProperties(paragraph, pageBreakBefore);
  const changeTag =
    provenance === undefined
      ? undefined
      : TRACKED_CHANGE_TAG_BY_CHANGE[provenance.change];
  const pPr =
    properties === undefined && changeTag !== undefined
      ? el("w:pPr", {}, [])
      : properties;
  if (
    pPr !== undefined &&
    changeTag !== undefined &&
    provenance !== undefined
  ) {
    pPr.children.push(
      el("w:rPr", {}, [el(changeTag, trackChangeAttrs(state, provenance))]),
    );
  }
  const runs = interleaveRunConstructExtents(
    paragraph.runs.map((run) => buildRun(run, state, deleted)),
    paragraph,
    state,
  );
  const content =
    changeTag === undefined || provenance === undefined
      ? runs
      : [el(changeTag, trackChangeAttrs(state, provenance), runs)];
  return el("w:p", {}, [...(pPr === undefined ? [] : [pPr]), ...content]);
}
