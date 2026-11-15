import { calculate, DEFAULT_SETTINGS, status as statusOf } from "../core/rules";
import { defaultEntryWeek, isIsoDate, isoWeekNumber, schoolDays, weekStart, type IsoDate } from "../core/weeks";
import type {
  Absence, AppSettings, Data, Detail, HalfYear, Late, LateExplanation, OverviewRow, Reminder, Student, Warning, WeekEntry, WeekRecord,
} from "./types";

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export interface Tracker {
  /** Stand zum Speichern (JSON-serialisierbar). */
  readonly data: Data;
  addClass(name: string): string;
  addStudent(p: { name: string; classId: string }): string;
  renameStudent(studentId: string, name: string): void;
  archiveStudent(studentId: string): void;
  restoreStudent(studentId: string): void;
  startHalfYear(p: { name: string; start: IsoDate; end: IsoDate }): string;
  /** Aktive Schüler:innen der Klasse mit ihrem Eintrag für die Woche (leer = ohne Fehlzeiten). */
  getWeek(classId: string, week: IsoDate): { studentId: string; name: string; entry: WeekEntry }[];
  /**
   * Speichert (ersetzt) die Einträge und gibt neu erreichte Warnstufen zurück.
   * Wirft ValidationError und ändert dann nichts.
   */
  saveWeek(p: { classId: string; week: IsoDate; entries: Record<string, WeekEntry> }): Warning[];
  /**
   * Speichert (ersetzt) den Eintrag einer Person sofort, ohne die Woche als erfasst zu bestätigen.
   * Gibt neu erreichte Warnstufen zurück. Wirft ValidationError und ändert dann nichts.
   */
  saveEntry(p: { classId: string; week: IsoDate; studentId: string; entry: WeekEntry }): Warning[];
  /** Bestätigt, dass die Woche für die Klasse vollständig erfasst ist (beendet die Erinnerung). */
  confirmWeek(classId: string, week: IsoDate): void;
  isWeekConfirmed(classId: string, week: IsoDate): boolean;
  overview(classId: string, opts?: { halfYearId?: string; includeArchived?: boolean }): OverviewRow[];
  /** Alle Wocheneinträge und die nachvollziehbare Berechnung einer Person (Standard: aktuelles Halbjahr). */
  detail(studentId: string, halfYearId?: string): Detail;
  /** Markiert die Schulversäumnisanzeige als gestellt (Standard: aktuelles Halbjahr). */
  markReportFiled(studentId: string, date: IsoDate, halfYearId?: string): void;
  unmarkReportFiled(studentId: string, halfYearId?: string): void;
  /** Klassen, deren Vorwoche noch nicht als erfasst bestätigt wurde. */
  reminders(): Reminder[];
  updateSettings(patch: Partial<AppSettings>): void;
  /** Halbjahre, die länger als die Löschfrist zurückliegen. */
  expiredHalfYears(): HalfYear[];
  /** Löscht ein Halbjahr samt aller zugehörigen Einträge. */
  deleteHalfYear(halfYearId: string): void;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  ...DEFAULT_SETTINGS,
  preWarning: true,
  reminderHour: 18,
  lockMinutes: 10,
  retentionMonths: 6,
};

export function emptyData(): Data {
  return {
    schemaVersion: 1, nextId: 1, settings: { ...DEFAULT_APP_SETTINGS },
    classes: [], students: [], halfYears: [], weeks: [], confirmedWeeks: [], filed: [], log: [],
  };
}

export const emptyEntry = (): WeekEntry => ({ lates: [], missedHours: 0, missedDays: 0, note: "" });

const absencesIn = (e: WeekEntry): Absence[] => e.absences ?? [];

const isEmpty = (e: WeekEntry) =>
  e.lates.length === 0 && absencesIn(e).length === 0 && e.missedHours === 0 && e.missedDays === 0 && e.note.trim() === "";

const isCount = (n: number, min: number, max = Infinity) => Number.isInteger(n) && n >= min && n <= max;

const sortedLates = (l: Late[]) => [...l].sort((a, b) => a.date.localeCompare(b.date) || a.minutes - b.minutes);
const sortedAbsences = (a: Absence[]) => [...a].sort((x, y) => x.date.localeCompare(y.date) || Number(y.fullDay) - Number(x.fullDay));

/** Kopie eines Eintrags; unbekannte Felder (z. B. aus älteren oder neueren Dateien) bleiben erhalten. */
function copyEntry(e: WeekEntry): WeekEntry {
  const { studentId: _s, week: _w, ...rest } = e as WeekRecord;
  const out: WeekEntry = { ...rest, lates: e.lates.map((l) => ({ ...l })) };
  if (e.absences) out.absences = e.absences.map((a) => ({ ...a }));
  return out;
}

/** Beschreibt, was sich an einem Wocheneintrag geändert hat (leer = nichts). */
function describeChange(old: WeekEntry, next: WeekEntry): string {
  const parts: string[] = [];
  if (old.missedDays !== next.missedDays) parts.push(`Fehltage ${old.missedDays}→${next.missedDays}`);
  if (old.missedHours !== next.missedHours) parts.push(`Fehlstunden ${old.missedHours}→${next.missedHours}`);
  const oa = absencesIn(old), na = absencesIn(next);
  if (oa.length !== na.length) parts.push(`Fehlzeiten-Einträge ${oa.length}→${na.length}`);
  else if (JSON.stringify(sortedAbsences(oa)) !== JSON.stringify(sortedAbsences(na))) parts.push("Fehlzeiten-Einträge geändert");
  if (old.lates.length !== next.lates.length) parts.push(`Verspätungen ${old.lates.length}→${next.lates.length}`);
  else if (JSON.stringify(sortedLates(old.lates)) !== JSON.stringify(sortedLates(next.lates))) parts.push("Verspätungen geändert");
  if (old.note.trim() !== next.note.trim()) parts.push("Bemerkung geändert");
  return parts.join("; ");
}

function addMonths(d: IsoDate, n: number): IsoDate {
  const dt = new Date(`${d}T00:00:00Z`);
  dt.setUTCMonth(dt.getUTCMonth() + n);
  return dt.toISOString().slice(0, 10);
}

function checkSettings(s: AppSettings): void {
  const ok =
    isCount(s.longLateMinutes, 1, 45) && isCount(s.freeShortLates, 0) && isCount(s.hoursPerDay, 1) &&
    isCount(s.warnDays, 1) && isCount(s.dueDays, 1) && s.warnDays <= s.dueDays &&
    isCount(s.reminderHour, 0, 23) && isCount(s.lockMinutes, 1) && isCount(s.retentionMonths, 0);
  if (!ok) throw new ValidationError("Ungültige Einstellungen (Vorwarnung muss vor oder bei der Fälligkeit liegen, Zahlen ganzzahlig und im sinnvollen Bereich).");
}

export function createTracker(opts: { data?: Data; now?: () => string } = {}): Tracker {
  const data: Data = opts.data ?? emptyData();
  const now = opts.now ?? (() => new Date().toISOString());
  const today = () => now().slice(0, 10);

  const newId = (prefix: string) => `${prefix}${data.nextId++}`;
  const log = (text: string) => data.log.push({ at: now(), text });

  function halfYearAt(date: IsoDate): HalfYear | undefined {
    return data.halfYears.find((h) => h.start <= date && date <= h.end);
  }

  function student(id: string): Student {
    const s = data.students.find((x) => x.id === id);
    if (!s) throw new ValidationError(`Unbekannte Schülerin / unbekannter Schüler: ${id}`);
    return s;
  }

  function checkName(name: string, classId: string, exceptId?: string): string {
    const n = name.trim();
    if (!n) throw new ValidationError("Der Vorname darf nicht leer sein.");
    const clash = data.students.some(
      (s) => s.classId === classId && s.id !== exceptId && s.name.toLocaleLowerCase("de") === n.toLocaleLowerCase("de"),
    );
    if (clash) throw new ValidationError(`„${n}“ gibt es in dieser Klasse schon. Bitte einen Zusatz ergänzen (z. B. Initial).`);
    return n;
  }

  function checkEntry(e: WeekEntry, week: IsoDate): void {
    const days = schoolDays(week);
    if (!isCount(e.missedHours, 0)) throw new ValidationError("Fehlstunden müssen eine ganze Zahl ab 0 sein.");
    if (!isCount(e.missedDays, 0, 5)) throw new ValidationError("Fehltage müssen eine ganze Zahl von 0 bis 5 sein.");
    if (e.note.length > 200) throw new ValidationError("Die Bemerkung darf höchstens 200 Zeichen lang sein.");
    const fullDays = new Set<IsoDate>();
    let dayCount = 0, hourSum = 0;
    for (const a of absencesIn(e)) {
      if (!days.includes(a.date)) throw new ValidationError(`Fehlzeit am ${a.date} liegt nicht in der Schulwoche ab ${week}.`);
      if (a.note.length > 200) throw new ValidationError("Die Bemerkung darf höchstens 200 Zeichen lang sein.");
      if (a.fullDay) {
        if (a.hours !== 0) throw new ValidationError("Ein ganzer Fehltag hat keine zusätzliche Stundenzahl.");
        fullDays.add(a.date); dayCount++;
      } else {
        if (!isCount(a.hours, 1, 12)) throw new ValidationError("Fehlstunden pro Eintrag: ganze Zahl von 1 bis 12.");
        hourSum += a.hours;
      }
    }
    if (fullDays.size !== dayCount) throw new ValidationError("Für diesen Tag ist bereits ein ganzer Fehltag eingetragen.");
    if (absencesIn(e).some((a) => !a.fullDay && fullDays.has(a.date))) {
      throw new ValidationError("An einem ganzen Fehltag können keine einzelnen Fehlstunden eingetragen werden.");
    }
    if (e.missedDays < dayCount || e.missedHours < hourSum) {
      throw new ValidationError("Die Wochensumme ist kleiner als die einzeln eingetragenen Fehlzeiten.");
    }
    for (const l of e.lates) {
      if (!days.includes(l.date)) throw new ValidationError(`Verspätung am ${l.date} liegt nicht in der Schulwoche ab ${week}.`);
      if (!isCount(l.minutes, 1, 45)) throw new ValidationError("Minuten zu spät: ganze Zahl von 1 bis 45.");
    }
  }

  function absencesOf(studentId: string, h: HalfYear) {
    const recs = data.weeks.filter((w) => w.studentId === studentId && h.start <= w.week && w.week <= h.end);
    return {
      lateMinutes: recs.flatMap((r) => r.lates.map((l) => l.minutes)),
      missedHours: recs.reduce((s, r) => s + r.missedHours, 0),
      missedDays: recs.reduce((s, r) => s + r.missedDays, 0),
    };
  }

  const activeIn = (classId: string) => data.students.filter((s) => s.classId === classId && !s.archived);

  const isFiled = (studentId: string, h: HalfYear) =>
    data.filed.some((f) => f.studentId === studentId && f.halfYearId === h.id);

  const statusFor = (studentId: string, h: HalfYear) =>
    statusOf(calculate(absencesOf(studentId, h), data.settings).totalDays, isFiled(studentId, h), data.settings);

  function currentHalfYear(halfYearId?: string): HalfYear {
    const h = halfYearId ? data.halfYears.find((x) => x.id === halfYearId) : halfYearAt(today());
    if (!h) throw new ValidationError("Kein passendes Halbjahr gefunden.");
    return h;
  }

  function confirm(classId: string, week: IsoDate): void {
    if (!data.confirmedWeeks.some((c) => c.classId === classId && c.week === week)) {
      data.confirmedWeeks.push({ classId, week });
    }
  }

  /** Prüft alle Einträge, schreibt sie erst dann und liefert neu erreichte Warnstufen. */
  function write(classId: string, week: IsoDate, entries: Record<string, WeekEntry>): Warning[] {
    if (!isIsoDate(week) || weekStart(week) !== week) throw new ValidationError("Die Woche muss durch ihren Montag angegeben werden.");
    if (!halfYearAt(week)) throw new ValidationError("Für diese Woche gibt es noch kein Halbjahr. Bitte zuerst ein Halbjahr anlegen.");
    for (const [studentId, e] of Object.entries(entries)) {
      if (student(studentId).classId !== classId) throw new ValidationError("Die Schülerin / der Schüler gehört nicht zu dieser Klasse.");
      checkEntry(e, week);
    }

    const h = halfYearAt(week)!;
    const before = new Map(Object.keys(entries).map((id) => [id, statusFor(id, h)]));

    const kw = isoWeekNumber(week);
    for (const [studentId, e] of Object.entries(entries)) {
      const old = data.weeks.find((w) => w.studentId === studentId && w.week === week) ?? emptyEntry();
      const change = describeChange(old, e);
      if (change) log(`KW ${kw} · ${student(studentId).name}: ${change}`);
      data.weeks = data.weeks.filter((w) => !(w.studentId === studentId && w.week === week));
      if (!isEmpty(e)) data.weeks.push({ ...copyEntry(e), studentId, week });
    }

    const className = data.classes.find((c) => c.id === classId)?.name ?? "";
    const warnings: Warning[] = [];
    for (const [studentId, was] of before) {
      const now_ = statusFor(studentId, h);
      const kind = now_ === "red" && was !== "red" ? "due" : now_ === "yellow" && was === "green" && data.settings.preWarning ? "warn" : null;
      if (kind) {
        warnings.push({
          kind, studentId, name: student(studentId).name, className,
          totalDays: calculate(absencesOf(studentId, h), data.settings).totalDays,
        });
      }
    }
    return warnings;
  }

  return {
    data,

    addClass(name) {
      const n = name.trim();
      if (!n) throw new ValidationError("Der Klassenname darf nicht leer sein.");
      const id = newId("c");
      data.classes.push({ id, name: n });
      log(`Klasse angelegt: ${n}`);
      return id;
    },

    addStudent({ name, classId }) {
      if (!data.classes.some((c) => c.id === classId)) throw new ValidationError("Unbekannte Klasse.");
      const n = checkName(name, classId);
      const id = newId("s");
      data.students.push({ id, name: n, classId, archived: false });
      log(`Angelegt: ${n} (${data.classes.find((c) => c.id === classId)!.name})`);
      return id;
    },

    renameStudent(studentId, name) {
      const s = student(studentId);
      const old = s.name;
      s.name = checkName(name, s.classId, s.id);
      log(`Umbenannt: ${old} → ${s.name}`);
    },

    archiveStudent(studentId) {
      const s = student(studentId);
      s.archived = true;
      log(`Archiviert: ${s.name}`);
    },

    restoreStudent(studentId) {
      const s = student(studentId);
      s.archived = false;
      log(`Wiederhergestellt: ${s.name}`);
    },

    startHalfYear({ name, start, end }) {
      if (!isIsoDate(start) || !isIsoDate(end) || start > end) throw new ValidationError("Ungültiger Zeitraum für das Halbjahr.");
      const id = newId("h");
      data.halfYears.push({ id, name, start, end });
      log(`Halbjahr angelegt: ${name} (${start} bis ${end})`);
      return id;
    },

    getWeek(classId, week) {
      return activeIn(classId).map((s) => {
        const rec = data.weeks.find((w) => w.studentId === s.id && w.week === week);
        const entry: WeekEntry = rec ? copyEntry(rec) : emptyEntry();
        return { studentId: s.id, name: s.name, entry };
      });
    },

    saveWeek({ classId, week, entries }) {
      const warnings = write(classId, week, entries);
      confirm(classId, week);
      return warnings;
    },

    saveEntry({ classId, week, studentId, entry }) {
      return write(classId, week, { [studentId]: entry });
    },

    confirmWeek(classId, week) {
      if (!data.classes.some((c) => c.id === classId)) throw new ValidationError("Unbekannte Klasse.");
      if (!isIsoDate(week) || weekStart(week) !== week) throw new ValidationError("Die Woche muss durch ihren Montag angegeben werden.");
      confirm(classId, week);
    },

    isWeekConfirmed(classId, week) {
      return data.confirmedWeeks.some((c) => c.classId === classId && c.week === week);
    },

    detail(studentId, halfYearId) {
      const s = student(studentId);
      const h = currentHalfYear(halfYearId);
      const weeks = data.weeks
        .filter((w) => w.studentId === studentId && h.start <= w.week && w.week <= h.end)
        .sort((a, b) => a.week.localeCompare(b.week))
        .map((w) => ({ ...w, lates: sortedLates(w.lates), ...(w.absences ? { absences: sortedAbsences(w.absences) } : {}) }));
      const result = calculate(absencesOf(studentId, h), data.settings);

      let ordinal = 0;
      const lateExplanation: LateExplanation[] = sortedLates(weeks.flatMap((w) => w.lates)).map((l) => {
        if (l.minutes >= data.settings.longLateMinutes) return { ...l, effect: "long", hours: 1 };
        ordinal++;
        return ordinal > data.settings.freeShortLates
          ? { ...l, effect: "counts", ordinal, hours: 1 }
          : { ...l, effect: "free", ordinal, hours: 0 };
      });

      return {
        student: { ...s },
        className: data.classes.find((c) => c.id === s.classId)?.name ?? "",
        halfYear: { ...h },
        weeks,
        absences: weeks.flatMap((w) => absencesIn(w)).map((a) => ({ ...a })),
        lateExplanation,
        recordedHours: weeks.reduce((n, w) => n + w.missedHours, 0),
        recordedDays: weeks.reduce((n, w) => n + w.missedDays, 0),
        result,
        status: statusFor(studentId, h),
        filedOn: data.filed.find((f) => f.studentId === studentId && f.halfYearId === h.id)?.date,
        settings: { ...data.settings },
      };
    },

    markReportFiled(studentId, date, halfYearId) {
      const s = student(studentId);
      if (!isIsoDate(date)) throw new ValidationError("Ungültiges Datum.");
      const h = currentHalfYear(halfYearId);
      data.filed = data.filed.filter((f) => !(f.studentId === studentId && f.halfYearId === h.id));
      data.filed.push({ studentId, halfYearId: h.id, date });
      log(`Anzeige gestellt: ${s.name} am ${date}`);
    },

    unmarkReportFiled(studentId, halfYearId) {
      const s = student(studentId);
      const h = currentHalfYear(halfYearId);
      data.filed = data.filed.filter((f) => !(f.studentId === studentId && f.halfYearId === h.id));
      log(`Markierung „Anzeige gestellt“ entfernt: ${s.name}`);
    },

    reminders() {
      const week = defaultEntryWeek(today());
      if (!halfYearAt(week)) return [];
      return data.classes
        .filter((c) => activeIn(c.id).length > 0 && !data.confirmedWeeks.some((x) => x.classId === c.id && x.week === week))
        .map((c) => ({ classId: c.id, className: c.name, week }));
    },

    updateSettings(patch) {
      const next = { ...data.settings, ...patch };
      checkSettings(next);
      const changed = Object.keys(patch).filter((k) => (data.settings as unknown as Record<string, unknown>)[k] !== (next as unknown as Record<string, unknown>)[k]);
      data.settings = next;
      if (changed.length) log(`Einstellungen geändert: ${changed.join(", ")}`);
    },

    expiredHalfYears() {
      return data.halfYears.filter((h) => addMonths(h.end, data.settings.retentionMonths) < today());
    },

    deleteHalfYear(halfYearId) {
      const h = currentHalfYear(halfYearId);
      const inRange = (week: IsoDate) => h.start <= week && week <= h.end;
      data.weeks = data.weeks.filter((w) => !inRange(w.week));
      data.confirmedWeeks = data.confirmedWeeks.filter((c) => !inRange(c.week));
      data.filed = data.filed.filter((f) => f.halfYearId !== h.id);
      data.halfYears = data.halfYears.filter((x) => x.id !== h.id);
      log(`Halbjahr gelöscht: ${h.name}`);
    },

    overview(classId, { halfYearId, includeArchived = false } = {}) {
      const h = halfYearId ? data.halfYears.find((x) => x.id === halfYearId) : halfYearAt(today());
      if (!h) return [];
      const rows = data.students
        .filter((s) => s.classId === classId && (includeArchived || !s.archived))
        .map((s): OverviewRow => {
          const a = absencesOf(s.id, h);
          const r = calculate(a, data.settings);
          const filed = data.filed.find((f) => f.studentId === s.id && f.halfYearId === h.id);
          return {
            studentId: s.id, name: s.name, archived: s.archived,
            recordedDays: a.missedDays, recordedHours: a.missedHours,
            lateCount: r.longLates + r.shortLates,
            hoursFromLates: r.hoursFromLongLates + r.hoursFromShortLates,
            totalHours: r.totalHours, totalDays: r.totalDays, remainderHours: r.remainderHours,
            status: statusOf(r.totalDays, !!filed, data.settings),
            filedOn: filed?.date,
          };
        });
      return rows.sort((a, b) => b.totalDays - a.totalDays || b.totalHours - a.totalHours || a.name.localeCompare(b.name, "de"));
    },
  };
}
