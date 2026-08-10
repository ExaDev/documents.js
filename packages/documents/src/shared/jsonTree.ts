import type { TreeNodeData } from '@mantine/core';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLeaf(value: unknown): boolean {
  return value === null || typeof value !== 'object';
}

function formatLeaf(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  return String(value);
}

// A finite value set worth showing inline in a node's own label rather than requiring the reader to expand a whole extra level just to see which array-item kind they're looking at (e.g. a discriminated union's own `kind` field).
function kindSuffix(value: unknown): string {
  if (!isPlainObject(value)) return '';
  const kind = value.kind;
  return typeof kind === 'string' ? `: ${kind}` : '';
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

function objectEntryNode(key: string, value: unknown, parentPath: string): TreeNodeData {
  const path = `${parentPath}.${key}`;
  const label = isLeaf(value) ? `${key}: ${formatLeaf(value)}` : Array.isArray(value) ? `${key} [${value.length}]` : key;
  return { value: path, label, children: childrenFor(value, path) };
}

function arrayItemNode(value: unknown, index: number, parentPath: string): TreeNodeData {
  const path = `${parentPath}[${index}]`;
  const label = isLeaf(value) ? `[${index}]: ${formatLeaf(value)}` : `[${index}]${kindSuffix(value)}`;
  return { value: path, label, children: childrenFor(value, path) };
}

// Generic value -> Mantine TreeNodeData[] adapter, so any plain JSON-like structure (a LayoutDocument, in this app's case) can be browsed as an expandable tree instead of a wall of stats. Leaf values (primitives, null) render inline as part of their parent's label; only non-empty objects and arrays become their own expandable node. `value` (Mantine Tree's own node identifier) is a synthetic path string, built fresh from the root on every call -- stable across two calls over structurally-identical data, but not meant to persist across different documents.
export function toTreeData(value: unknown): TreeNodeData[] {
  return childrenFor(value, 'root') ?? [];
}
