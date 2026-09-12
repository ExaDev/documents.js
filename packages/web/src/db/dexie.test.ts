import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { db } from "./dexie";

beforeEach(async () => {
  await db.recentFiles.clear();
  await db.preferences.clear();
  await db.customFonts.clear();
  await db.editorSessions.clear();
});

afterEach(async () => {
  await db.recentFiles.clear();
  await db.preferences.clear();
  await db.customFonts.clear();
  await db.editorSessions.clear();
});

describe("DocumentsDatabase", () => {
  it("names the database exadev-documents", () => {
    expect(db.name).toBe("exadev-documents");
  });

  it("stores and retrieves a recent-file record with an auto-assigned id", async () => {
    const id = await db.recentFiles.add({
      format: "docx",
      name: "a.docx",
      sizeBytes: 42,
      lastOpenedAt: 1,
    });
    if (id === undefined) throw new Error("expected an auto-assigned id");
    const record = await db.recentFiles.get(id);
    expect(record?.name).toBe("a.docx");
    expect(record?.sizeBytes).toBe(42);
  });

  it("indexes recentFiles by format and lastOpenedAt for ordered/filtered queries", async () => {
    await db.recentFiles.bulkAdd([
      { format: "docx", name: "a", sizeBytes: 1, lastOpenedAt: 10 },
      { format: "pdf", name: "b", sizeBytes: 1, lastOpenedAt: 20 },
      { format: "docx", name: "c", sizeBytes: 1, lastOpenedAt: 30 },
    ]);
    const byFormat = await db.recentFiles
      .where("format")
      .equals("docx")
      .toArray();
    expect(byFormat.map((record) => record.name).sort()).toEqual(["a", "c"]);

    const ordered = await db.recentFiles.orderBy("lastOpenedAt").toArray();
    expect(ordered.map((record) => record.name)).toEqual(["a", "b", "c"]);
  });

  it("stores a preference record keyed by its own key column", async () => {
    await db.preferences.put({ key: "theme", value: "dark" });
    const record = await db.preferences.get("theme");
    expect(record?.value).toBe("dark");
  });

  it("stores and indexes custom-font records by family", async () => {
    const bytes = new Blob([new Uint8Array([1, 2, 3])]);
    await db.customFonts.add({
      family: "Custom Sans",
      bold: false,
      italic: false,
      bytes,
    });
    const found = await db.customFonts
      .where("family")
      .equals("Custom Sans")
      .first();
    expect(found?.bold).toBe(false);
    expect(found?.italic).toBe(false);
  });

  it("stores and indexes editor-session records by sessionId, format, lastSnapshotAt, and cleanlyClosed", async () => {
    await db.editorSessions.add({
      sessionId: "s1",
      format: "markdown",
      originalName: "a.md",
      lastSnapshotAt: 5,
      sizeBytes: 10,
      cleanlyClosed: false,
    });
    const found = await db.editorSessions
      .where("sessionId")
      .equals("s1")
      .first();
    expect(found?.originalName).toBe("a.md");
    expect(found?.cleanlyClosed).toBe(false);
  });
});
