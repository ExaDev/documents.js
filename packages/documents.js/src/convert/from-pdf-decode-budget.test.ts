import { DEFAULT_LAYOUT_FONT } from "document-schema.js";
import { bytesToBase64, encodePng } from "byte-codec";
import { LAYOUT_FORMAT_VERSION, writePdf } from "pdf-codec";
import { describe, expect, it } from "vitest";
import { PdfDecodeBudgetError, PdfParseError } from "../index";
import { convertDocument } from "./composition-to-pdf";
import {
  pdfToDocx,
  pdfToMarkdown,
  readContentDocument,
  readNativeDocumentTree,
} from "./from-pdf";
import { encodeMarkdownText } from "../markdown/text";

const IMAGE_SIDE_PX = 64;
const RGB_CHANNELS = 3;
// A budget far beyond what the fixture decodes (its image's samples, some kilobytes).
const AMPLE_BUDGET = 1 << 24;

// One page of text and one image, which writePdf stores FlateDecode-compressed: reading it decodes the image's samples. Built once at module level, so the writer's first-use cost falls outside every test's timeout.
function imagePdf(): Uint8Array<ArrayBuffer> {
  const png = encodePng({
    width: IMAGE_SIDE_PX,
    height: IMAGE_SIDE_PX,
    channels: RGB_CHANNELS,
    data: new Uint8Array(IMAGE_SIDE_PX * IMAGE_SIDE_PX * RGB_CHANNELS),
  });
  return writePdf({
    formatVersion: LAYOUT_FORMAT_VERSION,
    metadata: {},
    images: {
      img1: {
        format: "png",
        base64: bytesToBase64(png),
        widthPx: IMAGE_SIDE_PX,
        heightPx: IMAGE_SIDE_PX,
      },
    },
    pages: [
      {
        widthPt: 300,
        heightPt: 300,
        items: [
          {
            kind: "text",
            text: "Caption text",
            xPt: 20,
            yPt: 250,
            font: DEFAULT_LAYOUT_FONT,
            sizePt: 12,
            color: { r: 0, g: 0, b: 0 },
          },
          {
            kind: "image",
            imageId: "img1",
            xPt: 20,
            yPt: 100,
            widthPt: 100,
            heightPt: 100,
          },
        ],
      },
    ],
  });
}

const IMAGE_PDF = imagePdf();

function refusal(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("the pdf conversions with maxDecodedBytes", () => {
  const conversions: readonly {
    readonly name: string;
    readonly run: (maxDecodedBytes?: number) => unknown;
  }[] = [
    {
      name: "pdfToMarkdown",
      run: (maxDecodedBytes) => pdfToMarkdown(IMAGE_PDF, { maxDecodedBytes }),
    },
    {
      name: "pdfToDocx",
      run: (maxDecodedBytes) => pdfToDocx(IMAGE_PDF, { maxDecodedBytes }),
    },
    {
      name: "convertDocument from pdf",
      run: (maxDecodedBytes) =>
        convertDocument("pdf", "ods", IMAGE_PDF, { maxDecodedBytes }),
    },
    {
      name: "readNativeDocumentTree",
      run: (maxDecodedBytes) =>
        readNativeDocumentTree("pdf", IMAGE_PDF, { maxDecodedBytes }),
    },
    {
      name: "readContentDocument",
      run: (maxDecodedBytes) =>
        readContentDocument("pdf", IMAGE_PDF, { maxDecodedBytes }),
    },
  ];

  for (const { name, run } of conversions) {
    it(`${name} refuses a pdf that would decode past the budget with PdfDecodeBudgetError, and converts one within it`, () => {
      const error = refusal(() => run(1));
      expect(error).toBeInstanceOf(PdfDecodeBudgetError);
      expect(error).toBeInstanceOf(PdfParseError);
      expect(refusal(() => run(AMPLE_BUDGET))).toBeUndefined();
    });
  }

  it("converts a pdf within the budget exactly as without one", () => {
    expect(pdfToMarkdown(IMAGE_PDF, { maxDecodedBytes: AMPLE_BUDGET })).toEqual(
      pdfToMarkdown(IMAGE_PDF),
    );
  });

  it("budgets only the caller's own pdf: an intermediate pdf a route renders is not charged", () => {
    const markdown = encodeMarkdownText("# Title\n\nBody.\n");
    expect(
      refusal(() =>
        convertDocument("markdown", "ods", markdown, { maxDecodedBytes: 0 }),
      ),
    ).toBeUndefined();
  });
});
