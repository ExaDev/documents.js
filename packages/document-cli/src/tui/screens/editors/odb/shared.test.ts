import { describe, expect, it } from "vitest";
import type { OdbOpenDocument } from "../../../state/types.js";
import { requireOdbDocument } from "./shared";

describe("requireOdbDocument", () => {
  it("returns a real odb document", () => {
    const doc: OdbOpenDocument = {
      format: "odb",
      tables: [],
      forms: [],
      reports: [],
      path: "a.odb",
    };
    expect(requireOdbDocument(doc)).toBe(doc);
  });

  it("throws for a document of a different format", () => {
    expect(() =>
      requireOdbDocument({
        format: "docx",
        editor: {} as never,
        path: undefined,
      }),
    ).toThrow(
      /An \.odb browsing screen rendered without an open \.odb document/,
    );
  });

  it("throws for undefined", () => {
    expect(() => requireOdbDocument(undefined)).toThrow(
      /An \.odb browsing screen rendered without an open \.odb document/,
    );
  });
});
