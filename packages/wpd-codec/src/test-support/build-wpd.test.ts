import { describe, expect, it } from "vitest";
import { uint32At } from "../bytes/view";
import { readFileHeader } from "../container/header";
import {
  buildWpdFile,
  embeddedSubfunction,
  eolFunction,
  variableFunction,
} from "./build-wpd";

// Direct unit coverage of the synthetic-file builder itself: read.test.ts, read-structure.test.ts, and every stream-level test file consume buildWpdFile/variableFunction/eolFunction constantly, but always for the resulting document behaviour, never for the builder's own byte layout -- so a wrong offset or a dropped default here could quietly build a still-plausible file (as several Stryker survivors on this file showed).
describe("buildWpdFile", () => {
  it("stamps a file header whose file size names the buffer's own true length", () => {
    const documentArea = [1, 2, 3, 4, 5];
    const bytes = buildWpdFile(documentArea);
    expect(bytes.length).toBeGreaterThan(documentArea.length);
    const header = readFileHeader(bytes);
    expect(header.fileSize).toBe(bytes.length);
  });

  it("stamps the extended header's documented reserved long as 5", () => {
    const bytes = buildWpdFile([1, 2, 3]);
    // Offset 16: "the documented reserved long at the head of the extended header". readFileHeader does not surface this field (the reader ignores everything but the file size), so it is read back directly here -- the only way to observe the builder actually wrote it.
    expect(uint32At(bytes, 16)).toBe(5);
  });
});

describe("variableFunction", () => {
  it("builds a function with no prefix IDs and empty non-deletable/deletable data by default", () => {
    const bytes = variableFunction({ group: 0xaa, subgroup: 0xbb });
    // size = 10 (fixed) + 0 (no prefix IDs) + 0 (non-deletable) + 0 (deletable) = 10.
    expect(bytes).toEqual([0xaa, 0xbb, 10, 0, 0, 0, 0, 10, 0, 0xaa]);
  });

  it("adds the deletable data's own length to the size field, on top of the non-deletable length", () => {
    const bytes = variableFunction({
      group: 0xaa,
      subgroup: 0xbb,
      nonDeletable: [1, 2],
      deletable: [3, 4, 5],
    });
    // size = 10 + 0 + 2 (non-deletable) + 3 (deletable) = 15.
    expect(bytes).toEqual([
      0xaa, 0xbb, 15, 0, 0, 2, 0, 1, 2, 3, 4, 5, 15, 0, 0xaa,
    ]);
  });
});

describe("eolFunction", () => {
  it("carries no embedded subfunctions by default", () => {
    expect(eolFunction({ subgroup: 0x01 })).toEqual(
      variableFunction({ group: 0xd0, subgroup: 0x01, nonDeletable: [0, 0] }),
    );
  });

  it("appends the given embedded subfunctions after the deletable-size word", () => {
    const sub = embeddedSubfunction(0x99, [0x01]);
    expect(eolFunction({ subgroup: 0x01, embedded: sub })).toEqual(
      variableFunction({
        group: 0xd0,
        subgroup: 0x01,
        nonDeletable: [0, 0, ...sub],
      }),
    );
  });
});
