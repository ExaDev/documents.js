// Smoke test: the built dist/ artifact loads and works under both ESM and CJS. Run only via `pnpm test:smoke` (tsdown, then vitest scoped to this file by vitest.config.ts's "smoke" project) -- never part of the default `pnpm test` file set, since it requires a fresh build to mean anything.
//
// This follows markdown-codec's and pdf-codec's own smoke.test.mjs shape: a representative slice of the public surface checked for presence in both builds, then real read -> write -> reparse assertions run against each build independently, proving the built artifact itself (not just the source under vitest's own transform) round-trips real RTF. Both encodings are exercised -- the tree-form readRtf/writeRtf/rtfCodec trio over document-schema.js's DocumentTree, and the flat readRtfContent/writeRtfContent/rtfContentCodec trio over its ContentDocument -- because the tree pair pulls document-schema.js's own assembleTree/flattenTree into the bundle, and a dual-build failure confined to that dependency would be invisible to a flat-only check.
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import * as esm from "../dist/index.js";

const require = createRequire(import.meta.url);
const cjs = require("../dist/index.cjs");

// A representative slice of the public surface, not an exhaustive list -- enough to catch a genuinely broken dual build without duplicating src/index.ts's own export list here. Error classes are real invocable functions at runtime (typeof === 'function'), so they're checked here alongside ordinary functions rather than in OBJECTS below.
const FUNCTIONS = [
  "readRtf",
  "writeRtf",
  "readRtfContent",
  "writeRtfContent",
  "rtfBytesFromLatin1",
  "mintRtfListNumId",
  "parseRtfListNumId",
  "NOOP_RTF_DIAGNOSTIC_SINK",
  "RtfParseError",
  "RtfWriteError",
  "RtfNotAnRtfDocumentError",
  "RtfInputTooLargeError",
  "RtfNestingLimitExceededError",
  "RtfUnsupportedDocumentKindError",
];
const OBJECTS = ["rtfCodec", "rtfContentCodec", "RtfBytesSchema", "RtfDiagnosticCodes"];

describe("dist/ exports are present in both builds", () => {
  for (const name of FUNCTIONS) {
    it(`${name} is a function`, () => {
      expect(typeof esm[name]).toBe("function");
      expect(typeof cjs[name]).toBe("function");
    });
  }

  for (const name of OBJECTS) {
    it(`${name} is exported`, () => {
      expect(esm[name]).toBeDefined();
      expect(cjs[name]).toBeDefined();
    });
  }
});

const SAMPLE_RTF =
  "{\\rtf1\\ansi\\ansicpg1252\\deff0" +
  "{\\fonttbl{\\f0\\froman\\fcharset0 Times New Roman;}{\\f1\\fswiss\\fcharset0 Arial;}}" +
  "{\\colortbl;\\red255\\green0\\blue0;}" +
  "{\\stylesheet{\\s1\\snext0 heading 1;}}" +
  "\\pard\\s1 Title\\par" +
  "\\pard Body with {\\b bold}, {\\i italic}, \\cf1 red\\cf0  and caf\\'e9.\\par" +
  "\\trowd\\trleft0\\cellx4320\\cellx8640\\pard\\intbl A\\cell\\pard\\intbl B\\cell\\row" +
  "\\pard After.\\par}";

describe.each([
  ["ESM", esm],
  ["CJS", cjs],
])("%s artifact behaviour", (_label, api) => {
  const source = api.rtfBytesFromLatin1(SAMPLE_RTF);

  it("reads real RTF into a wordprocessing DocumentTree", () => {
    const { documentPackage } = api.readRtf(source);
    expect(documentPackage.kind).toBe("wordprocessing");
    expect(documentPackage.children.length).toBeGreaterThan(0);
  });

  it("reads the body's text, formatting, colour and code-page-decoded characters", () => {
    const { document } = api.readRtfContent(source);
    const blocks = document.sections[0].blocks;
    const body = blocks.find(
      (block) => block.kind === "paragraph" && block.headingLevel === undefined,
    );
    expect(body.runs.map((run) => run.text).join("")).toBe(
      "Body with bold, italic, red and café.",
    );
    expect(body.runs.some((run) => run.bold === true)).toBe(true);
    expect(
      body.runs.some(
        (run) => run.color !== undefined && run.color.r === 1 && run.color.g === 0,
      ),
    ).toBe(true);
  });

  it("reads the table's rows and columns", () => {
    const { document } = api.readRtfContent(source);
    const table = document.sections[0].blocks.find(
      (block) => block.kind === "table",
    );
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0].cells).toHaveLength(2);
    expect(table.columnWidthsPt).toEqual([216, 216]);
  });

  it("writes the document back to RTF bytes that begin with the file header", () => {
    const { document } = api.readRtfContent(source);
    const written = api.writeRtfContent(document);
    expect(String.fromCharCode(...written.slice(0, 5))).toBe("{\\rtf");
    expect(written.every((byte) => byte < 0x80)).toBe(true);
  });

  it("round-trips the document's text through write then read", () => {
    const { document } = api.readRtfContent(source);
    const back = api.readRtfContent(api.writeRtfContent(document)).document;
    const body = back.sections[0].blocks.find(
      (block) => block.kind === "paragraph" && block.headingLevel === undefined,
    );
    expect(body.runs.map((run) => run.text).join("")).toBe(
      "Body with bold, italic, red and café.",
    );
  });

  it("exposes both z.codec pairs over the same bytes", () => {
    expect(api.rtfCodec.parse(source).kind).toBe("wordprocessing");
    expect(api.rtfContentCodec.parse(source).kind).toBe("wordprocessing");
  });
});
