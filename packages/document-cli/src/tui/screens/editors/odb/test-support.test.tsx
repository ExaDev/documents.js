import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { waitForFrame } from "../../../test-support.js";
import { OdbHarness } from "./test-support.js";

describe("OdbHarness", () => {
  it("renders the loading placeholder before the seeding effect has run", () => {
    // Checked synchronously, before any await: useEffect fires after paint, so the very first frame is captured while state.openDocument is still undefined.
    const { lastFrame } = render(<OdbHarness />);
    expect(lastFrame()).toContain("loading");
  });

  it("renders the real table-list screen once the seeding effect has opened the document", async () => {
    const { lastFrame } = render(<OdbHarness />);
    const frame = await waitForFrame(
      lastFrame,
      (candidate) => !candidate.includes("loading"),
    );
    expect(frame).not.toContain("loading");
  });

  it("re-seeds the open document when its own tables/forms/reports/path props change on rerender", async () => {
    const { lastFrame, rerender } = render(
      <OdbHarness tables={[]} path="first.odb" />,
    );
    await waitForFrame(
      lastFrame,
      (candidate) => !candidate.includes("loading"),
    );

    rerender(
      <OdbHarness
        tables={[
          {
            tableName: "WIDGETS",
            columns: [{ name: "ID", type: "INTEGER" }],
            rows: [[{ kind: "number", value: 1 }]],
          },
        ]}
        path="second.odb"
      />,
    );
    // A dropped effect dependency array would only ever open 'first.odb' with no tables — the table-list screen would never show WIDGETS at all.
    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("WIDGETS"),
    );
    expect(frame).toContain("WIDGETS");
  });
});
