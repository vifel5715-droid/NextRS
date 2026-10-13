/** MM/DD/YY — written out explicitly (not toLocaleDateString) so the format
 * stays fixed regardless of the browser's locale/system settings. */
export const formatDate = (dateString: string): string => {
  if (!dateString) return '';
  const date = new Date(dateString);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const yy = String(date.getFullYear()).slice(-2);
  return `${mm}/${dd}/${yy}`;
};

export const formatLocalDate = (dateString: string): string => {
  if (!dateString) return 'N/A';
  return new Date(dateString).toLocaleDateString();
};

/** 24-hour "military time" (HH:MM) — used anywhere a timestamp's time-of-day
 * is shown, e.g. a request's Created Time next to its Serial. */
export const formatMilitaryTime = (dateString: string | undefined | null): string => {
  if (!dateString) return 'N/A';
  return new Date(dateString).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
};

/** Date + 24-hour "military time" (HH:MM:SS) for a full timestamp — e.g.
 * Adjustment History's Date & Time column, which previously used the
 * browser's default 12-hour AM/PM formatting via toLocaleString(). */
export const formatMilitaryDateTime = (dateString: string | undefined | null): string => {
  if (!dateString) return 'N/A';
  const date = new Date(dateString);
  return `${date.toLocaleDateString()}, ${date.toLocaleTimeString('en-GB', { hour12: false })}`;
};
