import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDocx } from "documents.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DocxOpenDocument, OdbOpenDocument } from "./types.js";
import { saveOpenDocumentAction } from "./save-document";

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "document-cli-save-action-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe("saveOpenDocumentAction", () => {
  it("returns SAVE_SUCCESS and actually writes the file on success", async () => {
    const editor = createDocx();
    editor.body.appendParagraph().appendRun({ text: "hello" });
    const doc: DocxOpenDocument = { format: "docx", editor, path: undefined };
    const path = join(workspace, "out.docx");

    const action = await saveOpenDocumentAction(doc, path);

    expect(action).toEqual({ type: "SAVE_SUCCESS", path });
    const bytes = await readFile(path);
    expect(bytes.byteLength).toBeGreaterThan(0);
  });

  it("returns SAVE_ERROR naming the path and the underlying message on failure", async () => {
    const doc: OdbOpenDocument = {
      format: "odb",
      tables: [],
      forms: [],
      reports: [],
      path: "source.odb",
    };
    const path = join(workspace, "out.odb");

    const action = await saveOpenDocumentAction(doc, path);

    if (action.type !== "SAVE_ERROR") {
      throw new Error(`expected SAVE_ERROR, got ${action.type}`);
    }
    expect(action.message).toContain(`Could not save ${path}:`);
    expect(action.message).toContain("opened read-only");
  });
});
