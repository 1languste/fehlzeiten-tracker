import { describe, expect, it } from "vitest";
import { formatDate, parseCount, suggestHalfYear, weekLabel } from "./format";

describe("format", () => {
  it("formatDate: deutsches Datum", () => {
    expect(formatDate("2026-11-09")).toBe("09.11.2026");
  });

  it("weekLabel: KW mit Montag bis Freitag", () => {
    expect(weekLabel("2026-11-09")).toBe("KW 46 · 09.11.–13.11.2026");
    expect(weekLabel("2026-12-28")).toBe("KW 53 · 28.12.2026–01.01.2027");
  });

  it("parseCount: leere Eingabe zählt als 0, sonst ganze Zahl, sonst Fehler", () => {
    expect(parseCount("")).toBe(0);
    expect(parseCount("  ")).toBe(0);
    expect(parseCount("3")).toBe(3);
    expect(parseCount(" 12 ")).toBe(12);
    expect(parseCount("1,5")).toBeNaN();
    expect(parseCount("abc")).toBeNaN();
    expect(parseCount("-1")).toBeNaN();
  });

  it("suggestHalfYear: Vorschlag je nach Datum (Aug–Jan bzw. Feb–Jul)", () => {
    expect(suggestHalfYear("2026-11-15")).toEqual({ name: "1. Halbjahr 2026/27", start: "2026-08-01", end: "2027-01-31" });
    expect(suggestHalfYear("2027-01-10")).toEqual({ name: "1. Halbjahr 2026/27", start: "2026-08-01", end: "2027-01-31" });
    expect(suggestHalfYear("2027-03-01")).toEqual({ name: "2. Halbjahr 2026/27", start: "2027-02-01", end: "2027-07-31" });
  });
});
