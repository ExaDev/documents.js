import type { MathMlNode } from "documents.js";
import { describe, expect, it } from "vitest";

import { mountWithMantine } from "../test/mountComponent";
import { MathMlView } from "./MathMlView";

function textNode(value: string): MathMlNode {
  return { type: "text", value };
}

function elementNode(tag: string, children: readonly MathMlNode[] = []) {
  return { type: "element" as const, tag, attributes: [], children };
}

describe("MathMlView", () => {
  it("renders the given MathML tree inside its container", () => {
    const mounted = mountWithMantine(
      <MathMlView mathml={[elementNode("mn", [textNode("2")])]} />,
    );
    expect(mounted.container.querySelector("math")?.textContent).toBe("2");
    mounted.unmount();
  });

  it("re-renders the whole tree from scratch when the mathml prop changes, rather than appending onto stale content", () => {
    const mounted = mountWithMantine(
      <MathMlView mathml={[elementNode("mn", [textNode("2")])]} />,
    );
    mounted.rerender(
      <MathMlView mathml={[elementNode("mn", [textNode("3")])]} />,
    );
    const mathElements = mounted.container.querySelectorAll("math");
    expect(mathElements.length).toBe(1);
    expect(mathElements[0]?.textContent).toBe("3");
    // The math element's own parent (MathMlView's container div) must hold nothing else -- no leftover text node from a skipped or corrupted clear, which querySelectorAll("math") alone can't detect since it only ever matches real elements.
    expect(mathElements[0]?.parentNode?.childNodes.length).toBe(1);
    mounted.unmount();
  });

  it("applies the given className to the container element", () => {
    const mounted = mountWithMantine(
      <MathMlView mathml={[]} className="probe-class" />,
    );
    expect(mounted.container.querySelector(".probe-class")).not.toBeNull();
    mounted.unmount();
  });
});
