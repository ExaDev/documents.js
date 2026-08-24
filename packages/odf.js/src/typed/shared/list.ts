import type {
  ContentListMembership,
  ContentParagraph,
} from "document-schema.js";
import type { XmlElement } from "../../model/node";
import type { Package } from "../../model/package";
import {
  rootElement,
  findChildElement,
  childrenWithTag,
  attrValue,
} from "../../xml/query";

// The text:list walker every reader that meets list-structured ODF text shares -- the odt reader (office:text body content) and the odp reader (draw:text-box content inside slide text frames). A text:list means the same thing in both homes: a purely STRUCTURAL container whose own items are its own XML children, never a reference into a shared numbering part. This module therefore owns the whole ContentParagraph.list mapping for both readers: the numId identity convention (below), the ordered-vs-bullet kind prefix resolved from the referenced text:list-style, and the structural item/nesting walk itself.
//
// LIST numId DERIVATION: ODF has no docx-style shared numId at all -- a docx w:numId identifies one entry in numbering.xml that many, textually unrelated w:p elements can reference by attribute; an ODF text:list is instead a purely STRUCTURAL container (its own list items are its own XML children), so "which list does this paragraph belong to" is answered by tree position, not by an attribute lookup. To give downstream consumers (document-schema.js's ContentListMembership, mirroring docx's numId/level pair) an equivalent stable identity, numId is minted as a monotonically increasing counter ("list1", "list2", ...), ONE PER TOP-LEVEL text:list ELEMENT ENCOUNTERED IN DOCUMENT ORDER -- never per text:style-name. A text:list's own text:style-name was deliberately rejected as the numId source: it names a REUSABLE list-style DEFINITION (the marker/numbering format), and real documents routinely apply the identical list-style to two unrelated, non-adjacent text:list elements (e.g. two independent bullet lists both created from the same "List 1" paragraph style) -- collapsing those into one numId would violate the one hard requirement this convention must satisfy ("different text:list elements get different [numIds]"). A monotonic per-encounter counter satisfies that requirement unconditionally, is stable/deterministic for a given document (same input -> same output, useful for tests), and needs no cross-referencing at all. Nesting is layered on top of this identity, not a separate list: a NESTED text:list (one found while walking a text:list-item's own children, per the OASIS content model for list nesting) keeps its ENCLOSING list's numId unchanged and only increments level -- exactly mirroring how a docx numId spans every nesting depth of one multi-level list, with w:ilvl (level here) distinguishing depth. Nesting depth itself is never separately counted or inferred from indentation: it is read directly off the actual XML nesting depth of text:list inside text:list-item inside text:list ..., never from any style property.
//
// LIST KIND PREFIX: the minted numId is prefixed with "ordered:" or "bullet:" when the text:list's text:style-name resolves to a text:list-style whose level-1 child is text:list-level-style-number (ordered) or text:list-level-style-bullet/-image (bullet) -- see resolveOdfListKind below. This encodes the ordered-vs-bullet kind into the opaque numId string (the same convention markdown-codec and documents.js's router-side docx normalization already use), so downstream consumers (the web app's buildListForest/renderer) can render <ol> vs <ul> without needing a separate field on ContentListMembership. An unresolved style-name leaves the numId unprefixed, and the consumer renders with a neutral marker.
//
// The counter state (OdfListIdState) is minted-per-document, threaded by reference through the caller's whole walk -- one state for the entire odt body or the entire odp presentation (every slide, every frame), so two lists on different slides of one presentation get different numIds exactly as two lists in different sections of one odt body do.

// A monotonically increasing counter for minting fresh top-level list numIds, threaded by reference through a reader's whole document walk -- see this module's own top-of-file note on why a per-encounter counter, not text:style-name, is the numId source.
export interface OdfListIdState {
  next: number;
}

// Resolves a text:list's text:style-name to its ordered-vs-bullet kind by finding the corresponding text:list-style definition and inspecting its level-1 child tag. Searches both content.xml and styles.xml, in both office:automatic-styles and office:styles -- mirroring cascade.ts's own both-parts-both-containers pattern (style:name uniqueness is document-wide, so at most one text:list-style can match). Returns undefined when the style-name is absent or unresolvable, so the caller leaves the numId unprefixed and the downstream consumer falls back to a neutral marker.
export function resolveOdfListKind(
  pkg: Package,
  styleName: string | undefined,
): "ordered" | "bullet" | undefined {
  if (styleName === undefined) return undefined;
  for (const partPath of ["content.xml", "styles.xml"] as const) {
    const part = pkg.parts[partPath];
    if (part?.kind !== "xml") continue;
    const root = rootElement(part.nodes);
    if (root === undefined) continue;
    for (const containerTag of [
      "office:automatic-styles",
      "office:styles",
    ] as const) {
      const container = findChildElement(root.children, containerTag);
      if (container === undefined) continue;
      const listStyle = childrenWithTag(container, "text:list-style").find(
        (el) => attrValue(el, "style:name") === styleName,
      );
      if (listStyle === undefined) continue;
      // Real list-styles are homogeneous across levels; checking level 1 is sufficient.
      if (
        childrenWithTag(listStyle, "text:list-level-style-number").some(
          (el) => attrValue(el, "text:level") === "1",
        )
      )
        return "ordered";
      if (
        childrenWithTag(listStyle, "text:list-level-style-bullet").some(
          (el) => attrValue(el, "text:level") === "1",
        )
      )
        return "bullet";
      if (
        childrenWithTag(listStyle, "text:list-level-style-image").some(
          (el) => attrValue(el, "text:level") === "1",
        )
      )
        return "bullet";
      return undefined;
    }
  }
  return undefined;
}

// Mints one top-level text:list element's numId from the shared counter, encoding the ordered-vs-bullet kind as a prefix when the element's own text:style-name resolves (see LIST KIND PREFIX above) and advancing the counter exactly once per encounter -- see LIST numId DERIVATION above for why the counter, never the style-name, is the identity.
export function mintOdfListNumId(
  pkg: Package,
  listElement: XmlElement,
  state: OdfListIdState,
): string {
  const kind = resolveOdfListKind(
    pkg,
    attrValue(listElement, "text:style-name"),
  );
  const numId =
    kind !== undefined ? `${kind}:list${state.next}` : `list${state.next}`;
  state.next += 1;
  return numId;
}

// Reads one text:list element's own paragraph content into a flat, document-ordered ContentParagraph list: each text:list-item's own text:p/text:h children (read through the caller-supplied `readParagraph` callback, which owns every reader-specific concern -- odt's text:h heading-identity override, odp's plain readOdfParagraph) carry the given `membership` attached by THIS walker, never by the callback, since ODF list membership is purely structural (which text:list/text:list-item the paragraph is nested inside), never an attribute on the paragraph element itself the way docx's w:numPr is. A nested text:list (found inside a text:list-item, per the OASIS nesting content model) recurses at level + 1 under the SAME numId -- see this module's own top-of-file note on why nesting never mints a new numId. Items are not wrapped in any block of their own, matching ContentBlock's flat discriminated-union shape. A list item containing a table or further block content beyond a nested list is legal ODF but vanishingly rare and outside this walker's scope, matching the list-membership-only mandate both callers were built against.
export type OdfListParagraphReader = (element: XmlElement) => ContentParagraph;

export function readOdfListParagraphs(
  listElement: XmlElement,
  membership: ContentListMembership,
  readParagraph: OdfListParagraphReader,
): ContentParagraph[] {
  const paragraphs: ContentParagraph[] = [];
  for (const item of listElement.children) {
    if (item.type !== "element" || item.tag !== "text:list-item") {
      continue;
    }
    for (const itemChild of item.children) {
      if (itemChild.type !== "element") {
        continue;
      }
      if (itemChild.tag === "text:p" || itemChild.tag === "text:h") {
        const paragraph = readParagraph(itemChild);
        paragraph.list = membership;
        paragraphs.push(paragraph);
      } else if (itemChild.tag === "text:list") {
        paragraphs.push(
          ...readOdfListParagraphs(
            itemChild,
            { numId: membership.numId, level: membership.level + 1 },
            readParagraph,
          ),
        );
      }
    }
  }
  return paragraphs;
}
