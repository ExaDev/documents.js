import { describe, expect, it } from "vitest";
import { flattenTree } from "document-schema.js";
import {
  readRtf,
  readRtfContent,
  rtfBytesFromLatin1,
  writeRtf,
  writeRtfContent,
} from "../../src";

// Proves rtf-codec's public read/write surface executes inside a Cloudflare Workers isolate (workerd, via @cloudflare/vitest-pool-workers) with no Node-only APIs -- both encodings: the tree-form readRtf/writeRtf pair over document-schema.js's DocumentTree, and the flat readRtfContent/writeRtfContent pair over its ContentDocument. The codec is isomorphic by design -- a hand-written tokenizer, destination state machine, code page tables and writer, with only zod as a runtime sibling -- so if either direction touched a Node-only API the workerd isolate would throw instead of these passing.
//
// Two places in this package would be tempting to write with a Node-only shortcut, and this suite is what proves neither was: src/base64.ts's hand-written base64/hex encoders (Buffer.from(bytes).toString('base64') is the Node one-liner they exist instead of) and src/codepage.ts's own byte-to-character tables (iconv-lite is Node-only and is banned by name in this package's eslint config). Both are on the paths below -- the picture case reaches base64, and the accented text reaches cp1252.
//
// The tree pair matters here in its own right rather than being covered by the flat one: it runs document-schema.js's own assembleTree/flattenTree inside the isolate too, so this is equally a check that the schema package's package-boundary transform is Worker-isomorphic on the path this package puts it on. This is the runtime complement to the existing node `vitest run --project unit` suite, not a replacement for it.
describe("rtf-codec under the Cloudflare Workers runtime", () => {
  const source = rtfBytesFromLatin1(
    "{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0\\froman\\fcharset0 Times New Roman;}}" +
      "{\\colortbl;\\red255\\green0\\blue0;}" +
      "{\\stylesheet{\\s1\\snext0 heading 1;}}" +
      "\\pard\\s1 A Heading\\par\\pard caf\\'e9 and {\\b bold} and \\u915 ?\\par}",
  );

  it("readRtf lowers a heading and paragraph to a wordprocessing DocumentTree", () => {
    const { documentPackage } = readRtf(source);
    expect(documentPackage.kind).toBe("wordprocessing");
    expect(documentPackage.children.length).toBeGreaterThan(0);
  });

  it("decodes a \\'hh byte through its code page table, which needs no Node encoding API", () => {
    const { document } = readRtfContent(source);
    const blocks =
      document.kind === "wordprocessing"
        ? (document.sections[0]?.blocks ?? [])
        : [];
    const body = blocks[1];
    expect(
      body?.kind === "paragraph"
        ? body.runs.map((run) => run.text).join("")
        : undefined,
    ).toBe("café and bold and Γ");
  });

  it("writeRtf round-trips that package back to bytes containing the heading text", () => {
    const { documentPackage } = readRtf(source);
    const written = writeRtf(documentPackage);
    expect(String.fromCharCode(...written)).toContain("A Heading");
  });

  it("flattens a package to exactly the document readRtfContent produces", () => {
    expect(flattenTree(readRtf(source).documentPackage)).toEqual(
      readRtfContent(source).document,
    );
  });

  it("encodes an image's base64 payload as hex without Buffer", () => {
    const written = writeRtfContent({
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [
            {
              kind: "image",
              format: "png",
              base64:
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
              widthPt: 72,
              heightPt: 36,
            },
          ],
        },
      ],
    });
    expect(String.fromCharCode(...written)).toContain("89504e470d0a1a0a");
  });
});
