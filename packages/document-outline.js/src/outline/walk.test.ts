import { describe, expect, it } from 'vitest';
import type { HeadingGroupNode } from 'document-schema.js';
import { headingGroup, paragraph, sectionGroup, wordprocessingPackage } from '../test-support/fixtures';
import { projectDocumentGraph, type GraphEdge, type PropertyGraph } from './graph';
import { DEFAULT_EDGE_CYCLE_POLICY, GraphCycleError, walkGraph, type EdgeKindCyclePolicy } from './walk';

function edge(from: string, to: string, kind: GraphEdge['kind']): GraphEdge {
  return { from, to, kind, order: 'i' };
}

describe('walkGraph: CONTAINS-only correctness and zero bookkeeping', () => {
  it('visits every node reachable by CONTAINS from the root, exactly once each, on a wide real tree', () => {
    const width = 500;
    const paragraphs = Array.from({ length: width }, (_, i) => paragraph(`Paragraph number ${String(i)}.`));
    const pkg = wordprocessingPackage([sectionGroup(paragraphs)]);
    const graph = projectDocumentGraph([{ id: 'doc', package: pkg }]);

    const visited: string[] = [];
    walkGraph(graph, 'doc', (nodeId) => visited.push(nodeId), { edgeKinds: ['CONTAINS'] });

    // Every node in the projected graph (root, the one section, and all `width` distinct paragraphs -- each paragraph's text differs, so none share an id) is CONTAINS-reachable from the root and visited exactly once.
    expect(visited).toHaveLength(graph.nodes.length);
    expect(new Set(visited).size).toBe(graph.nodes.length);
    expect(new Set(visited)).toEqual(new Set(graph.nodes.map((node) => node.id)));
  });

  it('handles a deep CONTAINS-only chain correctly, with no stack overflow and no misattributed visits -- the "no per-step bookkeeping cost" claim demonstrated by simple correctness at a depth where an O(depth) cost per step would be the first thing to break', () => {
    // A narrow, 800-level-deep chain of nested heading groups: recursion depth big enough to matter, one CONTAINS edge apart at every level, ending in a single leaf.
    const depth = 800;
    function nestedHeadings(level: number): HeadingGroupNode {
      if (level === 0) return headingGroup('Level 0', 1, [paragraph('Bottom leaf.')]);
      return headingGroup(`Level ${String(level)}`, 1, [nestedHeadings(level - 1)]);
    }
    const pkg = wordprocessingPackage([sectionGroup([nestedHeadings(depth)])]);
    const graph = projectDocumentGraph([{ id: 'doc', package: pkg }]);
    // root + section + (depth + 1) heading levels (0..depth inclusive) + 1 leaf paragraph -- every heading level's text differs, so none share an id, and this walk should visit every one of them exactly once.
    expect(graph.nodes).toHaveLength(depth + 4);

    const visited: string[] = [];
    expect(() => walkGraph(graph, 'doc', (nodeId) => visited.push(nodeId), { edgeKinds: ['CONTAINS'] })).not.toThrow();
    expect(visited).toHaveLength(graph.nodes.length);
    expect(new Set(visited).size).toBe(graph.nodes.length);
  });

  it('reaches a node shared by two different CONTAINS parents twice (once per path), which is correct sharing, not a cycle', () => {
    const shared = paragraph('Shared leaf.');
    const pkg = wordprocessingPackage([sectionGroup([shared, paragraph('Other.'), shared])]);
    const graph = projectDocumentGraph([{ id: 'doc', package: pkg }]);
    const sharedNode = graph.nodes.find((node) => node.kind === 'paragraph' && JSON.stringify(node).includes('Shared leaf.'))!;

    const visits: string[] = [];
    expect(() => walkGraph(graph, 'doc', (nodeId) => visits.push(nodeId), { edgeKinds: ['CONTAINS'] })).not.toThrow();
    expect(visits.filter((id) => id === sharedNode.id)).toHaveLength(2);
  });
});

describe('walkGraph: guarded kinds detect and stop real cycles', () => {
  it('throws GraphCycleError on a synthetic 3-node cycle in a guarded (non-CONTAINS) kind, terminating rather than looping forever', () => {
    const graph: PropertyGraph = {
      nodes: [
        { id: 'n1', kind: 'x' },
        { id: 'n2', kind: 'x' },
        { id: 'n3', kind: 'x' },
      ],
      edges: [edge('n1', 'n2', 'DEFINED_BY'), edge('n2', 'n3', 'DEFINED_BY'), edge('n3', 'n1', 'DEFINED_BY')],
    };
    let calls = 0;
    expect(() =>
      walkGraph(graph, 'n1', () => {
        calls += 1;
        if (calls > 1000) throw new Error('walkGraph did not terminate'); // safety net: fail loudly rather than hang if the guard regresses
      }),
    ).toThrowError(GraphCycleError);
    expect(calls).toBeLessThan(10); // it stopped almost immediately, not after looping around the cycle many times
  });

  it('does NOT throw for a diamond (two non-overlapping paths converging on one node), only for a true same-path repeat', () => {
    const graph: PropertyGraph = {
      nodes: [
        { id: 'n1', kind: 'x' },
        { id: 'n2', kind: 'x' },
        { id: 'n3', kind: 'x' },
        { id: 'n4', kind: 'x' },
      ],
      edges: [
        edge('n1', 'n2', 'DEFINED_BY'),
        edge('n1', 'n3', 'DEFINED_BY'),
        edge('n2', 'n4', 'DEFINED_BY'),
        edge('n3', 'n4', 'DEFINED_BY'),
      ],
    };
    const visits: string[] = [];
    expect(() => walkGraph(graph, 'n1', (nodeId) => visits.push(nodeId))).not.toThrow();
    // n4 is reached via n1->n2->n4 AND n1->n3->n4 -- two different paths, not a cycle -- so it is visited (and counted) once per path, never merged away and never rejected.
    expect(visits.filter((id) => id === 'n4')).toHaveLength(2);
  });

  it('restricting the walk to a guarded kind via edgeKinds still detects a cycle confined to that kind', () => {
    const graph: PropertyGraph = {
      nodes: [
        { id: 'n1', kind: 'x' },
        { id: 'n2', kind: 'x' },
      ],
      edges: [edge('n1', 'n2', 'STYLED_BY'), edge('n2', 'n1', 'STYLED_BY')],
    };
    expect(() => walkGraph(graph, 'n1', () => {}, { edgeKinds: ['STYLED_BY'] })).toThrowError(GraphCycleError);
  });

  it('an edgeKinds filter that excludes the cycling kind entirely never sees the cycle', () => {
    const graph: PropertyGraph = {
      nodes: [
        { id: 'n1', kind: 'x' },
        { id: 'n2', kind: 'x' },
      ],
      edges: [edge('n1', 'n2', 'STYLED_BY'), edge('n2', 'n1', 'STYLED_BY')],
    };
    const visits: string[] = [];
    expect(() => walkGraph(graph, 'n1', (nodeId) => visits.push(nodeId), { edgeKinds: ['CONTAINS'] })).not.toThrow();
    expect(visits).toEqual(['n1']); // no CONTAINS edges at all here, so the walk never leaves the root
  });
});

describe('walkGraph: policy is caller-configurable, not hardcoded', () => {
  it('a custom policy marking CONTAINS as guarded catches a synthetic CONTAINS cycle the default policy would trust', () => {
    const graph: PropertyGraph = {
      nodes: [
        { id: 'n1', kind: 'x' },
        { id: 'n2', kind: 'x' },
      ],
      edges: [edge('n1', 'n2', 'CONTAINS'), edge('n2', 'n1', 'CONTAINS')],
    };
    // Under the default policy CONTAINS is trusted acyclic, so this synthetic (illegitimate for a real projection) cycle loops forever -- guarded against here with a safety-net throw, proving the default really does skip the check rather than merely being lucky.
    let calls = 0;
    expect(() =>
      walkGraph(graph, 'n1', () => {
        calls += 1;
        if (calls > 1000) throw new Error('unbounded -- default policy did not guard CONTAINS, as expected');
      }),
    ).toThrowError(/did not guard CONTAINS/);

    const guardCONTAINS: EdgeKindCyclePolicy = { ...DEFAULT_EDGE_CYCLE_POLICY, CONTAINS: 'guarded' };
    expect(() => walkGraph(graph, 'n1', () => {}, { policy: guardCONTAINS })).toThrowError(GraphCycleError);
  });
});
