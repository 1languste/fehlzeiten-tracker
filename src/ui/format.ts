import { addDays, isoWeekNumber, type IsoDate } from "../core/weeks";

/** "2026-11-09" -> "09.11.2026" */
export function formatDate(d: IsoDate): string {
  const [y, m, day] = d.split("-");
  return `${day}.${m}.${y}`;
}

/** "KW 46 · 09.11.–13.11.2026" */
export function weekLabel(monday: IsoDate): string {
  const friday = addDays(monday, 4);
  const from = formatDate(monday);
  const to = formatDate(friday);
  const range = monday.slice(0, 4) === friday.slice(0, 4) ? `${from.slice(0, 6)}–${to}` : `${from}–${to}`;
  return `KW ${isoWeekNumber(monday)} · ${range}`;
}

/** Leer = 0; sonst ganze Zahl >= 0; alles andere = NaN. */
export function parseCount(s: string): number {
  const t = s.trim();
  if (t === "") return 0;
  return /^\d+$/.test(t) ? Number(t) : NaN;
}

/** Vorschlag fürs Halbjahr (Bundesländer unterscheiden sich, daher im Formular änderbar). */
export function suggestHalfYear(today: IsoDate): { name: string; start: IsoDate; end: IsoDate } {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const label = (y: number) => `${y}/${String(y + 1).slice(2)}`;
  if (month >= 8) return { name: `1. Halbjahr ${label(year)}`, start: `${year}-08-01`, end: `${year + 1}-01-31` };
  if (month === 1) return { name: `1. Halbjahr ${label(year - 1)}`, start: `${year - 1}-08-01`, end: `${year}-01-31` };
  return { name: `2. Halbjahr ${label(year - 1)}`, start: `${year}-02-01`, end: `${year}-07-31` };
}
