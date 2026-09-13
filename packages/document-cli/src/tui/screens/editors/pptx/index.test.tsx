import { renderToString } from "ink";
import { describe, expect, it } from "vitest";
import { AppStateProvider } from "../../../state/context.js";
import { PptxSlideListScreen } from "./index.js";

describe("PptxSlideListScreen", () => {
  it("throws naming itself when rendered without an open pptx document", () => {
    expect(() =>
      renderToString(
        <AppStateProvider>
          <PptxSlideListScreen />
        </AppStateProvider>,
      ),
    ).toThrow(
      /PptxSlideListScreen rendered without an open pptx document; check the screen router in app\.tsx\./,
    );
  });
});
