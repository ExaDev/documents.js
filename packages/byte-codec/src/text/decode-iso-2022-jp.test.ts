import { describe, expect, it } from "vitest";
import { decodeText, UndecodableTextError } from "./decode";
import { pointerCodePoint } from "./decode-dbcs";
import { JIS0208 } from "./dbcs-tables";

/**
 * Runs `action` expecting it to throw {@link UndecodableTextError}, and asserts its message contains every one of `substrings` — the same "don't just check the error class" discipline decode-dbcs.test.ts's own expectMalformed uses, and for the same reason: several genuinely different byte patterns here refuse via different states that would otherwise throw indistinguishable errors.
 */
function expectMalformed(
  action: () => unknown,
  ...substrings: readonly string[]
): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(UndecodableTextError);
    const message = (error as UndecodableTextError).message;
    for (const substring of substrings) {
      expect(message).toContain(substring);
    }
    return;
  }
  expect.unreachable("expected decodeText to throw UndecodableTextError");
}

function decodeIso2022Jp(bytes: readonly number[]): string {
  return decodeText(Uint8Array.from(bytes), { encoding: "iso-2022-jp" }).text;
}

/** ESC $ B <leading> <trailing>, the byte sequence a single JIS X 0208 pointer needs from a fresh ASCII start. */
function jis0208BytesForPointer(pointer: number): readonly number[] {
  const leading = 0x21 + Math.floor(pointer / 94);
  const trailing = 0x21 + (pointer % 94);
  return [0x1b, 0x24, 0x42, leading, trailing];
}

/** ISO-2022-JP's own JIS X 0208 index and trailing bytes are both bound to 0x21-0x7E, so — exactly like EUC-JP's own two-byte form in decode-dbcs.test.ts — only pointers 0 to 93*94+93 = 8835 are reachable; JIS0208 itself runs to 11279, the rest being Shift_JIS's own EUDC range and beyond. */
const MAX_REACHABLE_POINTER = 93 * 94 + 93;

describe("decodeText ISO-2022-JP", () => {
  it("decodes plain ASCII with no escape sequences at all", () => {
    expect(decodeIso2022Jp([0x48, 0x69, 0x21])).toBe("Hi!");
  });

  it("decodes every printable ASCII byte, excluding the Shift codes and the escape byte", () => {
    for (let byte = 0x00; byte <= 0x7f; byte += 1) {
      if (byte === 0x0e || byte === 0x0f || byte === 0x1b) {
        continue;
      }
      expect(decodeIso2022Jp([byte]), `byte 0x${byte.toString(16)}`).toBe(
        String.fromCharCode(byte),
      );
    }
  });

  it("switches to JIS X 0208, decodes a two-byte pair, and switches back to ASCII", () => {
    // "A", ESC $ B, 亜 (pointer 0), ESC ( B, "B" — cross-checked directly against a platform TextDecoder (fatal mode, since a non-fatal one would substitute rather than throw).
    const bytes = [0x41, 0x1b, 0x24, 0x42, 0x30, 0x21, 0x1b, 0x28, 0x42, 0x42];
    expect(decodeIso2022Jp(bytes)).toBe("A亜B");
    expect(
      new TextDecoder("iso-2022-jp", { fatal: true }).decode(
        Uint8Array.from(bytes),
      ),
    ).toBe("A亜B");
  });

  it("decodes every defined JIS X 0208 pointer from a fresh designator switch", () => {
    for (let pointer = 0; pointer <= MAX_REACHABLE_POINTER; pointer += 1) {
      const codePoint = pointerCodePoint(JIS0208, pointer);
      if (codePoint === undefined) {
        continue;
      }
      expect(
        decodeIso2022Jp(jis0208BytesForPointer(pointer)),
        `pointer ${String(pointer)}`,
      ).toBe(String.fromCodePoint(codePoint));
    }
  });

  it("agrees with a platform decoder for a sample of defined JIS X 0208 pointers", () => {
    const platform = new TextDecoder("iso-2022-jp", { fatal: true });
    let sampled = 0;
    for (let pointer = 0; pointer <= MAX_REACHABLE_POINTER; pointer += 37) {
      const codePoint = pointerCodePoint(JIS0208, pointer);
      if (codePoint === undefined) {
        continue;
      }
      const bytes = Uint8Array.from(jis0208BytesForPointer(pointer));
      sampled += 1;
      expect(platform.decode(bytes), `pointer ${String(pointer)}`).toBe(
        decodeText(bytes, { encoding: "iso-2022-jp" }).text,
      );
    }
    expect(sampled).toBeGreaterThan(100);
  });

  it("decodes the old JIS C 6226-1978 designator (ESC $ @) identically to the 1983 one", () => {
    const bytes = [0x1b, 0x24, 0x40, 0x30, 0x21];
    expect(decodeIso2022Jp(bytes)).toBe("亜");
  });

  it("decodes a real Japanese word switching designators twice", () => {
    // "日本語" (nihongo, "the Japanese language").
    const bytes = [
      0x1b, 0x24, 0x42, 0x46, 0x7c, 0x4b, 0x5c, 0x38, 0x6c, 0x1b, 0x28, 0x42,
    ];
    expect(decodeIso2022Jp(bytes)).toBe("日本語");
    expect(
      new TextDecoder("iso-2022-jp", { fatal: true }).decode(
        Uint8Array.from(bytes),
      ),
    ).toBe("日本語");
  });

  it("decodes JIS X 0201 Roman, including its own two substituted characters", () => {
    // ESC ( J, then 0x5C (¥ instead of backslash), 0x7E (‾ instead of tilde), then plain "A".
    const bytes = [0x1b, 0x28, 0x4a, 0x5c, 0x7e, 0x41];
    expect(decodeIso2022Jp(bytes)).toBe("¥‾A");
  });

  it("decodes every Roman-mode byte other than 0x5C and 0x7E as its own ASCII code point", () => {
    for (let byte = 0x00; byte <= 0x7f; byte += 1) {
      if (
        byte === 0x0e ||
        byte === 0x0f ||
        byte === 0x1b ||
        byte === 0x5c ||
        byte === 0x7e
      ) {
        continue;
      }
      expect(
        decodeIso2022Jp([0x1b, 0x28, 0x4a, byte]),
        `byte 0x${byte.toString(16)}`,
      ).toBe(String.fromCharCode(byte));
    }
  });

  it("decodes every JIS X 0201 Katakana byte (0x21-0x5F) as halfwidth katakana", () => {
    for (let byte = 0x21; byte <= 0x5f; byte += 1) {
      expect(
        decodeIso2022Jp([0x1b, 0x28, 0x49, byte]),
        `byte 0x${byte.toString(16)}`,
      ).toBe(String.fromCharCode(0xff61 - 0x21 + byte));
    }
  });

  it("switches modes repeatedly, decoding real content in each", () => {
    // ASCII "A", katakana "ｱ" (0x31), JIS X 0208 "亜" (pointer 0), Roman "¥", ASCII "Z".
    const bytes = [
      0x41, 0x1b, 0x28, 0x49, 0x31, 0x1b, 0x24, 0x42, 0x30, 0x21, 0x1b, 0x28,
      0x4a, 0x5c, 0x1b, 0x28, 0x42, 0x5a,
    ];
    expect(decodeIso2022Jp(bytes)).toBe("Aｱ亜¥Z");
  });

  it("ends cleanly after a designator switch with no character decoded in the new mode yet", () => {
    // Every one of ASCII, Roman, Katakana and (having just switched, with no lead byte read yet) the JIS X 0208 mode itself is a valid place for the input to simply end.
    expect(decodeIso2022Jp([0x41, 0x1b, 0x24, 0x42])).toBe("A");
    expect(decodeIso2022Jp([0x1b, 0x28, 0x4a])).toBe("");
    expect(decodeIso2022Jp([0x1b, 0x28, 0x49])).toBe("");
    expect(decodeIso2022Jp([])).toBe("");
  });

  it("throws for a byte no ASCII-mode position defines", () => {
    for (const byte of [0x0e, 0x0f, 0x80, 0xff]) {
      expectMalformed(
        () => decodeIso2022Jp([byte]),
        "ISO-2022-JP",
        `has no character for byte 0x${byte.toString(16)} in ASCII mode`,
      );
    }
  });

  it("throws for a byte no Roman-mode position defines", () => {
    for (const byte of [0x0e, 0x0f, 0x80, 0xff]) {
      expectMalformed(
        () => decodeIso2022Jp([0x1b, 0x28, 0x4a, byte]),
        "ISO-2022-JP",
        `has no character for byte 0x${byte.toString(16)} in Roman mode`,
      );
    }
  });

  it("throws for a byte outside Katakana's own 0x21-0x5F band", () => {
    // 0x20 sits just below the band; 0x60 sits just above it.
    for (const byte of [0x20, 0x60]) {
      expectMalformed(
        () => decodeIso2022Jp([0x1b, 0x28, 0x49, byte]),
        "ISO-2022-JP",
        `has no character for byte 0x${byte.toString(16)} in Katakana mode`,
      );
    }
  });

  it("throws for a byte outside JIS X 0208's own 0x21-0x7E lead-byte band", () => {
    for (const byte of [0x20, 0x7f]) {
      expectMalformed(
        () => decodeIso2022Jp([0x1b, 0x24, 0x42, byte]),
        "ISO-2022-JP",
        `has no character for byte 0x${byte.toString(16)} as a JIS X 0208 lead byte`,
      );
    }
  });

  it("throws when a JIS X 0208 pair's own trailing byte is out of range", () => {
    for (const byte of [0x20, 0x7f]) {
      expectMalformed(
        () => decodeIso2022Jp([0x1b, 0x24, 0x42, 0x30, byte]),
        "ISO-2022-JP",
        `has no character for lead byte 0x30 trail byte 0x${byte.toString(16)}`,
      );
    }
  });

  it("rejects a trailing byte just below the JIS X 0208 index band even when the pointer arithmetic would otherwise wrap onto a real, defined pointer belonging to the row below", () => {
    // Lead byte 0x21 alone (the lowest valid lead byte) can only wrap a too-low trailing byte to a negative pointer, nothing to land on; lead byte 0x22 can, since 0x22's own row starts immediately after 0x21's — the same risk decode-dbcs.test.ts checks for its own two-byte decoders' shared trailing-byte helper.
    expect(pointerCodePoint(JIS0208, 93)).not.toBeUndefined();
    expectMalformed(
      () => decodeIso2022Jp([0x1b, 0x24, 0x42, 0x22, 0x20]),
      "ISO-2022-JP",
      "has no character for lead byte 0x22 trail byte 0x20",
    );
  });

  it("throws when a JIS X 0208 lead and trailing byte pair to an undefined pointer", () => {
    // Pointer 5734 (bytes 0x7E 0x7E): a real JIS X 0208 gap, confirmed against the generated table directly rather than assumed.
    const pointer = (0x7e - 0x21) * 94 + (0x7e - 0x21);
    expect(pointerCodePoint(JIS0208, pointer)).toBeUndefined();
    expectMalformed(
      () => decodeIso2022Jp([0x1b, 0x24, 0x42, 0x7e, 0x7e]),
      "ISO-2022-JP",
      "has no character for lead byte 0x7e trail byte 0x7e",
    );
  });

  it("throws when a JIS X 0208 pair is interrupted by an escape sequence", () => {
    expectMalformed(
      () => decodeIso2022Jp([0x1b, 0x24, 0x42, 0x30, 0x1b, 0x28, 0x42]),
      "ISO-2022-JP",
      "lead byte 0x30 was interrupted by an escape sequence",
    );
  });

  it("throws for an escape byte that names no supported designator", () => {
    expectMalformed(
      () => decodeIso2022Jp([0x1b, 0x41]),
      "ISO-2022-JP",
      "has no supported designator starting with escape byte 0x41",
    );
  });

  it("throws for a well-formed but unsupported designator escape sequence", () => {
    // ESC ( Z: 0x28 correctly opens a single-byte-form designator, but 0x5A selects nothing this decoder (or the Encoding Standard itself) defines.
    expectMalformed(
      () => decodeIso2022Jp([0x1b, 0x28, 0x5a]),
      "ISO-2022-JP",
      "has an unsupported designator escape sequence 0x1b 0x28 0x5a",
    );
  });

  it("rejects every well-formed but genuinely undefined leading-byte/byte combination, including ones sharing a byte with a real designator", () => {
    // Each of these shares one byte with a real designator (0x28 with ASCII/Roman/Katakana's own leading byte, or 0x40/0x42 with JIS X 0208's own trailing byte), so a boundary comparison that quietly accepted more than it should would resolve one of these to the wrong mode rather than genuinely refusing it — confirmed against a platform TextDecoder (fatal mode) to be a real, defined refusal, not an assumption.
    const undefinedDesignators: readonly (readonly [number, number])[] = [
      [0x24, 0x4a], // ESC $ J: 0x4A only selects Roman under the 0x28 leading byte, not 0x24
      [0x24, 0x49], // ESC $ I: 0x49 only selects Katakana under the 0x28 leading byte, not 0x24
      [0x28, 0x40], // ESC ( @: 0x40 only selects JIS X 0208 under the 0x24 leading byte, not 0x28
      [0x24, 0x41], // ESC $ A: 0x24 is the right leading byte, but 0x41 is neither 0x40 nor 0x42
    ];
    for (const [leading, byte] of undefinedDesignators) {
      const bytes = [0x1b, leading, byte];
      expect(() =>
        new TextDecoder("iso-2022-jp", { fatal: true }).decode(
          Uint8Array.from(bytes),
        ),
      ).toThrow();
      expectMalformed(
        () => decodeIso2022Jp(bytes),
        "ISO-2022-JP",
        `has an unsupported designator escape sequence 0x1b 0x${leading.toString(16)} 0x${byte.toString(16)}`,
      );
    }
  });

  it("throws for a redundant designator escape with no character decoded since the previous one", () => {
    // ESC ( B immediately followed by ESC $ B, nothing decoded between them — flagged even though both are individually well-formed designators, confirmed directly against a platform TextDecoder in fatal mode (which raises the same failure where its own non-fatal mode would instead insert a single U+FFFD).
    const bytes = [0x1b, 0x28, 0x42, 0x1b, 0x24, 0x42, 0x30, 0x21];
    expectMalformed(
      () => decodeIso2022Jp(bytes),
      "ISO-2022-JP",
      "has a redundant designator escape sequence with no characters decoded since the previous one",
    );
    expect(() =>
      new TextDecoder("iso-2022-jp", { fatal: true }).decode(
        Uint8Array.from(bytes),
      ),
    ).toThrow();
  });

  it("does not flag a designator switch that follows a real decoded character", () => {
    // The exact case the redundant-designator check must not catch: "A" is decoded in ASCII mode, resetting the flag, before ESC ( J switches to Roman.
    expect(decodeIso2022Jp([0x41, 0x1b, 0x28, 0x4a])).toBe("A");
  });

  it("does not flag a designator switch that follows a completed JIS X 0208 pair", () => {
    // Consuming a JIS X 0208 lead byte resets the flag (the "Leading byte" state's own 0x21-0x7E branch touches it, even though completing the pair one byte later does not — decodeIso2022Jp's own doc comment on the "trailingByte" case explains why), so the escape switching back to ASCII right after "亜" decodes is not itself flagged.
    expect(
      decodeIso2022Jp([0x1b, 0x24, 0x42, 0x30, 0x21, 0x1b, 0x28, 0x42]),
    ).toBe("亜");
  });

  it("throws when an escape sequence interrupts a JIS X 0208 pair even while entering a fresh designator, not just a redundant one", () => {
    // ESC arriving as the second byte of a JIS X 0208 pair is a truncated-pair error every time, never reinterpreted as a (possibly redundant) designator switch: the "Trailing byte" state's own 0x1B branch is unconditional, unlike "Leading byte"'s.
    expectMalformed(
      () => decodeIso2022Jp([0x1b, 0x24, 0x42, 0x30, 0x1b, 0x28, 0x42]),
      "ISO-2022-JP",
      "lead byte 0x30 was interrupted by an escape sequence",
    );
  });

  it("throws when the input ends inside each of ISO-2022-JP's own pending states", () => {
    for (const truncated of [[0x1b], [0x1b, 0x24], [0x1b, 0x24, 0x42, 0x30]]) {
      expectMalformed(
        () => decodeIso2022Jp(truncated),
        "ISO-2022-JP",
        "ends with an incomplete multi-byte or escape sequence",
      );
    }
  });
});
