import { describe, expect, it } from "vitest";
import { createTracker } from "../tracker/tracker";
import type { WeekEntry } from "../tracker/types";
import { detailCsv, detailHtml, overviewCsv, overviewHtml } from "./export";

const NOW = "2026-11-15T10:00:00";
const entry = (p: Partial<WeekEntry>): WeekEntry => ({ lates: [], missedHours: 0, missedDays: 0, note: "", ...p });
const late = (date: string, minutes: number, hour = 1) => ({ date, hour, minutes });

function fixture(name = "Anna", note = "Arzttermin") {
  const t = createTracker({ now: () => NOW });
  const h = t.startHalfYear({ name: "1. Halbjahr 2026/27", start: "2026-08-10", end: "2027-01-29" });
  const classId = t.addClass("5a");
  const anna = t.addStudent({ name, classId });
  const ben = t.addStudent({ name: "Ben", classId });
  t.saveWeek({
    classId, week: "2026-11-09",
    entries: {
      [anna]: entry({
        missedHours: 1, note,
        lates: [late("2026-11-09", 5), late("2026-11-10", 10), late("2026-11-11", 30, 2), late("2026-11-12", 10), late("2026-11-13", 10)],
      }),
      [ben]: entry({ missedDays: 5 }),
    },
  });
  t.markReportFiled(ben, "2026-11-14");
  return { t, classId, anna, ben, h };
}

const CRLF = "\r\n";

describe("CSV", () => {
  it("overviewCsv: Semikolon, deutsche Spaltenköpfe, sortiert wie die Übersicht", () => {
    const { t, classId, h } = fixture();
    const csv = overviewCsv({ className: "5a", halfYear: t.data.halfYears[0]!, rows: t.overview(classId, { halfYearId: h }) });
    const lines = csv.replace(/^﻿/, "").split(CRLF);
    expect(csv.startsWith("﻿")).toBe(true); // BOM, damit Excel Umlaute richtig liest
    expect(lines[0]).toBe("Klasse 5a;1. Halbjahr 2026/27");
    expect(lines[2]).toBe("Vorname;Verspätungen;Fehlstunden aus Verspätungen;Fehlstunden gesamt;Fehltage gesamt;Status");
    expect(lines[3]).toBe("Ben;0;0;0;5;Erledigt (Anzeige gestellt am 2026-11-14)");
    expect(lines[4]).toBe("Anna;5;3;4;0;Grün");
  });

  it("neutralisiert Zellen, die Excel als Formel deuten würde, und maskiert Semikolons", () => {
    const { t, classId } = fixture("=SUMME(1;2)", 'sagt "hallo"; tschüss');
    const csv = overviewCsv({ className: "5a", halfYear: t.data.halfYears[0]!, rows: t.overview(classId) });
    expect(csv).toContain(`"'=SUMME(1;2)";`); // Apostroph davor, wegen des Semikolons zusätzlich in Anführungszeichen
    const d = detailCsv(t.detail(t.data.students[0]!.id));
    expect(d).toContain('"sagt ""hallo""; tschüss"');
  });

  it("detailCsv: Wochen, erklärte Verspätungen und Summen", () => {
    const { t, anna } = fixture();
    const lines = detailCsv(t.detail(anna)).replace(/^﻿/, "").split(CRLF);
    expect(lines).toContain("Woche (Montag);KW;Fehltage;Fehlstunden;Bemerkung");
    expect(lines).toContain("2026-11-09;46;0;1;Arzttermin");
    expect(lines).toContain("Datum;Stunde;Minuten;Wirkung");
    expect(lines).toContain("2026-11-09;1;5;1. kurze Verspätung: folgenlos");
    expect(lines).toContain("2026-11-11;2;30;lange Verspätung (ab 20 Min): 1 Fehlstunde");
    expect(lines).toContain("2026-11-12;1;10;3. kurze Verspätung: 1 Fehlstunde");
    expect(lines).toContain("Fehlstunden gesamt;4");
    expect(lines).toContain("Fehltage gesamt;0");
  });
});

describe("Druckansicht (HTML)", () => {
  it("detailHtml zeigt Kopf, Wochen und die nachvollziehbare Rechnung", () => {
    const { t, anna } = fixture();
    const html = detailHtml(t.detail(anna));
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>Fehlzeiten Anna (5a)</title>");
    expect(html).toContain("1. Halbjahr 2026/27");
    expect(html).toContain("Erfasste Fehlstunden: 1");
    expect(html).toContain("Fehlstunden aus langen Verspätungen: 1");
    expect(html).toContain("Fehlstunden aus häufigen Verspätungen: 2");
    expect(html).toContain("Fehlstunden gesamt: 4");
    expect(html).toContain("0 Fehltage aus Fehlstunden (4 ÷ 6, abgerundet, Rest 4)");
    expect(html).toContain("Fehltage gesamt: 0");
    expect(html).toContain("3. kurze Verspätung: 1 Fehlstunde");
  });

  it("maskiert HTML in Namen und Bemerkungen", () => {
    const { t, anna, classId } = fixture("<b>Anna</b>", "<script>alert(1)</script>");
    const html = detailHtml(t.detail(anna)) + overviewHtml({ className: "<i>5a</i>", halfYear: t.data.halfYears[0]!, rows: t.overview(classId) });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>Anna");
    expect(html).not.toContain("<i>5a");
    expect(html).toContain("&lt;b&gt;Anna&lt;/b&gt;");
  });

  it("overviewHtml enthält alle Schüler:innen und die Ampel als Text", () => {
    const { t, classId, h } = fixture();
    const html = overviewHtml({ className: "5a", halfYear: t.data.halfYears[0]!, rows: t.overview(classId, { halfYearId: h }) });
    expect(html).toContain("Klasse 5a");
    expect(html).toContain("Ben");
    expect(html).toContain("Erledigt");
    expect(html).toContain("Grün");
  });
});
