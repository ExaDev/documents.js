import type { Package } from "ooxml.js";
import { bytesToBase64 } from "ooxml.js";
import { buildRelativeTarget } from "./paths";
import { addRelationship } from "./rels";
import {
  defaultContentTypeForExtension,
  ensureDefaultContentType,
} from "./content-types";

const IMAGE_RELATIONSHIP_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";

export interface AddedMedia {
  readonly partPath: string;
  readonly relationshipId: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function nextMediaIndex(
  pkg: Package,
  mediaDir: string,
  fileNamePrefix: string,
  extension: string,
): number {
  const pattern = new RegExp(
    `^${escapeRegExp(fileNamePrefix)}(\\d+)\\.${escapeRegExp(extension)}$`,
  );
  const prefix = `${mediaDir}/`;
  let max = 0;
  for (const path of Object.keys(pkg.parts)) {
    if (!path.startsWith(prefix)) {
      continue;
    }
    const match = pattern.exec(path.slice(prefix.length));
    if (match === null) {
      continue;
    }
    const digits = match[1];
    if (digits === undefined) {
      continue;
    }
    const n = Number.parseInt(digits, 10);
    if (n > max) {
      max = n;
    }
  }
  return max + 1;
}

// Adds a binary image part, ensures its extension has a [Content_Types].xml Default entry, and adds a relationship from the referencing part to it -- the three package-level effects a new inline image needs, performed together so a caller can never end up with only some of them (e.g. a media part with no content-type entry, which is the single most common reason a hand-built OOXML package fails to open). The caller is still responsible for inserting the format-specific drawing fragment (w:drawing / p:pic) that references the returned relationship id -- that part is docx/pptx-specific and lives in src/edit/*/image.ts.
export function addImageMedia(
  pkg: Package,
  fromPartPath: string,
  mediaDir: string, // e.g. 'word/media' or 'ppt/media'
  format: "png" | "jpeg",
  bytes: Uint8Array<ArrayBuffer>,
): AddedMedia {
  const extension = format === "jpeg" ? "jpeg" : "png";
  const fileNamePrefix = "image";
  const index = nextMediaIndex(pkg, mediaDir, fileNamePrefix, extension);
  const partPath = `${mediaDir}/${fileNamePrefix}${index}.${extension}`;
  pkg.parts[partPath] = { kind: "binary", base64: bytesToBase64(bytes) };
  ensureDefaultContentType(
    pkg,
    extension,
    defaultContentTypeForExtension(extension),
  );
  const target = buildRelativeTarget(fromPartPath, partPath);
  const relationshipId = addRelationship(pkg, fromPartPath, {
    type: IMAGE_RELATIONSHIP_TYPE,
    target,
  });
  return { partPath, relationshipId };
}
