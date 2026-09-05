import { z } from "zod";
import type { XmlElement, XmlNode } from "./model/node";
import type { Package } from "./model/package";
import { xmlnsAttributes } from "./ns";
import { mediaTypeForExtension } from "./media-type";
import { sniffImageFormat } from "./image/sniff";
import { readMimetype, writeMimetype } from "./mimetype";
import { el } from "./xml/fragment";
import { encodeXmlText } from "./xml/entities";
import { base64ToBytes } from "./util/base64";
import { MANIFEST_PART, MIMETYPE_PART } from "./package-io/write";

// odf.js diverges from ooxml.js here deliberately: ooxml.js only ever READS OPC relationships (its own typed readers are one-way; writing new relationships/content-type entries is documents.js's job, a separate downstream package). odf.js has no such downstream package -- it owns both reading AND writing the manifest itself, because META-INF/manifest.xml is the one part every ODF package unconditionally requires, and getting its content right (every part listed, every media type correct, the root entry's type tied to the mimetype part) is exhaustive enough to need first-class support, not something left to a caller to hand-assemble from raw XML.

export const ManifestEntrySchema = z.object({
  fullPath: z.string(),
  mediaType: z.string(),
  // manifest:version is optional on any manifest:file-entry per the OASIS spec; in practice it is set on the root ("/") entry (mirroring manifest:manifest's own required version) and, for composite documents, on an embedded sub-document's own directory entry.
  version: z.string().optional(),
});
export type ManifestEntry = z.infer<typeof ManifestEntrySchema>;

export const ManifestSchema = z.object({
  // manifest:manifest's own required manifest:version attribute -- the ODF package format version this manifest conforms to (e.g. "1.3"). Namespace URIs never carry version info (see ns.ts); this attribute is where it actually lives.
  version: z.string(),
  entries: z.array(ManifestEntrySchema),
});
export type Manifest = z.infer<typeof ManifestSchema>;

export const ManifestProblemSchema = z.object({
  severity: z.enum(["error", "warning"]),
  message: z.string(),
  path: z.string().optional(),
});
export type ManifestProblem = z.infer<typeof ManifestProblemSchema>;

// The current OASIS OpenDocument Format standard version, used as buildManifest/setDocumentMediaType's default when the caller supplies none.
const DEFAULT_MANIFEST_VERSION = "1.3";

const STANDARD_XML_PART_NAMES = new Set([
  "content.xml",
  "styles.xml",
  "meta.xml",
  "settings.xml",
]);

function findChildElement(
  nodes: readonly XmlNode[],
  tag: string,
): XmlElement | undefined {
  for (const node of nodes) {
    if (node.type === "element" && node.tag === tag) {
      return node;
    }
  }
  return undefined;
}

function attrValue(element: XmlElement, name: string): string | undefined {
  return element.attributes.find((attribute) => attribute.name === name)?.value;
}

// Reads META-INF/manifest.xml into a structured Manifest. Throws for a package that has no manifest part, or one whose XML does not carry the elements/attributes the ODF spec requires (no manifest:manifest root, or a manifest:file-entry missing its required manifest:full-path/manifest:media-type) -- unlike validateManifest, this is a strict parse, not a diagnostics collector.
export function readManifest(pkg: Package): Manifest {
  const part = pkg.parts[MANIFEST_PART];
  if (part?.kind !== "xml") {
    throw new Error(`package has no ${MANIFEST_PART} XML part to read`);
  }
  const root = findChildElement(part.nodes, "manifest:manifest");
  if (root === undefined) {
    throw new Error(`${MANIFEST_PART} has no manifest:manifest root element`);
  }
  const version = attrValue(root, "manifest:version");
  if (version === undefined) {
    throw new Error(
      `${MANIFEST_PART}'s manifest:manifest root is missing the required manifest:version attribute`,
    );
  }

  const entries: ManifestEntry[] = [];
  for (const child of root.children) {
    if (child.type !== "element" || child.tag !== "manifest:file-entry") {
      continue;
    }
    const fullPath = attrValue(child, "manifest:full-path");
    const mediaType = attrValue(child, "manifest:media-type");
    if (fullPath === undefined || mediaType === undefined) {
      throw new Error(
        `${MANIFEST_PART} has a manifest:file-entry missing manifest:full-path or manifest:media-type`,
      );
    }
    const entryVersion = attrValue(child, "manifest:version");
    entries.push(
      entryVersion === undefined
        ? { fullPath, mediaType }
        : { fullPath, mediaType, version: entryVersion },
    );
  }
  return { version, entries };
}

// A directory earns its own manifest:file-entry only when the package genuinely contains a "<dir>/content.xml" part -- the one real signal (per the OASIS spec and real-world LibreOffice output) that the directory is an embedded sub-document's own root, not just a plain folder of media (e.g. "Pictures/", which real ODF packages never list). Never synthesized for any other directory prefix.
function subdocumentDirectories(partPaths: readonly string[]): string[] {
  const dirs: string[] = [];
  for (const path of partPaths) {
    if (path.endsWith("/content.xml")) {
      dirs.push(path.slice(0, path.length - "content.xml".length));
    }
  }
  return dirs;
}

function resolvePartMediaType(
  path: string,
  bytes: Uint8Array<ArrayBuffer> | undefined,
  overrides: Readonly<Record<string, string>> | undefined,
): string {
  const override = overrides?.[path];
  if (override !== undefined) {
    return override;
  }

  const baseName = path.slice(path.lastIndexOf("/") + 1);
  if (STANDARD_XML_PART_NAMES.has(baseName)) {
    return "text/xml";
  }

  const dotIndex = baseName.lastIndexOf(".");
  const extension = dotIndex === -1 ? "" : baseName.slice(dotIndex + 1);
  const byExtension =
    extension === "" ? undefined : mediaTypeForExtension(extension);
  if (byExtension !== undefined) {
    return byExtension;
  }

  if (bytes !== undefined) {
    const sniffed = sniffImageFormat(bytes);
    if (sniffed === "png") {
      return "image/png";
    }
    if (sniffed === "jpeg") {
      return "image/jpeg";
    }
    if (sniffed === "gif") {
      return "image/gif";
    }
    if (sniffed === "svg") {
      return "image/svg+xml";
    }
  }

  // LibreOffice's own real-world behaviour for a part it cannot otherwise classify -- not "application/octet-stream", which LibreOffice never actually emits here.
  return "";
}

export interface BuildManifestOptions {
  // Overrides the root ("/") entry's media type; defaults to the package's existing "mimetype" part (readMimetype(pkg)). Required (one way or the other) since buildManifest has no way to guess a document's own ODF variant from its parts alone.
  documentMediaType?: string;
  // manifest:manifest's own manifest:version, and the version stamped on the root entry. Defaults to DEFAULT_MANIFEST_VERSION.
  version?: string;
  // fullPath -> media type, for any part (including a subdocument directory) whose type buildManifest's automatic resolution cannot determine on its own -- most notably an embedded sub-document's directory entry, whose own ODF variant is not recoverable from its parts without reading its own content.
  mediaTypeOverrides?: Readonly<Record<string, string>>;
}

// Exhaustive derivation of a Manifest from a package's actual parts: a root ("/") entry carrying the package's own media type, one entry per remaining part (excluding manifest.xml and mimetype, which are never self-listed), plus a directory entry for each genuine embedded-subdocument directory (see subdocumentDirectories). Deterministic and side-effect-free -- callers combine it with writeManifest (or call syncManifest, which does both) to actually persist the result.
export function buildManifest(
  pkg: Package,
  options: BuildManifestOptions = {},
): Manifest {
  const version = options.version ?? DEFAULT_MANIFEST_VERSION;
  const documentMediaType = options.documentMediaType ?? readMimetype(pkg);
  if (documentMediaType === undefined) {
    throw new Error(
      'buildManifest: package has no "mimetype" part and no documentMediaType override was supplied -- the manifest root entry requires a known document media type',
    );
  }

  const entries: ManifestEntry[] = [
    { fullPath: "/", mediaType: documentMediaType, version },
  ];

  const partPaths = Object.keys(pkg.parts);
  for (const dir of new Set(subdocumentDirectories(partPaths))) {
    entries.push({
      fullPath: dir,
      mediaType: resolvePartMediaType(
        dir,
        undefined,
        options.mediaTypeOverrides,
      ),
    });
  }

  for (const [path, part] of Object.entries(pkg.parts)) {
    if (path === MIMETYPE_PART || path === MANIFEST_PART) {
      continue;
    }
    const bytes =
      part.kind === "binary" ? base64ToBytes(part.base64) : undefined;
    entries.push({
      fullPath: path,
      mediaType: resolvePartMediaType(path, bytes, options.mediaTypeOverrides),
    });
  }

  return { version, entries };
}

function buildManifestNodes(manifest: Manifest): XmlNode[] {
  const fileEntries: XmlElement[] = manifest.entries.map((entry) => {
    const attrs: Record<string, string> = {
      "manifest:full-path": encodeXmlText(entry.fullPath),
    };
    if (entry.version !== undefined) {
      attrs["manifest:version"] = encodeXmlText(entry.version);
    }
    attrs["manifest:media-type"] = encodeXmlText(entry.mediaType);
    return el("manifest:file-entry", attrs);
  });
  const root = el(
    "manifest:manifest",
    {
      ...xmlnsAttributes(["manifest"]),
      "manifest:version": encodeXmlText(manifest.version),
    },
    fileEntries,
  );
  return [
    {
      type: "declaration",
      attributes: [
        { name: "version", value: "1.0" },
        { name: "encoding", value: "UTF-8" },
      ],
    },
    root,
  ];
}

// Serializes a Manifest to XML and sets (or replaces) the package's META-INF/manifest.xml part. Pure with respect to every other part -- it never touches "mimetype" or any content part.
export function writeManifest(pkg: Package, manifest: Manifest): void {
  pkg.parts[MANIFEST_PART] = {
    kind: "xml",
    nodes: buildManifestNodes(manifest),
  };
}

// build + write in one call. Idempotent: calling it twice in a row with the same options produces byte-identical manifest.xml both times, because buildManifest excludes manifest.xml itself from its own derivation and nothing else about the package changes between the two calls.
export function syncManifest(
  pkg: Package,
  options?: BuildManifestOptions,
): void {
  writeManifest(pkg, buildManifest(pkg, options));
}

// Non-throwing diagnostics: a manifest that fails to parse, is missing its root entry, whose root entry's media type disagrees with the mimetype part, that lists a part the package doesn't have (or omits one it does), or that carries manifest:encryption-data on any entry (an ODF feature this package does not implement decryption for). Never throws -- every failure mode becomes a problem entry instead.
export function validateManifest(pkg: Package): ManifestProblem[] {
  const problems: ManifestProblem[] = [];

  const manifestPart = pkg.parts[MANIFEST_PART];
  if (manifestPart === undefined) {
    problems.push({
      severity: "error",
      message: `package has no ${MANIFEST_PART} part`,
    });
    return problems;
  }
  if (manifestPart.kind !== "xml") {
    problems.push({
      severity: "error",
      message: `${MANIFEST_PART} part is not XML`,
    });
    return problems;
  }
  const root = findChildElement(manifestPart.nodes, "manifest:manifest");
  if (root === undefined) {
    problems.push({
      severity: "error",
      message: `${MANIFEST_PART} has no manifest:manifest root element`,
    });
    return problems;
  }

  let manifest: Manifest;
  try {
    manifest = readManifest(pkg);
  } catch (error) {
    problems.push({
      severity: "error",
      message: `failed to parse ${MANIFEST_PART}: ${error instanceof Error ? error.message : String(error)}`,
    });
    return problems;
  }

  const rootEntry = manifest.entries.find((entry) => entry.fullPath === "/");
  if (rootEntry === undefined) {
    problems.push({
      severity: "error",
      message: 'manifest has no root ("/") entry',
    });
  } else {
    const documentMediaType = readMimetype(pkg);
    if (
      documentMediaType !== undefined &&
      documentMediaType !== rootEntry.mediaType
    ) {
      problems.push({
        severity: "error",
        message: `manifest root entry media type "${rootEntry.mediaType}" does not match the mimetype part's media type "${documentMediaType}"`,
        path: "/",
      });
    }
  }

  const partPaths = new Set(
    Object.keys(pkg.parts).filter(
      (path) => path !== MIMETYPE_PART && path !== MANIFEST_PART,
    ),
  );
  const manifestPaths = new Set(
    manifest.entries.map((entry) => entry.fullPath),
  );

  for (const entry of manifest.entries) {
    // Root and directory entries have no literal corresponding zip part -- "/" is the package itself, and a directory entry describes a prefix, not a physical entry.
    if (entry.fullPath === "/" || entry.fullPath.endsWith("/")) {
      continue;
    }
    if (!partPaths.has(entry.fullPath)) {
      problems.push({
        severity: "warning",
        message: `manifest lists "${entry.fullPath}" but the package has no such part`,
        path: entry.fullPath,
      });
    }
  }
  for (const path of partPaths) {
    if (!manifestPaths.has(path)) {
      problems.push({
        severity: "warning",
        message: `package has part "${path}" not listed in the manifest`,
        path,
      });
    }
  }

  for (const child of root.children) {
    if (child.type !== "element" || child.tag !== "manifest:file-entry") {
      continue;
    }
    const hasEncryptionData = child.children.some(
      (grandchild) =>
        grandchild.type === "element" &&
        grandchild.tag === "manifest:encryption-data",
    );
    if (!hasEncryptionData) {
      continue;
    }
    const fullPath = attrValue(child, "manifest:full-path");
    if (fullPath === undefined) {
      continue; // already surfaced above by readManifest's own required-attribute check
    }
    problems.push({
      severity: "warning",
      message: `entry "${fullPath}" carries manifest:encryption-data -- odf.js does not implement ODF encryption/decryption`,
      path: fullPath,
    });
  }

  return problems;
}

// Atomically updates BOTH sides of the ODF spec's conditional MUST tying the manifest root entry's media type to the "mimetype" part's own bytes -- and keeps manifest:manifest's own manifest:version and the root entry's manifest:version in step with each other, since real-world ODF packages never let those diverge. Creates a minimal one-entry manifest if the package has none yet.
export function setDocumentMediaType(
  pkg: Package,
  mediaType: string,
  version: string = DEFAULT_MANIFEST_VERSION,
): void {
  writeMimetype(pkg, mediaType);

  const rootEntry: ManifestEntry = { fullPath: "/", mediaType, version };
  const existingManifestPart = pkg.parts[MANIFEST_PART];
  if (existingManifestPart === undefined) {
    writeManifest(pkg, { version, entries: [rootEntry] });
    return;
  }

  const existing = readManifest(pkg);
  const rootIndex = existing.entries.findIndex(
    (entry) => entry.fullPath === "/",
  );
  const entries =
    rootIndex === -1
      ? [rootEntry, ...existing.entries]
      : existing.entries.map((entry, index) =>
          index === rootIndex ? rootEntry : entry,
        );
  writeManifest(pkg, { version, entries });
}
