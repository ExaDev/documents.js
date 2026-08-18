import { isPackageGroup, type PackageNode } from './package-node';

// Resolves one tree node to its EFFECTIVE properties -- the values that govern rendering and comparison once every inheritance layer has been applied. Today that is the identity: no style layer exists yet (referenced/inheritable styles arrive with the document-schema.js major that carries the tree promotion, ExaDev/document-schema.js#21), so a node's effective properties simply are its own. The function exists now, rather than being added later, so that every consumer that must not care about the difference -- the bijection law tests (law ii is resolve-then-compare, not raw equality) and the content-hash helper (hashes stay stable across serialisation choices because they hash resolved properties) -- already routes through the one seam where the overlay chain will land.
export function effective<T extends PackageNode>(node: T): T {
  return node;
}

// Resolves a whole tree: every node, root first, passes through effective(). Today this is the identity walk -- resolution changes nothing, so each subtree returns its own root reference and nothing is copied -- but the walk still visits every node, because "resolve every node of the tree" is the contract the bijection laws and hash consumers rely on. When the styles major lands, resolution starts producing overlay-merged nodes and this same walk returns resolved trees; assertions already expressed over effectiveTree then compare resolved properties without being rewritten.
export function effectiveTree(nodes: readonly PackageNode[]): PackageNode[] {
  return nodes.map(resolveSubtree);
}

function resolveSubtree(node: PackageNode): PackageNode {
  const resolved = effective(node);
  if (!isPackageGroup(resolved)) return resolved;
  for (const child of resolved.children) resolveSubtree(child);
  return resolved;
}
