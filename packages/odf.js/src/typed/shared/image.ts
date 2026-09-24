import type { ContentImageBlock } from "document-schema.js";

// Reached only if ContentImageBlock's own format ever gains a member imageExtension's own switch does not match: every current member is covered there, so `value` narrows to `never` at the real call site, and adding an uncovered format makes that narrowing fail and this call stop compiling. That is the real safety net. Exported so image.test.ts can exercise the throw directly with a forced-invalid cast: it is otherwise unreachable, since every real format is already handled by a case in imageExtension.
export function assertNeverImageFormat(value: never): never {
  throw new Error(
    `imageExtension: unhandled image format ${JSON.stringify(value)}`,
  );
}

// The file extension a written image part gets named with. This never drives ODF's own media-type classification — buildManifest (src/manifest.ts) resolves that from the part's actual bytes via sniffImageFormat — but a correct extension still matters for round-tripping through tools that DO trust it, and for a human inspecting the package's own zip listing.
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
  return assertNeverImageFormat(format);
}
