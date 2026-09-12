import { XMLBuilder } from "fast-xml-parser";
import type { Attribute, XmlNode } from "../model/node";

const BUILDER = new XMLBuilder({
  preserveOrder: true,
  attributeNamePrefix: "@_",
  ignoreAttributes: false,
  textNodeName: "#text",
  cdataPropName: "__cdata",
  commentPropName: "__comment",
  processEntities: false,
  format: false,
  suppressEmptyNode: false,
});

// Extracted so the "did the builder return a string" guard is directly testable with a non-string literal: XMLBuilder itself, given this module's own fixed options, never actually returns anything but a string, so no real XmlNode input can drive this branch through buildXml itself.
export function assertBuiltString(out: unknown): string {
  if (typeof out !== "string") {
    throw new Error("XMLBuilder did not return a string");
  }
  return out;
}

export function buildXml(nodes: XmlNode[]): string {
  return assertBuiltString(BUILDER.build(toOrdered(nodes)));
}

function toOrdered(nodes: XmlNode[]): unknown[] {
  return nodes.map(toOrderedNode);
}

function attrsObject(attributes: Attribute[]): Record<string, string> {
  const obj: Record<string, string> = {};
  for (const a of attributes) {
    obj[`@_${a.name}`] = a.value;
  }
  return obj;
}

function toOrderedNode(node: XmlNode): Record<string, unknown> {
  switch (node.type) {
    case "text":
      return { "#text": node.value };
    case "comment":
      return { __comment: [{ "#text": node.value }] };
    case "cdata":
      return { __cdata: [{ "#text": node.value }] };
    // fast-xml-parser's builder never renders a processing-instruction target's own child content under this configuration (preserveOrder with no text/CDATA emission hook for `?`-prefixed keys) -- verified directly against the library: `{ "?custom": [{ "#text": "value" }] }` and `{ "?custom": [] }` build to the byte-identical `<?custom?>` either way. This is the write-side half of xml-fidelity.test.ts's own documented "processing-instruction pseudo-attribute payload is dropped" limitation, so node.content is deliberately not referenced here rather than passed through as a value the builder would silently discard.
    case "pi":
      return { [`?${node.target}`]: [] };
    // Symmetric with the "pi" case above: the declaration's own child array is likewise never rendered by the builder (it is driven entirely by `:@`'s own attributes), verified the same way.
    case "declaration":
      return { "?xml": [], ":@": attrsObject(node.attributes) };
    // `:@` is set unconditionally, even for a tagless-attribute element: the builder renders `{ tag: [...], ":@": {} }` byte-identical to `{ tag: [...] }` with the key omitted entirely (verified directly against fast-xml-parser), and parseAttributes already reads an empty `:@` object back to the same `attributes: []` a missing key produces -- so gating this on whether any attribute exists at all would only ever avoid constructing a value nothing downstream can tell apart from its absence.
    case "element":
      return {
        [node.tag]: toOrdered(node.children),
        ":@": attrsObject(node.attributes),
      };
  }
}
