import type { CanonicalPart, OpcCanonicalForm } from "./opc-package";

/**
 * How two packages differ part by part once lexical difference is gone, with the parts that differ only in identifiers or in document properties kept apart from the ones whose canonical content differs. Every list is in part-name order.
 *
 * None of this is a content verdict: a writer regenerates styles, themes and settings, so `differing` is expected to be long for any rewrite. Content is judged by `compareProjections`; this report is what remains to be explained.
 */
export interface PartDifferences {
  /** Present in both with equal canonical content. */
  readonly identical: readonly string[];
  /** Equal once identifier and revision-stamp attributes are left out: only identifiers differ. */
  readonly identifierOnly: readonly string[];
  /** Document property parts (`docProps/`) whose values differ: metadata, not content. */
  readonly metadata: readonly string[];
  /** Present in both with different canonical content. */
  readonly differing: readonly string[];
  /** In the original only. */
  readonly missing: readonly string[];
  /** In the rewrite only. */
  readonly added: readonly string[];
  /** Parts one side could not read, so nothing is known of how they compare. */
  readonly undetermined: readonly string[];
}

function compareNames(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  return left > right ? 1 : 0;
}

function classifyPair(
  name: string,
  original: CanonicalPart,
  rewrite: CanonicalPart,
): keyof PartDifferences {
  if (original.kind === "skipped" || rewrite.kind === "skipped") {
    return "undetermined";
  }
  if (original.digest === rewrite.digest) {
    return "identical";
  }
  if (name.startsWith("docProps/")) {
    return "metadata";
  }
  if (
    original.kind === "xml" &&
    rewrite.kind === "xml" &&
    original.identifierFreeDigest === rewrite.identifierFreeDigest
  ) {
    return "identifierOnly";
  }
  return "differing";
}

/** Compares two canonical package forms part by part. See `PartDifferences` for what each list means and does not mean. */
export function comparePartDigests(
  original: OpcCanonicalForm,
  rewrite: OpcCanonicalForm,
): PartDifferences {
  const lists: Record<keyof PartDifferences, string[]> = {
    identical: [],
    identifierOnly: [],
    metadata: [],
    differing: [],
    missing: [],
    added: [],
    undetermined: [],
  };
  for (const [name, before] of original.parts) {
    const after = rewrite.parts.get(name);
    if (after === undefined) {
      lists.missing.push(name);
    } else {
      lists[classifyPair(name, before, after)].push(name);
    }
  }
  for (const name of rewrite.parts.keys()) {
    if (!original.parts.has(name)) {
      lists.added.push(name);
    }
  }
  return {
    identical: lists.identical.sort(compareNames),
    identifierOnly: lists.identifierOnly.sort(compareNames),
    metadata: lists.metadata.sort(compareNames),
    differing: lists.differing.sort(compareNames),
    missing: lists.missing.sort(compareNames),
    added: lists.added.sort(compareNames),
    undetermined: lists.undetermined.sort(compareNames),
  };
}
