import { describe, expect, it } from "vitest";
import { MAX_WALK_DEPTH } from "archive-codec";
import { unzipPackage, zipPackage } from "../zip";
import { oleObjectBin } from "../test-support/cfb";
import {
  minimalDocxBytes,
  minimalPptxBytes,
  minimalXlsxBytes,
} from "../test-support/embedded";
import { readEmbeddedOoxmlPayload } from "./embedded";

// Coverage for the shared embedded-object decode (src/typed/embedded.ts): nested-ZIP payload bytes -> flavour detection -> the matching typed reader -> the ContentEmbeddedObject payload (objectKind + a genuinely recovered nested ContentDocument). Fixtures come from src/test-support/embedded.ts -- real minimal OOXML packages zipped inline, because the pipeline under test unzips actual bytes (a hand-built Package value would skip the parse step entirely).

const enc = (s: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(s);

describe("readEmbeddedOoxmlPayload", () => {
  it("decodes an embedded xlsx payload into a spreadsheet embedded document", () => {
    const payload = readEmbeddedOoxmlPayload(minimalXlsxBytes());
    expect(payload?.objectKind).toBe("spreadsheet");
    expect(payload?.document.kind).toBe("spreadsheet");
    // The nested document carries the workbook's real content, not just an envelope.
    const sheet =
      payload?.document.kind === "spreadsheet"
        ? payload.document.sheets[0]
        : undefined;
    expect(sheet?.name).toBe("Embedded");
    expect(sheet?.cells[0]?.value).toEqual({
      kind: "string",
      value: "Recovered cell",
    });
  });

  it("decodes an embedded docx payload into a wordprocessing embedded document", () => {
    const payload = readEmbeddedOoxmlPayload(minimalDocxBytes());
    expect(payload?.objectKind).toBe("wordprocessing");
    expect(payload?.document.kind).toBe("wordprocessing");
    const paragraph =
      payload?.document.kind === "wordprocessing"
        ? payload.document.sections[0]?.blocks[0]
        : undefined;
    expect(paragraph?.kind).toBe("paragraph");
    expect(
      paragraph?.kind === "paragraph" ? paragraph.runs[0]?.text : undefined,
    ).toBe("Embedded memo");
  });

  it("decodes an embedded pptx payload into a presentation embedded document", () => {
    const payload = readEmbeddedOoxmlPayload(minimalPptxBytes());
    expect(payload?.objectKind).toBe("presentation");
    expect(payload?.document.kind).toBe("presentation");
    const slide =
      payload?.document.kind === "presentation"
        ? payload.document.slides[0]
        : undefined;
    expect(slide?.shapes[0]?.blocks[0]?.kind).toBe("paragraph");
  });

  it("decodes an xlsx wrapped in a classic OLE compound-file Package stream (the .bin spelling)", () => {
    // The legacy real-world shape: oleObject1.bin is a CFB compound file whose root storage carries the embedded file as an OLE-packaged 'Package' stream -- here a mini-stream-resident one, since a small embed lands below the 4096-byte cutoff. The recovery must see through both wrappings (compound file, then OLE packaging) to the ZIP and reuse the same nested-package decode the direct-ZIP spelling takes.
    const payload = readEmbeddedOoxmlPayload(oleObjectBin(minimalXlsxBytes()));
    expect(payload?.objectKind).toBe("spreadsheet");
    expect(payload?.document.kind).toBe("spreadsheet");
    const sheet =
      payload?.document.kind === "spreadsheet"
        ? payload.document.sheets[0]
        : undefined;
    expect(sheet?.name).toBe("Embedded");
    expect(sheet?.cells[0]?.value).toEqual({
      kind: "string",
      value: "Recovered cell",
    });
  });

  it("returns undefined for a well-formed compound file carrying no Package stream (native legacy streams stay opaque)", () => {
    // A .bin whose CFB holds a native stream (BIFF Workbook, WordDocument, ...) rather than a Package stream: outside this recovery's scope by design, so the payload degrades to nothing without a throw.
    expect(
      readEmbeddedOoxmlPayload(
        oleObjectBin(enc("legacy native stream bytes"), {
          streamName: "Workbook",
        }),
      ),
    ).toBeUndefined();
  });

  it("returns undefined for a compound file whose Package stream holds a non-ZIP file", () => {
    // The OLE packaging wrapping something other than an OOXML package (a plain text file, say) has no nested document to recover.
    expect(
      readEmbeddedOoxmlPayload(
        oleObjectBin(enc("just some packaged text, not a zip")),
      ),
    ).toBeUndefined();
  });

  it("returns undefined for a non-ZIP payload (the classic OLE compound file)", () => {
    // The OLE/CFB magic bytes -- the legacy .bin spelling of an embedded object, which no reader in this ecosystem decodes.
    const bytes = new Uint8Array([
      0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x01, 0x02, 0x03, 0x04,
    ]);
    expect(readEmbeddedOoxmlPayload(bytes)).toBeUndefined();
  });

  it("returns undefined for a ZIP that is not a recognisable OOXML package (a plain archive, not a document)", () => {
    // A "Package"-ProgID embed of a plain .zip: valid archive, none of the three OOXML entry parts. An embedded payload is second-order content -- the caller chose to open the host document, not this archive -- so an unrecognisable flavour is a degrade-tier non-event, never a thrown error that kills the host read.
    const bytes = zipPackage({
      "readme.txt": enc("just a file, not a document package"),
    });
    expect(readEmbeddedOoxmlPayload(bytes)).toBeUndefined();
  });

  it("returns undefined for a corrupt ZIP payload (magic bytes present, structure truncated)", () => {
    // A truncated archive passes the magic-byte gate (the gate is four bytes long and cannot see structural corruption), then fails inside the unzip itself -- the raw inflate failure must degrade exactly like an unrecognisable flavour rather than propagating out of the host read.
    const truncated = minimalDocxBytes().slice(0, 30);
    expect(readEmbeddedOoxmlPayload(truncated)).toBeUndefined();
  });

  it("returns undefined for a docx payload whose document part carries no w:body", () => {
    // The entry part exists and parses, but readDocxContent's own precondition (a w:body to walk) does not hold -- detection verifies that precondition before dispatching, so a malformed nested docx degrades instead of throwing from inside the nested read.
    const bytes = zipPackage({
      "word/document.xml": enc(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>',
      ),
    });
    expect(readEmbeddedOoxmlPayload(bytes)).toBeUndefined();
  });

  it("returns undefined for a payload whose entries nest ZIPs beyond archive-codec's walk depth, even when its root is a valid xlsx", () => {
    // The nested decode runs behind archive-codec's recursive-walk guards (a depth cap and one shared cumulative decompressed-bytes budget -- the bounded inflate this package's own fflate unzip has no equivalent of). This payload IS a valid xlsx at its root, but it also carries an entry that is a chain of ZIPs nested one level deeper than MAX_WALK_DEPTH -- the shape a decompression bomb's nesting leverage takes. A walk that hits a guard limit means the payload as a whole stands outside the guards' contract, so no embedded block is decoded from it at all; without the gateway the root flavour would decode fine and the deep chain would ride along as an inert binary part.
    let chain: Uint8Array<ArrayBuffer> = minimalXlsxBytes();
    for (let level = 0; level <= MAX_WALK_DEPTH; level++) {
      chain = zipPackage({ "nest.zip": chain });
    }
    const bombShaped = zipPackage({
      ...unzipPackage(minimalXlsxBytes()),
      "word/embeddings/deep.bin": chain,
    });
    expect(readEmbeddedOoxmlPayload(bombShaped)).toBeUndefined();
  });
});
