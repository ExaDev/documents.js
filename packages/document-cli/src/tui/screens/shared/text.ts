// A paragraph or cell's own text can contain embedded newlines/tabs (from a real docx/odt run) that would otherwise break a single-row list preview onto several terminal lines, so this collapses internal whitespace runs to a single space before truncating to a fixed display width.
export function truncatePreview(text: string, maxLength: number): string {
  const singleLine = text.replace(/\s+/gu, ' ').trim();
  if (singleLine.length === 0) {
    return '(empty)';
  }
  return singleLine.length > maxLength ? `${singleLine.slice(0, Math.max(0, maxLength - 1))}…` : singleLine;
}

// Table dimensions are small positive integers -- a blank or non-numeric entry falls back to the same default the field was pre-filled with, and anything less than 1 (zero, negative, a fraction that floors to 0) does too, since documents.js's own table-creation inits have no meaningful zero-row or zero-column table to build. Shared between the pptx/odp slide-table wizard (slide-detail.tsx) and the docx/odt body-list table wizard (paragraph-family.tsx) -- both need the identical "small positive integer, fall back to the pre-filled default" parse.
export function parsePositiveIntField(raw: string, fallback: number): number {
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

// The 0-based-index counterpart to parsePositiveIntField above -- a merge rectangle's own start row/column is a valid 0, which parsePositiveIntField can never represent (it treats 0 as invalid and falls back). Used by the docx/odt table-creation wizard's own merge-rectangle picker (paragraph-family.tsx).
export function parseNonNegativeIntField(raw: string, fallback: number): number {
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

// A field wizard's own free-form point-size number entry (a frame's x/y/width/height in pt, a fill/stroke component) -- unlike the two integer parsers above, any finite value (including 0 and negatives) is accepted, since a frame position or a colour component genuinely can be either. Originally local to odg/shared.ts; moved here once field-wizard.tsx's own generic FieldWizard needed the identical parse for a non-odg caller (paragraph-detail.tsx's image-insertion wizard) -- odg/shared.ts re-exports this rather than keeping its own duplicate.
export function parseNumberField(raw: string, fallback: number): number {
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}
