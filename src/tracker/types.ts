import type { IsoDate } from "../core/weeks";
import type { Result, Settings, Status } from "../core/rules";

/** Einstellungen = Rechenschwellen + App-Verhalten. */
export interface AppSettings extends Settings {
  /** Vorwarnung bei gelb anzeigen (abschaltbar). */
  preWarning: boolean;
  /** Uhrzeit der Sonntags-Erinnerung (Stunde 0-23). */
  reminderHour: number;
  /** Sperre nach so vielen Minuten Inaktivität. */
  lockMinutes: number;
  /** Abgelaufene Halbjahre nach so vielen Monaten zur Löschung vorschlagen. */
  retentionMonths: number;
}

export interface SchoolClass { id: string; name: string }
export interface Student { id: string; name: string; classId: string; archived: boolean }
export interface HalfYear { id: string; name: string; start: IsoDate; end: IsoDate }

export interface Late { date: IsoDate; hour: number; minutes: number }

/** Eintrag einer Person für eine Woche (so wird er eingegeben). */
export interface WeekEntry {
  lates: Late[];
  missedHours: number;
  missedDays: number;
  note: string;
}

export interface WeekRecord extends WeekEntry { studentId: string; week: IsoDate }

export interface Filed { studentId: string; halfYearId: string; date: IsoDate }
export interface LogEntry { at: string; text: string }
export interface ConfirmedWeek { classId: string; week: IsoDate }

/** Alles, was gespeichert wird (JSON-serialisierbar). */
export interface Data {
  schemaVersion: 1;
  nextId: number;
  settings: AppSettings;
  classes: SchoolClass[];
  students: Student[];
  halfYears: HalfYear[];
  weeks: WeekRecord[];
  confirmedWeeks: ConfirmedWeek[];
  filed: Filed[];
  log: LogEntry[];
}

export interface Warning {
  kind: "due" | "warn";
  studentId: string;
  name: string;
  className: string;
  totalDays: number;
}

export interface OverviewRow {
  studentId: string;
  name: string;
  archived: boolean;
  lateCount: number;
  hoursFromLates: number;
  totalHours: number;
  totalDays: number;
  remainderHours: number;
  status: Status;
  filedOn?: IsoDate;
}

export interface LateExplanation extends Late {
  /** long: ab 20 Min, free: folgenlos, counts: zählt als Fehlstunde */
  effect: "long" | "free" | "counts";
  /** Laufende Nummer unter den kurzen Verspätungen (nur bei free/counts). */
  ordinal?: number;
  hours: 0 | 1;
}

export interface Detail {
  student: Student;
  className: string;
  halfYear: HalfYear;
  weeks: WeekRecord[];
  lateExplanation: LateExplanation[];
  recordedHours: number;
  recordedDays: number;
  result: Result;
  status: Status;
  filedOn?: IsoDate;
  /** Die zum Berechnungszeitpunkt gültigen Einstellungen (für Erklärungstexte). */
  settings: AppSettings;
}

export interface Reminder { classId: string; className: string; week: IsoDate }
