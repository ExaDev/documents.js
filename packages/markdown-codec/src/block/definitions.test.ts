// Direct tests for extractDefinitions -- the higher-level parseMarkdown suite (src/block/block.test.ts) exercises this through whole documents, which never isolates the exact cursor arithmetic that decides where one definition ends and the residual paragraph content begins.

import { describe, expect, it } from "vitest";
import { extractDefinitions } from "./definitions";
import type { LinkReferenceDefinition } from "../inline/link";

describe("extractDefinitions", () => {
  it("leaves ordinary text on a following line as the residual paragraph content", () => {
    const references = new Map<string, LinkReferenceDefinition>();
    const rest = extractDefinitions("[a]: /url\nsome text", references);
    expect(rest).toBe("some text");
    expect(references.get("A")).toEqual({ destination: "/url" });
  });

  it("ends the definition at the real line's own newline, not merely one past where the destination itself finished, when trailing spaces sit between them", () => {
    const references = new Map<string, LinkReferenceDefinition>();
    const rest = extractDefinitions("[a]: /url   \nsome text", references);
    expect(rest).toBe("some text");
  });

  it("consumes a definition with no trailing newline entirely, leaving nothing behind", () => {
    const references = new Map<string, LinkReferenceDefinition>();
    const rest = extractDefinitions("[a]: /url", references);
    expect(rest).toBe("");
    expect(references.get("A")).toEqual({ destination: "/url" });
  });

  it("does not treat a label with only whitespace between its brackets as a definition at all", () => {
    const references = new Map<string, LinkReferenceDefinition>();
    const rest = extractDefinitions("[   ]: /url\nrest", references);
    expect(rest).toBe("[   ]: /url\nrest");
    expect(references.size).toBe(0);
  });

  it("reports the exact duplicate-definition message, naming the losing label", () => {
    const messages: string[] = [];
    extractDefinitions(
      "[a]: /1\n[a]: /2",
      new Map<string, LinkReferenceDefinition>(),
      (diagnostic) => messages.push(diagnostic.message),
    );
    expect(messages).toEqual([
      'link reference definition "A" was already defined earlier in the document; this later definition is ignored',
    ]);
  });
});
