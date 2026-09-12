import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { db } from "../db/dexie";
import { recordRecentFile, removeRecentFile } from "./useRecentFiles";

beforeEach(async () => {
  await db.recentFiles.clear();
});

afterEach(async () => {
  await db.recentFiles.clear();
});

describe("recordRecentFile", () => {
  it("stamps the entry with the current time and stores it", async () => {
    await recordRecentFile({ format: "docx", name: "a.docx", sizeBytes: 10 });
    const all = await db.recentFiles.toArray();
    expect(all).toHaveLength(1);
    expect(all[0]?.name).toBe("a.docx");
    expect(typeof all[0]?.lastOpenedAt).toBe("number");
  });

  it("evicts the single stalest entry once the table exceeds its 20-entry limit", async () => {
    for (let i = 0; i < 20; i++) {
      await recordRecentFile({
        format: "docx",
        name: `file-${i}`,
        sizeBytes: 1,
      });
    }
    expect(await db.recentFiles.count()).toBe(20);

    await recordRecentFile({ format: "docx", name: "file-20", sizeBytes: 1 });

    const remaining = await db.recentFiles.count();
    expect(remaining).toBe(20);
    const names = (await db.recentFiles.toArray()).map((r) => r.name);
    expect(names).not.toContain("file-0");
    expect(names).toContain("file-20");
  });

  it("does not evict anything while at or under the limit", async () => {
    for (let i = 0; i < 20; i++) {
      await recordRecentFile({
        format: "docx",
        name: `file-${i}`,
        sizeBytes: 1,
      });
    }
    const names = (await db.recentFiles.toArray()).map((r) => r.name);
    expect(names).toHaveLength(20);
    expect(names).toContain("file-0");
  });
});

describe("removeRecentFile", () => {
  it("deletes the record with the given id", async () => {
    const id = await db.recentFiles.add({
      format: "docx",
      name: "a.docx",
      sizeBytes: 1,
      lastOpenedAt: 1,
    });
    if (id === undefined) throw new Error("expected an auto-assigned id");
    await removeRecentFile(id);
    expect(await db.recentFiles.get(id)).toBeUndefined();
  });
});
