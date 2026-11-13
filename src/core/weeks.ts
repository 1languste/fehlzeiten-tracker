/** Datumslogik. Datumsangaben sind ISO-Strings "YYYY-MM-DD", gerechnet wird in UTC (keine Zeitzonenfehler). */

export type IsoDate = string;

const DAY = 86_400_000;

function toMs(d: IsoDate): number {
  const [y, m, day] = d.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, day);
}

function fromMs(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(d: IsoDate, n: number): IsoDate {
  return fromMs(toMs(d) + n * DAY);
}

/** 0 = Montag … 6 = Sonntag */
function weekday(d: IsoDate): number {
  return (new Date(toMs(d)).getUTCDay() + 6) % 7;
}

export function weekStart(d: IsoDate): IsoDate {
  return addDays(d, -weekday(d));
}

/** Montag bis Freitag der Woche, in der `monday` liegt. */
export function schoolDays(monday: IsoDate): IsoDate[] {
  const start = weekStart(monday);
  return [0, 1, 2, 3, 4].map((i) => addDays(start, i));
}

/** ISO-8601-Kalenderwoche (Donnerstag der Woche bestimmt das Jahr). */
export function isoWeekNumber(d: IsoDate): number {
  const thursday = addDays(weekStart(d), 3);
  const yearStart = `${thursday.slice(0, 4)}-01-01`;
  return Math.floor((toMs(thursday) - toMs(yearStart)) / DAY / 7) + 1;
}

/**
 * Voreingestellte Erfassungswoche: am Wochenende die gerade beendete Schulwoche,
 * unter der Woche die vorige.
 */
export function defaultEntryWeek(today: IsoDate): IsoDate {
  const monday = weekStart(today);
  return weekday(today) >= 5 ? monday : addDays(monday, -7);
}

export function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && fromMs(toMs(s)) === s;
}
