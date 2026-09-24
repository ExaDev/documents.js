// The record-resolving helpers the syntheticPresentation fidelity suites walk a built presentation with. They live here rather than in one of the test files because that suite is split across presentation.test.ts and presentation-drawing.test.ts, and both reach into the same containers. Excluded from the published build by tsdown.config.ts's own entry list, like every other src/test-support module.

import { expect } from "vitest";
import { readSlideListWithText } from "../document/slide-list";
import {
  RT_SlideListWithText,
  SLIDE_LIST_INSTANCE_MASTERS,
} from "../record/types";
import { type PptRecord, childRecords } from "../record/tree";
import { readCurrentUserAtom } from "../stream/current-user";
import { buildPersistDirectory, resolvePersistObject } from "../stream/persist";

// This file is deliberately a fidelity test of the FIXTURE's own bytes, not of anything read.ts observes: several [MS-PPT]/[MS-ODRAW] header fields exercised below (an atom's own recVer, an FBSE's own blip-type instance, a font entity's name, an OfficeArtBStoreContainer's own recInstance count) are real, spec-mandated parts of a genuine PowerPoint binary document that this package's own reader deliberately tolerates a wrong, default, or unset value for — so a test written only against read.ts's own observable output could never catch a regression in one of them. These assertions instead re-parse the constructed record tree directly, the same way record/header.test.ts pins header bytes directly rather than only through something that consumes them, and check each value against what the spec (and the fixture's own comments) say a real file states.

export function resolveDocumentContainer(
  currentUserStream: Uint8Array<ArrayBuffer>,
  powerPointDocumentStream: Uint8Array<ArrayBuffer>,
): PptRecord {
  const currentUser = readCurrentUserAtom(currentUserStream);
  const { directory, currentEdit } = buildPersistDirectory(
    powerPointDocumentStream,
    currentUser.offsetToCurrentEdit,
  );
  return resolvePersistObject(
    powerPointDocumentStream,
    directory,
    currentEdit.docPersistIdRef,
    "test fixture's own docPersistIdRef",
  );
}

export function resolveMasterContainer(
  currentUserStream: Uint8Array<ArrayBuffer>,
  powerPointDocumentStream: Uint8Array<ArrayBuffer>,
): PptRecord {
  const currentUser = readCurrentUserAtom(currentUserStream);
  const { directory, currentEdit } = buildPersistDirectory(
    powerPointDocumentStream,
    currentUser.offsetToCurrentEdit,
  );
  const documentContainer = resolvePersistObject(
    powerPointDocumentStream,
    directory,
    currentEdit.docPersistIdRef,
    "test fixture's own docPersistIdRef",
  );
  const masterList = childRecords(documentContainer).find(
    (record) =>
      record.header.recType === RT_SlideListWithText &&
      record.header.recInstance === SLIDE_LIST_INSTANCE_MASTERS,
  );
  const [masterPersist] =
    masterList === undefined ? [] : readSlideListWithText(masterList);
  if (masterPersist === undefined) {
    throw new Error("test fixture always carries a master list entry");
  }
  return resolvePersistObject(
    powerPointDocumentStream,
    directory,
    masterPersist.persistIdRef,
    "test fixture's own master persist entry",
  );
}

export function resolveSlideContainer(
  currentUserStream: Uint8Array<ArrayBuffer>,
  powerPointDocumentStream: Uint8Array<ArrayBuffer>,
): PptRecord {
  const currentUser = readCurrentUserAtom(currentUserStream);
  const { directory, currentEdit } = buildPersistDirectory(
    powerPointDocumentStream,
    currentUser.offsetToCurrentEdit,
  );
  const documentContainer = resolvePersistObject(
    powerPointDocumentStream,
    directory,
    currentEdit.docPersistIdRef,
    "test fixture's own docPersistIdRef",
  );
  const slideList = childRecords(documentContainer).find(
    (record) =>
      record.header.recType === RT_SlideListWithText &&
      record.header.recInstance !== SLIDE_LIST_INSTANCE_MASTERS,
  );
  const [slidePersist] =
    slideList === undefined ? [] : readSlideListWithText(slideList);
  if (slidePersist === undefined) {
    throw new Error("test fixture always carries a slide list entry");
  }
  return resolvePersistObject(
    powerPointDocumentStream,
    directory,
    slidePersist.persistIdRef,
    "test fixture's own slide persist entry",
  );
}

// The document's own slide list container itself (RT_SlideListWithText, recInstance SLIDES) — distinct from resolveSlideContainer, which follows its own SlidePersistAtom on to the actual SlideContainer. Needed for fidelity checks against the list's own raw entries (a SlidePersistAtom's cTexts field, an inserted phantom record) rather than anything the slide container holds.
export function resolveSlideListRecord(
  currentUserStream: Uint8Array<ArrayBuffer>,
  powerPointDocumentStream: Uint8Array<ArrayBuffer>,
): PptRecord {
  const documentContainer = resolveDocumentContainer(
    currentUserStream,
    powerPointDocumentStream,
  );
  const slideList = childRecords(documentContainer).find(
    (record) =>
      record.header.recType === RT_SlideListWithText &&
      record.header.recInstance !== SLIDE_LIST_INSTANCE_MASTERS,
  );
  if (slideList === undefined) {
    throw new Error("test fixture always carries a slide list entry");
  }
  return slideList;
}

// Recursively asserts no record anywhere beneath `record` has recType 0 — the header a run of raw zero bytes decodes as. A mutant that splices non-byte content (a string, `undefined`) into a children array this package's own writeContainer/concatBytes then silently coerces to zero bytes is otherwise invisible to any test that only checks the real records' own content, since a handful of zero bytes can decode as one or more harmless, ignored phantom records rather than a parse failure.
export function assertNoPhantomRecords(record: PptRecord): void {
  for (const child of childRecords(record)) {
    expect(child.header.recType).not.toBe(0);
    assertNoPhantomRecords(child);
  }
}
