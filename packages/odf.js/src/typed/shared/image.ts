import type { ContentImageBlock } from "document-schema.js";

// The file extension a written image part gets named with. This never drives ODF's own media-type classification -- buildManifest (src/manifest.ts) resolves that from the part's actual bytes via sniffImageFormat -- but a correct extension still matters for round-tripping through tools that DO trust it, and for a human inspecting the package's own zip listing.
export function imageExtension(format: ContentImageBlock["format"]): string {
  switch (format) {
    case "png":
      return "png";
    case "jpeg":
      return "jpg";
    case "svg":
      return "svg";
    case "gif":
      return "gif";
  }
}
