import { describe, expect, it } from "vitest";
import { createTracker, ValidationError, type Tracker } from "./tracker";
import type { WeekEntry } from "./types";

const NOW = "2026-11-15T10:00:00"; // Sonntag, KW 46
const W1 = "2026-11-02"; // Montag KW 45
const W2 = "2026-11-09"; // Montag KW 46

const entry = (p: Partial<WeekEntry> = {}): WeekEntry => ({
  lates: [], missedHours: 0, missedDays: 0, note: "", ...p,
});
const late = (date: string, minutes: number, hour = 1) => ({ date, hour, minutes });

/** Tracker mit Klasse 5a, Schülerin Anna und dem Halbjahr 1. 8.-31. 1. */
function setup(): { t: Tracker; classId: string; anna: string } {
  const t = createTracker({ now: () => NOW });
  t.startHalfYear({ name: "1. Halbjahr 2026/27", start: "2026-08-10", end: "2027-01-29" });
  const classId = t.addClass("5a");
  const anna = t.addStudent({ name: "Anna", classId });
  return { t, classId, anna };
}

describe("Warnungen und Anzeige", () => {
  it("warnt beim Erreichen von 3 Fehltagen (gelb) und 5 Fehltagen (rot), je nur einmal", () => {
    const { t, classId, anna } = setup();

    // Beispiel 6: 3 Fehltage + 11 Fehlstunden = 4 Tage -> Vorwarnung
    const w1 = t.saveWeek({ classId, week: W1, entries: { [anna]: entry({ missedDays: 3, missedHours: 11 }) } });
    expect(w1).toEqual([{ kind: "warn", studentId: anna, name: "Anna", className: "5a", totalDays: 4 }]);

    // erneutes Speichern ohne Statuswechsel -> keine neue Warnung
    expect(t.saveWeek({ classId, week: W1, entries: { [anna]: entry({ missedDays: 3, missedHours: 10 }) } })).toEqual([]); // 4 Tage

    // Beispiel 7: weiterer Tag -> 5 Tage -> fällig
    const w2 = t.saveWeek({ classId, week: W2, entries: { [anna]: entry({ missedDays: 1 }) } });
    expect(w2).toEqual([{ kind: "due", studentId: anna, name: "Anna", className: "5a", totalDays: 5 }]);
    expect(t.overview(classId)[0]!.status).toBe("red");
  });

  it("springt eine Woche von grün direkt auf rot, kommt nur die Warnung 'fällig'", () => {
    const { t, classId, anna } = setup();
    const w = t.saveWeek({ classId, week: W2, entries: { [anna]: entry({ missedDays: 5 }) } });
    expect(w.map((x) => x.kind)).toEqual(["due"]);
  });

  it("die Vorwarnung lässt sich abschalten, 'fällig' bleibt", () => {
    const { t, classId, anna } = setup();
    t.updateSettings({ preWarning: false });
    expect(t.saveWeek({ classId, week: W1, entries: { [anna]: entry({ missedDays: 4 }) } })).toEqual([]);
    expect(t.saveWeek({ classId, week: W2, entries: { [anna]: entry({ missedDays: 1 }) } }).map((x) => x.kind)).toEqual(["due"]);
  });

  it("nach 'Anzeige gestellt': Status erledigt, Zählung läuft weiter, keine neue Warnung", () => {
    const { t, classId, anna } = setup();
    t.saveWeek({ classId, week: W1, entries: { [anna]: entry({ missedDays: 5 }) } });
    t.markReportFiled(anna, "2026-11-10");

    let row = t.overview(classId)[0]!;
    expect([row.status, row.filedOn, row.totalDays]).toEqual(["done", "2026-11-10", 5]);

    expect(t.saveWeek({ classId, week: W2, entries: { [anna]: entry({ missedDays: 2 }) } })).toEqual([]);
    row = t.overview(classId)[0]!;
    expect([row.status, row.totalDays]).toEqual(["done", 7]);

    t.unmarkReportFiled(anna);
    expect(t.overview(classId)[0]!.status).toBe("red");
  });
});

describe("Detailansicht", () => {
  it("erklärt chronologisch, welche Verspätung wie zählt, und stimmt mit der Übersicht überein", () => {
    const { t, classId, anna } = setup();
    t.saveWeek({
      classId, week: W2,
      entries: {
        [anna]: entry({
          missedHours: 1, note: "Arzttermin",
          // bewusst unsortiert eingegeben
          lates: [late("2026-11-12", 10), late("2026-11-09", 5), late("2026-11-11", 30, 2), late("2026-11-10", 10), late("2026-11-13", 10)],
        }),
      },
    });
    const d = t.detail(anna);

    expect(d.lateExplanation.map((l) => [l.date, l.effect, l.ordinal ?? null, l.hours])).toEqual([
      ["2026-11-09", "free", 1, 0],
      ["2026-11-10", "free", 2, 0],
      ["2026-11-11", "long", null, 1],
      ["2026-11-12", "counts", 3, 1],
      ["2026-11-13", "counts", 4, 1],
    ]);
    expect(d.recordedHours).toBe(1);
    expect(d.result.totalHours).toBe(4);
    expect(d.lateExplanation.reduce((s, l) => s + l.hours, 0)).toBe(d.result.hoursFromLongLates + d.result.hoursFromShortLates);
    expect(d.weeks.map((w) => [w.week, w.note])).toEqual([[W2, "Arzttermin"]]);
    expect(d.className).toBe("5a");
    expect(d.status).toBe("green");

    const row = t.overview(classId)[0]!;
    expect([d.result.totalHours, d.result.totalDays]).toEqual([row.totalHours, row.totalDays]);
  });
});

describe("Änderungsprotokoll und Speicherung", () => {
  it("protokolliert Änderungen mit Datum, aber keine unveränderten Speicherungen", () => {
    const { t, classId, anna } = setup();
    t.data.log.length = 0;

    t.saveWeek({ classId, week: W2, entries: { [anna]: entry({ missedDays: 2, lates: [late("2026-11-09", 5)] }) } });
    expect(t.data.log).toEqual([
      { at: NOW, text: "KW 46 · Anna: Fehltage 0→2; Verspätungen 0→1" },
    ]);

    t.saveWeek({ classId, week: W2, entries: { [anna]: entry({ missedDays: 2, lates: [late("2026-11-09", 5)] }) } });
    expect(t.data.log).toHaveLength(1); // nichts geändert

    t.saveWeek({ classId, week: W2, entries: { [anna]: entry({ missedDays: 1, lates: [late("2026-11-09", 5)], note: "Entschuldigung" }) } });
    expect(t.data.log[1]!.text).toBe("KW 46 · Anna: Fehltage 2→1; Bemerkung geändert");

    t.saveWeek({ classId, week: W2, entries: { [anna]: entry() } });
    expect(t.data.log[2]!.text).toBe("KW 46 · Anna: Fehltage 1→0; Verspätungen 1→0; Bemerkung geändert");
  });

  it("protokolliert Stammdaten und Anzeige", () => {
    const { t, classId, anna } = setup();
    t.data.log.length = 0;
    t.renameStudent(anna, "Anna K.");
    t.archiveStudent(anna);
    t.restoreStudent(anna);
    t.markReportFiled(anna, "2026-11-10");
    t.unmarkReportFiled(anna);
    void classId;
    expect(t.data.log.map((l) => l.text)).toEqual([
      "Umbenannt: Anna → Anna K.",
      "Archiviert: Anna K.",
      "Wiederhergestellt: Anna K.",
      "Anzeige gestellt: Anna K. am 2026-11-10",
      "Markierung „Anzeige gestellt“ entfernt: Anna K.",
    ]);
  });

  it("übersteht einen Rundlauf über JSON ohne Informationsverlust", () => {
    const { t, classId, anna } = setup();
    t.saveWeek({ classId, week: W2, entries: { [anna]: entry({ missedDays: 3, lates: [late("2026-11-09", 25)], note: "Ü" }) } });
    t.markReportFiled(anna, "2026-11-12");

    const t2 = createTracker({ data: JSON.parse(JSON.stringify(t.data)), now: () => NOW });
    expect(t2.overview(classId)).toEqual(t.overview(classId));
    expect(t2.detail(anna)).toEqual(t.detail(anna));
    const id = t2.addStudent({ name: "Ben", classId });
    expect(id).not.toBe(anna); // IDs laufen weiter
  });
});

describe("Erinnerung, Einstellungen, Löschfrist", () => {
  it("erinnert an die Vorwoche, bis sie gespeichert wurde, auch wenn sie leer ist", () => {
    const { t, classId } = setup();
    expect(t.reminders()).toEqual([{ classId, className: "5a", week: W2 }]);
    t.saveWeek({ classId, week: W2, entries: {} });
    expect(t.reminders()).toEqual([]);
  });

  it("erinnert nicht für Klassen ohne aktive Schüler:innen oder außerhalb eines Halbjahres", () => {
    const t = createTracker({ now: () => NOW });
    const empty = t.addClass("6b");
    void empty;
    t.startHalfYear({ name: "H", start: "2026-08-10", end: "2027-01-29" });
    expect(t.reminders()).toEqual([]); // 6b ohne Schüler:innen

    const t2 = createTracker({ now: () => "2026-07-05T10:00:00" }); // Sommerferien, kein Halbjahr
    t2.startHalfYear({ name: "H", start: "2026-08-10", end: "2027-01-29" });
    const c = t2.addClass("5a");
    t2.addStudent({ name: "Anna", classId: c });
    expect(t2.reminders()).toEqual([]);
  });

  it("prüft Einstellungen auf Plausibilität", () => {
    const { t } = setup();
    t.updateSettings({ dueDays: 10, warnDays: 6 });
    expect(t.data.settings.dueDays).toBe(10);
    expect(() => t.updateSettings({ warnDays: 11 })).toThrow(ValidationError); // Vorwarnung nach Fälligkeit
    expect(() => t.updateSettings({ hoursPerDay: 0 })).toThrow(ValidationError);
    expect(() => t.updateSettings({ reminderHour: 24 })).toThrow(ValidationError);
    expect(t.data.settings.warnDays).toBe(6); // unverändert
  });

  it("schlägt abgelaufene Halbjahre nach der Löschfrist vor und löscht ihre Daten auf Wunsch", () => {
    const t = createTracker({ now: () => "2027-09-01T10:00:00" });
    const c = t.addClass("5a");
    const anna = t.addStudent({ name: "Anna", classId: c });
    const old = t.startHalfYear({ name: "alt", start: "2026-08-10", end: "2027-01-29" });
    const cur = t.startHalfYear({ name: "neu", start: "2027-08-09", end: "2028-01-28" });
    t.saveWeek({ classId: c, week: "2026-11-09", entries: { [anna]: entry({ missedDays: 5 }) } });
    t.markReportFiled(anna, "2026-11-20", old);
    t.saveWeek({ classId: c, week: "2027-08-16", entries: { [anna]: entry({ missedDays: 1 }) } });

    expect(t.expiredHalfYears().map((h) => h.id)).toEqual([old]); // Ende Jan + 6 Monate < Sept 2027

    t.deleteHalfYear(old);
    expect(t.data.halfYears.map((h) => h.id)).toEqual([cur]);
    expect(t.data.weeks.map((w) => w.week)).toEqual(["2027-08-16"]);
    expect(t.data.filed).toEqual([]);
  });
});

describe("Korrigieren, Archivieren, Validieren", () => {
  it("eine korrigierte Woche ersetzt den alten Eintrag, ein leerer Eintrag löscht ihn", () => {
    const { t, classId, anna } = setup();
    t.saveWeek({ classId, week: W2, entries: { [anna]: entry({ missedDays: 2 }) } });
    expect(t.overview(classId)[0]!.totalDays).toBe(2);

    t.saveWeek({ classId, week: W2, entries: { [anna]: entry({ missedDays: 1, note: "Entschuldigung nachgereicht" }) } });
    expect(t.overview(classId)[0]!.totalDays).toBe(1);

    t.saveWeek({ classId, week: W2, entries: { [anna]: entry() } });
    expect(t.overview(classId)[0]!.totalDays).toBe(0);
    expect(t.data.weeks).toHaveLength(0);
  });

  it("getWeek liefert alle aktiven Schüler:innen, leere Wochen als 'ohne Fehlzeiten'", () => {
    const { t, classId, anna } = setup();
    const ben = t.addStudent({ name: "Ben", classId });
    t.saveWeek({ classId, week: W2, entries: { [anna]: entry({ missedHours: 2 }) } });
    const w = t.getWeek(classId, W2);
    expect(w.map((x) => x.name)).toEqual(["Anna", "Ben"]);
    expect(w[0]!.entry.missedHours).toBe(2);
    expect(w[1]!.studentId).toBe(ben);
    expect(w[1]!.entry).toEqual(entry());
  });

  it("archivierte Schüler:innen verschwinden aus Erfassung und Übersicht, die Historie bleibt", () => {
    const { t, classId, anna } = setup();
    t.saveWeek({ classId, week: W2, entries: { [anna]: entry({ missedDays: 2 }) } });
    t.archiveStudent(anna);
    expect(t.overview(classId)).toEqual([]);
    expect(t.getWeek(classId, W2)).toEqual([]);
    expect(t.overview(classId, { includeArchived: true })[0]!.totalDays).toBe(2);
    t.restoreStudent(anna);
    expect(t.overview(classId)).toHaveLength(1);
  });

  it("benennt um, lehnt aber doppelte Vornamen in einer Klasse ab", () => {
    const { t, classId, anna } = setup();
    t.addStudent({ name: "Ben", classId });
    t.renameStudent(anna, "Anna K.");
    expect(t.overview(classId).map((r) => r.name).sort()).toEqual(["Anna K.", "Ben"]);
    expect(() => t.addStudent({ name: "Ben", classId })).toThrow(ValidationError);
    expect(() => t.renameStudent(anna, "Ben")).toThrow(ValidationError);
    expect(() => t.addStudent({ name: "  ", classId })).toThrow(ValidationError);
  });

  it("weist ungültige Einträge ab und speichert dann nichts", () => {
    const { t, classId, anna } = setup();
    const bad = (e: Partial<WeekEntry>) => () => t.saveWeek({ classId, week: W2, entries: { [anna]: entry(e) } });
    expect(bad({ lates: [late("2026-11-09", 0)] })).toThrow(ValidationError); // 0 Minuten
    expect(bad({ lates: [late("2026-11-20", 5)] })).toThrow(ValidationError); // andere Woche
    expect(bad({ lates: [late("2026-11-14", 5)] })).toThrow(ValidationError); // Samstag
    expect(bad({ lates: [late("2026-11-09", 5, 0)] })).toThrow(ValidationError); // Stunde 0
    expect(bad({ missedHours: -1 })).toThrow(ValidationError);
    expect(bad({ missedDays: 1.5 })).toThrow(ValidationError);
    expect(bad({ missedDays: 6 })).toThrow(ValidationError); // mehr als 5 Schultage
    expect(() => t.saveWeek({ classId, week: "2026-11-10", entries: {} })).toThrow(ValidationError); // kein Montag
    expect(t.data.weeks).toHaveLength(0);
  });

  it("eine Woche ohne Halbjahr kann nicht erfasst werden; Halbjahre zählen getrennt", () => {
    const { t, classId, anna } = setup();
    expect(() => t.saveWeek({ classId, week: "2027-02-01", entries: { [anna]: entry({ missedDays: 1 }) } })).toThrow(ValidationError);

    const h2 = t.startHalfYear({ name: "2. Halbjahr 2026/27", start: "2027-02-01", end: "2027-07-09" });
    t.saveWeek({ classId, week: W2, entries: { [anna]: entry({ missedDays: 2 }) } });
    t.saveWeek({ classId, week: "2027-02-01", entries: { [anna]: entry({ missedDays: 1 }) } });
    expect(t.overview(classId)[0]!.totalDays).toBe(2); // aktuelles Halbjahr (NOW)
    expect(t.overview(classId, { halfYearId: h2 })[0]!.totalDays).toBe(1);
  });
});

describe("Erfassung und Übersicht", () => {
  it("rechnet über mehrere Wochen kumuliert (Beispiel 4 und 5 der Anforderung)", () => {
    const { t, classId, anna } = setup();

    t.saveWeek({
      classId, week: W1,
      entries: { [anna]: entry({ missedHours: 4, lates: [late("2026-11-02", 10), late("2026-11-03", 10), late("2026-11-04", 10)] }) },
    });
    let row = t.overview(classId)[0]!;
    expect([row.totalHours, row.totalDays, row.remainderHours, row.status]).toEqual([5, 0, 5, "green"]);

    t.saveWeek({ classId, week: W2, entries: { [anna]: entry({ missedHours: 1 }) } });
    row = t.overview(classId)[0]!;
    expect([row.totalHours, row.totalDays, row.status]).toEqual([6, 1, "green"]);
    expect(row.lateCount).toBe(3);
  });

  it("sortiert die Übersicht nach Fehltagen absteigend", () => {
    const { t, classId, anna } = setup();
    const ben = t.addStudent({ name: "Ben", classId });
    t.saveWeek({ classId, week: W1, entries: { [anna]: entry({ missedDays: 1 }), [ben]: entry({ missedDays: 3 }) } });
    expect(t.overview(classId).map((r) => r.name)).toEqual(["Ben", "Anna"]);
  });
});
