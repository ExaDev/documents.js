import { describe, expect, it } from "vitest";

import {
  setPendingReopen,
  takePendingReopen,
  type PendingReopen,
} from "./reopenMailbox";

function entry(name: string): PendingReopen {
  return {
    file: { bytes: new Uint8Array([1, 2, 3]), name },
    format: "docx",
  };
}

describe("the pending-reopen mailbox", () => {
  it("returns undefined when nothing has been set", () => {
    expect(takePendingReopen()).toBeUndefined();
  });

  it("returns the entry that was set", () => {
    setPendingReopen(entry("a.docx"));
    expect(takePendingReopen()).toEqual(entry("a.docx"));
  });

  it("is read-once: a second take after the first returns undefined", () => {
    setPendingReopen(entry("b.docx"));
    takePendingReopen();
    expect(takePendingReopen()).toBeUndefined();
  });

  it("a later set overwrites an earlier one that was never taken", () => {
    setPendingReopen(entry("first.docx"));
    setPendingReopen(entry("second.docx"));
    expect(takePendingReopen()).toEqual(entry("second.docx"));
  });
});
