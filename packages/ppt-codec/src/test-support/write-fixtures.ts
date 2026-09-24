// Fixtures and record-walking helpers shared by the writePptContent suites. They live here rather than in one of the test files because those suites are split across write.test.ts, write-drawing.test.ts and write-notes-and-ole.test.ts, and all three build the same minimal slides and reach into the same record trees. Excluded from the published build by tsdown.config.ts's own entry list, like every other src/test-support module.

import type { ContentBlock, ContentSlide } from "document-schema.js";
import {
  type PptRecord,
  childRecords,
  readRecordSequence,
} from "../record/tree";
import { RT_SlideListWithText } from "../record/types";

export function slide(overrides: Partial<ContentSlide> = {}): ContentSlide {
  return {
    size: { widthPt: 720, heightPt: 540 },
    shapes: [],
    notes: "",
    ...overrides,
  };
}

// One plain single-run paragraph block — the spelling every hand-built fixture in this file repeats.
export function paragraph(text: string): ContentBlock {
  return { kind: "paragraph", runs: [{ text }] };
}

// The PowerPoint Document stream's own top-level record sequence: the document container, every slide and notes container, the persist directory and the user edit, in the order the writer laid them out.
export function topLevelRecords(
  streamBytes: Uint8Array<ArrayBuffer>,
): PptRecord[] {
  return readRecordSequence(streamBytes, 0, streamBytes.length);
}

export function recordTypesIn(streamBytes: Uint8Array<ArrayBuffer>): number[] {
  return topLevelRecords(streamBytes).map((record) => record.header.recType);
}

// Narrows a lookup that the surrounding assertion has already established must succeed, so a test reads a record's fields without an `as` cast standing in for the check.
export function requireRecord(
  record: PptRecord | undefined,
  describe_: string,
): PptRecord {
  if (record === undefined) {
    throw new Error(`the writer produced no ${describe_}`);
  }
  return record;
}

export function listWithInstance(
  documentContainer: PptRecord,
  instance: number,
): PptRecord | undefined {
  return childRecords(documentContainer).find(
    (record) =>
      record.header.recType === RT_SlideListWithText &&
      record.header.recInstance === instance,
  );
}
