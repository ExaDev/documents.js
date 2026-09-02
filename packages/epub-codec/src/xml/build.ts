import { XMLBuilder } from "fast-xml-parser";
import type { Attribute, XmlNode } from "./node";

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

export function buildXml(nodes: XmlNode[]): string {
  const out = BUILDER.build(toOrdered(nodes));
  if (typeof out !== "string") {
    throw new Error("XMLBuilder did not return a string");
  }
  return out;
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
    case "pi":
      return { [`?${node.target}`]: [{ "#text": node.content }] };
    case "declaration":
      return { "?xml": [{ "#text": "" }], ":@": attrsObject(node.attributes) };
    case "element": {
      const obj: Record<string, unknown> = {
        [node.tag]: toOrdered(node.children),
      };
      const attrs = attrsObject(node.attributes);
      if (Object.keys(attrs).length > 0) {
        obj[":@"] = attrs;
      }
      return obj;
    }
  }
}
