import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bytesToBase64, createDocx } from "documents.js";
import { describe, expect, it } from "vitest";
import { odfFormulaBytes } from "../test-support/odf-formula-fixture";
import { outlineDocumentOperation } from "./outline";

describe("outlineDocumentOperation", () => {
  it("projects a heading and a plain paragraph as an outline, with the heading's own text/level/children and the paragraph's own kind/text", async () => {
    const editor = createDocx();
    editor.body.appendParagraph({ text: "Heading", headingLevel: 1 });
    editor.body.appendParagraph({ text: "Body text." });
    const bytesBase64 = bytesToBase64(editor.toBytes());

    const result = await outlineDocumentOperation.run({
      source: { bytesBase64, format: "docx" },
    });

    expect(result.sourceFormat).toBe("docx");
    expect(result.kind).toBe("wordprocessing");
    expect(result.outline).toEqual([
      {
        text: "Heading",
        level: 1,
        children: [{ kind: "paragraph", text: "Body text." }],
      },
    ]);
  });

  it("projects a standalone formula document's own single leaf as a 'formula'-kind child, identified structurally rather than by a kind field", async () => {
    const bytesBase64 = bytesToBase64(odfFormulaBytes());

    const result = await outlineDocumentOperation.run({
      source: { bytesBase64, format: "odf" },
    });

    expect(result.sourceFormat).toBe("odf");
    expect(result.kind).toBe("formula");
    expect(result.outline).toEqual([
      {
        text: "",
        level: 1,
        children: [{ kind: "formula", text: "" }],
      },
    ]);
  });

  it("propagates an already-aborted signal through to reading the document's own native tree", async () => {
    const editor = createDocx();
    editor.body.appendParagraph({ text: "Heading", headingLevel: 1 });
    const bytesBase64 = bytesToBase64(editor.toBytes());
    const controller = new AbortController();
    controller.abort();

    await expect(
      outlineDocumentOperation.run(
        { source: { bytesBase64, format: "docx" } },
        { signal: controller.signal },
      ),
    ).rejects.toThrow();
  });

  it("propagates an already-aborted signal through to resolving a path source's own bytes", async () => {
    const editor = createDocx();
    editor.body.appendParagraph({ text: "Heading", headingLevel: 1 });
    const dir = mkdtempSync(join(tmpdir(), "outline-test-"));
    const path = join(dir, "doc.docx");
    writeFileSync(path, editor.toBytes());
    const controller = new AbortController();
    controller.abort();

    await expect(
      outlineDocumentOperation.run(
        { source: { path } },
        { signal: controller.signal },
      ),
    ).rejects.toThrow();
  });
});
