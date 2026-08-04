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
