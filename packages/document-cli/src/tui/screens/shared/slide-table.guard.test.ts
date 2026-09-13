import { createPptx, type readPptxContent } from "documents.js";
import { describe, expect, it, vi } from "vitest";
import type { PptxOpenDocument } from "../../state/types.js";

// A type guard against the already-imported binding's own real type, not an inline `import('documents.js')` type query -- avoids needing any project-wide consistent-type-imports exception for this one test file, and is a genuine runtime check besides, unlike an unverified generic type parameter on importOriginal().
function isDocumentsJsModule(
  value: unknown,
): value is { readPptxContent: typeof readPptxContent } {
  return (
    typeof value === "object" &&
    value !== null &&
    "readPptxContent" in value &&
    typeof value.readPptxContent === "function"
  );
}

// A dedicated file, isolated from slide-table.test.ts's own real-content tests: mocking readPptxContent here is file-wide, so it must never share a module with a test that needs the genuine implementation.
vi.mock("documents.js", async (importOriginal) => {
  const actual = await importOriginal();
  if (!isDocumentsJsModule(actual)) {
    throw new Error(
      "documents.js mock: importOriginal() returned an unexpected shape",
    );
  }
  return {
    ...actual,
    // readPptxContent/readOdpContent always resolve a presentation package to the presentation ContentDocument variant in real use -- this stands in for the "genuinely impossible per its own contract, but still guarded against a hypothetical library bug" case resolveSlideTable's own throw exists for.
    readPptxContent: () => ({ kind: "spreadsheet" }),
  };
});

describe("resolveSlideTable", () => {
  it("throws naming both readPptxContent and readOdpContent if either ever resolves to a non-presentation ContentDocument", async () => {
    const { resolveSlideTable } = await import("./slide-table.js");
    const editor = createPptx();
    editor.addSlide();
    const doc: PptxOpenDocument = { format: "pptx", editor, path: undefined };
    expect(() => resolveSlideTable(doc, 0, 0)).toThrow(
      "readPptxContent/readOdpContent always resolve a presentation package to the presentation ContentDocument variant.",
    );
  });
});
