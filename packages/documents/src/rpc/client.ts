import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/message-port";
import type { RouterClient } from "@orpc/server";

import { cloneAndCollectTransferableBuffers } from "../shared/transferables";
import type { AppRouter } from "./router";

let cachedClient: RouterClient<AppRouter> | undefined;

// Lazily creates the single Worker + oRPC client pair for the app's lifetime. src/workers/workerPool.ts (added alongside the conversion pool) will replace this with a real pool for concurrent/cancellable jobs -- this minimal version proves the RPCLink/RPCHandler MessagePort boundary end to end for the flagship convert tool first.
export function getRpcClient(): RouterClient<AppRouter> {
  if (cachedClient !== undefined) return cachedClient;

  const worker = new Worker(
    new URL("../workers/documents.worker.ts", import.meta.url),
    { type: "module" },
  );
  const link = new RPCLink({
    port: worker,
    // Restores real Uint8Array instances across the boundary (see src/shared/transferables.ts). Clones before transferring so detaching the transferred buffer never invalidates bytes the caller still holds (e.g. an uploaded file reused across converting to several targets).
    experimental_transfer: (message) => {
      const transfer = cloneAndCollectTransferableBuffers(message);
      return transfer.length > 0 ? transfer : null;
    },
  });
  cachedClient = createORPCClient<RouterClient<AppRouter>>(link);
  return cachedClient;
}
