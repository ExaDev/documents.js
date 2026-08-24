import type { Attribute, XmlElement, XmlNode } from "../model/node";
import { el } from "../xml/fragment";
import { encodeXmlText } from "../xml/entities";
import {
  getOdfSpaceCount,
  measureOdfNodeLength,
  sumOdfNodeLength,
} from "../typed/shared/text";

// The ODF-specific "wrap this character range in a formattable unit" operation, with no docx analogue: a docx run already IS the formatting unit, but ODF paragraph text content is a flat sequence of text nodes plus text:s (space-run)/text:tab/text:line-break elements with no pre-existing span structure. Applying a style to characters [start, end) means splitting/wrapping exactly that range into a text:span referencing the given style name, splitting any text:s/text:tab/text:line-break/text:span that straddles either boundary.
//
// odf.js has no live-view paragraph editor yet (that is future work -- see the DocxEditor/PptxEditor precedent in the sibling documents.js package's src/edit/, which this module's eventual caller will mirror), so this operates directly on the real, already-decoded XmlElement `paragraph` (typically a text:p or text:h, or any other element whose children form flat inline text content -- the function itself is agnostic to the outer tag). It mutates `paragraph.children` in place, matching odf.js's live-view model throughout (see registry.ts and manifest.ts). Deviates from the task's own suggested `(paragraph, start, end): void` signature in two ways, both because a real caller needs them: a `styleName` parameter (there is no way to "ensure a formattable unit" without saying which style it should reference), and a return of the resulting text:span element (so a caller -- e.g. "place the cursor here, turn on bold, then type" -- has a handle to mutate further, such as inserting new text nodes into an initially empty span).
//
// Character position is defined as a UTF-16 code unit offset, consistent with how XmlText.value is represented (a plain JS string) throughout this package's model; a text:s run occupies its text:c count of positions (default 1 if the attribute is absent), text:tab and text:line-break each occupy exactly one, and a nested text:span's own children are measured (and split into) recursively.
export function ensureSpan(
  paragraph: XmlElement,
  start: number,
  end: number,
  styleName: string,
): XmlElement {
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start
  ) {
    throw new Error(`ensureSpan: invalid range [${start}, ${end})`);
  }
  const total = sumOdfNodeLength(paragraph.children);
  if (end > total) {
    throw new Error(
      `ensureSpan: range end ${end} exceeds the container's total character length ${total}`,
    );
  }

  const { before, after: rest } = splitChildrenAt(paragraph.children, start);
  const { before: middle, after } = splitChildrenAt(rest, end - start);

  let span: XmlElement;
  const soleChild = middle.length === 1 ? middle[0] : undefined;
  if (soleChild?.type === "element" && soleChild.tag === "text:span") {
    span = soleChild;
    setStyleName(span, styleName);
  } else {
    span = el(
      "text:span",
      { "text:style-name": encodeXmlText(styleName) },
      middle,
    );
  }

  paragraph.children = [...before, span, ...after];
  return span;
}

function cloneAttributes(attributes: readonly Attribute[]): Attribute[] {
  return attributes.map((attribute) => ({ ...attribute }));
}

function setStyleName(span: XmlElement, styleName: string): void {
  const encoded = encodeXmlText(styleName);
  const existing = span.attributes.find(
    (attribute) => attribute.name === "text:style-name",
  );
  if (existing !== undefined) {
    existing.value = encoded;
    return;
  }
  span.attributes.push({ name: "text:style-name", value: encoded });
}

function buildSpaceRun(count: number): XmlElement {
  return count === 1 ? el("text:s") : el("text:s", { "text:c": String(count) });
}

// Splits a single node at a character offset strictly inside it (0 < offset < measureOdfNodeLength(node), guaranteed by splitChildrenAt's caller). A text node splits by string slicing; a text:s splits into two text:s elements whose counts sum to the original (a text:c="5" run split at offset 2 becomes text:c="2" and text:c="3", never silently merged or corrupted); a text:span splits recursively into two sibling spans carrying the same style-name, each holding its half of the original content. text:tab/text:line-break have length exactly 1, so an offset strictly between 0 and 1 can never be an integer -- that branch is unreachable given ensureSpan's own integer-offset validation, and throws rather than silently doing something wrong if it is ever somehow reached.
function splitNode(
  node: XmlNode,
  offset: number,
): { left?: XmlNode; right?: XmlNode } {
  if (node.type === "text") {
    return {
      left: { type: "text", value: node.value.slice(0, offset) },
      right: { type: "text", value: node.value.slice(offset) },
    };
  }
  if (node.type === "element" && node.tag === "text:s") {
    const count = getOdfSpaceCount(node);
    return {
      left: buildSpaceRun(offset),
      right: buildSpaceRun(count - offset),
    };
  }
  if (node.type === "element" && node.tag === "text:span") {
    const inner = splitChildrenAt(node.children, offset);
    // Each half gets its OWN deep copy of `attributes` -- both the array AND each individual { name, value } object within it -- not a shared reference to the original. A shallow `[...node.attributes]` copy would still share the same Attribute *objects* between both halves, so setStyleName's `existing.value = ...` mutation (reusing a split-off span on a subsequent ensureSpan call) would silently corrupt the other half's style-name too, even though the two halves' attribute arrays were themselves already distinct.
    const left: XmlElement | undefined =
      inner.before.length === 0
        ? undefined
        : {
            ...node,
            attributes: cloneAttributes(node.attributes),
            children: inner.before,
          };
    const right: XmlElement | undefined =
      inner.after.length === 0
        ? undefined
        : {
            ...node,
            attributes: cloneAttributes(node.attributes),
            children: inner.after,
          };
    return { left, right };
  }
  const label = node.type === "element" ? node.tag : node.type;
  throw new Error(
    `ensureSpan: cannot split "${label}" at a fractional offset -- this indicates a character-length computation bug, since every node type with length 1 or 0 should never reach this branch`,
  );
}

// Splits a flat (or, via text:span, recursively nested) node sequence into everything before `offset` and everything from `offset` onward, splitting exactly one node via splitNode if `offset` falls strictly inside it.
function splitChildrenAt(
  children: readonly XmlNode[],
  offset: number,
): { before: XmlNode[]; after: XmlNode[] } {
  if (offset <= 0) {
    return { before: [], after: [...children] };
  }

  const before: XmlNode[] = [];
  let remaining = offset;
  for (let index = 0; index < children.length; index += 1) {
    if (remaining === 0) {
      return { before, after: children.slice(index) };
    }
    const node = children[index]!;
    const length = measureOdfNodeLength(node);
    if (remaining >= length) {
      before.push(node);
      remaining -= length;
      continue;
    }
    const { left, right } = splitNode(node, remaining);
    const after: XmlNode[] = [];
    if (left !== undefined) {
      before.push(left);
    }
    if (right !== undefined) {
      after.push(right);
    }
    after.push(...children.slice(index + 1));
    return { before, after };
  }

  return { before, after: [] };
}
