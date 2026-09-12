import type { ContentDocument } from "documents.js";
import { afterEach, describe, expect, it } from "vitest";

import { mountWithMantine } from "../test/mountComponent";
import { FormulaPreview, type FormulaPreviewProps } from "./FormulaPreview";

let unmount: (() => void) | undefined;

afterEach(() => {
  unmount?.();
  unmount = undefined;
});

function renderPreview(props: FormulaPreviewProps): string {
  const mounted = mountWithMantine(<FormulaPreview {...props} />);
  unmount = mounted.unmount;
  return mounted.container.innerHTML;
}

const FORMULA_DOCUMENT: ContentDocument = {
  kind: "formula",
  metadata: {},
  formula: { mathml: [{ type: "text", value: "x" }] },
};

const NON_FORMULA_DOCUMENT: ContentDocument = {
  kind: "wordprocessing",
  metadata: {},
  sections: [],
};

describe("FormulaPreview", () => {
  it("always renders the label and format badge", () => {
    const html = renderPreview({ label: "Formula A", format: "odf" });
    expect(html).toContain("Formula A");
    expect(html).toContain("odf");
  });

  it("shows a loading overlay when loading", () => {
    const html = renderPreview({ label: "L", format: "odf", loading: true });
    expect(html).toContain("mantine-LoadingOverlay-root");
  });

  it("shows no loading overlay content when not loading", () => {
    const html = renderPreview({ label: "L", format: "odf", loading: false });
    expect(html).not.toContain("mantine-LoadingOverlay-root");
  });

  it("shows the unavailable message when an error is present, even with content on hand", () => {
    const html = renderPreview({
      label: "L",
      format: "odf",
      content: FORMULA_DOCUMENT,
      error: new Error("boom"),
    });
    expect(html).toContain("Preview unavailable for this format.");
    expect(html).not.toContain("<math");
  });

  it("shows the not-yet-available message when there is no content at all", () => {
    const html = renderPreview({ label: "L", format: "odf" });
    expect(html).toContain("No preview yet.");
  });

  it("shows the not-yet-available message when the content is not a formula document", () => {
    const html = renderPreview({
      label: "L",
      format: "odf",
      content: NON_FORMULA_DOCUMENT,
    });
    expect(html).toContain("No preview yet.");
  });

  it("renders the formula's MathML once a formula document is present with no error", () => {
    const html = renderPreview({
      label: "L",
      format: "odf",
      content: FORMULA_DOCUMENT,
    });
    expect(html).toContain("<math");
    expect(html).not.toContain("No preview yet.");
    expect(html).not.toContain("Preview unavailable");
  });
});
