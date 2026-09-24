import { expect } from "vitest";
import { DocumentTreeSchema, type DocumentTree } from "document-schema.js";
import type { GraphNode, PropertyGraph } from "../outline/graph";

// Shared across every outline/graph.test.ts and outline/graph-edit.test.ts split file (ExaDev/documents.js#1275): both assertions were duplicated identically across the original graph.test.ts's read-side and write-side describe blocks before the max-lines split, so they live here once rather than in whichever split file happened to define them first.

export function expectSchemaValid(pkg: DocumentTree, label: string): void {
  const result = DocumentTreeSchema.safeParse(pkg);
  expect(
    result.success
      ? "valid"
      : `invalid (${label}): ${JSON.stringify(result.error.issues[0])}`,
  ).toBe("valid");
}

export function nodeByText(graph: PropertyGraph, text: string): GraphNode {
  const matches = graph.nodes.filter((node) =>
    JSON.stringify(node).includes(JSON.stringify(text)),
  );
  expect(matches.length).toBe(1);
  return matches[0]!;
}
