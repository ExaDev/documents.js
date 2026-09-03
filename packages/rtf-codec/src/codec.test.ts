import { describe, expect, it } from "vitest";
import { flattenTree } from "document-schema.js";
import { rtfCodec, rtfContentCodec, RtfBytesSchema } from "./codec";
import { readRtfContent } from "./read";
import { bytes } from "./test-support/bytes";

const SAMPLE = bytes(
  "{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0\\froman\\fcharset0 Times New Roman;}}" +
    "\\pard\\plain \\fs24 Hello, {\\b world}.\\par}",
);

describe("RtfBytesSchema", () => {
  it("accepts bytes beginning with the {\\rtf the <File> production requires", () => {
    expect(RtfBytesSchema.safeParse(SAMPLE).success).toBe(true);
  });

  it("rejects bytes that are not an RTF file at all", () => {
    expect(RtfBytesSchema.safeParse(bytes("PK")).success).toBe(false);
  });

  it("accepts a version parameter other than 1, which a future document could still carry", () => {
    expect(RtfBytesSchema.safeParse(bytes("{\\rtf2\\ansi}")).success).toBe(
      true,
    );
  });
});

describe("rtfCodec", () => {
  it("decodes bytes to a DocumentTree", () => {
    const documentPackage = rtfCodec.parse(SAMPLE);
    expect(documentPackage.kind).toBe("wordprocessing");
  });

  it("encodes a DocumentTree back to bytes an RTF reader accepts", () => {
    const documentPackage = rtfCodec.parse(SAMPLE);
    const encoded = rtfCodec.encode(documentPackage);
    expect(RtfBytesSchema.safeParse(encoded).success).toBe(true);
  });
});

describe("rtfContentCodec", () => {
  it("decodes bytes to the same flat document readRtfContent produces", () => {
    expect(rtfContentCodec.parse(SAMPLE)).toEqual(
      readRtfContent(SAMPLE).document,
    );
  });

  it("agrees with the tree codec once the tree is flattened", () => {
    expect(flattenTree(rtfCodec.parse(SAMPLE))).toEqual(
      rtfContentCodec.parse(SAMPLE),
    );
  });

  it("round-trips text through encode then parse", () => {
    const document = rtfContentCodec.parse(SAMPLE);
    const back = rtfContentCodec.parse(rtfContentCodec.encode(document));
    const paragraph =
      back.kind === "wordprocessing" ? back.sections[0]?.blocks[0] : undefined;
    expect(
      paragraph?.kind === "paragraph"
        ? paragraph.runs.map((run) => run.text).join("")
        : undefined,
    ).toBe("Hello, world.");
  });
});
