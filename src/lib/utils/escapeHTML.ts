/**
 * Escapes a value for interpolation into an HTML string.
 *
 * Both print slips build their markup by string concatenation and write it into
 * a new window, so any user-entered text (purpose, remarks, item names) lands in
 * the document unparsed. Without escaping, a stray `<` breaks the layout and a
 * `<script>` runs in the print window.
 */
export const escapeHTML = (value: string | number | null | undefined): string => {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};
