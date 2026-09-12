/// <reference lib="dom" />
// tsconfig.node.json (which typechecks every *.test.ts(x)) deliberately omits the DOM lib -- this file constructs a real Document via document.implementation.createHTMLDocument, so it opts in per-file the same way contentBlocks.test.tsx does.
import { describe, expect, it, vi } from "vitest";

// Mocked rather than let mountApp mount the real <App/>: that would pull in the full router tree (every route, including convert.tsx's worker-backed conversion machinery), none of which is what mountApp's own logic -- the #root lookup and the createRoot(...).render(...) call -- actually needs exercised against.
const render = vi.fn();
const createRoot = vi.fn(() => ({ render }));
vi.mock("react-dom/client", () => ({ createRoot }));

const { mountApp } = await import("./mountApp");

describe("mountApp", () => {
  it("throws when the document has no #root element", () => {
    const doc = document.implementation.createHTMLDocument("no root");
    expect(() => {
      mountApp(doc);
    }).toThrow("#root element is missing from index.html");
    expect(createRoot).not.toHaveBeenCalled();
  });

  it("mounts the app into the #root element when one exists", () => {
    const doc = document.implementation.createHTMLDocument("has root");
    const container = doc.createElement("div");
    container.id = "root";
    doc.body.appendChild(container);

    mountApp(doc);

    expect(createRoot).toHaveBeenCalledWith(container);
    expect(render).toHaveBeenCalledTimes(1);
  });
});
