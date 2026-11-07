import {
  decodeXmlBytes,
  readOpcPart,
  sha256Hex,
  type OpcPartEntry,
} from "./opc-package";
import {
  BINARY_DIGEST_FACTORS,
  type MemoryBudget,
  PROJECTION_FACTORS,
} from "./memory-budget";
import { ProjectionBuilder } from "./projection";
import { scanXml, type XmlScanHandler } from "./xml-scan";

/** The pieces every projection walk shares: the package bytes, the one builder, the memory budget. */
export interface PartScanContext {
  readonly bytes: Uint8Array;
  readonly builder: ProjectionBuilder;
  readonly budget: MemoryBudget;
}

/**
 * Reads one XML part and scans it with a handler that writes into a scratch builder. The scratch is merged into the shared builder only when the scan reaches the end of the part, so a part that fails halfway contributes nothing; the failure is recorded as a skipped part (`unparsed:` plus the error's class name, never its message). A part the memory budget does not cover is recorded as skipped without being read.
 *
 * Returns whether the part was scanned to the end.
 */
export function scanPart(
  context: PartScanContext,
  entry: OpcPartEntry,
  makeHandler: (scratch: ProjectionBuilder) => XmlScanHandler,
): boolean {
  if (!context.budget.admit(entry.size, PROJECTION_FACTORS)) {
    context.builder.skip({
      name: entry.name,
      reason: "exceeds-memory-budget",
    });
    return false;
  }
  const scratch = new ProjectionBuilder(context.builder.format);
  try {
    scanXml(
      decodeXmlBytes(readOpcPart(context.bytes, entry.name)),
      makeHandler(scratch),
    );
  } catch (error) {
    context.builder.skip({
      name: entry.name,
      reason: `unparsed:${error instanceof Error ? error.name : typeof error}`,
    });
    return false;
  }
  context.builder.merge(scratch);
  return true;
}

/** Hashes one media or embedded part into the builder, respecting the memory budget (the part is held once while it is digested). */
export async function digestMediaPart(
  context: PartScanContext,
  entry: OpcPartEntry,
  kind: "image" | "embedding",
): Promise<void> {
  if (!context.budget.admit(entry.size, BINARY_DIGEST_FACTORS)) {
    context.builder.skip({
      name: entry.name,
      reason: "exceeds-memory-budget",
    });
    return;
  }
  context.builder.addMedia(
    kind,
    await sha256Hex(readOpcPart(context.bytes, entry.name)),
  );
}
