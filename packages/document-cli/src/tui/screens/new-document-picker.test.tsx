import { render } from "ink-testing-library";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { Box, Text } from "ink";
import { AppStateProvider, useAppState } from "../state/context.js";
import { NewDocumentPickerScreen } from "./new-document-picker.js";

describe("NewDocumentPickerScreen", () => {
  it("lists exactly the six creatable formats, excluding .odb and .pdf", () => {
    const { lastFrame } = render(
      <AppStateProvider>
        <NewDocumentPickerScreen />
      </AppStateProvider>,
    );
    const frame = lastFrame();

    for (const extension of ["docx", "pptx", "odt", "odp", "ods", "odg"]) {
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
});
