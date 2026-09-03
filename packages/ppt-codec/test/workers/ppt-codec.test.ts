import { flattenTree } from "document-schema.js";
import { describe, expect, it } from "vitest";
import {
  CURRENT_USER_STREAM,
  POWERPOINT_DOCUMENT_STREAM,
  readPpt,
  readPptContent,
  readPptStreams,
  writePptContent,
} from "../../src";
import { compoundFile } from "../../src/test-support/compound-file";
import { syntheticPresentation } from "../../src/test-support/presentation";

// Proves ppt-codec's public read AND write surface executes inside a Cloudflare Workers isolate (workerd, via @cloudflare/vitest-pool-workers) with no Node-only APIs. The package is isomorphic by design -- a hand-written [MS-PPT] record walk over DataView and Uint8Array in both directions, with archive-codec's own isomorphic [MS-CFB] reader and writer beneath it and no node:fs, Buffer, or path anywhere -- so if any code path on either side of the package boundary reached for a Node-only API, this isolate would throw rather than these passing. The compound-file path matters here in its own right rather than being covered by the stream-level one: it is what pulls archive-codec into the isolate alongside this package's own code. This is the runtime complement to the node `vitest run --project unit` suite, not a replacement for it.
describe("ppt-codec under the Cloudflare Workers runtime", () => {
  const { currentUserStream, powerPointDocumentStream } =
    syntheticPresentation();
  const file = compoundFile([
    { name: CURRENT_USER_STREAM, bytes: currentUserStream },
    { name: POWERPOINT_DOCUMENT_STREAM, bytes: powerPointDocumentStream },
  ]);

  it("reads the two [MS-PPT] streams directly into slides", () => {
    const { slides } = readPptStreams(
      currentUserStream,
      powerPointDocumentStream,
    );
    expect(slides).toHaveLength(1);
    expect(slides[0]?.size).toEqual({ widthPt: 720, heightPt: 540 });
  });

  it("reads a whole compound file, exercising archive-codec's [MS-CFB] reader in the isolate too", () => {
    expect(readPptContent(file).slides[0]?.shapes[0]?.blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "Quarterly review" }] },
    ]);
  });

  it("assembles the tree form, running document-schema.js's own transform inside the isolate", () => {
    const tree = readPpt(file);
    expect(tree.kind).toBe("presentation");
    expect(flattenTree(tree).kind).toBe("presentation");
  });

  it("writes a presentation and reads it back, exercising archive-codec's [MS-CFB] writer in the isolate too", () => {
    const document = {
      metadata: {},
      slides: [
        {
          size: { widthPt: 720, heightPt: 540 },
          notes: "",
          shapes: [
            {
              frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
              insetLeftPt: 0,
              insetTopPt: 0,
              insetRightPt: 0,
              insetBottomPt: 0,
              blocks: [
                { kind: "paragraph" as const, runs: [{ text: "Written in the isolate" }] },
              ],
            },
          ],
        },
      ],
    };
    const written = readPptContent(writePptContent(document));
    expect(written.slides[0]?.shapes[0]?.blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "Written in the isolate" }] },
    ]);
  });
});
