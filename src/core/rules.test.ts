import { describe, expect, it } from "vitest";
import { calculate, status, type Absences } from "./rules";

const abs = (p: Partial<Absences>): Absences => ({ lateMinutes: [], missedHours: 0, missedDays: 0, ...p });

/** Testfälle 1-7 aus docs/anforderung.md. */
describe("Rechenbeispiele aus der Anforderung", () => {
  it("1: 2 Verspätungen à 5 min -> 0 Std, 0 Tage, grün", () => {
    const r = calculate(abs({ lateMinutes: [5, 5] }));
    expect([r.totalHours, r.totalDays]).toEqual([0, 0]);
    expect(status(r.totalDays, false)).toBe("green");
  });

  it("2: 4 Verspätungen à 10 min -> 2 Std (3. und 4.), 0 Tage, grün", () => {
    const r = calculate(abs({ lateMinutes: [10, 10, 10, 10] }));
    expect([r.totalHours, r.totalDays]).toEqual([2, 0]);
    expect(status(r.totalDays, false)).toBe("green");
  });

  it("3: 1 Verspätung à 25 min -> 1 Std, 0 Tage, grün", () => {
    const r = calculate(abs({ lateMinutes: [25] }));
    expect([r.totalHours, r.totalDays]).toEqual([1, 0]);
    expect(status(r.totalDays, false)).toBe("green");
  });

  it("4: 4 Fehlstunden + 3 Verspätungen à 10 min -> 5 Std, 0 Tage (Rest 5), grün", () => {
    const r = calculate(abs({ missedHours: 4, lateMinutes: [10, 10, 10] }));
    expect([r.totalHours, r.totalDays, r.remainderHours]).toEqual([5, 0, 5]);
    expect(status(r.totalDays, false)).toBe("green");
  });

  it("5: wie 4, Folgewoche + 1 Fehlstunde -> 6 Std, 1 Tag, grün", () => {
    const r = calculate(abs({ missedHours: 5, lateMinutes: [10, 10, 10] }));
    expect([r.totalHours, r.totalDays]).toEqual([6, 1]);
    expect(status(r.totalDays, false)).toBe("green");
  });

  it("6: 3 Fehltage + 11 Fehlstunden -> 11 Std, 4 Tage (Rest 5), gelb", () => {
    const r = calculate(abs({ missedDays: 3, missedHours: 11 }));
    expect([r.totalHours, r.totalDays, r.remainderHours]).toEqual([11, 4, 5]);
    expect(status(r.totalDays, false)).toBe("yellow");
  });

  it("7: 4 Fehltage + 6 Fehlstunden -> 6 Std, 5 Tage, rot", () => {
    const r = calculate(abs({ missedDays: 4, missedHours: 6 }));
    expect([r.totalHours, r.totalDays]).toEqual([6, 5]);
    expect(status(r.totalDays, false)).toBe("red");
  });
});

describe("Weitere Regeln", () => {
  it("lange Verspätungen zählen nicht zusätzlich bei den kurzen mit", () => {
    // 2 kurze bleiben folgenlos, die lange zählt genau 1
    const r = calculate(abs({ lateMinutes: [5, 5, 30] }));
    expect([r.longLates, r.shortLates, r.totalHours]).toEqual([1, 2, 1]);
  });

  it("20 Minuten zählt bereits als lange Verspätung (Grenze)", () => {
    expect(calculate(abs({ lateMinutes: [19] })).longLates).toBe(0);
    expect(calculate(abs({ lateMinutes: [20] })).longLates).toBe(1);
  });

  it("nach gestellter Anzeige bleibt der Status 'erledigt', die Zählung läuft weiter", () => {
    const r = calculate(abs({ missedDays: 7 }));
    expect(r.totalDays).toBe(7);
    expect(status(r.totalDays, true)).toBe("done");
  });

  it("Schwellenwerte sind einstellbar", () => {
    const r = calculate(abs({ missedHours: 4 }), {
      longLateMinutes: 20, freeShortLates: 2, hoursPerDay: 4, warnDays: 1, dueDays: 2,
    });
    expect(r.totalDays).toBe(1);
    expect(status(r.totalDays, false, { longLateMinutes: 20, freeShortLates: 2, hoursPerDay: 4, warnDays: 1, dueDays: 2 })).toBe("yellow");
  });
});
