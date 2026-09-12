import { describe, expect, it } from "vitest";
import {
  bookmarkAnchorDescriptor,
  bookmarkResidueControlWords,
  coalesceRunConstructs,
  dttmFromIso,
  formFieldContentControl,
  formFieldControlType,
  hasRevision,
  isBookmarkAnchor,
  isoFromDttm,
  NO_REVISION,
  provenanceDescriptors,
  type RevisionState,
  type RtfFormFieldData,
} from "./constructs";
import type { AnchorDescriptor, ConstructDescriptor } from "document-schema.js";

describe("bookmarkAnchorDescriptor", () => {
  it("carries no source at all when no column range is given", () => {
    const descriptor = bookmarkAnchorDescriptor("mark", undefined);
    expect(descriptor).not.toHaveProperty("source");
  });

  it("carries no source when a column range is given but both ends are undefined", () => {
    const descriptor = bookmarkAnchorDescriptor("mark", {
      first: undefined,
      last: undefined,
    });
    expect(descriptor).not.toHaveProperty("source");
  });

  it("residue carries only bkmkcolf when only the first column is given", () => {
    const descriptor = bookmarkAnchorDescriptor("mark", {
      first: 2,
      last: undefined,
    });
    expect(descriptor.source).toEqual({
      format: "rtf",
      xml: "\\bkmkcolf2",
    });
  });

  it("residue carries only bkmkcoll when only the last column is given", () => {
    const descriptor = bookmarkAnchorDescriptor("mark", {
      first: undefined,
      last: 5,
    });
    expect(descriptor.source).toEqual({
      format: "rtf",
      xml: "\\bkmkcoll5",
    });
  });

  it("residue carries both control words in order when both columns are given", () => {
    const descriptor = bookmarkAnchorDescriptor("mark", { first: 2, last: 5 });
    expect(descriptor.source).toEqual({
      format: "rtf",
      xml: "\\bkmkcolf2\\bkmkcoll5",
    });
  });
});

describe("bookmarkResidueControlWords", () => {
  it("returns the rtf residue verbatim", () => {
    const descriptor: AnchorDescriptor = {
      kind: "anchor",
      anchorType: "bookmark",
      name: "mark",
      source: { format: "rtf", xml: "\\bkmkcolf2" },
    };
    expect(bookmarkResidueControlWords(descriptor)).toBe("\\bkmkcolf2");
  });

  it("returns an empty string for residue from a different format", () => {
    const descriptor: AnchorDescriptor = {
      kind: "anchor",
      anchorType: "bookmark",
      name: "mark",
      source: { format: "docx", xml: "<w:bookmarkStart/>" },
    };
    expect(bookmarkResidueControlWords(descriptor)).toBe("");
  });

  it("returns an empty string when there is no source at all", () => {
    const descriptor: AnchorDescriptor = {
      kind: "anchor",
      anchorType: "bookmark",
      name: "mark",
    };
    expect(bookmarkResidueControlWords(descriptor)).toBe("");
  });
});

describe("isBookmarkAnchor", () => {
  it("is true for a bookmark anchor", () => {
    const descriptor: ConstructDescriptor = {
      kind: "anchor",
      anchorType: "bookmark",
      name: "mark",
    };
    expect(isBookmarkAnchor(descriptor)).toBe(true);
  });

  it("is false for a non-bookmark anchor", () => {
    const descriptor: ConstructDescriptor = {
      kind: "anchor",
      anchorType: "footnote",
      name: "1",
    };
    expect(isBookmarkAnchor(descriptor)).toBe(false);
  });

  it("is false for a non-anchor descriptor", () => {
    const descriptor: ConstructDescriptor = {
      kind: "contentControl",
      controlType: "checkbox",
    };
    expect(isBookmarkAnchor(descriptor)).toBe(false);
  });
});

describe("hasRevision", () => {
  it("is false for NO_REVISION", () => {
    expect(hasRevision(NO_REVISION)).toBe(false);
  });

  it("is true when only revised is set", () => {
    expect(hasRevision({ ...NO_REVISION, revised: true })).toBe(true);
  });

  it("is true when only deleted is set", () => {
    expect(hasRevision({ ...NO_REVISION, deleted: true })).toBe(true);
  });

  it("is true when only moved is set", () => {
    expect(hasRevision({ ...NO_REVISION, moved: "moveFrom" })).toBe(true);
  });

  it("is true when only formatAuthor is set", () => {
    expect(hasRevision({ ...NO_REVISION, formatAuthor: 0 })).toBe(true);
  });
});

describe("provenanceDescriptors", () => {
  const authors = ["Alice", "Bob"];

  it("returns an empty array for NO_REVISION", () => {
    expect(provenanceDescriptors(NO_REVISION, authors)).toEqual([]);
  });

  it("emits an insertion descriptor for revised, with author and date resolved", () => {
    const state: RevisionState = {
      ...NO_REVISION,
      revised: true,
      revisedAuthor: 0,
      revisedDateTime: dttmFromIso("1900-01-01T01:01:00"),
    };
    expect(provenanceDescriptors(state, authors)).toEqual([
      {
        kind: "provenance",
        change: "insertion",
        author: "Alice",
        dateIso: "1900-01-01T01:01:00",
      },
    ]);
  });

  it("emits a deletion descriptor for deleted", () => {
    const state: RevisionState = {
      ...NO_REVISION,
      deleted: true,
      deletedAuthor: 1,
    };
    expect(provenanceDescriptors(state, authors)).toEqual([
      { kind: "provenance", change: "deletion", author: "Bob" },
    ]);
  });

  it("emits a moveFrom or moveTo descriptor matching the moved field", () => {
    expect(
      provenanceDescriptors({ ...NO_REVISION, moved: "moveTo" }, authors),
    ).toEqual([{ kind: "provenance", change: "moveTo" }]);
  });

  it("emits a formatChange descriptor for formatAuthor", () => {
    expect(
      provenanceDescriptors(
        { ...NO_REVISION, formatAuthor: 0, formatDateTime: undefined },
        authors,
      ),
    ).toEqual([
      { kind: "provenance", change: "formatChange", author: "Alice" },
    ]);
  });

  it("emits all four descriptors at once when every revision fact is present", () => {
    const state: RevisionState = {
      revised: true,
      revisedAuthor: 0,
      revisedDateTime: undefined,
      deleted: true,
      deletedAuthor: 1,
      deletedDateTime: undefined,
      moved: "moveFrom",
      movedAuthor: undefined,
      movedDateTime: undefined,
      formatAuthor: 0,
      formatDateTime: undefined,
    };
    expect(provenanceDescriptors(state, authors)).toHaveLength(4);
  });

  it("omits author when the index resolves to no table entry", () => {
    const state: RevisionState = {
      ...NO_REVISION,
      revised: true,
      revisedAuthor: 99,
    };
    expect(provenanceDescriptors(state, authors)).toEqual([
      { kind: "provenance", change: "insertion" },
    ]);
  });

  it("omits author when the resolved name is an empty string", () => {
    const state: RevisionState = {
      ...NO_REVISION,
      revised: true,
      revisedAuthor: 0,
    };
    expect(provenanceDescriptors(state, [""])).toEqual([
      { kind: "provenance", change: "insertion" },
    ]);
  });

  it("omits dateIso entirely when the DTTM doesn't parse to a real date", () => {
    const state: RevisionState = {
      ...NO_REVISION,
      revised: true,
      revisedDateTime: 0, // day 0, month 0 -- "no time recorded"
    };
    const [descriptor] = provenanceDescriptors(state, authors);
    expect(descriptor).not.toHaveProperty("dateIso");
  });
});

describe("isoFromDttm", () => {
  // bits: year(9) month(4) day(5) hour(5) minute(6), assembled the same way the module's own writer does.
  function dttm(
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
  ): number {
    return (
      (minute & 0x3f) |
      ((hour & 0x1f) << 6) |
      ((day & 0x1f) << 11) |
      ((month & 0xf) << 16) |
      (((year - 1900) & 0x1ff) << 20)
    );
  }

  it("formats an ordinary date and time", () => {
    expect(isoFromDttm(dttm(2024, 3, 15, 9, 30))).toBe("2024-03-15T09:30:00");
  });

  it("returns undefined for day 0, the 'no time recorded' sentinel", () => {
    expect(isoFromDttm(dttm(2024, 3, 0, 9, 30))).toBeUndefined();
  });

  it("returns undefined for month 0, even with a nonzero day", () => {
    expect(isoFromDttm(dttm(2024, 0, 15, 9, 30))).toBeUndefined();
  });

  it("accepts month 12 but rejects month 13", () => {
    expect(isoFromDttm(dttm(2024, 12, 1, 0, 0))).toBe("2024-12-01T00:00:00");
    expect(isoFromDttm(dttm(2024, 13, 1, 0, 0))).toBeUndefined();
  });

  it("accepts day 31 but rejects day 32", () => {
    expect(isoFromDttm(dttm(2024, 1, 31, 0, 0))).toBe("2024-01-31T00:00:00");
    expect(isoFromDttm(dttm(2024, 1, 32, 0, 0))).toBeUndefined();
  });

  it("pads single-digit month/day/hour/minute with a leading zero", () => {
    expect(isoFromDttm(dttm(2024, 1, 2, 3, 4))).toBe("2024-01-02T03:04:00");
  });
});

describe("dttmFromIso", () => {
  it("returns undefined for a string that isn't an ISO date at all", () => {
    expect(dttmFromIso("not a date")).toBeUndefined();
  });

  it("round-trips a date and time through isoFromDttm", () => {
    const bits = dttmFromIso("2024-03-15T09:30:00");
    if (bits === undefined) throw new Error("expected a defined DTTM value");
    expect(isoFromDttm(bits)).toBe("2024-03-15T09:30:00");
  });

  it("defaults hour and minute to 0 for a date-only ISO string", () => {
    const bits = dttmFromIso("2024-03-15");
    if (bits === undefined) throw new Error("expected a defined DTTM value");
    expect(isoFromDttm(bits)).toBe("2024-03-15T00:00:00");
  });

  it("accepts the earliest representable year (the DTTM epoch itself)", () => {
    expect(dttmFromIso("1900-01-01")).toBeDefined();
  });

  it("rejects a year before the DTTM epoch", () => {
    expect(dttmFromIso("1899-01-01")).toBeUndefined();
  });

  it("accepts the latest representable year (epoch + the 9-bit field's own max)", () => {
    expect(dttmFromIso("2411-01-01")).toBeDefined();
  });

  it("rejects a year one past the latest representable year", () => {
    expect(dttmFromIso("2412-01-01")).toBeUndefined();
  });
});

describe("formFieldControlType", () => {
  it("recognizes FORMCHECKBOX, FORMDROPDOWN, and FORMTEXT", () => {
    expect(formFieldControlType("FORMCHECKBOX")).toBe("checkbox");
    expect(formFieldControlType("FORMDROPDOWN")).toBe("dropDown");
    expect(formFieldControlType("FORMTEXT")).toBe("plainText");
  });

  it("is case-insensitive and tolerates leading whitespace", () => {
    expect(formFieldControlType("  formtext")).toBe("plainText");
  });

  it("returns undefined for an ordinary field instruction", () => {
    expect(
      formFieldControlType('HYPERLINK "http://example.com/FORMTEXT"'),
    ).toBeUndefined();
  });
});

function formFieldData(
  overrides: Partial<RtfFormFieldData> = {},
): RtfFormFieldData {
  return {
    name: "",
    helpText: "",
    ownHelp: false,
    listItems: [],
    resultIndex: undefined,
    defaultResultIndex: undefined,
    protectedField: false,
    ...overrides,
  };
}

describe("formFieldContentControl", () => {
  it("returns undefined for an ordinary field instruction", () => {
    expect(formFieldContentControl("PAGE", undefined)).toBeUndefined();
  });

  it("returns a bare descriptor with no formField data at all", () => {
    expect(formFieldContentControl("FORMTEXT", undefined)).toEqual({
      kind: "contentControl",
      controlType: "plainText",
    });
  });

  it("trims the name before using it as tag, and omits tag entirely once trimmed to empty", () => {
    expect(
      formFieldContentControl(
        "FORMTEXT",
        formFieldData({ name: "  field1  " }),
      ),
    ).toMatchObject({ tag: "field1" });
    expect(
      formFieldContentControl("FORMTEXT", formFieldData({ name: "   " })),
    ).not.toHaveProperty("tag");
  });

  it("sets alias only when ownHelp is true and the trimmed help text is non-empty", () => {
    expect(
      formFieldContentControl(
        "FORMTEXT",
        formFieldData({ ownHelp: true, helpText: "  Enter your name  " }),
      ),
    ).toMatchObject({ alias: "Enter your name" });
    expect(
      formFieldContentControl(
        "FORMTEXT",
        formFieldData({ ownHelp: false, helpText: "Name" }),
      ),
    ).not.toHaveProperty("alias");
    expect(
      formFieldContentControl(
        "FORMTEXT",
        formFieldData({ ownHelp: true, helpText: "   " }),
      ),
    ).not.toHaveProperty("alias");
  });

  it("sets lock to content when protectedField is true, and omits it otherwise", () => {
    expect(
      formFieldContentControl(
        "FORMTEXT",
        formFieldData({ protectedField: true }),
      ),
    ).toMatchObject({ lock: "content" });
    expect(
      formFieldContentControl(
        "FORMTEXT",
        formFieldData({ protectedField: false }),
      ),
    ).not.toHaveProperty("lock");
  });

  describe("checkbox", () => {
    it("is checked when resultIndex is 1", () => {
      expect(
        formFieldContentControl(
          "FORMCHECKBOX",
          formFieldData({ resultIndex: 1 }),
        ),
      ).toMatchObject({ checked: true });
    });

    it("is unchecked when resultIndex is 0", () => {
      expect(
        formFieldContentControl(
          "FORMCHECKBOX",
          formFieldData({ resultIndex: 0 }),
        ),
      ).toMatchObject({ checked: false });
    });

    it("falls through to defaultResultIndex when resultIndex is the undefined sentinel (25)", () => {
      expect(
        formFieldContentControl(
          "FORMCHECKBOX",
          formFieldData({ resultIndex: 25, defaultResultIndex: 1 }),
        ),
      ).toMatchObject({ checked: true });
    });

    it("falls through to defaultResultIndex when resultIndex is absent entirely", () => {
      expect(
        formFieldContentControl(
          "FORMCHECKBOX",
          formFieldData({ resultIndex: undefined, defaultResultIndex: 1 }),
        ),
      ).toMatchObject({ checked: true });
    });

    it("defaults to unchecked when neither resultIndex nor defaultResultIndex is usable", () => {
      expect(
        formFieldContentControl(
          "FORMCHECKBOX",
          formFieldData({ resultIndex: 25, defaultResultIndex: undefined }),
        ),
      ).toMatchObject({ checked: false });
    });
  });

  describe("dropDown", () => {
    it("sets no options at all when listItems is empty", () => {
      expect(
        formFieldContentControl(
          "FORMDROPDOWN",
          formFieldData({ listItems: [] }),
        ),
      ).not.toHaveProperty("options");
    });

    it("sets options to a copy of listItems when non-empty", () => {
      const result = formFieldContentControl(
        "FORMDROPDOWN",
        formFieldData({ listItems: ["a", "b"] }),
      );
      expect(result?.options).toEqual(["a", "b"]);
    });

    it("sets value to the selected entry named by resultIndex", () => {
      expect(
        formFieldContentControl(
          "FORMDROPDOWN",
          formFieldData({ listItems: ["a", "b", "c"], resultIndex: 1 }),
        ),
      ).toMatchObject({ value: "b" });
    });

    it("falls through to defaultResultIndex when resultIndex is the undefined sentinel", () => {
      expect(
        formFieldContentControl(
          "FORMDROPDOWN",
          formFieldData({
            listItems: ["a", "b", "c"],
            resultIndex: 25,
            defaultResultIndex: 2,
          }),
        ),
      ).toMatchObject({ value: "c" });
    });

    it("sets no value when the selected index is negative", () => {
      expect(
        formFieldContentControl(
          "FORMDROPDOWN",
          formFieldData({
            listItems: ["a", "b"],
            resultIndex: undefined,
            defaultResultIndex: -1,
          }),
        ),
      ).not.toHaveProperty("value");
    });

    it("sets no value when the selected index is at or past listItems.length", () => {
      expect(
        formFieldContentControl(
          "FORMDROPDOWN",
          formFieldData({ listItems: ["a", "b"], resultIndex: 2 }),
        ),
      ).not.toHaveProperty("value");
      // the last genuinely valid index still resolves
      expect(
        formFieldContentControl(
          "FORMDROPDOWN",
          formFieldData({ listItems: ["a", "b"], resultIndex: 1 }),
        ),
      ).toMatchObject({ value: "b" });
    });

    it("sets no value when the selected index names a genuine hole in a sparse listItems array", () => {
      // A genuinely sparse array (index 1 has no own property at all, not merely an undefined value), not a simulated one -- listItems.length is still 3.
      const listItems = new Array<string>(3);
      listItems[0] = "a";
      listItems[2] = "c";
      expect(
        formFieldContentControl(
          "FORMDROPDOWN",
          formFieldData({ listItems, resultIndex: 1 }),
        ),
      ).not.toHaveProperty("value");
    });

    it("sets no value at all when resultIndex is undefined and defaultResultIndex is too", () => {
      expect(
        formFieldContentControl(
          "FORMDROPDOWN",
          formFieldData({
            listItems: ["a", "b"],
            resultIndex: undefined,
            defaultResultIndex: undefined,
          }),
        ),
      ).not.toHaveProperty("value");
    });
  });
});

describe("coalesceRunConstructs", () => {
  const anchor: ConstructDescriptor = {
    kind: "anchor",
    anchorType: "bookmark",
    name: "a",
  };
  const other: ConstructDescriptor = {
    kind: "anchor",
    anchorType: "bookmark",
    name: "b",
  };

  it("returns an empty array for no runs at all", () => {
    expect(coalesceRunConstructs([])).toEqual([]);
  });

  it("coalesces the same descriptor across adjacent runs into one extent", () => {
    expect(coalesceRunConstructs([[anchor], [anchor], [anchor]])).toEqual([
      { descriptor: anchor, startRun: 0, endRun: 3 },
    ]);
  });

  it("closes an extent the moment a run stops carrying the descriptor", () => {
    expect(coalesceRunConstructs([[anchor], [anchor], []])).toEqual([
      { descriptor: anchor, startRun: 0, endRun: 2 },
    ]);
  });

  it("closes a still-open extent at the end of the paragraph", () => {
    expect(coalesceRunConstructs([[anchor]])).toEqual([
      { descriptor: anchor, startRun: 0, endRun: 1 },
    ]);
  });

  it("reopens a fresh extent when the same descriptor reappears after a gap", () => {
    expect(coalesceRunConstructs([[anchor], [], [anchor]])).toEqual([
      { descriptor: anchor, startRun: 0, endRun: 1 },
      { descriptor: anchor, startRun: 2, endRun: 3 },
    ]);
  });

  it("tracks two distinct descriptors as independent extents", () => {
    const result = coalesceRunConstructs([[anchor, other], [anchor], [other]]);
    expect(result).toContainEqual({
      descriptor: anchor,
      startRun: 0,
      endRun: 2,
    });
    expect(result).toContainEqual({
      descriptor: other,
      startRun: 0,
      endRun: 1,
    });
    expect(result).toContainEqual({
      descriptor: other,
      startRun: 2,
      endRun: 3,
    });
  });

  it("sorts by startRun ascending, breaking a tie by endRun ascending", () => {
    // Two descriptors open on the same run (tied startRun) but close at different runs -- the second call site (the end-of-paragraph cleanup, not the per-run close) inserts them in Map iteration order, which need not already be endRun-ascending.
    const result = coalesceRunConstructs([[other, anchor], [other]]);
    expect(result).toEqual([
      { descriptor: anchor, startRun: 0, endRun: 1 },
      { descriptor: other, startRun: 0, endRun: 2 },
    ]);
  });

  it("sorts two overlapping extents by startRun even though the shorter one closes -- and is pushed -- first", () => {
    // "a" opens at run 0 and stays open the whole time; "b" opens at run 1 and closes at run 2, before "a" does at run 3 -- so the per-run close pushes b's extent onto `out` before a's own extent reaches the end-of-paragraph cleanup, making raw insertion order [b, a], the reverse of the startRun order the sort must produce.
    const result = coalesceRunConstructs([
      [anchor],
      [anchor, other],
      [anchor],
      [anchor],
    ]);
    expect(result).toEqual([
      { descriptor: anchor, startRun: 0, endRun: 4 },
      { descriptor: other, startRun: 1, endRun: 2 },
    ]);
  });
});
