import { describe, expect, it } from "vitest";

import { childrenOfType, findDescendant, readEscherRecords } from "./escher";
import { escherAtom, escherContainer } from "../test-support/escher";

describe("readEscherRecords", () => {
  it("reads a top-level atom", () => {
    // recInstance is a 12-bit field ([MS-ODRAW] 2.2.1), so 0x234 is the largest value that round-trips without masking.
    const bytes = new Uint8Array(escherAtom(0xf00a, 0x234, [1, 2, 3]));

    const records = readEscherRecords(bytes);

    expect(records).toEqual([
      {
        kind: "atom",
        recInstance: 0x234,
        recType: 0xf00a,
        data: new Uint8Array([1, 2, 3]),
      },
    ]);
  });

  it("reads a container's children recursively", () => {
    const bytes = new Uint8Array(
      escherContainer(0xf002, 0, [
        escherAtom(0xf008, 0, [9, 9]),
        escherContainer(0xf003, 0, [escherAtom(0xf00a, 5, [1])]),
      ]),
    );

    const [dg] = readEscherRecords(bytes);
    if (dg?.kind !== "container") {
      throw new Error("expected a container");
    }
    expect(dg.recType).toBe(0xf002);
    expect(dg.children).toHaveLength(2);
    const [dgAtom, spgr] = dg.children;
    expect(dgAtom).toEqual({
      kind: "atom",
      recInstance: 0,
      recType: 0xf008,
      data: new Uint8Array([9, 9]),
    });
    if (spgr?.kind !== "container") {
      throw new Error("expected a nested container");
    }
    expect(spgr.children).toEqual([
      {
        kind: "atom",
        recInstance: 5,
        recType: 0xf00a,
        data: new Uint8Array([1]),
      },
    ]);
  });

  it("reads multiple top-level records in stream order", () => {
    const bytes = new Uint8Array([
      ...escherAtom(0xf00a, 0, [1]),
      ...escherAtom(0xf00b, 0, [2, 2]),
    ]);

    const records = readEscherRecords(bytes);

    expect(records.map((record) => record.recType)).toEqual([0xf00a, 0xf00b]);
  });

  it("throws on a record header running past the end of the stream", () => {
    expect(() => readEscherRecords(new Uint8Array([1, 2, 3]))).toThrow();
  });

  it("throws when a record declares a body longer than the stream carries", () => {
    const header = new Uint8Array(8);
    new DataView(header.buffer).setUint32(4, 0xff, true); // recLen
    expect(() => readEscherRecords(header)).toThrow();
  });

  it("throws when a child record's declared length overruns its own container", () => {
    // A container's own recLen (the header's last 4 bytes) forced too small for the child atom that follows -- an inconsistent length a real writer would never produce, exercising the same defensive check readRecords already has for BIFF framing.
    const malformed = new Uint8Array(
      escherContainer(0xf002, 0, [escherAtom(0xf00a, 0, [1, 2, 3])]),
    );
    new DataView(malformed.buffer).setUint32(4, 4, true);
    expect(() => readEscherRecords(malformed)).toThrow();
  });
});

describe("childrenOfType / findDescendant", () => {
  it("filters direct children by recType", () => {
    const bytes = new Uint8Array(
      escherContainer(0xf002, 0, [
        escherAtom(0xf00a, 0, [1]),
        escherAtom(0xf00a, 0, [2]),
        escherAtom(0xf00b, 0, [3]),
      ]),
    );
    const [container] = readEscherRecords(bytes);
    if (container?.kind !== "container") {
      throw new Error("expected a container");
    }

    expect(childrenOfType(container, 0xf00a)).toHaveLength(2);
  });

  it("finds a record nested at any depth", () => {
    const bytes = new Uint8Array(
      escherContainer(0xf000, 0, [
        escherContainer(0xf001, 0, [escherAtom(0xf007, 0, [7])]),
      ]),
    );
    const [root] = readEscherRecords(bytes);
    if (root?.kind !== "container") {
      throw new Error("expected a container");
    }

    expect(findDescendant(root, 0xf007)).toEqual({
      kind: "atom",
      recInstance: 0,
      recType: 0xf007,
      data: new Uint8Array([7]),
    });
  });

  it("returns undefined when nothing matches", () => {
    const bytes = new Uint8Array(escherContainer(0xf000, 0, []));
    const [root] = readEscherRecords(bytes);
    if (root?.kind !== "container") {
      throw new Error("expected a container");
    }

    expect(findDescendant(root, 0xdead)).toBeUndefined();
  });
});
