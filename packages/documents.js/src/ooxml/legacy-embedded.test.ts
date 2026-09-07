import { describe, expect, it } from "vitest";
import { writeDocContent } from "doc-codec";
import { writeXlsContent } from "xls-codec";
import { writePptContent } from "ppt-codec";
import { decodeLegacyEmbeddedObject } from "./legacy-embedded";

// ExaDev/documents.js#921: doc-codec/xls-codec/ppt-codec's own writers produce genuine, real compound-file bytes -- exactly the shape a classic Word 97/Excel 97/PowerPoint 97 OLE embedding takes -- so these round-trip through the real writer rather than a hand-built fixture, the same discipline doc-codec's own write.test.ts states for its writer round trips.

describe("decodeLegacyEmbeddedObject", () => {
  it("recovers a wordprocessing document from real .doc-shaped compound-file bytes", () => {
    const bytes = writeDocContent({
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [
            { kind: "paragraph", runs: [{ text: "Legacy Word content" }] },
          ],
        },
      ],
    });
    const payload = decodeLegacyEmbeddedObject(bytes);
    expect(payload?.objectKind).toBe("wordprocessing");
    const doc = payload?.document;
    if (doc?.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing document");
    }
    const paragraph = doc.sections[0]?.blocks[0];
    expect(
      paragraph?.kind === "paragraph" ? paragraph.runs[0]?.text : undefined,
    ).toBe("Legacy Word content");
  });

  it("recovers a spreadsheet document from real .xls-shaped compound-file bytes", () => {
    const bytes = writeXlsContent({
      kind: "spreadsheet",
      metadata: {},
      sheets: [
        {
          name: "Sheet1",
          cells: [
            {
              row: 0,
              column: 0,
              value: { kind: "string", value: "Legacy Excel content" },
              displayText: "Legacy Excel content",
            },
          ],
          columns: [],
          rows: [],
          images: [],
          printSettings: {
            pageSize: { widthPt: 612, heightPt: 792 },
            margins: { topPt: 54, rightPt: 50.4, bottomPt: 54, leftPt: 50.4 },
            gridlines: false,
            headers: false,
            pageOrder: "downThenOver",
          },
        },
      ],
    });
    const payload = decodeLegacyEmbeddedObject(bytes);
    expect(payload?.objectKind).toBe("spreadsheet");
    const doc = payload?.document;
    if (doc?.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet document");
    }
    expect(doc.sheets[0]?.cells[0]?.value).toEqual({
      kind: "string",
      value: "Legacy Excel content",
    });
  });

  it("recovers a presentation document from real .ppt-shaped compound-file bytes", () => {
    const bytes = writePptContent({
      metadata: {},
      slides: [
        {
          size: { widthPt: 720, heightPt: 540 },
          shapes: [],
          notes: "",
        },
      ],
    });
    const payload = decodeLegacyEmbeddedObject(bytes);
    expect(payload?.objectKind).toBe("presentation");
    expect(payload?.document.kind).toBe("presentation");
  });

  it("returns undefined for bytes that carry no compound-file signature at all", () => {
    expect(
      decodeLegacyEmbeddedObject(new TextEncoder().encode("not a CFB file")),
    ).toBeUndefined();
  });
});
