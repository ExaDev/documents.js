import type { ContentRun } from "document-schema.js";
import { describe, expect, it } from "vitest";
import { buildRun, DocRun } from "./run";

// The live view over a doc paragraph's own runs array, pinned for its whole property surface: doc has no XML tree, so the view mutates the ContentRun object in place, and every optional flag is a key that appears and disappears rather than flipping between true and false.

function firstRun(): {
  container: ContentRun[];
  node: ContentRun;
  run: DocRun;
} {
  // Constructed directly over our own array so the raw node stays inspectable: runs() wrappers are fresh objects each call.
  const node: ContentRun = { text: "Hello" };
  const container = [node];
  return { container, node, run: new DocRun(container, node) };
}

describe("DocRun property surface", () => {
  it("defaults every flag to false and every optional to undefined", () => {
    const { run } = firstRun();
    expect(run.bold).toBe(false);
    expect(run.italic).toBe(false);
    expect(run.underline).toBe(false);
    expect(run.strike).toBe(false);
    expect(run.sizePt).toBeUndefined();
    expect(run.color).toBeUndefined();
    expect(run.fontFamily).toBeUndefined();
  });

  it("sets every property and reads it back, then clears each to absent again", () => {
    const { run, node } = firstRun();
    run.text = "Changed";
    run.bold = true;
    run.italic = true;
    run.underline = true;
    run.strike = true;
    run.sizePt = 18;
    run.color = { r: 1, g: 0, b: 0 };
    run.fontFamily = "Arial";
    expect(run.text).toBe("Changed");
    expect(run.bold).toBe(true);
    expect(run.italic).toBe(true);
    expect(run.underline).toBe(true);
    expect(run.strike).toBe(true);
    expect(run.sizePt).toBe(18);
    expect(run.color).toEqual({ r: 1, g: 0, b: 0 });
    expect(run.fontFamily).toBe("Arial");

    run.bold = false;
    run.italic = false;
    run.underline = false;
    run.strike = false;
    run.sizePt = undefined;
    run.color = undefined;
    run.fontFamily = undefined;
    const raw = node as unknown as Record<string, unknown>;
    expect("bold" in raw).toBe(false);
    expect("italic" in node).toBe(false);
    expect("underline" in node).toBe(false);
    expect("strike" in node).toBe(false);
    expect("sizePt" in node).toBe(false);
    expect("color" in node).toBe(false);
    expect("fontFamily" in node).toBe(false);
  });

  it("remove() splices the run out and poisons the view", () => {
    const { run, container } = firstRun();
    run.remove();
    expect(container).toHaveLength(0);
    expect(() => {
      run.text = "x";
    }).toThrow(/removed/);
    expect(() => {
      run.remove();
    }).toThrow(/removed/);
  });
});

describe("buildRun", () => {
  it("applies every init property through the same setters a live view uses", () => {
    expect(
      buildRun({
        text: "Hi",
        bold: true,
        italic: true,
        underline: true,
        strike: true,
        sizePt: 14,
        color: { r: 0, g: 1, b: 0 },
        fontFamily: "Courier",
      }),
    ).toEqual({
      text: "Hi",
      bold: true,
      italic: true,
      underline: true,
      strike: true,
      sizePt: 14,
      color: { r: 0, g: 1, b: 0 },
      fontFamily: "Courier",
    });
  });

  it("builds a bare text node for an empty init", () => {
    expect(buildRun()).toEqual({ text: "" });
    expect(buildRun({ bold: false })).toEqual({ text: "" });
  });
});
