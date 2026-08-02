// A paragraph or cell's own text can contain embedded newlines/tabs (from a real docx/odt run) that would otherwise break a single-row list preview onto several terminal lines, so this collapses internal whitespace runs to a single space before truncating to a fixed display width.
export function truncatePreview(text: string, maxLength: number): string {
  const singleLine = text.replace(/\s+/gu, ' ').trim();
  if (singleLine.length === 0) {
    return '(empty)';
  }
  return singleLine.length > maxLength ? `${singleLine.slice(0, Math.max(0, maxLength - 1))}…` : singleLine;
}
