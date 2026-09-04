import { RPCHandler } from "@orpc/server/message-port";

import { router } from "../rpc/router";
import { collectTransferableBuffers } from "../shared/transferables";

// This is the one runtime entry point allowed to import documents.js's real conversion functions on the "server" side of the oRPC boundary -- see src/rpc/router.ts for the procedures and src/rpc/client.ts for the main-thread caller.
const handler = new RPCHandler(router, {
  // Mirrors the client's experimental_transfer (src/rpc/client.ts): restores real Uint8Array instances on this side of the boundary and moves document bytes by reference instead of copying them.
  experimental_transfer: (message) => {
    const transfer = collectTransferableBuffers(message);
    return transfer.length > 0 ? transfer : null;
  },
});
handler.upgrade(self, { context: () => ({}) });
