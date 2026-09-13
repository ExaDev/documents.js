import { describe, expect, it } from "vitest";
import { WPD_FILE_EXTENSION, WPD_MEDIA_TYPE } from "./format";

describe("format identifiers", () => {
  it("states the IANA-registered media type", () => {
    expect(WPD_MEDIA_TYPE).toBe("application/vnd.wordperfect");
  });

  it("states the conventional file extension", () => {
    expect(WPD_FILE_EXTENSION).toBe(".wpd");
  });
});
