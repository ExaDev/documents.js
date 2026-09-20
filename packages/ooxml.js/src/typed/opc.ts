import type { Package } from "../model/package";
import type { Relationship } from "./util";
import { resolveRelationships, resolveRootRelationships } from "./util";

// Part resolution at the OPC (ECMA-376 Part 2) layer, below any one format's own markup: which part a package's body actually lives in, and which part another part reaches through a relationship of a given type. Both answers come from the relationship graph, never from a part's name. "word/document.xml", "xl/workbook.xml" and "ppt/presentation.xml" are conventions every Office producer follows, not requirements: OPC names the main part through the `officeDocument` relationship in "_rels/.rels", and Word opens a package whose body sits at "word/document2.xml" without complaint (ExaDev/documents.js#1314). Each reader keeps its own conventional path only as the documented fallback for a package that declares no usable relationship at all.
//
// Relationship types are matched by their final segment rather than by a full URI. ECMA-376 defines two parallel namespaces for the identical relationship -- the transitional "http://schemas.openxmlformats.org/officeDocument/2006/relationships/..." every mainstream producer writes, and the strict "http://purl.oclc.org/ooxml/officeDocument/relationships/..." -- so suffix matching resolves both, and it is the convention the format readers here already use for theme, slide-layout and drawing relationships.

// The relationship a package's root declares to its main document part.
export const OFFICE_DOCUMENT_REL_SUFFIX = "/officeDocument";

// Whether the package genuinely holds a part under this exact key. An own-property test, not an `undefined` comparison: Package.parts is an ordinary object, so a Target naming an inherited member ("constructor", "toString") would otherwise index a function off Object.prototype and read as a part that exists.
export function hasPart(pkg: Package, partPath: string): boolean {
  return Object.hasOwn(pkg.parts, partPath);
}

// The part `fromPartPath` reaches through a relationship whose type ends with `relationshipTypeSuffix`, or undefined when it declares no usable one. An external target (TargetMode="External", e.g. a hyperlink URL) is not a part and is skipped; so is a target naming a part the package does not actually hold, so several declared relationships of the same type resolve to the first that leads somewhere real rather than to a dangling first entry.
export function findRelatedPartPath(
  pkg: Package,
  fromPartPath: string,
  relationshipTypeSuffix: string,
): string | undefined {
  return firstResolvableTarget(
    pkg,
    resolveRelationships(pkg, fromPartPath),
    relationshipTypeSuffix,
  );
}

// The package's main document part, named by the root `officeDocument` relationship, or undefined when the package declares none that leads to a part it holds.
export function findMainPartPath(pkg: Package): string | undefined {
  return firstResolvableTarget(
    pkg,
    resolveRootRelationships(pkg),
    OFFICE_DOCUMENT_REL_SUFFIX,
  );
}

function firstResolvableTarget(
  pkg: Package,
  relationships: ReadonlyMap<string, Relationship>,
  relationshipTypeSuffix: string,
): string | undefined {
  for (const relationship of relationships.values()) {
    if (
      relationship.type.endsWith(relationshipTypeSuffix) &&
      relationship.targetMode !== "External" &&
      hasPart(pkg, relationship.target)
    ) {
      return relationship.target;
    }
  }
  return undefined;
}
