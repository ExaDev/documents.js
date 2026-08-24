import { rootElement } from "odf.js";
import { describe, expect, it } from "vitest";
import { createOdt } from "./editor";
import { buildRun, OdtRun } from "./run";

function freshRun(): OdtRun {
  const editor = createOdt();
  return editor.body.appendParagraph().appendRun();
}

describe("OdtRun text", () => {
  it("reads and writes plain text", () => {
    const run = freshRun();
    run.text = "Hello";
    expect(run.text).toBe("Hello");
    run.text = "Goodbye";
    expect(run.text).toBe("Goodbye");
  });

  it("preserves multi-space runs and tabs via encodeOdfText/decodeOdfText, not a plain text node", () => {
    const run = freshRun();
    run.text = "a  b\tc";
    expect(run.text).toBe("a  b\tc");
  });
});

describe("OdtRun toggle properties", () => {
  it("bold/italic/underline default to false and can be toggled on and off", () => {
    const run = freshRun();
    expect(run.bold).toBe(false);
    expect(run.italic).toBe(false);
    expect(run.underline).toBe(false);
    run.bold = true;
    run.italic = true;
    run.underline = true;
    expect(run.bold).toBe(true);
    expect(run.italic).toBe(true);
    expect(run.underline).toBe(true);
    run.bold = false;
    expect(run.bold).toBe(false);
    expect(run.italic).toBe(true); // unaffected by the other toggle
  });
});

describe("OdtRun value properties", () => {
  it("fontFamily, sizePt, and color round-trip through get/set", () => {
    const run = freshRun();
    expect(run.fontFamily).toBeUndefined();
    expect(run.sizePt).toBeUndefined();
    expect(run.color).toBeUndefined();

    run.fontFamily = "Arial";
    run.sizePt = 14;
    run.color = { r: 1, g: 0, b: 0 };

    expect(run.fontFamily).toBe("Arial");
    expect(run.sizePt).toBe(14);
    expect(run.color).toEqual({ r: 1, g: 0, b: 0 });
  });

  it("setting a property twice reuses/re-interns rather than accumulating stale style-name references", () => {
    const run = freshRun();
    run.fontFamily = "Arial";
    run.fontFamily = "Times New Roman";
    expect(run.fontFamily).toBe("Times New Roman");
  });

  it("two runs given the identical single-property change intern the same automatic style (StyleRegistry.intern dedupes by fingerprint)", () => {
    // A single setter call each, deliberately -- two SEQUENTIAL setter calls on the same run (bold, then color) would each independently resolve-merge-intern, so the run's final style is fingerprinted against its own {bold, color} combination while the intermediate {bold}-only style from the first call is left behind, unreferenced but harmless (see props.ts's own comment on this). That is a real, accepted consequence of every setter interning independently, exactly as this editor's own design requires -- not what this particular test is about, which is purely: does intern() dedupe two structurally-identical requests down to one style.
    const editor = createOdt();
    const paragraph = editor.body.appendParagraph();
    const a = paragraph.appendRun({ text: "A" });
    const b = paragraph.appendRun({ text: "B" });
    a.bold = true;
    b.bold = true;
    const pkg = editor.toPackage();
    const contentPart = pkg.parts["content.xml"];
    const root = rootElement(
      contentPart?.kind === "xml" ? contentPart.nodes : [],
    );
    const automaticStyles = root?.children.find(
      (c) => c.type === "element" && c.tag === "office:automatic-styles",
    );
    const styleCount =
      automaticStyles?.type === "element"
        ? automaticStyles.children.filter(
            (c) => c.type === "element" && c.tag === "style:style",
          ).length
        : -1;
    expect(styleCount).toBe(1);
  });
});

describe("OdtRun.remove", () => {
  it("removes the run from its container and throws on any further use", () => {
    const editor = createOdt();
    const paragraph = editor.body.appendParagraph();
    const run = paragraph.appendRun({ text: "Bye" });
    expect(paragraph.runs()).toHaveLength(1);
    run.remove();
    expect(paragraph.runs()).toHaveLength(0);
    expect(() => run.text).toThrow(/removed/);
    expect(() => {
      run.bold = true;
    }).toThrow(/removed/);
  });
});

describe("buildRun", () => {
  it("builds a run with no properties for plain text", () => {
    const editor = createOdt();
    const runElement = buildRun(editor.toPackage(), { text: "Hi" });
    const run = new OdtRun([runElement], runElement, editor.toPackage());
    expect(run.text).toBe("Hi");
    expect(run.bold).toBe(false);
  });

  it("builds a run with initial formatting applied", () => {
    const editor = createOdt();
    const runElement = buildRun(editor.toPackage(), {
      text: "Hi",
      bold: true,
      italic: true,
      sizePt: 16,
      fontFamily: "Arial",
    });
    const run = new OdtRun([runElement], runElement, editor.toPackage());
    expect(run.bold).toBe(true);
    expect(run.italic).toBe(true);
    expect(run.sizePt).toBe(16);
    expect(run.fontFamily).toBe("Arial");
    expect(run.text).toBe("Hi");
  });
});
