import { describe, expect, it } from "vitest";
import type {
  ConstructDescriptor,
  ContentControlDescriptor,
  DefinitionEntry,
  DivisionDescriptor,
  ProvenanceDescriptor,
  RunConstructExtent,
} from "document-schema.js";
import type { XmlElement } from "../../model/node";
import { el } from "../../xml/fragment";
import {
  canonicalOdfConstructDescriptor,
  odfIndexWrapperTag,
  odfRunConstructWriteKind,
  parseOdfFieldInstruction,
  writeOdfAnnotationHalf,
  writeOdfChangePoint,
  writeOdfDivision,
  writeOdfIndexWrapper,
  writeOdfTrackedChanges,
} from "./constructs";
import {} from "./constructs-markers";
import {} from "./constructs-definitions";

// Every fixture here is a programmatic package/element built with el/txt, matching the sibling odt/constructs.test.ts's own fixture-gate convention.

describe("parseOdfFieldInstruction", () => {
  it("finds the real top-level element, skipping a leading non-element node", () => {
    const element = parseOdfFieldInstruction('<!--c--><foo a="1"/>');
    expect(element.tag).toBe("foo");
  });

  it("throws when the instruction parses back to no element at all", () => {
    expect(() => parseOdfFieldInstruction("<!--c-->")).toThrow(
      /did not parse back to a single element/,
    );
  });
});

describe("canonicalOdfConstructDescriptor", () => {
  it("passes a non-index contentControl through unchanged", () => {
    const descriptor: ConstructDescriptor = {
      kind: "contentControl",
      controlType: "richText",
    };
    expect(canonicalOdfConstructDescriptor(descriptor)).toEqual(descriptor);
  });

  it("passes an index contentControl with no source through unchanged, without dereferencing a source that isn't there", () => {
    const descriptor: ConstructDescriptor = {
      kind: "contentControl",
      controlType: "index",
    };
    expect(() => canonicalOdfConstructDescriptor(descriptor)).not.toThrow();
    expect(canonicalOdfConstructDescriptor(descriptor)).toEqual(descriptor);
  });

  it("passes a non-index contentControl through unchanged even when it does carry a source (the controlType check is its own real gate, not implied by the source check alone)", () => {
    const descriptor: ConstructDescriptor = {
      kind: "contentControl",
      controlType: "richText",
      source: { format: "odt", xml: "<text:table-of-content-source/>" },
    };
    expect(canonicalOdfConstructDescriptor(descriptor)).toEqual(descriptor);
  });

  it("passes a non-contentControl descriptor through unchanged even when it happens to carry contentControl-shaped fields (the kind check is its own real gate, not implied by the controlType/source checks alone)", () => {
    const descriptor = {
      kind: "anchor",
      anchorType: "bookmark",
      name: "b",
      controlType: "index",
      source: { format: "odt", xml: "<text:table-of-content-source/>" },
    } as unknown as ConstructDescriptor;
    expect(canonicalOdfConstructDescriptor(descriptor)).toEqual(descriptor);
  });
});

describe("writeOdfChangePoint", () => {
  it("writes the exact point-change element and id", () => {
    const result = writeOdfChangePoint("id1");
    expect(result.tag).toBe("text:change");
    expect(result.attributes).toEqual([
      { name: "text:change-id", value: "id1" },
    ]);
  });
});

describe("writeOdfAnnotationHalf", () => {
  it("writes a dc:date child when the entry carries a dateIso", () => {
    const result = writeOdfAnnotationHalf(
      { name: "c1" },
      { kind: "comment", body: [], dateIso: "2024-01-01T00:00:00Z" },
    );
    const dateEl = result.children.find(
      (child): child is XmlElement =>
        child.type === "element" && child.tag === "dc:date",
    );
    if (dateEl === undefined) {
      throw new Error("expected a dc:date child");
    }
    const [text] = dateEl.children;
    expect(text).toEqual({ type: "text", value: "2024-01-01T00:00:00Z" });
  });

  it("writes no dc:date child when the entry carries no dateIso", () => {
    const result = writeOdfAnnotationHalf(
      { name: "c1" },
      { kind: "comment", body: [] },
    );
    expect(
      result.children.some(
        (child) => child.type === "element" && child.tag === "dc:date",
      ),
    ).toBe(false);
  });
});

describe("writeOdfTrackedChanges", () => {
  it("wraps every region in a text:tracked-changes element, spelled exactly", () => {
    expect(writeOdfTrackedChanges([]).tag).toBe("text:tracked-changes");
  });

  it("throws for a change kind with no ODF region spelling (moveFrom/moveTo, refused by every real caller before reaching here)", () => {
    const regions = [
      {
        id: "r1",
        descriptor: {
          kind: "provenance",
          change: "moveFrom",
        } as unknown as ProvenanceDescriptor & {
          change: "insertion" | "deletion" | "formatChange";
        },
      },
    ];
    expect(() => writeOdfTrackedChanges(regions)).toThrow(
      /has no ODF region spelling/,
    );
  });

  it("writes no office:change-info at all when neither author nor date is present", () => {
    const region = el("text:tracked-changes-region-probe", {});
    const result = writeOdfTrackedChanges([
      { id: "r1", descriptor: { kind: "provenance", change: "insertion" } },
    ]);
    const [regionEl] = result.children;
    if (regionEl?.type !== "element") {
      throw new Error("expected a text:changed-region element");
    }
    const [changeEl] = regionEl.children;
    if (changeEl?.type !== "element") {
      throw new Error("expected a change element");
    }
    expect(changeEl.children).toEqual([]);
    void region;
  });
});

describe("odfRunConstructWriteKind", () => {
  function extent(
    descriptor: RunConstructExtent["descriptor"],
    startRun: number,
    endRun: number,
  ): RunConstructExtent {
    return { descriptor, startRun, endRun };
  }

  it("distinguishes a zero-width bookmark point from a ranged bookmark", () => {
    const descriptor: RunConstructExtent["descriptor"] = {
      kind: "anchor",
      anchorType: "bookmark",
      name: "b",
    };
    const rangeEndRun = 4;
    expect(odfRunConstructWriteKind(extent(descriptor, 2, 2))).toBe(
      "bookmarkPoint",
    );
    expect(odfRunConstructWriteKind(extent(descriptor, 2, rangeEndRun))).toBe(
      "bookmarkRange",
    );
  });

  it("refuses a footnote anchor with no definition key at all", () => {
    const descriptor: RunConstructExtent["descriptor"] = {
      kind: "anchor",
      anchorType: "footnote",
      name: "n1",
    };
    expect(
      odfRunConstructWriteKind(extent(descriptor, 0, 0), {}),
    ).toBeUndefined();
  });

  it("refuses a footnote anchor whose definition key is not actually in the definitions table", () => {
    const descriptor: RunConstructExtent["descriptor"] = {
      kind: "anchor",
      anchorType: "footnote",
      name: "n1",
      definition: "note:n1",
    };
    expect(
      odfRunConstructWriteKind(extent(descriptor, 0, 0), {}),
    ).toBeUndefined();
  });

  it("writes a footnote, an endnote, and a comment as note/note/comment, once their definition resolves", () => {
    const noteDescriptor: RunConstructExtent["descriptor"] = {
      kind: "anchor",
      anchorType: "footnote",
      name: "n1",
      definition: "note:n1",
    };
    const endnoteDescriptor: RunConstructExtent["descriptor"] = {
      kind: "anchor",
      anchorType: "endnote",
      name: "n2",
      definition: "note:n2",
    };
    const commentDescriptor: RunConstructExtent["descriptor"] = {
      kind: "anchor",
      anchorType: "comment",
      name: "c1",
      definition: "comment:c1",
    };
    const definitions: Record<string, DefinitionEntry> = {
      "note:n1": { kind: "footnote", body: [] },
      "note:n2": { kind: "endnote", body: [] },
      "comment:c1": { kind: "comment", body: [] },
    };
    expect(
      odfRunConstructWriteKind(extent(noteDescriptor, 0, 0), definitions),
    ).toBe("note");
    expect(
      odfRunConstructWriteKind(extent(endnoteDescriptor, 0, 0), definitions),
    ).toBe("note");
    expect(
      odfRunConstructWriteKind(extent(commentDescriptor, 0, 0), definitions),
    ).toBe("comment");
  });

  it("refuses an anchor whose type is none of footnote/endnote/comment, even with a resolving definition (bookmark is excluded by the earlier branch; nothing else in AnchorType reaches this far)", () => {
    const descriptor = {
      kind: "anchor",
      anchorType: "notARealAnchorType",
      name: "n1",
      definition: "note:n1",
    } as unknown as RunConstructExtent["descriptor"];
    const definitions: Record<string, DefinitionEntry> = {
      "note:n1": { kind: "footnote", body: [] },
    };
    expect(
      odfRunConstructWriteKind(extent(descriptor, 0, 0), definitions),
    ).toBeUndefined();
  });

  it("refuses a moveFrom/moveTo provenance change (no ODF spelling exists for either)", () => {
    const moveFrom: RunConstructExtent["descriptor"] = {
      kind: "provenance",
      change: "moveFrom",
    };
    const moveTo: RunConstructExtent["descriptor"] = {
      kind: "provenance",
      change: "moveTo",
    };
    const changeIds = new Map<ProvenanceDescriptor, string>([
      [moveFrom, "id1"],
      [moveTo, "id2"],
    ]);
    expect(
      odfRunConstructWriteKind(extent(moveFrom, 0, 0), {}, changeIds),
    ).toBeUndefined();
    expect(
      odfRunConstructWriteKind(extent(moveTo, 0, 0), {}, changeIds),
    ).toBeUndefined();
  });

  it("refuses a provenance change with no minted region id at all", () => {
    const descriptor: RunConstructExtent["descriptor"] = {
      kind: "provenance",
      change: "insertion",
    };
    expect(
      odfRunConstructWriteKind(extent(descriptor, 0, 0), {}),
    ).toBeUndefined();
  });

  it("distinguishes a zero-width change point from a ranged change, once minted", () => {
    const descriptor: RunConstructExtent["descriptor"] = {
      kind: "provenance",
      change: "insertion",
    };
    const changeIds = new Map<ProvenanceDescriptor, string>([
      [descriptor, "id1"],
    ]);
    const changePointRun = 3;
    const changeRangeEndRun = 5;
    expect(
      odfRunConstructWriteKind(
        extent(descriptor, changePointRun, changePointRun),
        {},
        changeIds,
      ),
    ).toBe("changePoint");
    expect(
      odfRunConstructWriteKind(
        extent(descriptor, changePointRun, changeRangeEndRun),
        {},
        changeIds,
      ),
    ).toBe("changeRange");
  });
});

describe("writeOdfDivision", () => {
  it("carries no text:section-name when the linked division names none", () => {
    const descriptor: DivisionDescriptor = {
      kind: "division",
      linked: { href: "chapter.odt" },
    };
    const result = writeOdfDivision(descriptor, [], {
      mintSectionStyleName: () => "S1",
    });
    const sourceEl = result.children.find(
      (child): child is XmlElement =>
        child.type === "element" && child.tag === "text:section-source",
    );
    expect(sourceEl?.attributes).toEqual([
      { name: "xlink:type", value: "simple" },
      { name: "xlink:href", value: "chapter.odt" },
    ]);
  });
});

describe("odfIndexWrapperTag / writeOdfIndexWrapper", () => {
  function descriptorWithSourceXml(xml: string): ContentControlDescriptor {
    return {
      kind: "contentControl",
      controlType: "index",
      source: { format: "odt", xml },
    };
  }

  it("finds the real *-source element, skipping a leading non-element node", () => {
    expect(
      odfIndexWrapperTag(
        descriptorWithSourceXml("<!--c--><text:table-of-content-source/>"),
      ),
    ).toBe("text:table-of-content");
  });

  it("throws when the residue's own top-level element does not end in -source", () => {
    expect(() =>
      odfIndexWrapperTag(descriptorWithSourceXml("<text:table-of-content/>")),
    ).toThrow();
  });

  it("really checks for the -source suffix specifically, not merely that the tag has some suffix", () => {
    // Blindly slicing the last 7 characters off "text:bibliography-sourcX" (a tag that does NOT end in "-source") lands exactly on the real "text:bibliography" wrapper tag — so a weakened endsWith check that let this through would silently succeed instead of throwing.
    expect(() =>
      odfIndexWrapperTag(
        descriptorWithSourceXml("<text:bibliography-sourcX/>"),
      ),
    ).toThrow();
  });

  it("throws when the stripped tag is not one of the seven recognised index wrapper tags", () => {
    expect(() =>
      odfIndexWrapperTag(descriptorWithSourceXml("<text:bogus-source/>")),
    ).toThrow();
  });

  it("writes the bare *-source child and the recovered wrapper tag together", () => {
    const descriptor = descriptorWithSourceXml(
      "<text:table-of-content-source/>",
    );
    const result = writeOdfIndexWrapper(descriptor, []);
    expect(result.tag).toBe("text:table-of-content");
    expect(
      result.children.some(
        (child) =>
          child.type === "element" &&
          child.tag === "text:table-of-content-source",
      ),
    ).toBe(true);
  });
});
