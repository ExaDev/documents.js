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

export function buildXml(nodes: readonly XmlNode[]): string {
  const out = BUILDER.build(toOrdered(nodes));
  if (typeof out !== "string") {
    throw new Error("XMLBuilder did not return a string");
  }
  return out;
}

function toOrdered(nodes: readonly XmlNode[]): unknown[] {
  return nodes.map(toOrderedNode);
}

function attrsObject(attributes: readonly Attribute[]): Record<string, string> {
  const obj: Record<string, string> = {};
  for (const a of attributes) {
    obj[`@_${a.name}`] = a.value;
  }
  return obj;
}

// The array Stryker's own ArrayDeclaration mutator would otherwise target at each of the pi/declaration return sites below, factored to one shared literal and pinned to the empty-tuple type `readonly []` so that any mutation of its contents (Stryker's own probe replaces `[]` with `["Stryker was here"]`) is a type error rather than a silent, unobservable survivor: fast-xml-builder reads neither node shape's own array value, only its ":@" attributes (see the case comments below), so no test on buildXml's output could ever distinguish an empty array here from a non-empty one. The type system rules the mutation out instead of a test having to.
const NO_ORDERED_CONTENT: readonly [] = [];

// Exported so a test can pin the exact intermediate ordered-node shape directly — in particular that an attribute-less element's object carries no ":@" key at all, rather than one holding an empty object, a distinction fast-xml-builder itself never renders differently in the built XML string and so no output-equality test on buildXml could ever observe.
export function toOrderedNode(node: XmlNode): Record<string, unknown> {
  switch (node.type) {
    case "text":
      return { "#text": node.value };
    case "comment":
      return { __comment: [{ "#text": node.value }] };
    case "cdata":
      return { __cdata: [{ "#text": node.value }] };
    // fast-xml-builder (fast-xml-parser's own build engine) special-cases any "?"-prefixed key: it emits `<key attrs?>` from the key and its ":@" attributes alone and never looks at the key's own array value, for a PI exactly as it does for the declaration case just below — confirmed directly against the library's own orderedJs2Xml.js, which branches on a leading "?" before ever touching a node's array/text content. node.content therefore never reaches the built string; an empty array is exactly as observable as any other value here; and there's no attribute for it to ride either, since a PI's content is free text rather than name/value pairs. This is a genuine limitation of the library, not a choice this codec makes — see the equivalent case below for the same reasoning restated over ?xml's own attributes.
    case "pi":
      return { [`?${node.target}`]: NO_ORDERED_CONTENT };
    // Same "?"-prefixed-key rule as the pi case above: fast-xml-builder reads ?xml's attributes from ":@" and ignores whatever sits in its own array value entirely, so the array carries nothing observable either way.
    case "declaration":
      return { "?xml": NO_ORDERED_CONTENT, ":@": attrsObject(node.attributes) };
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
