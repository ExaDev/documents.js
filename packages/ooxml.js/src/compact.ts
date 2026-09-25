import { z } from "zod";
import { type Package, PackageSchema } from "./model/package";
import {
  assertNeverXmlNodeType,
  type Attribute,
  type XmlNode,
} from "./model/node";
import { decodePackage, encodePackage } from "./codec";

// A flat number[] of alternating [nameIdx, valueIdx, ...] pairs into the string table.
export type CompactAttrPairs = number[];

// The leading tuple element of every CompactXmlNode variant: a numeric type-code discriminant, in the same order as model/node.ts's own XmlNode variants. Declared as consts, not bare literals, so the tuple type aliases below (referenced via `typeof`, since a type alias needs a type rather than a value) and every value-position check against the same discriminant (isCompactXmlNode, encodeNode, decodeNode) share one named source rather than six independently-typed magic numbers.
const NODE_TAG_ELEMENT = 0;
const NODE_TAG_TEXT = 1;
const NODE_TAG_CDATA = 2;
const NODE_TAG_COMMENT = 3;
const NODE_TAG_DECLARATION = 4;
const NODE_TAG_PI = 5;

// Tuple-encoded XmlNode: a leading numeric type code, then the node's fields as string-table indices. Order matches model/node.ts's XmlNode variants.
export type CompactElement = [
  typeof NODE_TAG_ELEMENT,
  number,
  CompactAttrPairs,
  CompactXmlNode[],
];
export type CompactText = [typeof NODE_TAG_TEXT, number];
export type CompactCdata = [typeof NODE_TAG_CDATA, number];
export type CompactComment = [typeof NODE_TAG_COMMENT, number];
export type CompactDeclaration = [
  typeof NODE_TAG_DECLARATION,
  CompactAttrPairs,
];
export type CompactPi = [typeof NODE_TAG_PI, number, number];

export type CompactXmlNode =
  | CompactElement
  | CompactText
  | CompactCdata
  | CompactComment
  | CompactDeclaration
  | CompactPi;

// Array.isArray narrows unknown to any[], not unknown[] — lib.es5.d.ts types its parameter as `any`, so TypeScript can't do better even after the check. This guard exists so indexing the result stays unknown rather than silently reintroducing any.
function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function isCompactAttrPairs(value: unknown): value is CompactAttrPairs {
  return isUnknownArray(value) && value.every((v) => typeof v === "number");
}

// Recursive structural guard, mirroring model/node.ts's isXmlNode: z.lazy + z.union collapses to `unknown` for the element-children case in this zod version, so the recursive union goes through z.custom instead.
export function isCompactXmlNode(value: unknown): value is CompactXmlNode {
  if (!isUnknownArray(value)) {
    return false;
  }
  const code = value[0];
  if (
    code === NODE_TAG_TEXT ||
    code === NODE_TAG_CDATA ||
    code === NODE_TAG_COMMENT
  ) {
    return value.length === 2 && typeof value[1] === "number";
  }
  if (code === NODE_TAG_DECLARATION) {
    return value.length === 2 && isCompactAttrPairs(value[1]);
  }
  // Each tuple's own fixed length: [tag, target, content] for pi, [tag, tagIdx, attrs, children] for element.
  const PI_TUPLE_LENGTH = 3;
  const ELEMENT_TUPLE_LENGTH = 4;
  if (code === NODE_TAG_PI) {
    return (
      value.length === PI_TUPLE_LENGTH &&
      typeof value[1] === "number" &&
      typeof value[2] === "number"
    );
  }
  if (code === NODE_TAG_ELEMENT) {
    return (
      value.length === ELEMENT_TUPLE_LENGTH &&
      typeof value[1] === "number" &&
      isCompactAttrPairs(value[2]) &&
      Array.isArray(value[3]) &&
      value[3].every(isCompactXmlNode)
    );
  }
  return false;
}

export const CompactXmlNodeSchema = z.custom<CompactXmlNode>(isCompactXmlNode);

// A CompactPart is either an XML part (a CompactXmlNode[] forest) or a binary part (a single string-table index for its base64); Array.isArray discriminates the two.
export const CompactPartSchema = z.union([
  z.array(CompactXmlNodeSchema),
  z.number(),
]);
export type CompactPart = z.infer<typeof CompactPartSchema>;

export const CompactPackageSchema = z.object({
  s: z.array(z.string()),
  p: z.record(z.string(), CompactPartSchema),
});
export type CompactPackage = z.infer<typeof CompactPackageSchema>;

// Interns every string once, in first-occurrence order, so the same input always yields the same table (determinism) and repeated strings (tags, namespace URIs, attribute names) cost one entry instead of one per occurrence.
class StringTable {
  private readonly indices = new Map<string, number>();
  readonly strings: string[] = [];

  intern(value: string): number {
    const existing = this.indices.get(value);
    if (existing !== undefined) {
      return existing;
    }
    const index = this.strings.length;
    this.indices.set(value, index);
    this.strings.push(value);
    return index;
  }
}

function encodeAttrs(
  attributes: readonly Attribute[],
  table: StringTable,
): CompactAttrPairs {
  const pairs: CompactAttrPairs = [];
  for (const attribute of attributes) {
    pairs.push(table.intern(attribute.name), table.intern(attribute.value));
  }
  return pairs;
}

function encodeNode(node: XmlNode, table: StringTable): CompactXmlNode {
  switch (node.type) {
    case "text":
      return [NODE_TAG_TEXT, table.intern(node.value)];
    case "cdata":
      return [NODE_TAG_CDATA, table.intern(node.value)];
    case "comment":
      return [NODE_TAG_COMMENT, table.intern(node.value)];
    case "declaration":
      return [NODE_TAG_DECLARATION, encodeAttrs(node.attributes, table)];
    case "pi":
      return [
        NODE_TAG_PI,
        table.intern(node.target),
        table.intern(node.content),
      ];
    case "element":
      return [
        NODE_TAG_ELEMENT,
        table.intern(node.tag),
        encodeAttrs(node.attributes, table),
        node.children.map((child) => encodeNode(child, table)),
      ];
  }
  return assertNeverXmlNodeType(node);
}

function packageToCompact(pkg: Package): CompactPackage {
  const table = new StringTable();
  const p: Record<string, CompactPart> = {};
  for (const [path, part] of Object.entries(pkg.parts)) {
    p[path] =
      part.kind === "binary"
        ? table.intern(part.base64)
        : part.nodes.map((node) => encodeNode(node, table));
  }
  return { s: table.strings, p };
}

function stringAt(strings: readonly string[], index: number): string {
  const value = strings[index];
  if (value === undefined) {
    throw new Error(`fromCompact: string table index ${index} is out of range`);
  }
  return value;
}

function decodeAttrs(
  pairs: CompactAttrPairs,
  strings: readonly string[],
): Attribute[] {
  const attributes: Attribute[] = [];
  for (let i = 0; i < pairs.length; i += 2) {
    const nameIdx = pairs[i];
    const valueIdx = pairs[i + 1];
    if (nameIdx === undefined || valueIdx === undefined) {
      throw new Error(
        "fromCompact: attribute index pairs array has odd length",
      );
    }
    attributes.push({
      name: stringAt(strings, nameIdx),
      value: stringAt(strings, valueIdx),
    });
  }
  return attributes;
}

// Reached only if CompactXmlNode ever gains a variant decodeNode's own switch does not match: every current member is covered there, so `value` narrows to `never` at the real call site, and adding an uncovered leading type code makes that narrowing fail and this call stop compiling. That is the real safety net. Exported so compact.test.ts can exercise the throw directly with a forced-invalid cast: it is otherwise unreachable, since every real CompactXmlNode type code is already handled by a case in decodeNode.
export function assertNeverCompactXmlNodeCode(value: never): never {
  throw new Error(
    `decodeNode: unhandled CompactXmlNode type code ${JSON.stringify(value)}`,
  );
}

function decodeNode(node: CompactXmlNode, strings: readonly string[]): XmlNode {
  switch (node[0]) {
    case NODE_TAG_TEXT:
      return { type: "text", value: stringAt(strings, node[1]) };
    case NODE_TAG_CDATA:
      return { type: "cdata", value: stringAt(strings, node[1]) };
    case NODE_TAG_COMMENT:
      return { type: "comment", value: stringAt(strings, node[1]) };
    case NODE_TAG_DECLARATION:
      return {
        type: "declaration",
        attributes: decodeAttrs(node[1], strings),
      };
    case NODE_TAG_PI:
      return {
        type: "pi",
        target: stringAt(strings, node[1]),
        content: stringAt(strings, node[2]),
      };
    case NODE_TAG_ELEMENT:
      return {
        type: "element",
        tag: stringAt(strings, node[1]),
        attributes: decodeAttrs(node[2], strings),
        children: node[3].map((child) => decodeNode(child, strings)),
      };
  }
  return assertNeverCompactXmlNodeCode(node);
}

function compactToPackage(cpkg: CompactPackage): Package {
  const parts: Package["parts"] = {};
  for (const [path, part] of Object.entries(cpkg.p)) {
    parts[path] =
      typeof part === "number"
        ? { kind: "binary", base64: stringAt(cpkg.s, part) }
        : { kind: "xml", nodes: part.map((node) => decodeNode(node, cpkg.s)) };
  }
  return { parts };
}

// Package <-> the ooxml.js compact form: tuple-encoded nodes plus a string-interning table, still plain diffable JSON but without the repeated `type`/`tag`/`attributes`/`children` keys and repeated tag/namespace strings of the verbose Package model. decode is the "to compact form" direction.
export const compactCodec = z.codec(PackageSchema, CompactPackageSchema, {
  decode: (pkg) => packageToCompact(pkg),
  encode: (cpkg) => compactToPackage(cpkg),
});

export function toCompact(pkg: Package): CompactPackage {
  return z.decode(compactCodec, pkg);
}

export function fromCompact(cpkg: CompactPackage): Package {
  return z.encode(compactCodec, cpkg);
}

// OOXML package bytes <-> the ooxml.js compact form directly, composing packageCodec and compactCodec so callers who only care about bytes and CompactPackage don't have to go through Package by hand.
export const compactPackageCodec = z.codec(
  z.instanceof(Uint8Array),
  CompactPackageSchema,
  {
    decode: (bytes) => toCompact(decodePackage(bytes)),
    encode: (cpkg) => encodePackage(fromCompact(cpkg)),
  },
);

export function decodeCompactPackage(
  bytes: Uint8Array<ArrayBuffer>,
): CompactPackage {
  return z.decode(compactPackageCodec, bytes);
}

export function encodeCompactPackage(
  cpkg: CompactPackage,
): Uint8Array<ArrayBuffer> {
  return z.encode(compactPackageCodec, cpkg);
}
