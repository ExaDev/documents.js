import { describe, expect, it } from "vitest";
import {
  BUILTIN_NUMBER_FORMATS,
  classifyNumberFormat,
  tokenizeNumberFormat,
} from "../../src";

// Proves excel-number-format's surface executes inside a Cloudflare Workers isolate (workerd, via @cloudflare/vitest-pool-workers) with no Node-only APIs. The classifier is a pure string tokenizer with no I/O of any kind, so this is a straightforward runtime complement to the static ESLint Worker-isomorphism guard: if any touched code path reached for a node:* module or the Buffer global, the workerd isolate would throw rather than these passing.
describe("excel-number-format under the Cloudflare Workers runtime", () => {
  it("tokenizes and classifies a mixed date-and-time format inside the isolate", () => {
    expect(tokenizeNumberFormat("[$GBP-809]#,##0.00")).toEqual([
      { kind: "bracket", body: "$GBP-809" },
      { kind: "code", char: "#" },
      { kind: "code", char: "," },
      { kind: "code", char: "#" },
      { kind: "code", char: "#" },
      { kind: "code", char: "0" },
      { kind: "code", char: "." },
      { kind: "code", char: "0" },
      { kind: "code", char: "0" },
    ]);
    expect(classifyNumberFormat("yyyy-mm-dd hh:mm:ss")).toEqual({
      kind: "dateTime",
    });
    expect(classifyNumberFormat("[$GBP-809]#,##0.00")).toEqual({
      kind: "currency",
      code: "GBP",
    });
  });

  it("classifies every ECMA-376 built-in format code inside the isolate", () => {
    for (const [id, code] of BUILTIN_NUMBER_FORMATS) {
      // Every built-in id has a defined classification -- none of them fall through to an exception -- which is the property this loop actually checks; the per-id kind is already pinned in the node test suite.
      expect(() => classifyNumberFormat(code)).not.toThrow();
      expect(id).toBeGreaterThanOrEqual(0);
    }
  });
});
