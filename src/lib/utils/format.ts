import {
  formatPhtDate,
  formatPhtDateTime,
  formatPhtTime,
  getPhtParts,
} from '@/lib/utils/timezone';

/** MM/DD/YY in Philippine Time — written out explicitly so the format stays
 * fixed regardless of the browser's locale and time zone. */
export const formatDate = (dateString: string): string => {
  const p = getPhtParts(dateString);
  if (!p) return '';
  const mm = String(p.month).padStart(2, '0');
  const dd = String(p.day).padStart(2, '0');
  const yy = String(p.year).slice(-2);
  return `${mm}/${dd}/${yy}`;
};

/** M/D/YYYY in Philippine Time. */
export const formatLocalDate = (dateString: string): string => formatPhtDate(dateString, 'N/A');

/** 24-hour "military time" (HH:MM) in Philippine Time — used anywhere a
 * timestamp's time-of-day is shown, e.g. a request's Created Time. */
export const formatMilitaryTime = (dateString: string | undefined | null): string =>
  formatPhtTime(dateString, 'N/A');

/** Date + 24-hour time (HH:MM:SS) in Philippine Time for a full timestamp,
 * e.g. Adjustment History's Date & Time column. */
export const formatMilitaryDateTime = (dateString: string | undefined | null): string =>
  formatPhtDateTime(dateString, 'N/A');
