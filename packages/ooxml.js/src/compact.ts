import { z } from "zod";
import { type Package, PackageSchema } from "./model/package";
import type { Attribute, XmlNode } from "./model/node";
import { decodePackage, encodePackage } from "./codec";

// A flat number[] of alternating [nameIdx, valueIdx, ...] pairs into the string table.
export type CompactAttrPairs = number[];

// Tuple-encoded XmlNode: a leading numeric type code, then the node's fields as string-table indices. Order matches model/node.ts's XmlNode variants.
export type CompactElement = [0, number, CompactAttrPairs, CompactXmlNode[]];
export type CompactText = [1, number];
export type CompactCdata = [2, number];
export type CompactComment = [3, number];
export type CompactDeclaration = [4, CompactAttrPairs];
export type CompactPi = [5, number, number];

export type CompactXmlNode =
  | CompactElement
  | CompactText
  | CompactCdata
  | CompactComment
  | CompactDeclaration
  | CompactPi;

// Array.isArray narrows unknown to any[], not unknown[] -- lib.es5.d.ts types its parameter as `any`, so TypeScript can't do better even after the check. This guard exists so indexing the result stays unknown rather than silently reintroducing any.
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
  if (code === 1 || code === 2 || code === 3) {
    return value.length === 2 && typeof value[1] === "number";
  }
  if (code === 4) {
    return value.length === 2 && isCompactAttrPairs(value[1]);
  }
  if (code === 5) {
    return (
      value.length === 3 &&
      typeof value[1] === "number" &&
      typeof value[2] === "number"
    );
  }
  if (code === 0) {
    return (
      value.length === 4 &&
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
  attributes: Attribute[],
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
      return [1, table.intern(node.value)];
    case "cdata":
      return [2, table.intern(node.value)];
    case "comment":
      return [3, table.intern(node.value)];
    case "declaration":
      return [4, encodeAttrs(node.attributes, table)];
    case "pi":
      return [5, table.intern(node.target), table.intern(node.content)];
    case "element":
      return [
        0,
        table.intern(node.tag),
        encodeAttrs(node.attributes, table),
        node.children.map((child) => encodeNode(child, table)),
      ];
  }
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

function stringAt(strings: string[], index: number): string {
  const value = strings[index];
  if (value === undefined) {
    throw new Error(`fromCompact: string table index ${index} is out of range`);
  }
  return value;
}

function decodeAttrs(pairs: CompactAttrPairs, strings: string[]): Attribute[] {
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

function decodeNode(node: CompactXmlNode, strings: string[]): XmlNode {
  switch (node[0]) {
    case 1:
      return { type: "text", value: stringAt(strings, node[1]) };
    case 2:
      return { type: "cdata", value: stringAt(strings, node[1]) };
    case 3:
      return { type: "comment", value: stringAt(strings, node[1]) };
    case 4:
      return { type: "declaration", attributes: decodeAttrs(node[1], strings) };
    case 5:
      return {
        type: "pi",
        target: stringAt(strings, node[1]),
        content: stringAt(strings, node[2]),
      };
    case 0:
      return {
        type: "element",
        tag: stringAt(strings, node[1]),
        attributes: decodeAttrs(node[2], strings),
        children: node[3].map((child) => decodeNode(child, strings)),
      };
  }
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
