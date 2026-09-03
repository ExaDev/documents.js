// The Worker-isomorphism proof, run inside a real workerd isolate by `pnpm test:workers` (vitest.workers.config.ts). The point is not the assertions -- the unit suite already covers what these read back -- it is that the whole read path, this package's own parser plus archive-codec's compound-file reader beneath it, executes at all in a runtime with no node:* modules and no Buffer global. A Node-only API anywhere in the graph makes the isolate throw rather than the expectation fail.
import { describe, expect, it } from "vitest";
import {
  buildWpdFile,
  text,
} from "../../src/test-support/build-wpd";
import { compoundFileWithStream } from "../../src/test-support/compound-file";
import { PERFECT_OFFICE_MAIN_STREAM } from "../../src/container/container";
import { readWpd, readWpdContent } from "../../src/index";

const HARD_EOL = 0xcc;

describe("wpd-codec inside workerd", () => {
  it("reads a bare WordPerfect 6.x file", () => {
    const document = readWpdContent(
      buildWpdFile([...text("Hello"), HARD_EOL, ...text("World")]),
    );
    expect(document.kind).toBe("wordprocessing");
    if (document.kind !== "wordprocessing") {
      return;
    }
    const blocks = document.sections[0]?.blocks ?? [];
    expect(blocks).toHaveLength(2);
  });

  it("reads an OLE-wrapped WordPerfect file through archive-codec's compound-file reader", () => {
    const wrapped = compoundFileWithStream(
      PERFECT_OFFICE_MAIN_STREAM,
      buildWpdFile(text("Wrapped")),
    );
    expect(readWpdContent(wrapped)).toEqual(
      readWpdContent(buildWpdFile(text("Wrapped"))),
    );
  });

  it("assembles the tree form", () => {
    expect(readWpd(buildWpdFile(text("Tree"))).kind).toBe("wordprocessing");
  });
});
