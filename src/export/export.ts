/** Ausgaben als Anlage zur Schulversäumnisanzeige: CSV (Excel, deutsch) und druckbares HTML (-> PDF). */
import { isoWeekNumber } from "../core/weeks";
import type { Status } from "../core/rules";
import type { Detail, HalfYear, LateExplanation, OverviewRow } from "../tracker/types";

const BOM = "﻿";
const CRLF = "\r\n";

function cell(v: string | number): string {
  if (typeof v === "number") return String(v);
  let s = v;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // Formel-Injection in Excel verhindern
  if (/[;"\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

const line = (...cells: (string | number)[]) => cells.map(cell).join(";");

export function statusLabel(status: Status, filedOn?: string): string {
  switch (status) {
    case "green": return "Grün";
    case "yellow": return "Gelb";
    case "red": return "Rot (Anzeige fällig)";
    case "done": return filedOn ? `Erledigt (Anzeige gestellt am ${filedOn})` : "Erledigt";
  }
}

export function describeLate(l: LateExplanation, longLateMinutes: number): string {
  if (l.effect === "long") return `lange Verspätung (ab ${longLateMinutes} Min): 1 Fehlstunde`;
  return `${l.ordinal}. kurze Verspätung: ${l.hours ? "1 Fehlstunde" : "folgenlos"}`;
}

interface OverviewInput { className: string; halfYear: HalfYear; rows: OverviewRow[] }

export function overviewCsv({ className, halfYear, rows }: OverviewInput): string {
  const out = [
    line(`Klasse ${className}`, halfYear.name),
    "",
    line("Vorname", "Verspätungen", "Fehlstunden aus Verspätungen", "Fehlstunden gesamt", "Fehltage gesamt", "Status"),
    ...rows.map((r) => line(r.name, r.lateCount, r.hoursFromLates, r.totalHours, r.totalDays, statusLabel(r.status, r.filedOn))),
  ];
  return BOM + out.join(CRLF) + CRLF;
}

export function detailCsv(d: Detail): string {
  const { result: r, settings: s } = d;
  const out = [
    line("Fehlzeiten", d.student.name, `Klasse ${d.className}`, d.halfYear.name),
    "",
    line("Woche (Montag)", "KW", "Fehltage", "Fehlstunden", "Bemerkung"),
    ...d.weeks.map((w) => line(w.week, isoWeekNumber(w.week), w.missedDays, w.missedHours, w.note)),
    "",
    line("Datum", "Stunde", "Minuten", "Wirkung"),
    ...d.lateExplanation.map((l) => line(l.date, l.hour, l.minutes, describeLate(l, s.longLateMinutes))),
    "",
    line("Erfasste Fehlstunden", d.recordedHours),
    line("Fehlstunden aus langen Verspätungen", r.hoursFromLongLates),
    line("Fehlstunden aus häufigen Verspätungen", r.hoursFromShortLates),
    line("Fehlstunden gesamt", r.totalHours),
    line("Erfasste Fehltage", d.recordedDays),
    line("Fehltage aus Fehlstunden", r.daysFromHours),
    line("Fehltage gesamt", r.totalDays),
    line("Status", statusLabel(d.status, d.filedOn)),
  ];
  return BOM + out.join(CRLF) + CRLF;
}

const esc = (s: string | number) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const STYLE = `
  body { font: 14px/1.4 system-ui, sans-serif; margin: 24px; color: #111; }
  h1 { font-size: 20px; margin: 0 0 4px; } h2 { font-size: 16px; margin: 24px 0 8px; }
  table { border-collapse: collapse; width: 100%; } th, td { border: 1px solid #999; padding: 4px 8px; text-align: left; }
  th { background: #eee; } .num { text-align: right; } .muted { color: #555; }
  ul.calc { list-style: none; padding: 0; } ul.calc li { padding: 2px 0; } ul.calc li.total { font-weight: 700; }
  @media print { body { margin: 0; } }`;

const page = (title: string, body: string) =>
  `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${STYLE}</style></head><body>${body}</body></html>`;

export function overviewHtml({ className, halfYear, rows }: OverviewInput): string {
  const tr = rows
    .map(
      (r) => `<tr><td>${esc(r.name)}</td><td class="num">${r.lateCount}</td><td class="num">${r.hoursFromLates}</td>` +
        `<td class="num">${r.totalHours}</td><td class="num">${r.totalDays}</td><td>${esc(statusLabel(r.status, r.filedOn))}</td></tr>`,
    )
    .join("");
  return page(
    `Fehlzeiten Klasse ${className}`,
    `<h1>Klasse ${esc(className)}</h1><p class="muted">${esc(halfYear.name)} (${esc(halfYear.start)} bis ${esc(halfYear.end)})</p>` +
      `<table><thead><tr><th>Vorname</th><th>Verspätungen</th><th>Fehlstunden aus Verspätungen</th><th>Fehlstunden gesamt</th><th>Fehltage gesamt</th><th>Status</th></tr></thead><tbody>${tr}</tbody></table>`,
  );
}

export function detailHtml(d: Detail): string {
  const { result: r, settings: s } = d;
  const weeks = d.weeks
    .map(
      (w) => `<tr><td>${esc(w.week)}</td><td class="num">${isoWeekNumber(w.week)}</td><td class="num">${w.missedDays}</td>` +
        `<td class="num">${w.missedHours}</td><td>${esc(w.note)}</td></tr>`,
    )
    .join("");
  const lates = d.lateExplanation
    .map((l) => `<tr><td>${esc(l.date)}</td><td class="num">${l.hour}</td><td class="num">${l.minutes}</td><td>${esc(describeLate(l, s.longLateMinutes))}</td></tr>`)
    .join("");

  const body =
    `<h1>${esc(d.student.name)} · Klasse ${esc(d.className)}</h1>` +
    `<p class="muted">${esc(d.halfYear.name)} (${esc(d.halfYear.start)} bis ${esc(d.halfYear.end)}) · Status: ${esc(statusLabel(d.status, d.filedOn))}</p>` +
    `<h2>Wocheneinträge</h2><table><thead><tr><th>Woche (Montag)</th><th>KW</th><th>Fehltage</th><th>Fehlstunden</th><th>Bemerkung</th></tr></thead><tbody>${weeks}</tbody></table>` +
    `<h2>Verspätungen</h2><table><thead><tr><th>Datum</th><th>Stunde</th><th>Minuten</th><th>Wirkung</th></tr></thead><tbody>${lates}</tbody></table>` +
    `<h2>Berechnung</h2><ul class="calc">` +
    `<li>Erfasste Fehlstunden: ${d.recordedHours}</li>` +
    `<li>Fehlstunden aus langen Verspätungen: ${r.hoursFromLongLates}</li>` +
    `<li>Fehlstunden aus häufigen Verspätungen: ${r.hoursFromShortLates}</li>` +
    `<li class="total">Fehlstunden gesamt: ${r.totalHours}</li>` +
    `<li>${r.daysFromHours} Fehltage aus Fehlstunden (${r.totalHours} ÷ ${s.hoursPerDay}, abgerundet, Rest ${r.remainderHours})</li>` +
    `<li>Erfasste Fehltage: ${d.recordedDays}</li>` +
    `<li class="total">Fehltage gesamt: ${r.totalDays}</li></ul>`;
  return page(`Fehlzeiten ${d.student.name} (${d.className})`, body);
}
