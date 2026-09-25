// Pins the parts of presentation-records.ts the fidelity suites cannot reach. Those suites only ever walk a well-formed synthetic presentation, so every guard here, and the instance test that tells the masters list from the slides list, is exercised only by a tree built to be wrong in one specific way.

import { describe, expect, it } from "vitest";
import { type PptRecord, readRecordAt } from "../record/tree";
import { writeAtom, writeContainer } from "../record/write";
import {
  RT_Drawing,
  RT_SlideListWithText,
  SLIDE_LIST_INSTANCE_MASTERS,
  SLIDE_LIST_INSTANCE_SLIDES,
} from "../record/types";
import { syntheticPresentation } from "./presentation";
import {
  assertNoPhantomRecords,
  firstPersistIdRef,
  requireSlideList,
  resolveDocumentContainer,
  resolveMasterContainer,
  resolveSlideContainer,
  slideLists,
} from "./presentation-records";

const NO_BYTES = new Uint8Array(new ArrayBuffer(0));
// recType 0 is the header a run of raw zero bytes decodes as, which is exactly what assertNoPhantomRecords exists to catch.
const PHANTOM_REC_TYPE = 0;

function container(children: readonly Uint8Array<ArrayBuffer>[]): PptRecord {
  return readRecordAt(writeContainer(RT_Drawing, children), 0);
}

function slideList(recInstance: number): Uint8Array<ArrayBuffer> {
  return writeContainer(RT_SlideListWithText, [], { recInstance });
}

describe("slideLists", () => {
  // A record carrying the masters instance under some other type, so a test that dropped the record-type half of the match would pick this up instead of a list.
  const decoy = writeAtom(RT_Drawing, NO_BYTES, {
    recInstance: SLIDE_LIST_INSTANCE_MASTERS,
  });

  it("finds the masters list behind a decoy and a slides list", () => {
    const { masters, slides } = slideLists(
      container([
        decoy,
        slideList(SLIDE_LIST_INSTANCE_SLIDES),
        slideList(SLIDE_LIST_INSTANCE_MASTERS),
      ]),
    );
    expect(masters?.header.recInstance).toBe(SLIDE_LIST_INSTANCE_MASTERS);
    expect(masters?.header.recType).toBe(RT_SlideListWithText);
    expect(slides?.header.recInstance).toBe(SLIDE_LIST_INSTANCE_SLIDES);
  });

  it("finds the slides list when the masters list comes first", () => {
    const { masters, slides } = slideLists(
      container([
        slideList(SLIDE_LIST_INSTANCE_MASTERS),
        slideList(SLIDE_LIST_INSTANCE_SLIDES),
      ]),
    );
    expect(masters?.header.recInstance).toBe(SLIDE_LIST_INSTANCE_MASTERS);
    expect(slides?.header.recInstance).toBe(SLIDE_LIST_INSTANCE_SLIDES);
  });

  it("reports a list absent rather than substituting the other one", () => {
    const mastersOnly = slideLists(
      container([slideList(SLIDE_LIST_INSTANCE_MASTERS)]),
    );
    expect(mastersOnly.masters?.header.recInstance).toBe(
      SLIDE_LIST_INSTANCE_MASTERS,
    );
    expect(mastersOnly.slides).toBeUndefined();
    const slidesOnly = slideLists(
      container([slideList(SLIDE_LIST_INSTANCE_SLIDES)]),
    );
    expect(slidesOnly.masters).toBeUndefined();
    expect(slidesOnly.slides?.header.recInstance).toBe(
      SLIDE_LIST_INSTANCE_SLIDES,
    );
  });

  it("finds both lists in a real presentation", () => {
    const { currentUserStream, powerPointDocumentStream } =
      syntheticPresentation();
    const { masters, slides } = slideLists(
      resolveDocumentContainer(currentUserStream, powerPointDocumentStream),
    );
    expect(masters?.header.recInstance).toBe(SLIDE_LIST_INSTANCE_MASTERS);
    expect(slides?.header.recInstance).toBe(SLIDE_LIST_INSTANCE_SLIDES);
  });
});

describe("firstPersistIdRef", () => {
  it("names what was missing when the list is absent", () => {
    expect(() => firstPersistIdRef(undefined, "master")).toThrow(
      "test fixture always carries a master list entry",
    );
  });

  it("treats a present but empty list as the same failure", () => {
    const list = readRecordAt(slideList(SLIDE_LIST_INSTANCE_SLIDES), 0);
    expect(() => firstPersistIdRef(list, "slide")).toThrow(
      "test fixture always carries a slide list entry",
    );
  });

  it("returns the persist id the first entry names", () => {
    const { currentUserStream, powerPointDocumentStream } =
      syntheticPresentation();
    const { slides } = slideLists(
      resolveDocumentContainer(currentUserStream, powerPointDocumentStream),
    );
    expect(firstPersistIdRef(slides, "slide")).toBeGreaterThan(0);
  });
});

describe("requireSlideList", () => {
  it("rejects a document carrying only a masters list", () => {
    expect(() =>
      requireSlideList(container([slideList(SLIDE_LIST_INSTANCE_MASTERS)])),
    ).toThrow("test fixture always carries a slide list entry");
  });

  it("returns the slides list when the document carries one", () => {
    const record = requireSlideList(
      container([slideList(SLIDE_LIST_INSTANCE_SLIDES)]),
    );
    expect(record.header.recType).toBe(RT_SlideListWithText);
  });
});

describe("resolving against a persist directory missing an object", () => {
  it("names the document persist reference", () => {
    const { currentUserStream, powerPointDocumentStream } =
      syntheticPresentation({ omitPersistObject: "document" });
    expect(() =>
      resolveDocumentContainer(currentUserStream, powerPointDocumentStream),
    ).toThrow("test fixture's own docPersistIdRef");
  });

  it("names the master persist entry", () => {
    const { currentUserStream, powerPointDocumentStream } =
      syntheticPresentation({ omitPersistObject: "master" });
    expect(() =>
      resolveMasterContainer(currentUserStream, powerPointDocumentStream),
    ).toThrow("test fixture's own master persist entry");
  });

  it("names the slide persist entry", () => {
    const { currentUserStream, powerPointDocumentStream } =
      syntheticPresentation({ omitPersistObject: "slide" });
    expect(() =>
      resolveSlideContainer(currentUserStream, powerPointDocumentStream),
    ).toThrow("test fixture's own slide persist entry");
  });
});

describe("assertNoPhantomRecords", () => {
  it("accepts a tree whose records all carry a real type", () => {
    expect(() => {
      assertNoPhantomRecords(
        container([
          writeContainer(RT_Drawing, [slideList(SLIDE_LIST_INSTANCE_SLIDES)]),
        ]),
      );
    }).not.toThrow();
  });

  it("rejects a phantom sitting directly beneath the record", () => {
    expect(() => {
      assertNoPhantomRecords(
        container([writeAtom(PHANTOM_REC_TYPE, NO_BYTES)]),
      );
    }).toThrow();
  });

  it("rejects a phantom nested below a child container", () => {
    expect(() => {
      assertNoPhantomRecords(
        container([
          writeContainer(RT_Drawing, [writeAtom(PHANTOM_REC_TYPE, NO_BYTES)]),
        ]),
      );
    }).toThrow();
  });
});
