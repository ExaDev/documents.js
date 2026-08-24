import { type Color, colorToRgbHex, rgbHexToColor } from "document-schema.js";

// ODF's `text:color` datatype (fo:color, style:text-underline-color when it's not the "font-color" keyword, and every other colour-valued attribute across the format) is always "#" followed by exactly 6 hex digits -- confirmed against the OASIS ODF schema (datypic.com's ODF schema reference for the text:color datatype) and against real LibreOffice 26.2 output (see properties.ts's own ground-truth note, and this module's own test suite): every real-world ODF producer emits colour this way. Unlike HTML/CSS, ODF never uses a bare 3-digit shorthand, an rgb()/rgba() function, or a CSS named colour ("red") -- there is no such alternative form in the schema for this module to also handle. A value outside this exact 6-hex-digit shape is not a colour this module can interpret, and rgbHexToColor (document-schema.js's own hex parser) is reused rather than reimplemented, matching this package's established rule of never redeclaring a document-schema.js shape or its parsing logic locally.
const ODF_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export function parseOdfColor(value: string): Color | undefined {
  if (!ODF_COLOR_PATTERN.test(value)) {
    return undefined;
  }
  return rgbHexToColor(value);
}

export function formatOdfColor(color: Color): string {
  return `#${colorToRgbHex(color)}`;
}
