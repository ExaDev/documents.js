import { render } from "ink-testing-library";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { Box, Text } from "ink";
import { AppStateProvider, useAppState } from "../state/context.js";
import { settle } from "../test-support.js";
import { NewDocumentPickerScreen } from "./new-document-picker.js";

describe("NewDocumentPickerScreen", () => {
  it("lists exactly the seven creatable formats, excluding .odb and .pdf", () => {
    const { lastFrame } = render(
      <AppStateProvider>
        <NewDocumentPickerScreen />
      </AppStateProvider>,
    );
    const frame = lastFrame();

    for (const extension of [
      "docx",
      "pptx",
      "odt",
      "odp",
      "ods",
      "odg",
      "md",
    ]) {
      expect(frame).toContain(`.${extension}`);
    }
    // `.odb` has no create<X>() editor at all and `.pdf` is only ever opened, never created from nothing -- both must be absent, not merely present-and-disabled.
    expect(frame).not.toMatch(/\bodb\b/);
    expect(frame).not.toMatch(/\.pdf\b/);
  });

  it("creates the highlighted format as the open document on Enter", async () => {
    function FormatProbe(): ReactElement {
      const state = useAppState();
      return (
        <Box flexDirection="column">
          <NewDocumentPickerScreen />
          <Text>
            openFormat:
            {state.openDocument === undefined
              ? "none"
              : state.openDocument.format}
          </Text>
        </Box>
      );
    }

    const { lastFrame, stdin } = render(
      <AppStateProvider>
        <FormatProbe />
      </AppStateProvider>,
    );
    expect(lastFrame()).toContain("openFormat:none");

    stdin.write("\r");

    await vi.waitFor(() => {
      expect(lastFrame()).toContain("openFormat:docx");
    });
  });

  it("creates a markdown document with a genuine live-view editor via the picker's own markdown entry", async () => {
    function FormatProbe(): ReactElement {
      const state = useAppState();
      return (
        <Box flexDirection="column">
          <NewDocumentPickerScreen />
          <Text>
            openFormat:
            {state.openDocument === undefined
              ? "none"
              : state.openDocument.format}
          </Text>
        </Box>
      );
    }

    const { lastFrame, stdin } = render(
      <AppStateProvider>
        <FormatProbe />
      </AppStateProvider>,
    );

    // markdown is the last entry in CREATABLE_FORMATS -- nine "down" presses reach it from the first row. Each press's own state update must actually commit before the next is sent (see test-support.ts's settle()), or a later press reads a stale selectedIndex closure.
    for (let step = 0; step < 9; step += 1) {
      stdin.write("j");
      await settle();
    }
    stdin.write("\r");

    await vi.waitFor(() => {
      expect(lastFrame()).toContain("openFormat:markdown");
    });
  });
});
