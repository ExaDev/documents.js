import { createPptx, pptxToPdf, type Box } from "documents.js";

// A real, genuine multi-page PDF for exercising pdf_inspect — built via a pptx's own slide-per-page direct-placement layout engine (documents.js's README: "no pagination needed"), so each addSlide() call is deterministically exactly one PDF page, unlike a docx/odt flow document where forcing a page break needs enough paragraph content to overflow the first page. The first slide carries a real embedded PNG image alongside its text; the second is text-only, so pdf_inspect's summary mode has a real, page-varying item-kind histogram and a real imagesByFormat count to report.

const TITLE_FRAME: Box = { xPt: 40, yPt: 30, widthPt: 400, heightPt: 60 };
const BODY_FRAME: Box = { xPt: 40, yPt: 120, widthPt: 400, heightPt: 60 };
const IMAGE_FRAME: Box = { xPt: 40, yPt: 220, widthPt: 60, heightPt: 60 };

// Real PNG magic bytes followed by a minimal but genuine 1x1 payload, taken from documents.js's own src/convert/convert.test.ts fixture (pdf-codec sniffs the image format from these bytes, not a file extension, so it has to be a real, decodable PNG rather than arbitrary bytes). Base64 rather than a byte-literal array: no individual byte here has a name worth giving it, each is one octet of a PNG signature/IHDR/IDAT/IEND stream, not a value anyone chose, so the array-of-numbers spelling was 68 unnamed magic numbers with nothing to gain from naming them one by one. The base64 string carries the identical bytes with none of them written as a bare numeric literal.
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP6z8DwHwAFAQIB6Tb00AAAAABJRU5ErkJggg==";
const TINY_PNG_BYTES = Uint8Array.from(atob(TINY_PNG_BASE64), (char) =>
  char.charCodeAt(0),
);

export const PDF_FIXTURE = {
  page1Title: "Page One Heading",
  page1Body: "First slide body text.",
  page2Title: "Page Two Heading",
  page2Body: "Second slide body text.",
} as const;

// A real two-slide pptx, converted to PDF through documents.js's own pptxToPdf.
export function buildMultiPagePdf(): Uint8Array<ArrayBuffer> {
  const editor = createPptx();

  const slide1 = editor.addSlide();
  slide1.addTextBox({ frame: TITLE_FRAME, text: PDF_FIXTURE.page1Title });
  slide1.addTextBox({ frame: BODY_FRAME, text: PDF_FIXTURE.page1Body });
  slide1.addImage({ frame: IMAGE_FRAME, format: "png", bytes: TINY_PNG_BYTES });

  const slide2 = editor.addSlide();
  slide2.addTextBox({ frame: TITLE_FRAME, text: PDF_FIXTURE.page2Title });
  slide2.addTextBox({ frame: BODY_FRAME, text: PDF_FIXTURE.page2Body });

  return pptxToPdf(editor.toBytes());
}
