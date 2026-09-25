import { describe, expect, it } from "vitest";
import type { DocumentTree } from "document-schema.js";
import type { PropertyGraph } from "../outline/graph";
import { expectSchemaValid, nodeByText } from "./graph-assertions";

// Direct coverage for graph-assertions.ts's own two helpers: every real caller passes a genuinely valid package and a graph with exactly one match, so neither helper's own failure branch is exercised by the tests that merely use them in passing.

describe("expectSchemaValid", () => {
  it("throws, naming the label and the first schema issue, for a package that fails validation", () => {
    const invalidPackage = {
      kind: "bogus",
    } as unknown as DocumentTree;
    expect(() => {
      expectSchemaValid(invalidPackage, "my-label");
    }).toThrow(/invalid \(my-label\):/);
  });
});

describe("nodeByText", () => {
  it("throws when no node's own serialised content contains the given text", () => {
    const graph: PropertyGraph = { nodes: [], edges: [] };
    expect(() => nodeByText(graph, "missing")).toThrow();
  });

  it("throws when more than one node's own serialised content contains the given text", () => {
    const graph: PropertyGraph = {
      nodes: [
        { id: "a", kind: "value", value: "shared" },
        { id: "b", kind: "value", value: "shared" },
      ],
      edges: [],
    };
    expect(() => nodeByText(graph, "shared")).toThrow();
  });

  it("returns the single matching node when exactly one matches", () => {
    const graph: PropertyGraph = {
      nodes: [{ id: "a", kind: "value", value: "unique-text" }],
      edges: [],
    };
    expect(nodeByText(graph, "unique-text")).toEqual(graph.nodes[0]);
  });
});
