import { expect } from "vitest";
import type { ContentDocument, DocumentTree } from "document-schema.js";
import {
  DocumentTreeSchema,
  factorStyles,
  flattenTree,
} from "document-schema.js";

// The shared round-trip harness each package-native reader's own suite runs over its format's real fixture, so the five readers are held to one contract stated once rather than five paraphrases of it. Never imported by src/index.ts and never reaches dist/ -- test-only, matching test-support/zip.ts's own convention.
//
// Every assertion here is a real property of the value, never a no-throw smoke check:
//
// 1. SCHEMA VALIDITY, at the envelope and at every group node, though not at a leaf. DocumentTreeSchema.parse walks the tree through document-schema.js's own isTreeGroup/isTreeLeaf guards, so comparing the parsed value back against the input proves the package satisfies that structure. A group descriptor is `.strict()` and isGroupWrapper restricts a group node's own keys to node/style/children, so a stray key on a GROUP node is rejected outright and the parse throws. A leaf is validated by a z.custom guard, which returns the input unchanged on success rather than a stripped, reparsed value -- a stray key on a LEAF is neither rejected nor stripped, so this comparison cannot catch one there.
// 2. THE ROUND TRIP ITSELF. flattenTree(assembleTree(content)) reproduces `content` exactly -- law (i) of the package boundary, and the strongest round trip odf.js can state today: this package has readers and no writers, so bytes -> package -> bytes has no second half to run. What IS provable is that nothing is lost or invented crossing the boundary in the direction that does exist: real ODF bytes -> Package -> the flat ContentDocument the *Content reader produces -> the tree -> back to a ContentDocument that must deep-equal the flat one, refs resolved, groups dissolved, document order intact.
// 3. MINTING IDEMPOTENCE. factorStyles re-factors an already-assembled package and must mint the identical table -- law (iii). Run over real fixture content rather than synthetic property tuples, this is what catches a styles table whose ids or strips depend on anything but the content itself.
export function assertPackageRoundTrip(
  pkg: DocumentTree,
  content: ContentDocument,
): void {
  expect(DocumentTreeSchema.parse(pkg)).toEqual(pkg);
  expect(flattenTree(pkg)).toEqual(content);
  expect(factorStyles(pkg)).toEqual(pkg);
}

// One narrower per package kind, so a suite reaching into a package's own tree (children, group nodes, refs) works against the arm its reader actually returns rather than the whole five-arm union. Each is a plain discriminated-union guard -- the throw IS the "this reader returns this kind" assertion, and narrowing by comparison is what keeps every caller free of type assertions, which this package bans outright. Written out one per kind rather than as one kind-parameterised helper on purpose: TypeScript narrows a union against a LITERAL discriminant, not against a generic type parameter, so the generic form would only typecheck behind exactly the assertion this avoids.
type PackageOfKind<K extends DocumentTree["kind"]> = Extract<
  DocumentTree,
  { kind: K }
>;

export function wordprocessingPackage(
  pkg: DocumentTree,
): PackageOfKind<"wordprocessing"> {
  if (pkg.kind !== "wordprocessing") {
    throw new Error(`expected a wordprocessing package, got ${pkg.kind}`);
  }
  return pkg;
}

export function presentationPackage(
  pkg: DocumentTree,
): PackageOfKind<"presentation"> {
  if (pkg.kind !== "presentation") {
    throw new Error(`expected a presentation package, got ${pkg.kind}`);
  }
  return pkg;
}

export function spreadsheetPackage(
  pkg: DocumentTree,
): PackageOfKind<"spreadsheet"> {
  if (pkg.kind !== "spreadsheet") {
    throw new Error(`expected a spreadsheet package, got ${pkg.kind}`);
  }
  return pkg;
}

export function drawingPackage(pkg: DocumentTree): PackageOfKind<"drawing"> {
  if (pkg.kind !== "drawing") {
    throw new Error(`expected a drawing package, got ${pkg.kind}`);
  }
  return pkg;
}

export function formulaPackage(pkg: DocumentTree): PackageOfKind<"formula"> {
  if (pkg.kind !== "formula") {
    throw new Error(`expected a formula package, got ${pkg.kind}`);
  }
  return pkg;
}
