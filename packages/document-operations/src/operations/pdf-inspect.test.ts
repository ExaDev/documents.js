import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bytesToBase64, createPdf } from "documents.js";
import { describe, expect, it } from "vitest";
import { pdfInspectOperation } from "./pdf-inspect";

describe("pdfInspectOperation", () => {
  it("summarises a PDF page carrying real items, with a per-page item-kind histogram and an image-format count", async () => {
    const onePixelPng = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      ),
      (char) => char.charCodeAt(0),
    );
    const editor = createPdf();
    const page = editor.page(0);
    if (page === undefined) {
      throw new Error("expected createPdf() to start with one page");
    }
    page.appendText({
      xPt: 10,
      yPt: 10,
      text: "one",
      font: { family: "Helvetica", weight: "normal", style: "normal" },
      sizePt: 12,
      color: { r: 0, g: 0, b: 0 },
    });
    page.appendText({
      xPt: 10,
      yPt: 30,
      text: "two",
      font: { family: "Helvetica", weight: "normal", style: "normal" },
      sizePt: 12,
      color: { r: 0, g: 0, b: 0 },
    });
    page.appendRect({
      xPt: 0,
      yPt: 0,
      widthPt: 5,
      heightPt: 5,
      fill: { r: 0, g: 0, b: 0 },
    });
    page.appendImage({
      xPt: 0,
      yPt: 0,
      widthPt: 1,
      heightPt: 1,
      bytes: onePixelPng,
      format: "png",
    });
    const bytesBase64 = bytesToBase64(editor.toBytes());

    const result = await pdfInspectOperation.run({
      source: { bytesBase64, format: "pdf" },
    });

    if (!("pageCount" in result)) {
      throw new Error("expected a summary, not a full LayoutDocument");
    }
    expect(result.pageCount).toBe(1);
    expect(result.pages[0]?.widthPt).toBeGreaterThan(0);
    expect(result.pages[0]?.heightPt).toBeGreaterThan(0);
    expect(result.pages[0]?.itemKinds).toEqual({ text: 2, rect: 1, image: 1 });
    expect(result.imagesByFormat).toEqual({ png: 1 });
  });

  it("returns the entire parsed LayoutDocument when full: true is given", async () => {
    const bytesBase64 = bytesToBase64(createPdf().toBytes());
    const result = await pdfInspectOperation.run({
      source: { bytesBase64, format: "pdf" },
      full: true,
    });
    expect("pageCount" in result).toBe(false);
    if (!("pages" in result)) {
      throw new Error("expected a full LayoutDocument");
    }
    expect(Array.isArray(result.pages)).toBe(true);
  });

  it("rejects a non-pdf source", async () => {
    const bytesBase64 = bytesToBase64(new TextEncoder().encode("not a pdf"));
    await expect(
      pdfInspectOperation.run({
        source: { bytesBase64, format: "markdown" },
      }),
    ).rejects.toThrow(/requires a PDF document/);
  });

  it("propagates an already-aborted signal through to parsing the PDF", async () => {
    const bytesBase64 = bytesToBase64(createPdf().toBytes());
    const controller = new AbortController();
    controller.abort();

    await expect(
      pdfInspectOperation.run(
        { source: { bytesBase64, format: "pdf" } },
        { signal: controller.signal },
      ),
    ).rejects.toThrow();
  });

  it("propagates an already-aborted signal through to resolving a path source's own bytes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pdf-inspect-test-"));
    const path = join(dir, "doc.pdf");
    writeFileSync(path, createPdf().toBytes());
    const controller = new AbortController();
    controller.abort();

    await expect(
      pdfInspectOperation.run(
        { source: { path } },
        { signal: controller.signal },
      ),
    ).rejects.toThrow();
  });
});
