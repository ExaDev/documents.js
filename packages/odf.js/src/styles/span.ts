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
// odf.js has no live-view paragraph editor yet (that is future work — see the DocxEditor/PptxEditor precedent in the sibling documents.js package's src/edit/, which this module's eventual caller will mirror), so this operates directly on the real, already-decoded XmlElement `paragraph` (typically a text:p or text:h, or any other element whose children form flat inline text content — the function itself is agnostic to the outer tag). It mutates `paragraph.children` in place, matching odf.js's live-view model throughout (see registry.ts and manifest.ts). Deviates from the task's own suggested `(paragraph, start, end): void` signature in two ways, both because a real caller needs them: a `styleName` parameter (there is no way to "ensure a formattable unit" without saying which style it should reference), and a return of the resulting text:span element (so a caller — e.g. "place the cursor here, turn on bold, then type" — has a handle to mutate further, such as inserting new text nodes into an initially empty span).
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

// Splits a single node at a character offset strictly inside it (0 < offset < measureOdfNodeLength(node), guaranteed by splitChildrenAt's caller). A text node splits by string slicing; a text:s splits into two text:s elements whose counts sum to the original (a text:c="5" run split at offset 2 becomes text:c="2" and text:c="3", never silently merged or corrupted); a text:span splits recursively into two sibling spans carrying the same style-name, each holding its half of the original content. text:tab/text:line-break have length exactly 1, so an offset strictly between 0 and 1 can never be an integer — that branch is unreachable given ensureSpan's own integer-offset validation, and throws rather than silently doing something wrong if it is ever somehow reached.
// Exported so a direct unit test can reach the defensive throw at this function's own tail below, which no call reachable through ensureSpan's public entry point can ever trigger (see that throw's own comment) — the only way to observe it is to call this function directly with an offset ensureSpan's own integer validation would have already rejected.
export function splitNode(
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
    // Each half gets its OWN deep copy of `attributes` — both the array AND each individual { name, value } object within it — not a shared reference to the original. A shallow `[...node.attributes]` copy would still share the same Attribute *objects* between both halves, so setStyleName's `existing.value = ...` mutation (reusing a split-off span on a subsequent ensureSpan call) would silently corrupt the other half's style-name too, even though the two halves' attribute arrays were themselves already distinct. No `inner.before.length === 0` / `inner.after.length === 0` check guarding either half: this function is only ever invoked (from splitChildrenAt's own loop below) with an offset strictly between 0 and this node's own measureOdfNodeLength, and at that invariant, the recursive splitChildrenAt(node.children, offset) above can never come back with an empty `before` or `after` — an offset > 0 means its loop either pushes at least one whole/zero-width child into `before` before reaching the split point, or lands inside a child whose own split contributes a defined, non-empty half (text and text:s always return one; a nested text:span does too, by this same argument applied recursively); and offset strictly less than this node's own total length guarantees genuine content remains for `after` too. Both halves are therefore always real, non-empty node arrays here, never the empty array an `undefined` branch would exist to represent.
    const left: XmlElement = {
      ...node,
      attributes: cloneAttributes(node.attributes),
      children: inner.before,
    };
    const right: XmlElement = {
      ...node,
      attributes: cloneAttributes(node.attributes),
      children: inner.after,
    };
    return { left, right };
  }
  const label = node.type === "element" ? node.tag : node.type;
  throw new Error(
    `ensureSpan: cannot split "${label}" at a fractional offset — this indicates a character-length computation bug, since every node type with length 1 or 0 should never reach this branch`,
  );
}

// Splits a flat (or, via text:span, recursively nested) node sequence into everything before `offset` and everything from `offset` onward, splitting exactly one node via splitNode if `offset` falls strictly inside it.
function splitChildrenAt(
  children: readonly XmlNode[],
  offset: number,
): { before: XmlNode[]; after: XmlNode[] } {
  // No separate `offset <= 0` fast path: every caller in this module only ever passes an offset in [0, this children array's own total measureOdfNodeLength] — ensureSpan's own upfront validation guarantees start >= 0 and end <= total, and splitNode's own recursive call into this function is only ever reached with an offset strictly between 0 and the node's own length. offset is therefore never negative, and offset === 0 is already handled identically by the loop's own `remaining === 0` check on its very first iteration below (before stays empty, after becomes the full children array via children.slice(0)) — a dedicated early return would only ever produce a result that check already produces on its own.
  const before: XmlNode[] = [];
  let remaining = offset;
  // A `for...of` over `.entries()`, not an indexed `for` loop bounded by `index < children.length`: every valid offset this function is ever called with (see the comment above) makes `remaining` reach exactly 0 at or before the final entry, so the loop below always returns from inside its own body — an indexed bound never needs comparing against `children.length` at all, so there is no such comparison here to get wrong.
  for (const [index, node] of children.entries()) {
    if (remaining === 0) {
      return { before, after: children.slice(index) };
    }
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
