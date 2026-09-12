import { describe, expect, it } from "vitest";
import { groupHead, matchingGroupEnd } from "./group";
import { tokenizeRtf } from "./tokenize";

describe("matchingGroupEnd", () => {
  it("finds the matching close of a group with no nesting", () => {
    const tokens = tokenizeRtf(new TextEncoder().encode("{\\b x}y"));
    expect(matchingGroupEnd(tokens, 0)).toBe(3);
  });

  it("skips over a nested group's own close to find the outer one", () => {
    const tokens = tokenizeRtf(new TextEncoder().encode("{a{b}c}d"));
    // groupStart(0) text(1) groupStart(2) text(3) groupEnd(4) text(5) groupEnd(6)
    expect(matchingGroupEnd(tokens, 0)).toBe(6);
    expect(matchingGroupEnd(tokens, 2)).toBe(4);
  });

  it("returns tokens.length for a group that is never closed", () => {
    const tokens = tokenizeRtf(new TextEncoder().encode("{\\b x"));
    expect(matchingGroupEnd(tokens, 0)).toBe(tokens.length);
  });

  it("does not read one token past the actual matching close", () => {
    // A trailing sibling group after the one being matched is exactly where an off-by-one loop bound would accidentally report the sibling's own close.
    const tokens = tokenizeRtf(new TextEncoder().encode("{a}{b}"));
    expect(matchingGroupEnd(tokens, 0)).toBe(2);
  });
});

describe("groupHead", () => {
  it("names the destination a group opens with", () => {
    const tokens = tokenizeRtf(new TextEncoder().encode("{\\pict x}"));
    const head = groupHead(tokens, 0);
    expect(head.destination).toBe("pict");
    expect(head.ignorable).toBe(false);
  });

  it("marks a group ignorable when it opens with the \\* control symbol", () => {
    const tokens = tokenizeRtf(new TextEncoder().encode("{\\*\\bkmkstart x}"));
    const head = groupHead(tokens, 0);
    expect(head.destination).toBe("bkmkstart");
    expect(head.ignorable).toBe(true);
  });

  it("does not mark a group ignorable for a control symbol other than \\*", () => {
    // \~ is a real control symbol (non-breaking space); a mutant collapsing the \* check to "always true" would wrongly mark this group ignorable and would also wrongly consume this token as the ignorable marker.
    const tokens = tokenizeRtf(new TextEncoder().encode("{\\~x}"));
    const head = groupHead(tokens, 0);
    expect(head.ignorable).toBe(false);
    expect(head.destination).toBeUndefined();
    expect(head.contentStart).toBe(1);
  });

  it("returns no destination for a group that opens with plain text", () => {
    const tokens = tokenizeRtf(new TextEncoder().encode("{plain text}"));
    const head = groupHead(tokens, 0);
    expect(head.destination).toBeUndefined();
    expect(head.ignorable).toBe(false);
    expect(head.contentStart).toBe(1);
  });
});
