import { describe, expect, it } from "vitest";
import {
  FOOTER_A,
  FOOTER_B,
  HEADER_A,
  HEADER_B,
  readFurnitureClaim,
  WATERMARK_A,
  WATERMARK_B,
} from "./furniture";

// Direct unit coverage of the subgroup-to-kind dispatch, isolated from the page.ts integration tests, which only ever exercise one subgroup per kind at a time and so cannot distinguish "the B slot of a kind" from "no claim at all".
describe("readFurnitureClaim", () => {
  const bothParities = new Uint8Array([0b11]);
  const oddOnly = new Uint8Array([0b01]);
  const evenOnly = new Uint8Array([0b10]);
  const neitherParity = new Uint8Array([0b00]);

  it("claims header for both HEADER_A and HEADER_B", () => {
    expect(readFurnitureClaim(HEADER_A, bothParities)).toEqual({
      kind: "header",
      slot: "default",
    });
    expect(readFurnitureClaim(HEADER_B, bothParities)).toEqual({
      kind: "header",
      slot: "default",
    });
  });

  it("claims footer for both FOOTER_A and FOOTER_B", () => {
    expect(readFurnitureClaim(FOOTER_A, bothParities)).toEqual({
      kind: "footer",
      slot: "default",
    });
    expect(readFurnitureClaim(FOOTER_B, bothParities)).toEqual({
      kind: "footer",
      slot: "default",
    });
  });

  it("claims watermark for both WATERMARK_A and WATERMARK_B", () => {
    expect(readFurnitureClaim(WATERMARK_A, bothParities)).toEqual({
      kind: "watermark",
      slot: "default",
    });
    expect(readFurnitureClaim(WATERMARK_B, bothParities)).toEqual({
      kind: "watermark",
      slot: "default",
    });
  });

  it("claims nothing for a subgroup outside the six known slots", () => {
    expect(readFurnitureClaim(0x06, bothParities)).toBe("none");
  });

  it("claims the default slot for odd-only occurrence", () => {
    expect(readFurnitureClaim(HEADER_A, oddOnly)).toEqual({
      kind: "header",
      slot: "default",
    });
  });

  it("claims the even slot for even-only occurrence", () => {
    expect(readFurnitureClaim(HEADER_A, evenOnly)).toEqual({
      kind: "header",
      slot: "even",
    });
  });

  it("claims nothing when neither parity bit is set", () => {
    expect(readFurnitureClaim(HEADER_A, neitherParity)).toBe("none");
  });

  it("treats a missing non-deletable byte as occurring on neither parity", () => {
    expect(readFurnitureClaim(HEADER_A, new Uint8Array())).toBe("none");
  });
});
