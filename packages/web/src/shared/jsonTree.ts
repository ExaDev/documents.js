import type { TreeNodeData } from "@mantine/core";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLeaf(value: unknown): boolean {
  return value === null || typeof value !== "object";
}

// Cap rendered leaf length so a large value (an embedded image's base64, a long paragraph) doesn't produce a tree leaf wider than the panel. The start of the string is kept so the reader can still identify what it is. Strings are checked for length BEFORE JSON.stringify so a multi-MB base64 blob is never materialized in full -- only its first N chars are stringified.
const MAX_LEAF_LENGTH = 100;
const RAW_STRING_CAP = MAX_LEAF_LENGTH + 2; // +2 for the JSON quotes JSON.stringify wraps the string in

function formatLeaf(value: unknown): string {
  if (typeof value === "string") {
    if (value.length > RAW_STRING_CAP) {
      // -3 leaves room for the two JSON quotes JSON.stringify wraps the slice in, plus the ellipsis.
      return `${JSON.stringify(value.slice(0, MAX_LEAF_LENGTH - 3))}…`;
    }
    return JSON.stringify(value);
  }
  const formatted = String(value);
  return formatted.length <= MAX_LEAF_LENGTH
    ? formatted
    : `${formatted.slice(0, MAX_LEAF_LENGTH - 1)}…`;
}

// A finite value set worth showing inline in a node's own label rather than requiring the reader to expand a whole extra level just to see which array-item kind they're looking at (e.g. a discriminated union's own `kind` field).
function kindSuffix(value: unknown): string {
  if (!isPlainObject(value)) return "";
  const kind = value.kind;
  return typeof kind === "string" ? `: ${kind}` : "";
}

function childrenFor(value: unknown, path: string): TreeNodeData[] | undefined {
  if (Array.isArray(value)) {
    if (value.length === 0) return undefined;
    return value.map((item, index) => arrayItemNode(item, index, path));
  }
  if (!isPlainObject(value)) return undefined;
  const entries = Object.entries(value);
  if (entries.length === 0) return undefined;
  return entries.map(([key, entry]) => objectEntryNode(key, entry, path));
}

function objectEntryNode(
  key: string,
  value: unknown,
  parentPath: string,
): TreeNodeData {
  const path = `${parentPath}.${key}`;
  const label = isLeaf(value)
    ? `${key}: ${formatLeaf(value)}`
    : Array.isArray(value)
      ? `${key} [${value.length}]`
      : key;
  return { value: path, label, children: childrenFor(value, path) };
}

function arrayItemNode(
  value: unknown,
  index: number,
  parentPath: string,
): TreeNodeData {
  const path = `${parentPath}[${index}]`;
  const label = isLeaf(value)
    ? `[${index}]: ${formatLeaf(value)}`
    : `[${index}]${kindSuffix(value)}`;
  return { value: path, label, children: childrenFor(value, path) };
}

// Generic value -> Mantine TreeNodeData[] adapter, so any plain JSON-like structure (a LayoutDocument, in this app's case) can be browsed as an expandable tree instead of a wall of stats. Leaf values (primitives, null) render inline as part of their parent's label; only non-empty objects and arrays become their own expandable node. `value` (Mantine Tree's own node identifier) is a synthetic path string, built fresh from the root on every call -- stable across two calls over structurally-identical data, but not meant to persist across different documents.
export function toTreeData(value: unknown): TreeNodeData[] {
  return childrenFor(value, "root") ?? [];
}
