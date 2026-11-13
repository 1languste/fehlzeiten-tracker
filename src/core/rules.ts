/** Rechenkern: reine Funktionen, keine UI, kein Speicher. Regeln siehe docs/anforderung.md. */

export interface Settings {
  /** Verspätung ab dieser Dauer (Minuten) zählt sofort als 1 Fehlstunde. */
  longLateMinutes: number;
  /** Anzahl kürzerer Verspätungen, die folgenlos bleiben; ab der nächsten zählt jede als Fehlstunde. */
  freeShortLates: number;
  /** Fehlstunden pro Fehltag. */
  hoursPerDay: number;
  /** Fehltage ab denen die Vorwarnung (gelb) gilt. */
  warnDays: number;
  /** Fehltage ab denen die Schulversäumnisanzeige fällig ist (rot). */
  dueDays: number;
}

export const DEFAULT_SETTINGS: Settings = {
  longLateMinutes: 20,
  freeShortLates: 2,
  hoursPerDay: 6,
  warnDays: 3,
  dueDays: 5,
};

/** Alle Einträge einer Person im Schulhalbjahr. */
export interface Absences {
  /** Minuten je Verspätung. */
  lateMinutes: number[];
  /** Erfasste unentschuldigte Fehlstunden. */
  missedHours: number;
  /** Erfasste unentschuldigte Fehltage. */
  missedDays: number;
}

export interface Result {
  longLates: number;
  shortLates: number;
  /** Fehlstunden aus Regel 1 (lange Verspätungen). */
  hoursFromLongLates: number;
  /** Fehlstunden aus Regel 2 (häufige kurze Verspätungen). */
  hoursFromShortLates: number;
  totalHours: number;
  daysFromHours: number;
  /** Fehlstunden, die noch nicht zu einem vollen Fehltag reichen. */
  remainderHours: number;
  totalDays: number;
}

export type Status = "green" | "yellow" | "red" | "done";

export function calculate(a: Absences, s: Settings = DEFAULT_SETTINGS): Result {
  const longLates = a.lateMinutes.filter((m) => m >= s.longLateMinutes).length;
  const shortLates = a.lateMinutes.length - longLates;

  const hoursFromLongLates = longLates;
  const hoursFromShortLates = Math.max(0, shortLates - s.freeShortLates);

  const totalHours = a.missedHours + hoursFromLongLates + hoursFromShortLates;
  const daysFromHours = Math.floor(totalHours / s.hoursPerDay);

  return {
    longLates,
    shortLates,
    hoursFromLongLates,
    hoursFromShortLates,
    totalHours,
    daysFromHours,
    remainderHours: totalHours - daysFromHours * s.hoursPerDay,
    totalDays: a.missedDays + daysFromHours,
  };
}

/** `reportFiled`: Anzeige wurde bereits gestellt (manuell markiert). */
export function status(totalDays: number, reportFiled: boolean, s: Settings = DEFAULT_SETTINGS): Status {
  if (reportFiled) return "done";
  if (totalDays >= s.dueDays) return "red";
  if (totalDays >= s.warnDays) return "yellow";
  return "green";
}
