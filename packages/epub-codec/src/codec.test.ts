import { z } from "zod";
import { describe, expect, it } from "vitest";
import { epubCodec, epubContentCodec, EpubBytesSchema } from "./codec";
import { writeEpubContent } from "./write";

function sampleEpubBytes(): Uint8Array<ArrayBuffer> {
  return writeEpubContent({
    kind: "wordprocessing",
    metadata: { title: "Codec Test" },
    sections: [
      {
        pageSize: { widthPt: 595.28, heightPt: 841.89 },
        margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
        blocks: [{ kind: "paragraph", runs: [{ text: "Hello." }] }],
      },
    ],
  });
}

describe("EpubBytesSchema", () => {
  it("accepts real zip bytes", () => {
    expect(EpubBytesSchema.safeParse(sampleEpubBytes()).success).toBe(true);
  });

  it("rejects bytes with no zip header", () => {
    expect(
      EpubBytesSchema.safeParse(new Uint8Array([0, 1, 2, 3])).success,
    ).toBe(false);
  });
});

describe("epubContentCodec", () => {
  it("decodes to a ContentDocument and re-encodes to real zip bytes", () => {
    const bytes = sampleEpubBytes();
    const document = z.decode(epubContentCodec, bytes);
    expect(document.kind).toBe("wordprocessing");
    const reEncoded = z.encode(epubContentCodec, document);
    expect(EpubBytesSchema.safeParse(reEncoded).success).toBe(true);
  });
});

describe("epubCodec", () => {
  it("decodes to a DocumentTree", () => {
    const tree = z.decode(epubCodec, sampleEpubBytes());
    expect(tree.kind).toBe("wordprocessing");
  });
});
