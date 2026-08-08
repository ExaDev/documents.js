function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// oRPC's message-port RPCLink/RPCHandler serialize payloads through their own JSON-oriented codec by default, which does not reconstruct Uint8Array instances on the receiving end -- a Uint8Array in a message arrives as a plain array-like object unless the codec is told which values are real binary buffers via `experimental_transfer`. This walker finds every Uint8Array in a message (however deeply nested inside the app's own RPC contract shapes) and returns its backing ArrayBuffer so both the client (src/rpc/client.ts) and the worker's handler (src/workers/documents.worker.ts) can pass it to `experimental_transfer`, restoring real Uint8Array instances across the boundary and moving large document buffers by reference rather than by copy.
export function collectTransferableBuffers(value: unknown, found: ArrayBufferLike[] = []): ArrayBufferLike[] {
  if (value instanceof Uint8Array) {
    found.push(value.buffer);
  } else if (Array.isArray(value)) {
    for (const item of value) collectTransferableBuffers(item, found);
  } else if (isRecord(value)) {
    for (const key of Object.keys(value)) {
      collectTransferableBuffers(value[key], found);
    }
  }
  return found;
}
