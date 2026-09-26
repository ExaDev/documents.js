import {
  CONTENT_FORMATS,
  FORMAT_NODES,
  LAYOUT_CAPABLE,
  MAX_CONVERSION_PATH_NODES,
  READ_ONLY_CONTENT_FORMATS,
  READ_ONLY_FORMAT_NODES,
  THROUGH_PDF_EDGE_COST,
  TRANSFORMS,
  isReadOnlyContentFormat,
} from "./composition";
import type { ContentFormat, SourceContentFormat } from "./composition";
import type { DocumentFormat } from "./port";
// The conversion-path planning half of composition, split from composition.ts: the format graph, Dijkstra shortest-path over it, and the plan resolver that turns a from/to pair into the hop list an executor walks. composition.ts keeps the format tables, bridge execution and the public entry points.
// --- Pathfinder: minimum-cost route over the composition graph ---------------------------------

export type HopExecutor = "bridge" | "toPdf" | "fromPdf";

export interface CompositionHop {
  readonly executor: HopExecutor;
  readonly from: DocumentFormat;
  readonly to: DocumentFormat;
}

export interface ConversionPlan {
  readonly hops: readonly CompositionHop[];
}

export interface GraphEdge {
  readonly to: DocumentFormat;
  readonly cost: number;
}

// Builds the composition graph's adjacency list from the registry, with fidelity-ordered edge costs: a same-variant bridge (cost 1, lossless) always beats a cross-variant transform (cost 2, approximate), which always beats a toPdf/fromPdf edge (cost 3, geometry-based render or reconstruction). Same-variant bridges and toPdf/fromPdf edges are genuinely bidirectional with symmetric costs; cross-variant transform edges are DIRECTED per TRANSFORMS key instead, since a variant pair is bidirectional only when both directions are registered as separate keys — a one-way transform (spreadsheet->wordprocessing) must not open a same-cost edge back the other way with no transform to execute it. The toPdf/fromPdf edges cover exactly LAYOUT_CAPABLE (xlsx and csv absent — each routes through ods), and cross-variant transform edges are derived from TRANSFORMS' own keys so the graph cannot drift from the registered transforms.
export function buildCompositionGraph(): ReadonlyMap<
  DocumentFormat,
  readonly GraphEdge[]
> {
  const adj = new Map<DocumentFormat, GraphEdge[]>();
  const addDirected = (
    from: DocumentFormat,
    to: DocumentFormat,
    cost: number,
  ): void => {
    const list = adj.get(from);
    if (list === undefined) {
      adj.set(from, [{ to, cost }]);
    } else {
      list.push({ to, cost });
    }
  };
  const addEdge = (
    from: DocumentFormat,
    to: DocumentFormat,
    cost: number,
  ): void => {
    addDirected(from, to, cost);
    addDirected(to, from, cost);
  };

  // Same-variant bridges (cost 1): every pair of content formats sharing a variant.
  for (const a of CONTENT_FORMATS) {
    for (const b of CONTENT_FORMATS) {
      if (a === b) {
        continue;
      }
      if (FORMAT_NODES[a].variant === FORMAT_NODES[b].variant) {
        addEdge(a, b, 1);
      }
    }
  }

  // Cross-variant transforms (cost 2): every format of the source variant -> every format of the target variant, for each direction registered in TRANSFORMS. DIRECTED, not addEdge's bidirectional pair: a TRANSFORMS key states one direction, and a pair like wordprocessing<->presentation is bidirectional only because both directions are registered as separate keys above — registering just one direction (spreadsheet->wordprocessing, with no reverse) must NOT silently open a same-cost edge back the other way, since executeBridge would then look up a TRANSFORMS entry that was never registered and throw at runtime for a route the pathfinder itself proposed.
  for (const key of Object.keys(TRANSFORMS)) {
    const parts = key.split("->");
    const fromVariant = parts[0];
    const toVariant = parts[1];
    if (fromVariant === undefined || toVariant === undefined) {
      continue;
    }
    for (const a of CONTENT_FORMATS) {
      if (FORMAT_NODES[a].variant !== fromVariant) {
        continue;
      }
      for (const b of CONTENT_FORMATS) {
        if (FORMAT_NODES[b].variant !== toVariant) {
          continue;
        }
        addDirected(a, b, 2);
      }
    }
  }

  // toPdf/fromPdf edges (cost 3) for every layout-capable format. xlsx and csv are absent, so each reaches pdf only through its ods bridge.
  for (const format of CONTENT_FORMATS) {
    if (LAYOUT_CAPABLE.has(format)) {
      addEdge(format, "pdf", THROUGH_PDF_EDGE_COST);
    }
  }

  // Read-only formats (see ReadOnlyContentFormat above) get the same three edge kinds at the same three costs, but DIRECTED — out of the read-only node only. That single asymmetry is the whole mechanism: with nothing pointing at one, Dijkstra can never reach a read-only format as a target, so "a source that can never be a target" is a property of the graph's shape rather than a rule some resolver has to remember to apply.
  for (const source of READ_ONLY_CONTENT_FORMATS) {
    const variant = READ_ONLY_FORMAT_NODES[source].variant;
    for (const target of CONTENT_FORMATS) {
      const targetVariant = FORMAT_NODES[target].variant;
      if (targetVariant === variant) {
        addDirected(source, target, 1);
      } else if (TRANSFORMS[`${variant}->${targetVariant}`] !== undefined) {
        addDirected(source, target, 2);
      }
    }
    if (LAYOUT_CAPABLE.has(source)) {
      addDirected(source, "pdf", THROUGH_PDF_EDGE_COST);
    }
  }

  return adj;
}

// Standard Dijkstra over the small (<= 16-node) composition graph. Returns the ordered node path from source to target, or undefined if source === target or target is unreachable.
let compositionGraphCache:
  ReadonlyMap<DocumentFormat, readonly GraphEdge[]> | undefined;

function compositionGraph(): ReadonlyMap<DocumentFormat, readonly GraphEdge[]> {
  compositionGraphCache ??= buildCompositionGraph();
  return compositionGraphCache;
}

export function shortestPath(
  source: DocumentFormat,
  target: DocumentFormat,
): readonly DocumentFormat[] | undefined {
  if (source === target) {
    return undefined;
  }
  const distances = new Map<DocumentFormat, number>([[source, 0]]);
  const previous = new Map<DocumentFormat, DocumentFormat | undefined>();
  const visited = new Set<DocumentFormat>();
  while (true) {
    let current: DocumentFormat | undefined = undefined;
    let currentDist = Infinity;
    for (const [node, dist] of distances) {
      if (!visited.has(node) && dist < currentDist) {
        current = node;
        currentDist = dist;
      }
    }
    if (current === undefined || current === target) {
      break;
    }
    visited.add(current);
    for (const edge of compositionGraph().get(current) ?? []) {
      if (visited.has(edge.to)) {
        continue;
      }
      const alt = currentDist + edge.cost;
      const known = distances.get(edge.to);
      if (known === undefined || alt < known) {
        distances.set(edge.to, alt);
        previous.set(edge.to, current);
      }
    }
  }
  if (distances.get(target) === undefined) {
    return undefined;
  }
  const path: DocumentFormat[] = [];
  let cursor: DocumentFormat | undefined = target;
  while (cursor !== undefined) {
    path.unshift(cursor);
    cursor = previous.get(cursor);
  }
  return path;
}

// Resolves the minimum-cost path between two DocumentFormats as an ordered hop list, or undefined if no route exists. Each hop is tagged with the executor that runs it (derivable from which endpoint is pdf: target pdf -> toPdf, source pdf -> fromPdf, otherwise bridge). Capped at 3 hops — the most any real route needs (markdown -> xlsx = markdown -> ods bridge, ods -> pdf toPdf, pdf -> xlsx fromPdf, three hops; the reverse xlsx -> markdown is a single bridge hop instead, since ExaDev/documents.js#1043's one-way spreadsheet->wordprocessing transform has no reverse entry to route markdown -> xlsx through), and the bound beyond which a composed route would stack more lossy layers than any existing conversion in this package does today. Reproduces every route convert.ts's own functions handle: docx -> pdf is a direct toPdf hop; odt -> docx is a same-variant bridge; docx -> pptx is a cross-variant transform bridge; xlsx -> pdf is [xlsx -> ods bridge, ods -> pdf toPdf]; markdown -> xlsx is [markdown -> ods, ods -> pdf, pdf -> xlsx].
export function resolveCompositionPlan(
  source: DocumentFormat,
  target: DocumentFormat,
): ConversionPlan | undefined {
  const path = shortestPath(source, target);
  if (path === undefined) {
    return undefined;
  }
  // path.length includes both endpoints: 2 nodes = 1 hop, 4 nodes = 3 hops (the cap).
  if (path.length > MAX_CONVERSION_PATH_NODES) {
    return undefined;
  }
  const hops: CompositionHop[] = [];
  for (let i = 0; i + 1 < path.length; i++) {
    const from = path[i];
    const to = path[i + 1];
    if (from === undefined || to === undefined) {
      return undefined;
    }
    const executor: HopExecutor =
      to === "pdf" ? "toPdf" : from === "pdf" ? "fromPdf" : "bridge";
    hops.push({ executor, from, to });
  }
  return { hops };
}

// Narrows a DocumentFormat to the ContentFormat union (the fourteen formats with a FORMAT_NODES entry) — the type every hop's TARGET must be, since a target is built and encoded. pdf, odf, and every read-only format are excluded: pdf is the layout pivot reached only via toPdf/fromPdf edges, odf is the special-case format this engine does not route at all, and a read-only format has no build half to be a target with.
export function isContentFormat(
  format: DocumentFormat,
): format is ContentFormat {
  return (
    format !== "pdf" && format !== "odf" && !isReadOnlyContentFormat(format)
  );
}

// The same narrowing for a hop's SOURCE, which may additionally be a read-only format. Used by runCompositionPlan for the `from` endpoint of a bridge or toPdf hop, where isContentFormat covers the `to`.
export function isSourceContentFormat(
  format: DocumentFormat,
): format is SourceContentFormat {
  return isContentFormat(format) || isReadOnlyContentFormat(format);
}
