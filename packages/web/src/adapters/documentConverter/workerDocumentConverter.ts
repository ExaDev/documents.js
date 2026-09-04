import type { DocumentFormat } from "documents.js";

import { getRpcClient } from "../../rpc/client";

export interface ConvertInput {
  source: DocumentFormat;
  targetFormat: DocumentFormat;
  bytes: Uint8Array<ArrayBuffer>;
  signal?: AbortSignal;
}

// Thin call-through to the oRPC/Worker boundary -- the actual convert logic lives in src/rpc/router.ts, which runs inside src/workers/documents.worker.ts.
export function convertViaWorker(input: ConvertInput) {
  return getRpcClient().convert(
    {
      source: input.source,
      targetFormat: input.targetFormat,
      bytes: input.bytes,
    },
    { signal: input.signal },
  );
}
