import { afterEach, describe, expect, it, vi } from "vitest";

import { mountWithMantine } from "../test/mountComponent";
import { PdfPreview, type PdfPreviewProps } from "./PdfPreview";

let unmount: (() => void) | undefined;

afterEach(() => {
  unmount?.();
  unmount = undefined;
  vi.restoreAllMocks();
});

function renderPreview(props: PdfPreviewProps): string {
  const mounted = mountWithMantine(<PdfPreview {...props} />);
  unmount = mounted.unmount;
  return mounted.container.innerHTML;
}

describe("PdfPreview", () => {
  it("always renders the label and format badge", () => {
    const html = renderPreview({ label: "Doc A", format: "pdf" });
    expect(html).toContain("Doc A");
    expect(html).toContain("pdf");
  });

  it("shows a loading overlay when loading", () => {
    const html = renderPreview({ label: "L", format: "pdf", loading: true });
    expect(html).toContain("mantine-LoadingOverlay-root");
  });

  it("shows no loading overlay content when not loading", () => {
    const html = renderPreview({ label: "L", format: "pdf", loading: false });
    expect(html).not.toContain("mantine-LoadingOverlay-root");
  });

  it("shows the unavailable message when an error is present, even with bytes on hand", () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:one");
    const html = renderPreview({
      label: "L",
      format: "pdf",
      bytes: new Uint8Array([1, 2, 3]),
      error: new Error("boom"),
    });
    expect(html).toContain("Preview unavailable for this format.");
    expect(html).not.toContain("<iframe");
  });

  it("shows the not-yet-available message when there are no bytes at all", () => {
    const html = renderPreview({ label: "L", format: "pdf" });
    expect(html).toContain("No preview yet.");
    expect(html).not.toContain("<iframe");
  });

  it("renders an iframe pointed at the object URL once bytes are present with no error", () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:one");
    const html = renderPreview({
      label: "My Doc",
      format: "pdf",
      bytes: new Uint8Array([1, 2, 3]),
    });
    expect(html).toContain('src="blob:one"');
    expect(html).toContain('title="My Doc preview"');
    expect(html).not.toContain("No preview yet.");
  });
});
