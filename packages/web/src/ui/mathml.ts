import type { MathMlNode } from "documents.js";

export const MATHML_NS = "http://www.w3.org/1998/Math/MathML";

// Real MathML producers write element tags with a "math:" namespace prefix when math is not the document's default namespace (<math:mfrac>, <math:mrow>). The browser's MathML parser expects unprefixed tags inside a namespaced <math>, so the prefix must be stripped.
function stripMathMlNamespace(tag: string): string {
  const colonIndex = tag.indexOf(":");
  return colonIndex === -1 ? tag : tag.slice(colonIndex + 1);
}

// Walks a parsed MathML tree (MathMlNode is a generic parsed-XML tree, not MathML-specific types) onto a real DOM node via createElementNS -- React's JSX doesn't create MathML elements with the correct namespace, so every consumer that wants to display one (FormulaPreview's own standalone panel, contentBlocks.tsx's embedded-formula block) walks it imperatively through this shared helper rather than duplicating the walk.
export function appendMathMlNodes(parent: Node, nodes: readonly MathMlNode[]) {
  for (const node of nodes) {
    if (node.type === "text") {
      parent.appendChild(document.createTextNode(node.value));
    } else if (node.type === "element") {
      const tag = stripMathMlNamespace(node.tag);
      // <annotation> carries StarMath (or other encodings), not displayable presentation MathML -- browsers render <semantics> by showing its first child and ignoring annotation elements, but skipping them explicitly avoids any ambiguity.
      if (tag === "annotation") continue;
      const el = document.createElementNS(MATHML_NS, tag);
      for (const attr of node.attributes) {
        el.setAttribute(attr.name, attr.value);
      }
      appendMathMlNodes(el, node.children);
      parent.appendChild(el);
    }
    // cdata, comment, declaration, pi: no displayable content, skip.
  }
}
