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

// experimental_transfer's transfer list is moved by reference, not copied: every ArrayBuffer it names is detached from its original Uint8Array once postMessage runs. Called from the client's outgoing (request) direction only (src/rpc/client.ts) -- it replaces each Uint8Array it finds with a fresh copy *inside the message about to be sent*, so the transfer detaches that throwaway copy instead of the caller's own retained buffer (e.g. an uploaded file's bytes, which the UI reuses across converting to several targets, reading metadata, etc.). The worker's response direction (src/workers/documents.worker.ts) uses collectTransferableBuffers directly instead -- a result's bytes are never needed again on that side, so detaching the original there is fine and avoids an unnecessary copy.
export function cloneAndCollectTransferableBuffers(value: unknown, found: ArrayBufferLike[] = []): ArrayBufferLike[] {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const item: unknown = value[index];
      if (item instanceof Uint8Array) {
        const clone = new Uint8Array(item);
        value[index] = clone;
        found.push(clone.buffer);
      } else {
        cloneAndCollectTransferableBuffers(item, found);
      }
    }
  } else if (isRecord(value)) {
    for (const key of Object.keys(value)) {
      const item = value[key];
      if (item instanceof Uint8Array) {
        const clone = new Uint8Array(item);
        value[key] = clone;
        found.push(clone.buffer);
      } else {
        cloneAndCollectTransferableBuffers(item, found);
      }
    }
  }
  return found;
}
