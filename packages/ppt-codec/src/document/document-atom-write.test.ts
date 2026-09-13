import { describe, expect, it } from "vitest";
import { readRecordAt } from "../record/tree";
import { readDocumentAtom } from "./document-atom";
import { writeDocumentAtom } from "./document-atom-write";

describe("writeDocumentAtom", () => {
  it("stamps recVer 0x1, which [MS-PPT] 2.4.2 mandates of a DocumentAtom", () => {
    const bytes = writeDocumentAtom({ widthPt: 720, heightPt: 540 });
    const record = readRecordAt(bytes, 0);
    expect(record.header.recVer).toBe(0x1);
  });

  it("round-trips the slide size, mirrored onto notesSize since this writer has no separate notes geometry", () => {
    const bytes = writeDocumentAtom({ widthPt: 720, heightPt: 540 });
    const atom = readDocumentAtom(readRecordAt(bytes, 0));
    expect(atom.slideSize).toEqual(atom.notesSize);
    expect(atom.slideSize.x).toBeGreaterThan(0);
    expect(atom.slideSize.y).toBeGreaterThan(0);
  });
});
