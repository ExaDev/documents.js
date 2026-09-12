import { describe, expect, it } from "vitest";
import type { Package } from "../../model/package";
import { el, txt } from "../../xml/fragment";
import { loadSharedStrings, SharedStringTable } from "./shared-strings";

describe("loadSharedStrings", () => {
  it("returns exactly an empty array when the package has no sharedStrings part at all", () => {
    expect(loadSharedStrings({ parts: {} })).toEqual([]);
  });

  it("concatenates every <t> run inside one <si>, and reads several <si> entries in document order", () => {
    const pkg: Package = {
      parts: {
        "xl/sharedStrings.xml": {
          kind: "xml",
          nodes: [
            el("sst", {}, [
              el("si", {}, [
                el("t", {}, [txt("hello ")]),
                el("t", {}, [txt("world")]),
              ]),
              el("si", {}, [el("t", {}, [txt("second")])]),
            ]),
          ],
        },
      },
    };
    expect(loadSharedStrings(pkg)).toEqual(["hello world", "second"]);
  });
});

describe("SharedStringTable", () => {
  it("assigns sequential indices to distinct values, in first-intern order", () => {
    const table = new SharedStringTable();
    expect(table.intern("a")).toBe(0);
    expect(table.intern("b")).toBe(1);
    expect(table.entries()).toEqual(["a", "b"]);
    expect(table.size).toBe(2);
  });

  it("returns the same index for a value interned more than once, without growing the table", () => {
    const table = new SharedStringTable();
    expect(table.intern("a")).toBe(0);
    expect(table.intern("a")).toBe(0);
    expect(table.entries()).toEqual(["a"]);
    expect(table.size).toBe(1);
  });
});
