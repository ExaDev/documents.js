import { describe, expect, it } from "vitest";

import {
  cloneAndCollectTransferableBuffers,
  collectTransferableBuffers,
} from "./transferables";

describe("collectTransferableBuffers", () => {
  it("finds a top-level Uint8Array", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(collectTransferableBuffers({ bytes })).toEqual([bytes.buffer]);
  });

  it("finds Uint8Arrays nested inside objects and arrays", () => {
    const first = new Uint8Array([1]);
    const second = new Uint8Array([2]);
    const message = {
      document: { bytes: first },
      chapters: [{ bytes: second }],
    };
    expect(collectTransferableBuffers(message)).toEqual([
      first.buffer,
      second.buffer,
    ]);
  });

  it("returns an empty array when there is nothing to transfer", () => {
    expect(
      collectTransferableBuffers({ source: "docx", targetFormat: "pdf" }),
    ).toEqual([]);
  });

  it("ignores primitives, null, and non-Uint8Array values", () => {
    expect(collectTransferableBuffers("docx")).toEqual([]);
    expect(collectTransferableBuffers(null)).toEqual([]);
    expect(collectTransferableBuffers(42)).toEqual([]);
  });
});

describe("cloneAndCollectTransferableBuffers", () => {
  it("replaces a Uint8Array in the message with a clone and leaves the original untouched", () => {
    const original = new Uint8Array([1, 2, 3]);
    const message = { bytes: original };

    const transfer = cloneAndCollectTransferableBuffers(message);

    expect(message.bytes).not.toBe(original);
    expect(Array.from(message.bytes)).toEqual([1, 2, 3]);
    expect(transfer).toEqual([message.bytes.buffer]);
    // The caller's own reference must still be a live, attached buffer — reusable in a later call.
    expect(original.buffer.byteLength).toBe(3);
  });

  it("clones Uint8Arrays nested inside objects that are themselves inside an array", () => {
    const original = new Uint8Array([9]);
    const message = { chapters: [{ bytes: original }] };

    cloneAndCollectTransferableBuffers(message);

    const [chapter] = message.chapters;
    if (chapter === undefined) throw new Error("expected a chapter");
    expect(chapter.bytes).not.toBe(original);
    expect(Array.from(chapter.bytes)).toEqual([9]);
  });

  it("clones every Uint8Array that is itself a direct array element, in order", () => {
    const first = new Uint8Array([1]);
    const second = new Uint8Array([2]);
    const message = { chapters: [first, second] };

    const transfer = cloneAndCollectTransferableBuffers(message);

    expect(message.chapters[0]).not.toBe(first);
    expect(message.chapters[1]).not.toBe(second);
    expect(Array.from(message.chapters[0] as Uint8Array)).toEqual([1]);
    expect(Array.from(message.chapters[1] as Uint8Array)).toEqual([2]);
    expect(transfer).toEqual([
      (message.chapters[0] as Uint8Array).buffer,
      (message.chapters[1] as Uint8Array).buffer,
    ]);
  });

  it("never reads past the array's own last index", () => {
    const array = [new Uint8Array([1]), new Uint8Array([2])];
    const accessedIndices: (string | symbol)[] = [];
    const tracked = new Proxy(array, {
      get(target, property, receiver) {
        if (property !== "length") accessedIndices.push(property);
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    cloneAndCollectTransferableBuffers(tracked);
    expect(accessedIndices).not.toContain("2");
  });
});
