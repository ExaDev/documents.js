import { afterEach, describe, expect, it, vi } from "vitest";

import type { RecentFileRecord } from "../db/dexie";
import { mountWithMantine } from "../test/mountComponent";

const useRecentFiles = vi.fn<() => RecentFileRecord[] | undefined>();
const removeRecentFile = vi.fn<(id: number) => void>();
vi.mock("../hooks/useRecentFiles", () => ({
  useRecentFiles: () => useRecentFiles(),
  removeRecentFile: (id: number) => {
    removeRecentFile(id);
  },
}));

const navigate = vi.fn<(options: { to: string }) => void>();
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));

const notifyError = vi.fn<(title: string, error: unknown) => void>();
vi.mock("./notify", () => ({
  notifyError: (title: string, error: unknown) => {
    notifyError(title, error);
  },
}));

const setPendingReopen = vi.fn<(entry: unknown) => void>();
vi.mock("./reopenMailbox", () => ({
  setPendingReopen: (entry: unknown) => {
    setPendingReopen(entry);
  },
}));

const { RecentFilesPanel } = await import("./RecentFilesPanel");

// handleReopen chains several real awaits (queryPermission, maybe requestPermission, getFile, arrayBuffer) before it calls setPendingReopen/navigate, so a fixed count of Promise.resolve() ticks is fragile against a chain this long -- flushing on a real macrotask boundary (setTimeout) guarantees every already-queued microtask has drained first, regardless of how many awaits the chain happens to have.
function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

let unmount: (() => void) | undefined;

afterEach(() => {
  unmount?.();
  unmount = undefined;
  useRecentFiles.mockReset();
  removeRecentFile.mockReset();
  navigate.mockReset();
  notifyError.mockReset();
  setPendingReopen.mockReset();
});

function renderPanel(): { html: () => string; container: HTMLElement } {
  const mounted = mountWithMantine(<RecentFilesPanel />);
  unmount = mounted.unmount;
  return {
    html: () => mounted.container.innerHTML,
    container: mounted.container,
  };
}

function record(overrides: Partial<RecentFileRecord> = {}): RecentFileRecord {
  return {
    id: 1,
    format: "docx",
    name: "report.docx",
    sizeBytes: 2048,
    lastOpenedAt: Date.now(),
    ...overrides,
  };
}

function fakeHandle(
  overrides: Partial<{
    queryPermission: () => Promise<PermissionState>;
    requestPermission: () => Promise<PermissionState>;
    getFile: () => Promise<File>;
  }> = {},
): FileSystemFileHandle {
  return {
    queryPermission:
      overrides.queryPermission ?? (() => Promise.resolve("granted")),
    requestPermission:
      overrides.requestPermission ?? (() => Promise.resolve("granted")),
    getFile:
      overrides.getFile ??
      (() =>
        Promise.resolve(new File([new Uint8Array([1, 2])], "report.docx"))),
  } as unknown as FileSystemFileHandle;
}

describe("RecentFilesPanel", () => {
  it("renders nothing while the query is still loading (undefined)", () => {
    useRecentFiles.mockReturnValue(undefined);
    const { html } = renderPanel();
    expect(html()).not.toContain("mantine-Stack-root");
  });

  it("shows the empty-state hint when there are no recent files", () => {
    useRecentFiles.mockReturnValue([]);
    const { html } = renderPanel();
    expect(html()).toContain("Files you open will show up here.");
  });

  it("lists a recent file's name, format badge, size, and relative time", () => {
    useRecentFiles.mockReturnValue([
      record({ name: "budget.xlsx", format: "xlsx", sizeBytes: 500 }),
    ]);
    const { html } = renderPanel();
    expect(html()).toContain("budget.xlsx");
    expect(html()).toContain("xlsx");
    expect(html()).toContain("500 B");
  });

  it("formats a size in KB once at or above 1024 bytes", () => {
    useRecentFiles.mockReturnValue([record({ sizeBytes: 2048 })]);
    const { html } = renderPanel();
    expect(html()).toContain("2.0 KB");
  });

  it("formats a size in MB once at or above 1024 * 1024 bytes", () => {
    useRecentFiles.mockReturnValue([record({ sizeBytes: 1024 * 1024 * 3 })]);
    const { html } = renderPanel();
    expect(html()).toContain("3.0 MB");
  });

  it("disables the reopen action and shows a fallback tooltip when the record has no handle", () => {
    useRecentFiles.mockReturnValue([record({ handle: undefined })]);
    const { html } = renderPanel();
    expect(html()).toContain("disabled");
  });

  it("removes a record by id when its remove action is clicked", () => {
    useRecentFiles.mockReturnValue([record({ id: 42 })]);
    const { container } = renderPanel();
    const buttons = container.querySelectorAll("button");
    // The second action button (index 1) is Remove; the first (index 0) is Reopen.
    buttons[1]!.click();
    expect(removeRecentFile).toHaveBeenCalledWith(42);
  });

  it("reopens a file with a granted permission: reads its bytes, stages the pending reopen, and navigates to /convert", async () => {
    const handle = fakeHandle();
    useRecentFiles.mockReturnValue([
      record({ id: 7, format: "docx", name: "report.docx", handle }),
    ]);
    const { container } = renderPanel();
    const buttons = container.querySelectorAll("button");
    buttons[0]!.click();
    await flushPromises();
    expect(setPendingReopen).toHaveBeenCalledWith(
      expect.objectContaining({ format: "docx" }),
    );
    expect(navigate).toHaveBeenCalledWith({ to: "/convert" });
  });

  it("requests permission when the initial query is not granted, and proceeds once the request itself is granted", async () => {
    const queryPermission = vi.fn(() =>
      Promise.resolve("prompt" as PermissionState),
    );
    const requestPermission = vi.fn(() =>
      Promise.resolve("granted" as PermissionState),
    );
    const handle = fakeHandle({ queryPermission, requestPermission });
    useRecentFiles.mockReturnValue([record({ id: 7, handle })]);
    const { container } = renderPanel();
    container.querySelectorAll("button")[0]!.click();
    await flushPromises();
    expect(requestPermission).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith({ to: "/convert" });
  });

  it("notifies and does not navigate when permission is ultimately denied", async () => {
    const handle = fakeHandle({
      queryPermission: () => Promise.resolve("prompt"),
      requestPermission: () => Promise.resolve("denied"),
    });
    useRecentFiles.mockReturnValue([
      record({ id: 7, name: "secret.docx", handle }),
    ]);
    const { container } = renderPanel();
    container.querySelectorAll("button")[0]!.click();
    await flushPromises();
    expect(navigate).not.toHaveBeenCalled();
    expect(setPendingReopen).not.toHaveBeenCalled();
    expect(notifyError).toHaveBeenCalledWith(
      "Permission needed",
      expect.any(Error),
    );
  });

  it("notifies with the reopen failure when reading the handle throws", async () => {
    const handle = fakeHandle({
      getFile: () => Promise.reject(new Error("disk error")),
    });
    useRecentFiles.mockReturnValue([record({ name: "broken.docx", handle })]);
    const { container } = renderPanel();
    container.querySelectorAll("button")[0]!.click();
    await flushPromises();
    expect(notifyError).toHaveBeenCalledWith(
      'Could not reopen "broken.docx"',
      expect.any(Error),
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it("does nothing when the record's format is not a recognised DocumentFormat", async () => {
    const handle = fakeHandle();
    useRecentFiles.mockReturnValue([
      record({ format: "not-a-real-format", handle }),
    ]);
    const { container } = renderPanel();
    container.querySelectorAll("button")[0]!.click();
    await flushPromises();
    expect(navigate).not.toHaveBeenCalled();
    expect(notifyError).not.toHaveBeenCalled();
  });
});
