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

interface PersistContext {
  readonly streamBytes: Uint8Array<ArrayBuffer>;
  readonly directory: ReadonlyMap<number, number>;
  readonly documentContainer: PptRecord;
}

// The three resolve* entry points below all need the same three things, and reaching any one of them means walking the CurrentUserAtom to the user edit, the user edit to the persist directory, and the directory to the document container. Stated once here so the walk, and the description a failed lookup reports itself by, exist in one place rather than three copies that can drift apart.
function persistContext(
  currentUserStream: Uint8Array<ArrayBuffer>,
  powerPointDocumentStream: Uint8Array<ArrayBuffer>,
): PersistContext {
  const currentUser = readCurrentUserAtom(currentUserStream);
  const { directory, currentEdit } = buildPersistDirectory(
    powerPointDocumentStream,
    currentUser.offsetToCurrentEdit,
  );
  return {
    streamBytes: powerPointDocumentStream,
    directory,
    documentContainer: resolvePersistObject(
      powerPointDocumentStream,
      directory,
      currentEdit.docPersistIdRef,
      "test fixture's own docPersistIdRef",
    ),
  };
}

// The document's own two RT_SlideListWithText containers. A list is the masters list by its own recInstance; every other instance is treated as the slides list, which is what the fidelity suites have always relied on and is correct for a fixture whose slides list precedes its notes list.
export function slideLists(documentContainer: PptRecord): {
  readonly masters: PptRecord | undefined;
  readonly slides: PptRecord | undefined;
} {
  const lists = childRecords(documentContainer).filter(
    (record) => record.header.recType === RT_SlideListWithText,
  );
  return {
    masters: lists.find(
      (record) => record.header.recInstance === SLIDE_LIST_INSTANCE_MASTERS,
    ),
    slides: lists.find(
      (record) => record.header.recInstance !== SLIDE_LIST_INSTANCE_MASTERS,
    ),
  };
}

// The persist ID the first entry of a slide list names. An absent list and a present but empty one are the same failure to a fixture that is supposed to carry one, so both report it the same way.
export function firstPersistIdRef(
  list: PptRecord | undefined,
  what: string,
): number {
  const [entry] = list === undefined ? [] : readSlideListWithText(list);
  if (entry === undefined) {
    throw new Error(`test fixture always carries a ${what} list entry`);
  }
  return entry.persistIdRef;
}

export function resolveDocumentContainer(
  currentUserStream: Uint8Array<ArrayBuffer>,
  powerPointDocumentStream: Uint8Array<ArrayBuffer>,
): PptRecord {
  return persistContext(currentUserStream, powerPointDocumentStream)
    .documentContainer;
}

// Resolves the persist object named by the first entry of one of the document's slide lists. `what` names the list in both failures this can report, an absent or empty list and an entry the persist directory does not carry, so the word is stated once rather than once per message.
function resolveFromSlideList(
  context: PersistContext,
  list: PptRecord | undefined,
  what: string,
): PptRecord {
  return resolvePersistObject(
    context.streamBytes,
    context.directory,
    firstPersistIdRef(list, what),
    `test fixture's own ${what} persist entry`,
  );
}

export function resolveMasterContainer(
  currentUserStream: Uint8Array<ArrayBuffer>,
  powerPointDocumentStream: Uint8Array<ArrayBuffer>,
): PptRecord {
  const context = persistContext(currentUserStream, powerPointDocumentStream);
  return resolveFromSlideList(
    context,
    slideLists(context.documentContainer).masters,
    "master",
  );
}

export function resolveSlideContainer(
  currentUserStream: Uint8Array<ArrayBuffer>,
  powerPointDocumentStream: Uint8Array<ArrayBuffer>,
): PptRecord {
  const context = persistContext(currentUserStream, powerPointDocumentStream);
  return resolveFromSlideList(
    context,
    slideLists(context.documentContainer).slides,
    "slide",
  );
}

// The document's own slide list container itself (RT_SlideListWithText, recInstance SLIDES), distinct from resolveSlideContainer, which follows its own SlidePersistAtom on to the actual SlideContainer. Needed for fidelity checks against the list's own raw entries (a SlidePersistAtom's cTexts field, an inserted phantom record) rather than anything the slide container holds.
export function requireSlideList(documentContainer: PptRecord): PptRecord {
  const { slides } = slideLists(documentContainer);
  if (slides === undefined) {
    throw new Error("test fixture always carries a slide list entry");
  }
  return slides;
}

export function resolveSlideListRecord(
  currentUserStream: Uint8Array<ArrayBuffer>,
  powerPointDocumentStream: Uint8Array<ArrayBuffer>,
): PptRecord {
  return requireSlideList(
    resolveDocumentContainer(currentUserStream, powerPointDocumentStream),
  );
}

// Recursively asserts no record anywhere beneath `record` has recType 0, the header a run of raw zero bytes decodes as. A mutant that splices non-byte content (a string, `undefined`) into a children array this package's own writeContainer/concatBytes then silently coerces to zero bytes is otherwise invisible to any test that only checks the real records' own content, since a handful of zero bytes can decode as one or more harmless, ignored phantom records rather than a parse failure.
export function assertNoPhantomRecords(record: PptRecord): void {
  for (const child of childRecords(record)) {
    expect(child.header.recType).not.toBe(0);
    assertNoPhantomRecords(child);
  }
}
