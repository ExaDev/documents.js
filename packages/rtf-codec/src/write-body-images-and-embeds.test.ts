import { describe, expect, it } from "vitest";
import { RtfDiagnosticCodes } from "./diagnostics";
import { asciiText } from "./test-support/bytes";
import { writeRtfContent } from "./write";
import { wordprocessing, write } from "./test-support/wordprocessing-document";

describe("images and embedded objects", () => {
  it("writes an image as a hex-payload \\pict inside the \\*\\shppict wrapper", () => {
    // A one-pixel PNG.
    const base64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const out = write(
      wordprocessing([
        {
          kind: "image",
          format: "png",
          base64,
          widthPt: 72,
          heightPt: 36,
        },
      ]),
    );
    expect(out).toContain(
      "{\\*\\shppict{\\pict\\pngblip\\picwgoal1440\\pichgoal720",
    );
    expect(out).toContain("89504e470d0a1a0a");
    // A top-level image (inTable defaults to false, via writeImageParagraph) writes no \intbl and closes with its own trailing \par — the sibling table-cell test above proves the opposite for inTable: true. Checked as the exact contiguous prefix, not a loose \intbl substring search: that alone would still pass if some OTHER text were wrongly substituted into the ternary's false branch instead of "".
    expect(out).toContain("\\pard\\plain {\\*\\shppict");
    expect(out).toContain("}}\\par");
  });

  it("writes \\jpegblip rather than \\pngblip for a jpeg image", () => {
    const out = write(
      wordprocessing([
        {
          kind: "image",
          format: "jpeg",
          base64: "/9j/",
          widthPt: 72,
          heightPt: 36,
        },
      ]),
    );
    expect(out).toContain("{\\*\\shppict{\\pict\\jpegblip");
    expect(out).not.toContain("pngblip");
  });

  it("wraps a hex payload at exactly HEX_LINE_LENGTH (128) with no trailing empty line at the boundary", () => {
    // A 64-byte payload is exactly 128 hex characters — the loop's own final index (128) must NOT run another iteration, or wrapHex would push a spurious empty final "line" (128 <= 128 true, hex.slice(128, 256) === "") and join in an extra line ending nothing else produced.
    const base64 =
      "q6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6urqw==";
    const out = write(
      wordprocessing([
        { kind: "image", format: "png", base64, widthPt: 72, heightPt: 36 },
      ]),
    );
    expect(out).toContain(`${"ab".repeat(64)}}}`);
  });

  it("wraps a hex payload longer than HEX_LINE_LENGTH into real chunks, not the whole payload repeated per line", () => {
    // A 100-byte payload is 200 hex characters — two lines, the first exactly 128 characters and the second the remaining 72, not the full 200-character hex string pushed twice.
    const base64 =
      "zc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3NzQ==";
    const out = write(
      wordprocessing([
        { kind: "image", format: "png", base64, widthPt: 72, heightPt: 36 },
      ]),
    );
    const firstLine = "cd".repeat(64);
    const secondLine = "cd".repeat(36);
    expect(out).toContain(`${firstLine}\n${secondLine}}}`);
  });

  it("reports rather than mislabelling an svg or gif image, RTF's \\pict destination having no picture-type keyword for either", () => {
    for (const format of ["svg", "gif"] as const) {
      const diagnostics: { code: string; message: string }[] = [];
      const out = asciiText(
        writeRtfContent(
          wordprocessing([
            {
              kind: "image",
              format,
              base64: "AA==",
              widthPt: 72,
              heightPt: 36,
            },
          ]),
          {
            sink: (diagnostic) => {
              diagnostics.push({
                code: diagnostic.code,
                message: diagnostic.message,
              });
            },
          },
        ),
      );
      expect(diagnostics).toEqual([
        {
          code: RtfDiagnosticCodes.UNSUPPORTED_PICTURE_FORMAT,
          message: `an image block in ${format} format cannot be written: RTF's \\pict destination has no picture-type keyword for it, so the image is dropped rather than mislabelled as a format it is not`,
        },
      ]);
      expect(out).not.toContain("\\pict");
    }
  });

  it("reports rather than writing an empty \\pict destination for an image whose base64 payload does not decode to anything", () => {
    const diagnostics: { code: string; message: string }[] = [];
    const out = asciiText(
      writeRtfContent(
        wordprocessing([
          {
            kind: "image",
            format: "png",
            base64: "not valid base64!!",
            widthPt: 72,
            heightPt: 36,
          },
        ]),
        {
          sink: (diagnostic) => {
            diagnostics.push({
              code: diagnostic.code,
              message: diagnostic.message,
            });
          },
        },
      ),
    );
    expect(diagnostics).toEqual([
      {
        code: RtfDiagnosticCodes.UNSUPPORTED_PICTURE_FORMAT,
        message:
          "an image block's base64 payload could not be decoded, so no \\pict destination is written for it",
      },
    ]);
    expect(out).not.toContain("\\pict");
  });

  it("reports the same empty-payload gap for a genuinely empty base64 string, distinct from one that fails to decode at all", () => {
    // base64ToBytes("") returns a real, defined, zero-length Uint8Array rather than undefined — the one reachable way bytes.length === 0 fires on its own, separate from the bytes === undefined branch the malformed-string case above already covers.
    const diagnostics: { code: string; message: string }[] = [];
    const out = asciiText(
      writeRtfContent(
        wordprocessing([
          {
            kind: "image",
            format: "png",
            base64: "",
            widthPt: 72,
            heightPt: 36,
          },
        ]),
        {
          sink: (diagnostic) => {
            diagnostics.push({
              code: diagnostic.code,
              message: diagnostic.message,
            });
          },
        },
      ),
    );
    expect(diagnostics).toEqual([
      {
        code: RtfDiagnosticCodes.UNSUPPORTED_PICTURE_FORMAT,
        message:
          "an image block's base64 payload could not be decoded, so no \\pict destination is written for it",
      },
    ]);
    expect(out).not.toContain("\\pict");
  });

  it("writes an embedded object as a real [MS-CFB] compound file inside \\object's \\objdata", () => {
    const out = write(
      wordprocessing([
        {
          kind: "embeddedObject",
          objectKind: "spreadsheet",
          frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 50 },
          document: { kind: "spreadsheet", metadata: {}, sheets: [] },
        },
      ]),
    );
    expect(out).toContain("{\\object\\objemb\\objw2000\\objh1000");
    expect(out).toContain("{\\*\\objclass spreadsheet}");
    expect(out).toContain("{\\*\\objdata");
    // The [MS-CFB] magic bytes (D0 CF 11 E0 A1 B1 1A E1) — proof the \objdata payload is a genuine compound file, not a placeholder or an opaque blob.
    expect(out).toContain("d0cf11e0a1b11ae1");
    expect(out).toContain(
      "{\\result{\\pard\\plain [embedded spreadsheet object]\\par}}}",
    );
    // A top-level embedded object (inTable defaults to false) writes no \intbl and closes with its own trailing \par — the sibling table-cell test proves the opposite for inTable: true. Checked as the exact contiguous prefix, not a loose \intbl substring search, for the same reason the sibling image test above is.
    expect(out).toContain("\\pard\\plain {\\object\\objemb");
    expect(out).toMatch(/\\par\n\}$/);
  });
});
