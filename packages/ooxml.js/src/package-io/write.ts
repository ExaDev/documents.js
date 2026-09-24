import type { Package, Part } from "../model/package";
import { base64ToBytes } from "byte-codec";
import { buildXml } from "../xml/build";
import { zipPackage } from "../zip";

export function serializePackage(pkg: Package): Uint8Array<ArrayBuffer> {
  const entries: Record<string, Uint8Array<ArrayBuffer>> = {};
  for (const [path, part] of Object.entries(pkg.parts)) {
    entries[path] = partToBytes(part);
  }
  return zipPackage(entries);
}

// Reached only if Part ever gains a variant partToBytes's own switch does not match: every current member is covered there, so `value` narrows to `never` at the real call site, and adding an uncovered kind makes that narrowing fail and this call stop compiling. That is the real safety net. Exported so write.test.ts can exercise the throw directly with a forced-invalid cast: it is otherwise unreachable, since every real Part kind is already handled by a case in partToBytes.
export function assertNeverPartKind(value: never): never {
  throw new Error(`partToBytes: unhandled Part kind ${JSON.stringify(value)}`);
}

function partToBytes(part: Part): Uint8Array<ArrayBuffer> {
  switch (part.kind) {
    case "xml":
      return new TextEncoder().encode(buildXml(part.nodes));
    case "binary":
      return base64ToBytes(part.base64);
  }
  return assertNeverPartKind(part);
}
