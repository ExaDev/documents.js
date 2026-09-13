import { renderToString } from "ink";
import { describe, expect, it } from "vitest";
import { AppStateProvider } from "../../../state/context.js";
import { OdpSlideListScreen } from "./index.js";

describe("OdpSlideListScreen", () => {
  it("throws naming itself when rendered without an open odp document", () => {
    expect(() =>
      renderToString(
        <AppStateProvider>
          <OdpSlideListScreen />
        </AppStateProvider>,
      ),
    ).toThrow(
      /OdpSlideListScreen rendered without an open odp document; check the screen router in app\.tsx\./,
    );
  });
});
