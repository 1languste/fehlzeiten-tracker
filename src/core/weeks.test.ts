import { describe, expect, it } from "vitest";
import { defaultEntryWeek, isoWeekNumber, schoolDays, weekStart } from "./weeks";

// 2026-11-09 ist ein Montag (Kalenderwoche 46).
describe("weeks", () => {
  it("weekStart liefert den Montag der Woche, auch für Freitag und Sonntag", () => {
    expect(weekStart("2026-11-09")).toBe("2026-11-09");
    expect(weekStart("2026-11-13")).toBe("2026-11-09");
    expect(weekStart("2026-11-15")).toBe("2026-11-09");
  });

  it("schoolDays liefert Montag bis Freitag", () => {
    expect(schoolDays("2026-11-09")).toEqual([
      "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13",
    ]);
  });

  it("isoWeekNumber nutzt die ISO-Zählung (Jahreswechsel eingeschlossen)", () => {
    expect(isoWeekNumber("2026-11-09")).toBe(46);
    expect(isoWeekNumber("2026-01-01")).toBe(1); // Donnerstag -> KW 1
    expect(isoWeekNumber("2025-12-29")).toBe(1); // gehört schon zu KW 1/2026
    expect(isoWeekNumber("2027-01-01")).toBe(53); // Freitag -> KW 53/2026
  });

  it("defaultEntryWeek: am Wochenende die gerade beendete Woche, unter der Woche die vorige", () => {
    expect(defaultEntryWeek("2026-11-15")).toBe("2026-11-09"); // Sonntag
    expect(defaultEntryWeek("2026-11-14")).toBe("2026-11-09"); // Samstag
    expect(defaultEntryWeek("2026-11-16")).toBe("2026-11-09"); // Montag danach -> noch die Vorwoche
    expect(defaultEntryWeek("2026-11-18")).toBe("2026-11-09"); // Mittwoch -> Vorwoche
  });
});
