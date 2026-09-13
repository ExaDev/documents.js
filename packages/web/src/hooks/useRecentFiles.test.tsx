/// <reference lib="dom" />
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "../db/dexie";
import {
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
    await db.recentFiles.bulkAdd([
      { format: "docx", name: "oldest", sizeBytes: 1, lastOpenedAt: 1 },
      { format: "docx", name: "newest", sizeBytes: 1, lastOpenedAt: 2 },
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
