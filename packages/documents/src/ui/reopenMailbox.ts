import type { DocumentFormat } from "documents.js";

import type { OpenedFile } from "../ports/fileAccess";

export interface PendingReopen {
  file: OpenedFile;
  format: DocumentFormat;
}

// A write-once, read-once handoff for Recent Files' "Reopen" action: Convert's file state is local to its own route component (deliberately, per convert.tsx's own comment -- it never remounts across pair changes), so there's no existing store to carry an OpenedFile across a navigation. A module-level singleton is safe here specifically because this is a single-tab, client-only SPA with no SSR and no concurrent route instances -- setPendingReopen is called immediately before a navigate(), and takePendingReopen is read exactly once by the destination route's lazy state initializer.
let pending: PendingReopen | undefined;

export function setPendingReopen(entry: PendingReopen) {
  pending = entry;
}

export function takePendingReopen(): PendingReopen | undefined {
  const entry = pending;
  pending = undefined;
  return entry;
}
