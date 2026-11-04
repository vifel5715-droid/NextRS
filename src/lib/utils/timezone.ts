/**
 * System time zone: Philippine Standard Time (Asia/Manila, UTC+08:00).
 *
 * PHT is the single source of truth for every transaction date and time.
 * Every date shown to a user, every "today", every serial-number year and
 * every date-range filter is computed in Asia/Manila through these helpers,
 * so neither the browser's nor the server host's time zone can change it.
 *
 * Storage: timestamps are persisted as ISO-8601 instants (toISOString()).
 * An instant is the same moment in every zone, and keeping one fixed format
 * keeps text columns sorting and range-comparing correctly. Interpretation
 * of that instant (which calendar day, which hour) always happens in PHT.
 *
 * The Philippines has no daylight-saving time, so the +08:00 offset is fixed.
 */
export const SYSTEM_TIME_ZONE = "Asia/Manila";
export const SYSTEM_UTC_OFFSET = "+08:00";

/** node-postgres `options` that pin each DB session (now(), TIMESTAMPTZ output) to PHT. */
export const POSTGRES_TIME_ZONE_OPTION = `-c TimeZone=${SYSTEM_TIME_ZONE}`;

type DateInput = string | number | Date | null | undefined;

export interface PhtParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: SYSTEM_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/**
 * Parses a stored value into a Date. A bare "YYYY-MM-DD" (date-only column
 * such as date_needed) is read as that calendar day in PHT, not UTC midnight.
 */
export const toDate = (value: DateInput): Date | null => {
  if (value === null || value === undefined || value === "") return null;
  const date =
    value instanceof Date
      ? value
      : typeof value === "string" && DATE_ONLY.test(value)
        ? new Date(`${value}T00:00:00${SYSTEM_UTC_OFFSET}`)
        : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** Calendar/clock fields of an instant as seen in PHT. Defaults to now. */
export const getPhtParts = (value: DateInput = new Date()): PhtParts | null => {
  const date = toDate(value);
  if (!date) return null;
  const parts: Record<string, number> = {};
  for (const { type, value: part } of partsFormatter.formatToParts(date)) {
    if (type !== "literal") parts[type] = Number(part);
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
};

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" of an instant in PHT. Defaults to today in PHT. Empty string when invalid. */
export const toPhtDateString = (value: DateInput = new Date()): string => {
  const p = getPhtParts(value);
  return p ? `${p.year}-${pad(p.month)}-${pad(p.day)}` : "";
};

/** Today in PHT as "YYYY-MM-DD". */
export const getPhtToday = (): string => toPhtDateString(new Date());

/** Calendar year of an instant in PHT (serial-number years). Defaults to now. */
export const getPhtYear = (value: DateInput = new Date()): number => {
  const p = getPhtParts(value);
  if (!p) throw new Error("Invalid date.");
  return p.year;
};

/** First millisecond of a PHT calendar day ("YYYY-MM-DD") as epoch ms. */
export const phtDayStartMs = (day: string): number =>
  new Date(`${day}T00:00:00.000${SYSTEM_UTC_OFFSET}`).getTime();

/** Last millisecond of a PHT calendar day ("YYYY-MM-DD") as epoch ms. */
export const phtDayEndMs = (day: string): number =>
  new Date(`${day}T23:59:59.999${SYSTEM_UTC_OFFSET}`).getTime();

/** PHT day bounds as ISO instants, for comparing against stored ISO text columns. */
export const phtDayStartIso = (day: string): string => new Date(phtDayStartMs(day)).toISOString();
export const phtDayEndIso = (day: string): string => new Date(phtDayEndMs(day)).toISOString();

/** M/D/YYYY in PHT (the format toLocaleDateString() gave in en-US). */
export const formatPhtDate = (value: DateInput, fallback = ""): string => {
  const p = getPhtParts(value);
  return p ? `${p.month}/${p.day}/${p.year}` : fallback;
};

/** HH:MM, 24-hour, in PHT. */
export const formatPhtTime = (value: DateInput, fallback = ""): string => {
  const p = getPhtParts(value);
  return p ? `${pad(p.hour)}:${pad(p.minute)}` : fallback;
};

/** HH:MM:SS, 24-hour, in PHT. */
export const formatPhtTimeWithSeconds = (value: DateInput, fallback = ""): string => {
  const p = getPhtParts(value);
  return p ? `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}` : fallback;
};

/** ISO-8601 with the PHT offset, e.g. "2026-11-04T09:30:00.000+08:00" (log lines). */
export const toPhtIsoString = (value: DateInput = new Date()): string => {
  const date = toDate(value);
  if (!date) return "";
  const p = getPhtParts(date)!;
  const ms = String(date.getUTCMilliseconds()).padStart(3, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}.${ms}${SYSTEM_UTC_OFFSET}`;
};

/** "M/D/YYYY, HH:MM:SS" in PHT, labelled with the zone when `withZone` is set. */
export const formatPhtDateTime = (value: DateInput, fallback = "", withZone = false): string => {
  const date = formatPhtDate(value);
  if (!date) return fallback;
  return `${date}, ${formatPhtTimeWithSeconds(value)}${withZone ? " PHT" : ""}`;
};
