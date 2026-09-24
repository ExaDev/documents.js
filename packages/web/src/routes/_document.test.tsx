import type * as TanstackRouter from "@tanstack/react-router";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OpenDocumentProvider } from "../document/OpenDocumentContext";
import type { OpenedFile } from "../ports/fileAccess";
import { mountWithMantine } from "../test/mountComponent";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof TanstackRouter>();
  return {
    ...actual,
    Outlet: () => <div data-testid="outlet" />,
  };
});

let latestOnFile: ((file: OpenedFile) => void) | undefined;
let latestFile: OpenedFile | undefined;
let latestFormatHint: string | undefined;
vi.mock("../ui/FileUpload", () => ({
  FileUpload: (props: {
    onFile: (file: OpenedFile) => void;
    file?: OpenedFile;
    formatHint?: string;
  }) => {
    latestOnFile = props.onFile;
    latestFile = props.file;
    latestFormatHint = props.formatHint;
    return <div data-testid="file-upload" />;
  },
}));

const { Route } = await import("./_document");
const DocumentLayout = Route.options.component!;

function openedFile(name: string): OpenedFile {
  return { bytes: new Uint8Array([1, 2, 3]), name };
}

// The layout reads the open document out of context rather than holding it, so this harness supplies the same provider the root route mounts in the real app.
function mountLayout() {
  return mountWithMantine(
    <OpenDocumentProvider>
      <DocumentLayout />
    </OpenDocumentProvider>,
  );
}

afterEach(() => {
  latestOnFile = undefined;
  latestFile = undefined;
  latestFormatHint = undefined;
});

describe("DocumentLayout", () => {
  it("renders the shared FileUpload and the routed outlet", () => {
    const mounted = mountLayout();
    expect(
      mounted.container.querySelector('[data-testid="file-upload"]'),
    ).not.toBeNull();
    expect(
      mounted.container.querySelector('[data-testid="outlet"]'),
    ).not.toBeNull();
    expect(latestFormatHint).toBe("Any document format this app supports");
    mounted.unmount();
  });

  it("leaves navigating between the document tools to the sidebar rather than repeating it as a second tab strip", () => {
    const mounted = mountLayout();
    expect(mounted.container.querySelectorAll("a")).toHaveLength(0);
    mounted.unmount();
  });

  it("shows no detected-format line before anything is open", () => {
    const mounted = mountLayout();
    expect(mounted.container.textContent).not.toContain("Detected format");
    expect(mounted.container.textContent).not.toContain(
      "Could not detect a format",
    );
    mounted.unmount();
  });

  it("reports the detected format once a recognised file is opened", () => {
    const mounted = mountLayout();
    act(() => {
      latestOnFile?.(openedFile("report.docx"));
    });
    expect(mounted.container.textContent).toContain("Detected format: docx");
    expect(latestFile?.name).toBe("report.docx");
    mounted.unmount();
  });

  it("reports an undetected format neutrally rather than as an alarming error", () => {
    const mounted = mountLayout();
    act(() => {
      latestOnFile?.(openedFile("notes.xyz"));
    });
    expect(mounted.container.textContent).toContain(
      "Could not detect a format from the file's extension.",
    );
    mounted.unmount();
  });
});
