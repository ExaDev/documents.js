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

// XMLBuilder#build's own type declaration already returns `string` unconditionally (fast-xml-parser's fxp.d.ts: `build(jObj: any): string`), so no runtime check is needed here to narrow it.
export function buildXml(nodes: readonly XmlNode[]): string {
  return BUILDER.build(toOrdered(nodes));
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

function toOrderedNode(node: XmlNode): Record<string, unknown> {
  switch (node.type) {
    case "text":
      return { "#text": node.value };
    case "comment":
      return { __comment: [{ "#text": node.value }] };
    case "cdata":
      return { __cdata: [{ "#text": node.value }] };
    // A pi/declaration node's own value is never read at all by fast-xml-parser's builder in preserveOrder mode — confirmed empirically against every shape tried (an empty array, one holding a real "#text" entry, undefined, null, a plain object): build([{ "?target": <any of these> }]) always produces the identical "<?target?>", the same quirk this builder's own reader hits on the way in (a plain or attribute-shaped PI's content parses back as "" either way). undefined is therefore used here as the plainest spelling of "this value is never consulted", not a placeholder standing in for children data the builder would otherwise use.
    case "pi":
      return { [`?${node.target}`]: undefined };
    case "declaration":
      return { "?xml": undefined, ":@": attrsObject(node.attributes) };
    case "element":
      // No emptiness check before setting ":@": XMLBuilder renders an empty attributes object identically to an entirely absent ":@" key (confirmed empirically), so guarding it here would only ever produce output indistinguishable from not guarding it.
      return {
        [node.tag]: toOrdered(node.children),
        ":@": attrsObject(node.attributes),
      };
  }
  return assertNeverXmlNode(node);
}

// Reached only if the union behind `node` ever gains a member toOrderedNode's own switch does not match: every current member has a case there, so `node` narrows to `never` at the call, and adding an uncovered member makes that narrowing fail and the call stop compiling. Exists so the switch's own exhaustiveness, proven by the type checker rather than by a catch-all default that would silently emit nothing for a genuinely new member, still gives consistent-return an explicit statement to see past the switch. Exported so a test can exercise the throw directly with a forced-invalid cast, since it is otherwise unreachable.
export function assertNeverXmlNode(value: never): never {
  throw new Error(`epub-codec: unhandled xml node ${JSON.stringify(value)}`);
}
