import { z } from "zod";

// The colour type shared by every content/layout schema. Ported from ooxml.js's typed/shared/color.ts and documents.js's src/model/color.ts (identical shape in both, modulo naming) -- this is the canonical home now; both packages import it from here instead of maintaining their own copy. DrawingML's colour-transform maths (ColorTransform/applyColorTransforms -- shade/tint/lumMod/lumOff) is deliberately NOT here: that's OOXML cascade-resolution logic used only inside ooxml.js's own readDocx/readPptx, not a content-model shape.

// sRGB components in 0..1.
export const ColorSchema = z.object({
  r: z.number().min(0).max(1),
  g: z.number().min(0).max(1),
  b: z.number().min(0).max(1),
});
export type Color = z.infer<typeof ColorSchema>;

export const COLOR_BLACK: Color = { r: 0, g: 0, b: 0 };

const HEX_COLOR_PATTERN = /^#?([0-9a-fA-F]{6})$/;
const HEX_BYTE_MAX = 255;

// Parses a 6-digit hex colour (OOXML's w:color/@w:val, a:srgbClr/@val; ODF's fo:color), with or without a leading '#', into a Color. Throws on malformed input rather than substituting a default -- callers are expected to have already validated the attribute is present.
export function rgbHexToColor(hex: string): Color {
  const match = HEX_COLOR_PATTERN.exec(hex);
  if (match === null) {
    throw new Error(`not a 6-digit hex colour: ${hex}`);
  }
  const digits = match[1];
  if (digits === undefined) {
    throw new Error(`not a 6-digit hex colour: ${hex}`);
  }
  const r = Number.parseInt(digits.slice(0, 2), 16);
  const g = Number.parseInt(digits.slice(2, 4), 16);
  const b = Number.parseInt(digits.slice(4, 6), 16);
  return { r: r / HEX_BYTE_MAX, g: g / HEX_BYTE_MAX, b: b / HEX_BYTE_MAX };
}

function toHexByte(component: number): string {
  const byte = Math.round(component * HEX_BYTE_MAX);
  return byte.toString(16).padStart(2, "0");
}

// The exact inverse of rgbHexToColor, rounding each component to the nearest byte; always returns a lowercase 6-digit hex string with no leading '#'.
export function colorToRgbHex(color: Color): string {
  return `${toHexByte(color.r)}${toHexByte(color.g)}${toHexByte(color.b)}`;
}
