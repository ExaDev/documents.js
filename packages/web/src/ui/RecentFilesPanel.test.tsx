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

const navigate = vi.fn<(options: Readonly<{ to: string }>) => void>();
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));

const notifyError = vi.fn<(title: string, error: unknown) => void>();
vi.mock("./notify", () => ({
  notifyError: (title: string, error: unknown) => {
    notifyError(title, error);
  },
}));

const openDocument = vi.fn<(file: Readonly<{ name: string }>) => void>();
vi.mock("../document/OpenDocumentContext", () => ({
  useOpenDocument: () => ({ document: undefined, openDocument }),
}));

const { formatBytes, reopenTooltipLabel, RecentFilesPanel } =
  await import("./RecentFilesPanel");

// handleReopen chains several real awaits (queryPermission, maybe requestPermission, getFile, arrayBuffer) before it calls openDocument/navigate, so a fixed count of Promise.resolve() ticks is fragile against a chain this long — flushing on a real macrotask boundary (setTimeout) guarantees every already-queued microtask has drained first, regardless of how many awaits the chain happens to have.
function flushPromises(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

let unmount: (() => void) | undefined;

afterEach(() => {
  unmount?.();
  unmount = undefined;
  useRecentFiles.mockReset();
  removeRecentFile.mockReset();
  navigate.mockReset();
  notifyError.mockReset();
  openDocument.mockReset();
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
  overrides: Readonly<
    Partial<{
      queryPermission: () => Promise<PermissionState>;
      requestPermission: () => Promise<PermissionState>;
      getFile: () => Promise<File>;
    }>
  > = {},
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

  it("formats exactly 1024 bytes as KB, not B", () => {
    useRecentFiles.mockReturnValue([record({ sizeBytes: 1024 })]);
    const { html } = renderPanel();
    expect(html()).toContain("1.0 KB");
    expect(html()).not.toContain("1024 B");
  });

  it("formats a size in MB once at or above 1024 * 1024 bytes", () => {
    useRecentFiles.mockReturnValue([record({ sizeBytes: 1024 * 1024 * 3 })]);
    const { html } = renderPanel();
    expect(html()).toContain("3.0 MB");
  });

  it("formats exactly 1024 * 1024 bytes as MB, not KB", () => {
    useRecentFiles.mockReturnValue([record({ sizeBytes: 1024 * 1024 })]);
    const { html } = renderPanel();
    expect(html()).toContain("1.0 MB");
    expect(html()).not.toContain("1024.0 KB");
  });

  it("separates the size and relative time with a space around the middle dot", () => {
    useRecentFiles.mockReturnValue([record({ sizeBytes: 500 })]);
    const { container } = renderPanel();
    const sizeText = Array.from(container.querySelectorAll("p")).find((p) =>
      p.textContent.includes("500 B"),
    );
    expect(sizeText?.textContent).toMatch(/^500 B · /);
  });

  it("enables the reopen action when the record has a handle", () => {
    useRecentFiles.mockReturnValue([record({ handle: fakeHandle() })]);
    const { container } = renderPanel();
    const reopenButton =
      container.querySelectorAll<HTMLButtonElement>("button")[0];
    expect(reopenButton?.disabled).toBe(false);
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

  it("reopens a file with a granted permission: reads its bytes, opens it as the shared document, and navigates to /convert", async () => {
    const handle = fakeHandle();
    useRecentFiles.mockReturnValue([
      record({ id: 7, format: "docx", name: "report.docx", handle }),
    ]);
    const { container } = renderPanel();
    const buttons = container.querySelectorAll("button");
    buttons[0]!.click();
    await flushPromises();
    expect(openDocument).toHaveBeenCalledWith(
      expect.objectContaining({ name: "report.docx", handle }),
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
    expect(openDocument).not.toHaveBeenCalled();
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

  it("opens on the strength of the filename, so a record whose stored format string is stale still reopens", async () => {
    const handle = fakeHandle();
    useRecentFiles.mockReturnValue([
      record({ format: "not-a-real-format", name: "report.docx", handle }),
    ]);
    const { container } = renderPanel();
    container.querySelectorAll("button")[0]!.click();
    await flushPromises();
    expect(openDocument).toHaveBeenCalledWith(
      expect.objectContaining({ name: "report.docx" }),
    );
    expect(navigate).toHaveBeenCalledWith({ to: "/convert" });
    expect(notifyError).not.toHaveBeenCalled();
  });

  it("queries permission in read mode, and skips requesting it again once already granted", async () => {
    const queryPermission = vi.fn(() =>
      Promise.resolve("granted" as PermissionState),
    );
    const requestPermission = vi.fn(() =>
      Promise.resolve("denied" as PermissionState),
    );
    const handle = fakeHandle({ queryPermission, requestPermission });
    useRecentFiles.mockReturnValue([record({ id: 7, handle })]);
    const { container } = renderPanel();
    container.querySelectorAll("button")[0]!.click();
    await flushPromises();
    expect(queryPermission).toHaveBeenCalledWith({ mode: "read" });
    expect(requestPermission).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith({ to: "/convert" });
  });

  it("requests permission in read mode when the initial query is not granted", async () => {
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
    expect(requestPermission).toHaveBeenCalledWith({ mode: "read" });
  });

  it("names the record in the permission-denied error message", async () => {
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
    const [, error] = notifyError.mock.calls[0] as [string, Error];
    expect(error.message).toBe('Access to "secret.docx" was not granted.');
  });
});

describe("formatBytes", () => {
  it("formats bytes below 1024 as a plain byte count", () => {
    expect(formatBytes(500)).toBe("500 B");
  });

  it("formats exactly 1024 bytes as KB, not B", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
  });

  it("formats exactly 1024 * 1024 bytes as MB, not KB", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
  });
});

describe("reopenTooltipLabel", () => {
  it("labels a handle-backed record for reopening", () => {
    expect(reopenTooltipLabel(true)).toBe("Reopen in Convert");
  });

  it("explains why a handle-less record can't be reopened directly", () => {
    expect(reopenTooltipLabel(false)).toBe(
      "This browser can't reopen files directly — pick it again from the tool you need",
    );
  });
});
