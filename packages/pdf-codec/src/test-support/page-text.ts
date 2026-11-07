import { readPdf } from "../read";

/**
 * The text the first page of a PDF reads as, its text items joined in reading order.
 * @param pdf - The PDF's bytes.
 * @returns The page's text, empty for a PDF with no page.
 */
export function pageText(pdf: Uint8Array<ArrayBuffer>): string {
  return (
    readPdf(pdf)
      .pages[0]?.items.flatMap((item) =>
        item.kind === "text" ? [item.text] : [],
      )
      .join("") ?? ""
  );
}
