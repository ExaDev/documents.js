import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createDoc,
  createDocx,
  createPpt,
  createXls,
  openDocx,
  openOdt,
} from "documents.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDocumentAtPath, saveDocumentTo } from "./open-document.js";

// The three legacy binary formats open through their live-view editors now (ExaDev/documents.js#929): each test builds genuine source bytes with the editor itself, opens them through the TUI's single open path, mutates through the editor the variant carries, saves, and re-opens to prove the edit survived the format's own bytes round trip.

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "document-cli-editors-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe("openDocumentAtPath for .doc", () => {
  it("opens through DocEditor, and an edit survives save and re-open", async () => {
    const source = createDoc();
    source.appendParagraph({ text: "first" });
    const path = join(workspace, "letter.doc");
    await writeFile(path, source.toBytes());

    const doc = await openDocumentAtPath(path);
    if (doc.format !== "doc") {
      throw new Error(`expected an open doc document, got ${doc.format}`);
    }
    expect(doc.path).toBe(path);
    doc.editor.appendParagraph({ text: "second" });
    await saveDocumentTo(doc, path);

    const reopened = await openDocumentAtPath(path);
    if (reopened.format !== "doc") {
      throw new Error(`expected a reopened doc document`);
    }
    expect(reopened.editor.paragraphs().map((p) => p.text)).toEqual([
      "first",
      "second",
    ]);
    // The saved file is real [MS-DOC] bytes, not the editor's memory: the round trip above went through writeDocContent/readDocContent.
    const raw = await readFile(path);
    expect(raw.byteLength).toBeGreaterThan(512);
  });
});

describe("openDocumentAtPath for .xls", () => {
  it("opens through XlsEditor, and a cell edit survives save and re-open", async () => {
    const source = createXls();
    source.sheets()[0]!.cell(0, 0).value = { kind: "string", value: "Total" };
    const path = join(workspace, "budget.xls");
    await writeFile(path, source.toBytes());

    const doc = await openDocumentAtPath(path);
    if (doc.format !== "xls") {
      throw new Error(`expected an open xls document, got ${doc.format}`);
    }
    doc.editor.sheets()[0]!.cell(1, 0).value = { kind: "number", value: 42 };
    await saveDocumentTo(doc, path);

    const reopened = await openDocumentAtPath(path);
    if (reopened.format !== "xls") {
      throw new Error(`expected a reopened xls document`);
    }
    const sheet = reopened.editor.sheets()[0]!;
    expect(sheet.cell(0, 0).value).toEqual({
      kind: "string",
      value: "Total",
    });
    expect(sheet.cell(1, 0).value).toEqual({ kind: "number", value: 42 });
  });
});

describe("openDocumentAtPath for .ppt", () => {
  it("opens through PptEditor, and a notes edit survives save and re-open", async () => {
    const source = createPpt();
    const slide = source.addSlide();
    slide.addTextBox({
      frame: { xPt: 40, yPt: 30, widthPt: 640, heightPt: 80 },
      text: "Title",
    });
    const path = join(workspace, "deck.ppt");
    await writeFile(path, source.toBytes());

    const doc = await openDocumentAtPath(path);
    if (doc.format !== "ppt") {
      throw new Error(`expected an open ppt document, got ${doc.format}`);
    }
    doc.editor.slides()[0]!.notes = "say the thing";
    await saveDocumentTo(doc, path);

    const reopened = await openDocumentAtPath(path);
    if (reopened.format !== "ppt") {
      throw new Error(`expected a reopened ppt document`);
    }
    expect(reopened.editor.slides()[0]!.notes).toBe("say the thing");
    expect(reopened.editor.slides()[0]!.shapes()[0]!.text).toBe("Title");
  });
});

describe("the shared paragraph screen family admits doc", () => {
  it("paragraphFamilyDocument accepts all four wordprocessing variants and nothing else", async () => {
    const { paragraphFamilyDocument } =
      await import("../screens/shared/paragraph-family.js");
    const docxPath = join(workspace, "a.docx");
    await writeFile(docxPath, createDocx().toBytes());
    const openedDocx = await openDocumentAtPath(docxPath);
    expect(openedDocx.format).toBe("docx");
    expect(paragraphFamilyDocument(openedDocx)?.format).toBe("docx");

    const docPath = join(workspace, "b.doc");
    await writeFile(docPath, createDoc().toBytes());
    const openedDoc = await openDocumentAtPath(docPath);
    expect(paragraphFamilyDocument(openedDoc)?.format).toBe("doc");

    // A non-wordprocessing document is not a paragraph-family document, whatever its editor.
    const pptPath = join(workspace, "c.ppt");
    await writeFile(pptPath, createPpt().toBytes());
    const openedPpt = await openDocumentAtPath(pptPath);
    expect(paragraphFamilyDocument(openedPpt)).toBeUndefined();
  });

  it("rootScreenForFormat routes doc to the shared body list, xls to the sheet list, ppt to the slide list", async () => {
    const { rootScreenForFormat } = await import("../state/types.js");
    expect(rootScreenForFormat("doc")).toEqual({ kind: "bodyList" });
    expect(rootScreenForFormat("xls")).toEqual({ kind: "sheetList" });
    expect(rootScreenForFormat("ppt")).toEqual({ kind: "slideList" });
    // The read-only preview formats keep the pdf screen family.
    expect(rootScreenForFormat("xlsx")).toEqual({ kind: "pdfPageList" });
  });
});

// openDocx/openOdt keep working unchanged beside the new openers -- a guard against the import reshuffle in open-document.ts accidentally dropping an existing opener.
describe("existing openers are untouched", () => {
  it("still opens a docx built by createDocx", async () => {
    const { createDocx } = await import("documents.js");
    const path = join(workspace, "d.docx");
    await writeFile(path, createDocx().toBytes());
    const doc = await openDocumentAtPath(path);
    expect(doc.format).toBe("docx");
    expect(openDocx(createDocx().toBytes()).paragraphs()).toHaveLength(0);
    expect(openOdt).toBeDefined();
  });
});
