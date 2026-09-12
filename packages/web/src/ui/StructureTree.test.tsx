import { afterEach, describe, expect, it } from "vitest";

import { mountWithMantine } from "../test/mountComponent";
import { StructureTree } from "./StructureTree";

let unmount: (() => void) | undefined;

afterEach(() => {
  unmount?.();
  unmount = undefined;
});

function renderTree(data: unknown): string {
  const mounted = mountWithMantine(<StructureTree data={data} />);
  unmount = mounted.unmount;
  return mounted.container.innerHTML;
}

// MantineProvider injects its own <style> elements into the mount container regardless of what its children render, so an empty StructureTree (which returns null) still leaves non-empty innerHTML -- the Tree's own root class is the actual signal that it rendered anything at all.
const TREE_ROOT_CLASS = "mantine-Tree-root";

describe("StructureTree", () => {
  it("renders nothing for a value with no browsable children (an empty object)", () => {
    expect(renderTree({})).not.toContain(TREE_ROOT_CLASS);
  });

  it("renders nothing for a primitive value", () => {
    expect(renderTree(42)).not.toContain(TREE_ROOT_CLASS);
  });

  it("renders a Mantine Tree once the data has at least one browsable node", () => {
    const html = renderTree({ pages: [{ widthPt: 595, heightPt: 842 }] });
    expect(html).toContain(TREE_ROOT_CLASS);
  });
});
