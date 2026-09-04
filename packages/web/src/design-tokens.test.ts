import { describe, expect, it } from "vitest";

import { BRAND_COLOR } from "./design-tokens";
import { theme } from "./theme";

describe("design-tokens", () => {
  it("BRAND_COLOR stays in sync with the theme primaryColor shade Mantine actually resolves", () => {
    const shade = theme.colors[theme.primaryColor]?.[6];
    expect(BRAND_COLOR).toBe(shade);
  });
});
