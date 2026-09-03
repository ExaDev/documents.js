import type { ContentDocument } from "document-schema.js";
import { describe, expect, it } from "vitest";
import { isDocBytes, parseClx, readDocContent, writeDocContent } from "../../src";
import { buildDoc } from "../../src/test-support/doc";

// Proves doc-codec's surface executes inside a Cloudflare Workers isolate (workerd, via @cloudflare/vitest-pool-workers) with no Node-only APIs. Every path here is byte arithmetic over Uint8Array and DataView plus archive-codec's compound-file reader; if any of it reached for node:fs, Buffer, or a Node-only global, the workerd isolate would throw rather than these passing. This is the runtime complement to the static no-restricted-imports guard eslint.config.ts enforces.
describe("doc-codec under the Cloudflare Workers runtime", () => {
  it("reads a whole synthetic .doc end to end", () => {
    const bytes = buildDoc({
      styles: [{ name: "Normal" }, { name: "heading 1" }],
      paragraphs: [
        { runs: [{ text: "Title" }], istd: 1 },
        {
          runs: [
            { text: "plain " },
            { text: "bold", grpprl: [0x35, 0x08, 0x01] },
          ],
        },
      ],
    });
    expect(isDocBytes(bytes)).toBe(true);

    const document = readDocContent(bytes);
    expect(document.kind).toBe("wordprocessing");
    if (document.kind !== "wordprocessing") return;
    const blocks = document.sections[0]?.blocks ?? [];
    expect(blocks).toHaveLength(2);
    const [heading, body] = blocks;
    expect(heading?.kind === "paragraph" && heading.headingLevel).toBe(1);
    expect(
      body?.kind === "paragraph" && body.runs.map((run) => run.text),
    ).toEqual(["plain ", "bold"]);
  });

  it("reads a compressed document, whose text is one byte per character", () => {
    const document = readDocContent(
      buildDoc({
        compressed: true,
        paragraphs: [{ runs: [{ text: "Eight-bit text." }] }],
      }),
    );
    if (document.kind !== "wordprocessing") throw new Error("wrong kind");
    const block = document.sections[0]?.blocks[0];
    expect(block?.kind === "paragraph" && block.runs[0]?.text).toBe(
      "Eight-bit text.",
    );
  });

  it("writes a whole synthetic .doc end to end, with no Node-only API", () => {
    const input: ContentDocument = {
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [
            {
              kind: "paragraph",
              runs: [
                { text: "plain " },
                { text: "bold", bold: true, color: { r: 1, g: 0, b: 0 } },
              ],
              alignment: "center",
            },
          ],
        },
      ],
    };
    const bytes = writeDocContent(input);
    expect(isDocBytes(bytes)).toBe(true);
    const result = readDocContent(bytes);
    if (result.kind !== "wordprocessing") throw new Error("wrong kind");
    const paragraph = result.sections[0]?.blocks[0];
    expect(paragraph?.kind === "paragraph" && paragraph.alignment).toBe(
      "center",
    );
    expect(
      paragraph?.kind === "paragraph" &&
        paragraph.runs.map((run) => run.text),
    ).toEqual(["plain ", "bold"]);
    expect(
      paragraph?.kind === "paragraph" && paragraph.runs[1]?.color,
    ).toEqual({ r: 1, g: 0, b: 0 });
  });

  it("parses a piece table without touching any Node API", () => {
    // [MS-DOC] 2.9.6's own example Clx, byte for byte, one structure per line.
    const clx = new Uint8Array([
      0x02, // Pcdt.clxt.
      0x28, 0x00, 0x00, 0x00, // Pcdt.lcb: a 40-byte PlcPcd, giving 4 CPs and 3 Pcds.
      0x00, 0x00, 0x00, 0x00, // aCp[0] = 0.
      0x06, 0x00, 0x00, 0x00, // aCp[1] = 6.
      0x0d, 0x00, 0x00, 0x00, // aCp[2] = 13.
      0x0e, 0x00, 0x00, 0x00, // aCp[3] = 14.
      0x01, 0x00, 0x22, 0x0c, 0x00, 0x00, 0x00, 0x00, // aPcd[0]: fNoParaLast, fc 0x00000C22 uncompressed.
      0x00, 0x00, 0x00, 0x08, 0x00, 0x40, 0x00, 0x00, // aPcd[1]: fc 0x00000800 with fCompressed set.
      0x00, 0x00, 0x0e, 0x08, 0x00, 0x40, 0x00, 0x00, // aPcd[2]: fc 0x0000080E with fCompressed set.
    ]);
    expect(clx.length).toBe(0x2d);
    const table = parseClx(clx);
    expect(table.pieces.map((piece) => piece.fc)).toEqual([
      0x0c22, 0x0800, 0x080e,
    ]);
    expect(table.lastCp).toBe(14);
  });
});
