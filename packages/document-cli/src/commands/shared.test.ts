import { describe, expect, it } from "vitest";
import { formatError, resolveTargetFormat } from "./shared";

describe("resolveTargetFormat", () => {
  it("prefers an explicit --to over the output path's own extension", () => {
    const result = resolveTargetFormat("out.pdf", undefined, "docx");
    expect(result).toStrictEqual({ format: "docx" });
  });

  it("rejects an unrecognised --to value, naming it and the known formats", () => {
    const result = resolveTargetFormat(undefined, undefined, "made-up");
    expect(result).toStrictEqual({
      errorMessage:
        "unknown --to format 'made-up'; expected one of docx, pptx, xlsx, odt, odp, ods, odg, svg, odf, csv, markdown, rtf, wpd, doc, xls, ppt, epub, pdf",
    });
  });

  it("falls back to --out's extension when the positional output is absent", () => {
    const result = resolveTargetFormat(undefined, "result.docx", undefined);
    expect(result).toStrictEqual({ format: "docx" });
  });

  it("fails with a usage error naming every fallback when neither --to nor an output path is given", () => {
    const result = resolveTargetFormat(undefined, undefined, undefined);
    expect(result).toStrictEqual({
      errorMessage:
        "cannot infer a target format — pass an output path with a recognised extension, --out with one, or --to <format>",
    });
  });

  it("fails with a usage error naming the path when its extension is not recognised", () => {
    const result = resolveTargetFormat("out.mystery", undefined, undefined);
    expect(result).toStrictEqual({
      errorMessage:
        "cannot infer a target format from 'out.mystery'; pass --to <format> instead",
    });
  });
});

describe("formatError", () => {
  it("stringifies a non-Error thrown value directly, ignoring verbose", () => {
    expect(formatError("boom", false)).toBe("error: boom");
    expect(formatError("boom", true)).toBe("error: boom");
  });

  it("reports only the message, with no stack, when not verbose", () => {
    const error = new Error("oh no");
    expect(formatError(error, false)).toBe("error: oh no");
  });

  it("appends the full stack trace on its own line when verbose", () => {
    const error = new Error("oh no");
    const result = formatError(error, true);
    expect(result).toBe(`error: oh no\n${error.stack}`);
  });

  it("omits the stack clause under verbose when the error genuinely has no stack", () => {
    const error = new Error("oh no");
    error.stack = undefined;
    expect(formatError(error, true)).toBe("error: oh no");
  });
});
