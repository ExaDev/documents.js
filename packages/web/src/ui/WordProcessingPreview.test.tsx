import type { ContentDocument } from "documents.js";
import { afterEach, describe, expect, it } from "vitest";

import { mountWithMantine } from "../test/mountComponent";
import {
  WordProcessingPreview,
  type WordProcessingPreviewProps,
} from "./WordProcessingPreview";

let unmount: (() => void) | undefined;

afterEach(() => {
  unmount?.();
  unmount = undefined;
});

function renderPreview(props: WordProcessingPreviewProps): string {
  const mounted = mountWithMantine(<WordProcessingPreview {...props} />);
  unmount = mounted.unmount;
  return mounted.container.innerHTML;
}

const WORDPROCESSING_DOCUMENT: ContentDocument = {
  kind: "wordprocessing",
  metadata: {},
  sections: [
    {
      pageSize: { widthPt: 595, heightPt: 842 },
      margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
      blocks: [{ kind: "paragraph", runs: [{ text: "hello docx" }] }],
    },
  ],
};

const NON_WORDPROCESSING_DOCUMENT: ContentDocument = {
  kind: "formula",
  metadata: {},
  formula: { mathml: [] },
};

describe("WordProcessingPreview", () => {
  it("always renders the label and format badge", () => {
    const html = renderPreview({ label: "Doc A", format: "docx" });
    expect(html).toContain("Doc A");
    expect(html).toContain("docx");
  });

  it("shows a loading overlay when loading", () => {
    const html = renderPreview({ label: "L", format: "docx", loading: true });
    expect(html).toContain("mantine-LoadingOverlay-root");
  });

  it("shows no loading overlay content when not loading", () => {
    const html = renderPreview({ label: "L", format: "docx", loading: false });
    expect(html).not.toContain("mantine-LoadingOverlay-root");
  });

  it("shows the unavailable message when an error is present, even with content on hand", () => {
    const html = renderPreview({
      label: "L",
      format: "docx",
      content: WORDPROCESSING_DOCUMENT,
      error: new Error("boom"),
    });
    expect(html).toContain("Preview unavailable for this format.");
    expect(html).not.toContain("hello docx");
  });

  it("shows the not-yet-available message when there is no content at all", () => {
    const html = renderPreview({ label: "L", format: "docx" });
    expect(html).toContain("No preview yet.");
  });

  it("renders nothing for the content area when the content is not a wordprocessing document (no crash, no placeholder text)", () => {
    const html = renderPreview({
      label: "L",
      format: "docx",
      content: NON_WORDPROCESSING_DOCUMENT,
    });
    expect(html).not.toContain("No preview yet.");
    expect(html).not.toContain("Preview unavailable");
  });

  it("renders every section's blocks once a wordprocessing document is present with no error", () => {
    const html = renderPreview({
      label: "L",
      format: "docx",
      content: WORDPROCESSING_DOCUMENT,
    });
    expect(html).toContain("hello docx");
    expect(html).not.toContain("No preview yet.");
  });
});
