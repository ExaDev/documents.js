import type { FileWithPath } from "@mantine/dropzone";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FileAccessPort, OpenedFile } from "../ports/fileAccess";
import { mountWithMantine } from "../test/mountComponent";

const recordRecentFile = vi.fn();
vi.mock("../hooks/useRecentFiles", () => ({ recordRecentFile }));

const createFileAccess = vi.fn<() => FileAccessPort>();
vi.mock("../adapters/fileAccess/createFileAccess", () => ({
  createFileAccess: () => createFileAccess(),
}));

// Stands in for the real @mantine/dropzone Dropzone: FileUpload.tsx's own logic (handleDrop, handleClick, the accept/activateOnClick wiring) is what this test exercises, not the third-party drag-and-drop machinery Dropzone itself provides -- that library's internals are out of this package's mutate glob entirely. Exposes onDrop/onClick as plain props a test can call directly (onDrop via the module-scope holder below, since nothing in the rendered output can trigger it the way a real click event triggers onClick), and renders every child (including the Accept/Reject/Idle slots) unconditionally so their content is always inspectable.
let latestOnDrop: ((files: FileWithPath[]) => void) | undefined;

vi.mock("@mantine/dropzone", () => {
  function MockDropzone(props: {
    onDrop: (files: FileWithPath[]) => void;
    onClick: (() => void) | undefined;
    activateOnClick: boolean;
    disabled: boolean | undefined;
    loading: boolean | undefined;
    accept: Record<string, string[]> | undefined;
    children: React.ReactNode;
  }) {
    latestOnDrop = props.onDrop;
    return (
      <button
        type="button"
        data-testid="dropzone"
        data-activate-on-click={String(props.activateOnClick)}
        data-disabled={String(props.disabled)}
        data-loading={String(props.loading)}
        data-accept={JSON.stringify(props.accept ?? null)}
        data-has-onclick={String(props.onClick !== undefined)}
        onClick={props.onClick}
      >
        {props.children}
      </button>
    );
  }
  MockDropzone.Accept = (props: { children: React.ReactNode }) => (
    <div data-testid="accept-slot">{props.children}</div>
  );
  MockDropzone.Reject = (props: { children: React.ReactNode }) => (
    <div data-testid="reject-slot">{props.children}</div>
  );
  MockDropzone.Idle = (props: { children: React.ReactNode }) => (
    <div data-testid="idle-slot">{props.children}</div>
  );
  return { Dropzone: MockDropzone };
});

const { FileUpload } = await import("./FileUpload");

let unmount: (() => void) | undefined;

afterEach(() => {
  unmount?.();
  unmount = undefined;
  recordRecentFile.mockClear();
  createFileAccess.mockReset();
});

function fileAccessStub(
  overrides: Partial<FileAccessPort> = {},
): FileAccessPort {
  return {
    supportsNativePicker: () => false,
    openFile: () => Promise.resolve(undefined),
    saveFile: () => Promise.resolve({}),
    ...overrides,
  };
}

interface RenderedUpload {
  html: () => string;
  click: () => void;
  drop: (files: FileWithPath[]) => void;
}

function renderUpload(
  props: Partial<Parameters<typeof FileUpload>[0]> & {
    onFile?: (file: OpenedFile) => void;
  } = {},
): RenderedUpload {
  const onFile = props.onFile ?? vi.fn();
  latestOnDrop = undefined;
  const mounted = mountWithMantine(<FileUpload onFile={onFile} {...props} />);
  unmount = mounted.unmount;
  return {
    html: () => mounted.container.innerHTML,
    click: () => {
      mounted.container
        .querySelector<HTMLButtonElement>('[data-testid="dropzone"]')
        ?.click();
    },
    drop: (files: FileWithPath[]) => {
      latestOnDrop?.(files);
    },
  };
}

interface DroppedFileOverrides {
  name?: string;
  bytes?: number[];
  handle?: FileSystemFileHandle;
}

function droppedFile(overrides: DroppedFileOverrides = {}): FileWithPath {
  const bytes = new Uint8Array(overrides.bytes ?? [1, 2, 3]);
  const name = overrides.name ?? "test.docx";
  const file: FileWithPath = Object.assign(new File([bytes], name), {
    path: name,
    // Overridden rather than left to jsdom's own Blob/File implementation: this test asserts on the exact bytes toOpenedFile reads back, and a real arrayBuffer() round trip through jsdom's Blob internals is an unnecessary source of timing/behaviour variance for what is otherwise a synchronous, known input.
    arrayBuffer: () => Promise.resolve(bytes.buffer),
    handle: overrides.handle,
  });
  return file;
}

describe("FileUpload", () => {
  it("shows the upload icon and drag hint when no file is present", () => {
    createFileAccess.mockReturnValue(fileAccessStub());
    const { html } = renderUpload();
    expect(html()).toContain("Drag a file here or click to browse");
  });

  it("shows the file icon and the file's own name when a file is present", () => {
    createFileAccess.mockReturnValue(fileAccessStub());
    const { html } = renderUpload({
      file: { bytes: new Uint8Array([1]), name: "report.pdf" },
    });
    expect(html()).toContain("report.pdf");
    expect(html()).not.toContain("Drag a file here");
  });

  it("shows the format hint only when there is no file yet", () => {
    createFileAccess.mockReturnValue(fileAccessStub());
    const { html } = renderUpload({ formatHint: "docx, odt, or pdf" });
    expect(html()).toContain("docx, odt, or pdf");
  });

  it("hides the format hint once a file is present", () => {
    createFileAccess.mockReturnValue(fileAccessStub());
    const { html } = renderUpload({
      formatHint: "docx, odt, or pdf",
      file: { bytes: new Uint8Array([1]), name: "report.pdf" },
    });
    expect(html()).not.toContain("docx, odt, or pdf");
  });

  it("passes loading and disabled straight through to the dropzone", () => {
    createFileAccess.mockReturnValue(fileAccessStub());
    const { html } = renderUpload({ loading: true, disabled: true });
    expect(html()).toContain('data-loading="true"');
    expect(html()).toContain('data-disabled="true"');
  });

  it("normalises a single accept extension string into an array", () => {
    createFileAccess.mockReturnValue(fileAccessStub());
    const { html } = renderUpload({
      accept: { "application/pdf": ".pdf" },
    });
    expect(html()).toContain("&quot;application/pdf&quot;:[&quot;.pdf&quot;]");
  });

  it("leaves an already-array accept extension list untouched", () => {
    createFileAccess.mockReturnValue(fileAccessStub());
    const { html } = renderUpload({
      accept: { "application/pdf": [".pdf", ".PDF"] },
    });
    expect(html()).toContain(
      "&quot;application/pdf&quot;:[&quot;.pdf&quot;,&quot;.PDF&quot;]",
    );
  });

  it("passes no accept prop through when accept is undefined", () => {
    createFileAccess.mockReturnValue(fileAccessStub());
    const { html } = renderUpload();
    expect(html()).toContain('data-accept="null"');
  });

  it("enables click-to-open and disables Dropzone's own activateOnClick when the native picker is supported", () => {
    createFileAccess.mockReturnValue(
      fileAccessStub({ supportsNativePicker: () => true }),
    );
    const { html } = renderUpload();
    expect(html()).toContain('data-has-onclick="true"');
    expect(html()).toContain('data-activate-on-click="false"');
  });

  it("leaves click-to-open to Dropzone's own activateOnClick when there is no native picker", () => {
    createFileAccess.mockReturnValue(fileAccessStub());
    const { html } = renderUpload();
    expect(html()).toContain('data-has-onclick="false"');
    expect(html()).toContain('data-activate-on-click="true"');
  });

  it("opens the native picker on click, records the opened file, and hands it to onFile", async () => {
    const openFile = vi.fn(() =>
      Promise.resolve({ bytes: new Uint8Array([9, 9]), name: "picked.docx" }),
    );
    createFileAccess.mockReturnValue(
      fileAccessStub({ supportsNativePicker: () => true, openFile }),
    );
    const onFile = vi.fn();
    const { click } = renderUpload({ onFile });

    click();
    await Promise.resolve();
    await Promise.resolve();

    expect(openFile).toHaveBeenCalled();
    expect(onFile).toHaveBeenCalledWith(
      expect.objectContaining({ name: "picked.docx" }),
    );
    expect(recordRecentFile).toHaveBeenCalledWith(
      expect.objectContaining({ format: "docx", name: "picked.docx" }),
    );
  });

  it("does nothing when the native picker resolves with no file (the user cancelled)", async () => {
    const openFile = vi.fn(() => Promise.resolve(undefined));
    createFileAccess.mockReturnValue(
      fileAccessStub({ supportsNativePicker: () => true, openFile }),
    );
    const onFile = vi.fn();
    const { click } = renderUpload({ onFile });

    click();
    await Promise.resolve();
    await Promise.resolve();

    expect(onFile).not.toHaveBeenCalled();
    expect(recordRecentFile).not.toHaveBeenCalled();
  });

  it("reads a dropped file's bytes, records it, and hands it to onFile", async () => {
    createFileAccess.mockReturnValue(fileAccessStub());
    const onFile = vi.fn();
    const { drop } = renderUpload({ onFile });

    drop([droppedFile({ name: "dropped.docx", bytes: [1, 2, 3, 4] })]);
    await Promise.resolve();
    await Promise.resolve();

    expect(onFile).toHaveBeenCalledTimes(1);
    const opened = onFile.mock.calls[0]?.[0] as OpenedFile;
    expect(opened.name).toBe("dropped.docx");
    expect([...opened.bytes]).toEqual([1, 2, 3, 4]);
    expect(recordRecentFile).toHaveBeenCalledWith(
      expect.objectContaining({ format: "docx", name: "dropped.docx" }),
    );
  });

  it("does nothing when the drop event carries no files at all", async () => {
    createFileAccess.mockReturnValue(fileAccessStub());
    const onFile = vi.fn();
    const { drop } = renderUpload({ onFile });

    drop([]);
    await Promise.resolve();
    await Promise.resolve();

    expect(onFile).not.toHaveBeenCalled();
    expect(recordRecentFile).not.toHaveBeenCalled();
  });

  it("skips recording a dropped file whose extension isn't a recognised document format", async () => {
    createFileAccess.mockReturnValue(fileAccessStub());
    const onFile = vi.fn();
    const { drop } = renderUpload({ onFile });

    drop([droppedFile({ name: "notes.txt" })]);
    await Promise.resolve();
    await Promise.resolve();

    expect(onFile).toHaveBeenCalledTimes(1);
    expect(recordRecentFile).not.toHaveBeenCalled();
  });
});
