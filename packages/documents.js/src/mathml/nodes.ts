// A local, structurally-compatible mirror of odf.js's own XmlNode/XmlElement (src/model/node.ts there), deliberately NOT imported from odf.js: src/mathml/ is a pure layout module with zero ODF (or PDF) knowledge, matching this package's existing src/layout/ isolation rule, and readOdfFormulaMathMl's own return shape (odf.js's OdfFormulaDocument.mathml: XmlNode[]) is the actual raw tree this module is designed to consume. TypeScript's structural typing means odf.js's real XmlNode[] value type-checks directly against MathMlNode[] with no cast anywhere -- the same "mirror the shape, don't import the package" pattern src/interop.test.ts already verifies holds between ooxml.js and odf.js.
export interface MathMlAttribute {
  readonly name: string;
  readonly value: string;
}

export interface MathMlElement {
  readonly type: "element";
  readonly tag: string;
  readonly attributes: readonly MathMlAttribute[];
  readonly children: readonly MathMlNode[];
}

export interface MathMlText {
  readonly type: "text";
  readonly value: string;
}

// odf.js's own XmlNode also has 'cdata' | 'comment' | 'declaration' | 'pi' variants; MathML content never meaningfully contains any of them (a formula's content.xml text content is always plain 'text', per every real LibreOffice/odf.js-produced tree), so this union only names the two variants this module's own walkers ever branch on. A node of one of the other four kinds still narrows correctly to neither MathMlElement nor MathMlText and is simply skipped wherever this module walks children -- see isMathMlElement/textContent below -- so a structurally-compatible odf.js XmlNode carrying one of those kinds is handled safely, just not specially.
export type MathMlNode =
  | MathMlElement
  | MathMlText
  | { readonly type: "cdata" | "comment" | "declaration" | "pi" };

export function isMathMlElement(node: MathMlNode): node is MathMlElement {
  return node.type === "element";
}

function isMathMlText(node: MathMlNode): node is MathMlText {
  return node.type === "text";
}

// Real MathML producers (confirmed against LibreOffice's own content.xml output) write element tags with a "math:" namespace prefix when math is not the document's default namespace (<math:mfrac>, <math:mrow>, ...), and bare, unprefixed tags when it is (<mfrac>, <mrow>, ...) -- odf.js's own readOdfFormulaMathMl already handles exactly this ambiguity for the root element (MATH_ROOT_TAGS = ['math', 'math:math']). This module applies the same tolerance uniformly to every element, not just the root: strip a single leading "prefix:" segment before comparing against a canonical MathML tag name, so this layout engine works unmodified regardless of which form a given producer chose.
export function localName(tag: string): string {
  const colonIndex = tag.indexOf(":");
  return colonIndex === -1 ? tag : tag.slice(colonIndex + 1);
}

export function elementLocalName(element: MathMlElement): string {
  return localName(element.tag);
}

export function attrValue(
  element: MathMlElement,
  name: string,
): string | undefined {
  return element.attributes.find((attribute) => attribute.name === name)?.value;
}

// Every element child of `node`, in document order, skipping text/cdata/comment/declaration/pi siblings -- the standard "walk the element tree" shape almost every layout function below needs.
export function elementChildren(node: MathMlElement): readonly MathMlElement[] {
  return node.children.filter(isMathMlElement);
}

// The first element child whose local name (after stripping any namespace prefix) equals `name`, or undefined.
export function firstChildByLocalName(
  node: MathMlElement,
  name: string,
): MathMlElement | undefined {
  return elementChildren(node).find(
    (child) => elementLocalName(child) === name,
  );
}

// Concatenates every text-node descendant's own value, depth-first, in document order -- MathML token elements (mi/mn/mo/mtext) hold their actual content this way, and this is also the last-resort fallback this module's layout engine uses to render an unrecognised element as plain text rather than dropping it silently (see layout.ts's own unsupported-element handling).
export function textContent(node: MathMlNode): string {
  if (isMathMlText(node)) {
    return node.value;
  }
  if (!isMathMlElement(node)) {
    return "";
  }
  let out = "";
  for (const child of node.children) {
    out += textContent(child);
  }
  return out;
}
