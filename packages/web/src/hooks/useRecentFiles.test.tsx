/// <reference lib="dom" />
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "../db/dexie";
import {
  definedIds,
  recordRecentFile,
  removeRecentFile,
  type RecentFileEntry,
  useRecentFiles,
} from "./useRecentFiles";

function mountUseRecentFiles() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const result: { current: ReturnType<typeof useRecentFiles> } = {
    current: undefined,
  };

  function Harness() {
    result.current = useRecentFiles();
    return null;
  }

  act(() => {
    root.render(<Harness />);
  });

  return {
    result,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

beforeEach(async () => {
  await db.recentFiles.clear();
});

afterEach(async () => {
  await db.recentFiles.clear();
});

describe("useRecentFiles", () => {
  it("returns entries ordered by lastOpenedAt, most recent first", async () => {
    // Inserted in the OPPOSITE order from lastOpenedAt (newest row added first) -- natural table/insertion order would read back [newest, oldest] unsorted, then .reverse() would wrongly flip it to [oldest, newest]. Only a genuine orderBy("lastOpenedAt") produces the correct [newest, oldest] here.
    await db.recentFiles.bulkAdd([
      { format: "docx", name: "newest", sizeBytes: 1, lastOpenedAt: 2 },
      { format: "docx", name: "oldest", sizeBytes: 1, lastOpenedAt: 1 },
    ]);
    const { result, unmount } = mountUseRecentFiles();
    await vi.waitFor(() => {
      expect(result.current).toBeDefined();
    });
    expect(result.current?.map((entry) => entry.name)).toEqual([
      "newest",
      "oldest",
    ]);
    unmount();
  });

  it("caps the returned list at 20 entries even when more exist", async () => {
    const entries: (RecentFileEntry & { lastOpenedAt: number })[] = Array.from(
      { length: 25 },
      (_, index) => ({
        format: "docx",
        name: `file-${index}`,
        sizeBytes: 1,
        lastOpenedAt: index,
      }),
    );
    await db.recentFiles.bulkAdd(entries);
    const { result, unmount } = mountUseRecentFiles();
    await vi.waitFor(() => {
      expect(result.current?.length).toBe(20);
    });
    unmount();
  });
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
    // Inserted in the OPPOSITE order from lastOpenedAt (file-19's own lastOpenedAt is the smallest, despite being added last) -- natural insertion order would evict whichever row happens to sort first by id, not by lastOpenedAt. Only a genuine orderBy("lastOpenedAt") picks file-19 as the actual stalest row.
    await db.recentFiles.bulkAdd(
      Array.from({ length: 20 }, (_, i) => ({
        format: "docx" as const,
        name: `file-${i}`,
        sizeBytes: 1,
        lastOpenedAt: 20 - i,
      })),
    );
    expect(await db.recentFiles.count()).toBe(20);

    await recordRecentFile({ format: "docx", name: "file-20", sizeBytes: 1 });

    const remaining = await db.recentFiles.count();
    expect(remaining).toBe(20);
    const names = (await db.recentFiles.toArray()).map((r) => r.name);
    expect(names).not.toContain("file-19");
    expect(names).toContain("file-0");
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

  // A stale count of 0 (or negative, below the limit) skips the eviction query entirely, rather than running it anyway against a limit Dexie is guaranteed to resolve as "nothing to delete" -- IndexedDB's own getAll count is spec'd [EnforceRange] unsigned long, so a genuinely negative limit throws in a real browser rather than gracefully returning zero rows the way this suite's fake-indexeddb backend happens to for the specific query shape Dexie takes below the fast-path threshold. Asserting on bulkDelete's own call count (never on the resulting row count, which converges to the same "nothing changed" outcome via either path) is what actually distinguishes "skipped" from "ran and found nothing to do".
  it("never queries for stale rows to delete while at or under the limit", async () => {
    const bulkDeleteSpy = vi.spyOn(db.recentFiles, "bulkDelete");
    for (let i = 0; i < 20; i++) {
      await recordRecentFile({
        format: "docx",
        name: `file-${i}`,
        sizeBytes: 1,
      });
    }
    expect(bulkDeleteSpy).not.toHaveBeenCalled();
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

describe("definedIds", () => {
  it("keeps only the records whose id is actually defined", () => {
    expect(definedIds([{ id: 1 }, { id: undefined }, { id: 3 }])).toEqual([
      1, 3,
    ]);
  });

  it("returns an empty array when every record's id is undefined", () => {
    expect(definedIds([{ id: undefined }, { id: undefined }])).toEqual([]);
  });
});
