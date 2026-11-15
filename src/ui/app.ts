/**
 * Dünne Oberfläche: hält nur Anzeigezustand. Alle Fachregeln liegen im Tracker,
 * alle Dateioperationen in Session/FileStore. Im Browser geprüft, nicht per Unit-Test.
 */
import { addDays, defaultEntryWeek, schoolDays, type IsoDate } from "../core/weeks";
import { absenceAmount, detailCsv, detailHtml, describeLate, overviewCsv, overviewHtml, statusLabel } from "../export/export";
import { createBrowserStore } from "../storage/browserFileStore";
import { createSession, openSession, type Session } from "../storage/session";
import type { Absence, AppSettings, Late, OverviewRow, Warning, WeekEntry } from "../tracker/types";
import { formatDate, parseCount, suggestHalfYear, weekLabel } from "./format";
import { html, raw, type Html } from "./html";

type Screen = "week" | "overview" | "students" | "settings" | "detail";
/**
 * Bearbeitungsstand einer Person in der gewählten Woche. Jede Änderung wird sofort gespeichert.
 * extraDays/extraHours: ältere Wochensummen ohne Tag (bleiben erhalten, bis sie bewusst entfernt werden).
 * base: zuletzt gespeicherter Eintrag, damit unbekannte Felder beim Speichern erhalten bleiben.
 */
interface Draft { note: string; lates: Late[]; absences: Absence[]; extraDays: number; extraHours: number; base: WeekEntry }
interface Notice { kind: "info" | "warn" | "due" | "error"; text: string; studentId?: string }

const store = createBrowserStore();
const root = document.getElementById("app")!;

const S = {
  session: null as Session | null,
  screen: "week" as Screen,
  classId: "",
  week: "" as IsoDate,
  halfYearId: "",
  detailId: "",
  draft: {} as Record<string, Draft>,
  draftKey: "",
  notices: [] as Notice[],
  dirty: false,
  generation: 0,
  locked: false,
  lastActivity: Date.now(),
  showArchived: false,
  startError: "",
  startMode: "open" as "open" | "create",
  lastReminderDay: "",
  sort: "days" as "days" | "name",
  toast: "",
};

// ---------- Hilfen ----------

/** Lokales Datum/Zeit als ISO-String (nicht UTC, sonst stimmt "heute" am späten Abend nicht). */
const localNow = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
const today = () => localNow().slice(0, 10);

const REV_KEY = "fzt.lastRevision";
function lastSeenRevision(): number | undefined {
  try { const v = localStorage.getItem(REV_KEY); return v ? Number(v) : undefined; } catch { return undefined; }
}
function rememberRevision(r: number) {
  try { localStorage.setItem(REV_KEY, String(r)); } catch { /* ohne Speicher weiter */ }
}

const tracker = () => S.session!.tracker;

const ICONS: Record<string, string> = {
  prev: '<path d="M15 6l-6 6 6 6"/>', next: '<path d="M9 6l6 6-6 6"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>', plus: '<path d="M12 5v14M5 12h14"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
  check: '<path d="M5 12l5 5L20 7"/>',
};
const icon = (name: keyof typeof ICONS): Html =>
  raw(`<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`);

let toastTimer: ReturnType<typeof setTimeout> | undefined;
/** Kurze Bestätigung, die von selbst verschwindet (bleibt sichtbar, auch wenn man unten in der Liste ist). */
function toast(text: string) {
  S.toast = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { S.toast = ""; render(); }, 3500);
}
const notice = (kind: Notice["kind"], text: string, studentId?: string) => S.notices.push({ kind, text, studentId });
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function download(name: string, content: string | Uint8Array, mime: string) {
  const url = URL.createObjectURL(new Blob([content as BlobPart], { type: mime }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function openPrintable(content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/html" }));
  const win = window.open(url, "_blank");
  if (!win) { notice("warn", "Das Pop-up wurde blockiert. Bitte Pop-ups erlauben und erneut versuchen."); return; }
  win.addEventListener("load", () => win.print());
}

function systemNotify(title: string, body: string) {
  try {
    if ("Notification" in window && Notification.permission === "granted") new Notification(title, { body });
  } catch { /* nicht überall verfügbar */ }
}

function ensureSelection() {
  const t = tracker();
  if (!t.data.classes.some((c) => c.id === S.classId)) S.classId = t.data.classes[0]?.id ?? "";
  if (!S.week) S.week = defaultEntryWeek(today());
}

function loadDraft() {
  const key = `${S.classId}|${S.week}`;
  if (key === S.draftKey) return;
  S.draftKey = key;
  S.draft = {};
  if (!S.classId) return;
  for (const row of tracker().getWeek(S.classId, S.week)) S.draft[row.studentId] = draftOf(row.entry);
}

const sumDays = (a: Absence[]) => a.filter((x) => x.fullDay).length;
const sumHours = (a: Absence[]) => a.reduce((n, x) => n + (x.fullDay ? 0 : x.hours), 0);

function draftOf(e: WeekEntry): Draft {
  const absences = e.absences ?? [];
  return {
    note: e.note, lates: e.lates, absences, base: e,
    extraDays: e.missedDays - sumDays(absences), extraHours: e.missedHours - sumHours(absences),
  };
}

/** Wocheneintrag aus dem Bearbeitungsstand: Summen = Tageseinträge + ältere Angaben ohne Tag. */
const entryOf = (d: Draft): WeekEntry => ({
  ...d.base, note: d.note, lates: d.lates, absences: d.absences,
  missedDays: d.extraDays + sumDays(d.absences), missedHours: d.extraHours + sumHours(d.absences),
});

/** Speichert den Eintrag einer Person sofort. Bei Fehlern bleibt alles beim Alten. */
function commit(sid: string, next: Draft) {
  const entry = entryOf(next);
  const warnings = tracker().saveEntry({ classId: S.classId, week: S.week, studentId: sid, entry });
  S.draft[sid] = { ...next, base: entry };
  touched();
  announce(warnings);
}

function announce(warnings: Warning[]) {
  for (const w of warnings) {
    // „fällig“ steht dauerhaft im roten Banner (bis die Anzeige als gestellt markiert ist), hier nur die Vorwarnung
    if (w.kind === "warn") notice("warn", `Vorwarnung: ${w.name} (${w.className}) – ${w.totalDays} Fehltage`, w.studentId);
  }
  // Systembenachrichtigungen bleiben im Benachrichtigungscenter/Sperrbildschirm sichtbar: nur Anzahl, keine Namen.
  const due = warnings.filter((w) => w.kind === "due").length;
  const warn = warnings.length - due;
  if (due) systemNotify("Schulversäumnisanzeige fällig", `${due === 1 ? "1 Anzeige ist" : `${due} Anzeigen sind`} fällig. Details in der App.`);
  if (warn) systemNotify("Vorwarnung Fehlzeiten", `${warn === 1 ? "1 Vorwarnung" : `${warn} Vorwarnungen`}. Details in der App.`);
}

async function persist(): Promise<boolean> {
  const generation = S.generation;
  try {
    rememberRevision(await S.session!.save());
    // Wurde während des Speicherns weiter geändert, bleibt die Datei „ungesichert“.
    if (S.generation === generation) S.dirty = false;
    return true;
  } catch (e) {
    notice("error", `Speichern nicht gelungen: ${errText(e)}`);
    return false;
  }
}

/** Nach einer Änderung: still speichern, wenn der Browser das erlaubt, sonst als „ungesichert“ markieren. */
function touched() {
  S.dirty = true;
  S.generation++;
  if (store.silent) void persist().then(render);
}

// ---------- Ansichten ----------

const nav: [Screen, string][] = [["week", "Erfassen"], ["overview", "Übersicht"], ["students", "Schüler:innen"], ["settings", "Einstellungen"]];

function statusChip(r: { status: OverviewRow["status"]; filedOn?: string }): Html {
  return html`<span class="chip ${r.status}">${statusLabel(r.status, r.filedOn ? formatDate(r.filedOn) : undefined)}</span>`;
}

function viewStart(): Html {
  const known = store.fileName;
  return html`
    <main class="start">
      <h1>Fehlzeiten-Tracker</h1>
      <p class="muted lead">Alle Daten liegen verschlüsselt in einer Datei (z. B. in iCloud Drive). Nichts wird an einen Server gesendet.</p>
      ${S.startError ? html`<p class="notice error" role="alert">${S.startError}</p>` : ""}
      <div class="tabs small">
        <button data-action="startMode" data-mode="open" class="${S.startMode === "open" ? "on" : ""}">Datei öffnen</button>
        <button data-action="startMode" data-mode="create" class="${S.startMode === "create" ? "on" : ""}">Neue Datei</button>
      </div>
      ${S.startMode === "open" ? html`
        <form data-form="open" class="card">
          ${known
            ? html`<p>Datei: <strong>${known}</strong></p>`
            : html`<p class="muted">Noch keine Datei gewählt.</p>`}
          <button type="button" data-action="pick" class="${known ? "ghost" : ""}">${known ? "Andere Datei wählen" : "Datei wählen …"}</button>
          ${known ? html`
            <label>Passwort <input type="password" name="pw" autocomplete="current-password" required autofocus></label>
            <button type="submit">Öffnen</button>` : ""}
        </form>`
        : html`
        <form data-form="create" class="card">
          <label>Neues Passwort (mind. 8 Zeichen) <input type="password" name="pw" autocomplete="new-password" required minlength="8"></label>
          <label>Passwort wiederholen <input type="password" name="pw2" autocomplete="new-password" required minlength="8"></label>
          <p class="muted">Das Passwort lässt sich nicht zurücksetzen. Ohne Passwort sind die Daten unwiederbringlich verloren.</p>
          <button type="submit">Neue Datei anlegen</button>
        </form>`}
    </main>`;
}

function viewLock(): Html {
  return html`
    <main class="start">
      <h1>Gesperrt</h1>
      <p class="muted lead">Nach Inaktivität gesperrt. Mit dem Passwort geht es genau da weiter, wo du warst.</p>
      <form data-form="unlock" class="card">
        <label>Passwort <input type="password" name="pw" autocomplete="current-password" required autofocus></label>
        <button type="submit">Entsperren</button>
        ${S.startError ? html`<p class="notice error" role="alert">${S.startError}</p>` : ""}
      </form>
    </main>`;
}

function banners(): Html {
  const t = tracker();
  const out: Html[] = [];

  for (const c of t.data.classes) {
    for (const r of t.overview(c.id)) {
      if (r.status === "red") {
        out.push(html`<div class="notice due" role="alert"><span><strong>Schulversäumnisanzeige fällig:</strong> ${r.name} (${c.name}) – ${r.totalDays} Fehltage</span>
          <button data-action="detail" data-sid="${r.studentId}" data-cid="${c.id}">Details</button></div>`);
      }
    }
  }
  for (const r of t.reminders()) {
    out.push(html`<div class="notice warn"><span>${r.className}: ${weekLabel(r.week)} ist noch nicht erfasst.</span>
      <button data-action="gotoWeek" data-cid="${r.classId}" data-week="${r.week}">Jetzt erfassen</button></div>`);
  }
  if (!t.data.halfYears.some((h) => h.start <= today() && today() <= h.end)) {
    out.push(html`<div class="notice warn"><span>Für heute ist kein Halbjahr angelegt.</span><button data-action="tab" data-screen="settings">Halbjahr anlegen</button></div>`);
  }
  if (t.expiredHalfYears().length) {
    out.push(html`<div class="notice info"><span>Ein Halbjahr liegt länger als ${t.data.settings.retentionMonths} Monate zurück. Die Daten können gelöscht werden.</span><button data-action="tab" data-screen="settings">Ansehen</button></div>`);
  }
  if (S.dirty && !store.silent) {
    out.push(html`<div class="notice warn"><span>Änderungen sind noch nicht in der Datei gesichert.</span><button data-action="save">Jetzt sichern</button></div>`);
  }
  S.notices.forEach((n, i) => {
    out.push(html`<div class="notice ${n.kind}" role="${n.kind === "error" ? "alert" : "status"}"><span>${n.text}</span>
      <span>${n.studentId ? html`<button data-action="detail" data-sid="${n.studentId}">Details</button>` : ""}
      <button class="ghost" data-action="dismiss" data-i="${i}" aria-label="Schließen">${icon("x")}</button></span></div>`);
  });
  return html`<div class="banners">${out}</div>`;
}

function classSelect(): Html {
  const cs = tracker().data.classes;
  if (!cs.length) return html``;
  return html`<label class="inline">Klasse
    <select data-field="class">${cs.map((c) => html`<option value="${c.id}" ${c.id === S.classId ? raw("selected") : ""}>${c.name}</option>`)}</select></label>`;
}

function viewWeek(): Html {
  const t = tracker();
  if (!S.classId) return html`<p class="card">Lege zuerst unter „Schüler:innen“ eine Klasse an.</p>`;
  loadDraft();
  const rows = new Map(t.overview(S.classId).map((r) => [r.studentId, r]));
  const days = schoolDays(S.week);
  const students = t.getWeek(S.classId, S.week);
  const isThisDefault = S.week === defaultEntryWeek(today());

  return html`
    <div class="weeknav">
      <button class="ghost" data-action="weekShift" data-d="-7" aria-label="Vorwoche">${icon("prev")}</button>
      <div><strong>${weekLabel(S.week)}</strong>${isThisDefault ? "" : html` <button class="link" data-action="weekDefault">zur aktuellen Woche</button>`}</div>
      <button class="ghost" data-action="weekShift" data-d="7" aria-label="Folgewoche">${icon("next")}</button>
    </div>
    ${students.length === 0 ? html`<p class="card">In dieser Klasse gibt es keine aktiven Schüler:innen.</p>` : ""}
    ${students.map(({ studentId: id, name }) => {
      const d = S.draft[id] ?? draftOf(emptyWeekEntry);
      const r = rows.get(id);
      const dayLabel = (iso: IsoDate) => `${DAY_NAMES[days.indexOf(iso)] ?? ""} ${formatDate(iso).slice(0, 6)}`;
      const daySelect = (attr: string) =>
        html`<select ${raw(`data-${attr}-day`)}="${id}" aria-label="Tag">${days.map((dd, i) => html`<option value="${i}">${dayLabel(dd)}</option>`)}</select>`;
      return html`
        <section class="student card">
          <header><strong class="name">${name}</strong><span class="stand" data-stand="${id}">${standHtml(r)}</span></header>
          <div class="entries">
            <div class="label">Fehlzeiten<small class="num-t" data-sum="${id}">${weekSum(d)}</small></div>
            <div class="entry-body">
              ${d.extraDays ? html`<span class="chip entry legacy" title="Ältere Angabe ohne Tag">ohne Tag · <strong>${plural(d.extraDays, "Tag", "Tage")}</strong>
                <button class="x" data-action="delExtra" data-kind="days" data-sid="${id}" aria-label="Fehltage ohne Tag entfernen">${icon("x")}</button></span>` : ""}
              ${d.extraHours ? html`<span class="chip entry legacy" title="Ältere Angabe ohne Tag">ohne Tag · <strong>${d.extraHours} Std</strong>
                <button class="x" data-action="delExtra" data-kind="hours" data-sid="${id}" aria-label="Fehlstunden ohne Tag entfernen">${icon("x")}</button></span>` : ""}
              ${d.absences.map((a, i) => html`<span class="chip entry ${a.fullDay ? "fullday" : ""}">${dayLabel(a.date)} · <strong>${absenceAmount(a)}</strong>${a.note ? html`<span class="chip-note">· ${a.note}</span>` : ""}
                <button class="x" data-action="delAbsence" data-sid="${id}" data-i="${i}" aria-label="Fehlzeit entfernen">${icon("x")}</button></span>`)}
              <span class="entry-add">
                ${daySelect("abs")}
                <select data-abs-amount="${id}" aria-label="Umfang"><option value="day">ganzer Tag</option>${Array.from({ length: 10 }, (_, i) => html`<option value="${i + 1}">${i + 1} Std</option>`)}</select>
                <input class="entry-note" data-abs-note="${id}" placeholder="Bemerkung, z. B. 3.–4. Std" maxlength="200" aria-label="Bemerkung zur Fehlzeit">
                <button class="ghost" data-action="addAbsence" data-sid="${id}" aria-label="Fehlzeit hinzufügen">${icon("plus")}<span class="btn-text">Hinzufügen</span></button>
              </span>
            </div>
          </div>
          <div class="entries">
            <div class="label">Verspätungen</div>
            <div class="entry-body">
              ${d.lates.map((l, i) => html`<span class="chip entry">${dayLabel(l.date)} · <strong>${l.minutes} Min</strong>
                <button class="x" data-action="delLate" data-sid="${id}" data-i="${i}" aria-label="Verspätung entfernen">${icon("x")}</button></span>`)}
              <span class="entry-add">
                ${daySelect("late")}
                <input data-late-min="${id}" inputmode="numeric" pattern="[0-9]*" placeholder="Min" aria-label="Minuten zu spät">
                <button class="ghost" data-action="addLate" data-sid="${id}" aria-label="Verspätung hinzufügen">${icon("plus")}<span class="btn-text">Hinzufügen</span></button>
              </span>
            </div>
          </div>
          <div class="entries">
            <label class="label" for="note-${id}">Bemerkung</label>
            <div class="entry-body"><input id="note-${id}" class="note" data-draft="note" data-sid="${id}" placeholder="optional, zur ganzen Woche" value="${d.note}" maxlength="200"></div>
          </div>
        </section>`;
    })}
    ${students.length ? html`<div class="actions savebar">
      <span class="muted savebar-hint">Änderungen werden sofort übernommen.</span>
      ${t.isWeekConfirmed(S.classId, S.week)
        ? html`<span class="confirmed">${icon("check")}Woche ist als erfasst bestätigt</span>`
        : html`<button data-action="confirmWeek">${icon("check")}Woche als erfasst bestätigen</button>`}
    </div>` : ""}`;
}

const DAY_NAMES = ["Mo", "Di", "Mi", "Do", "Fr"];
const emptyWeekEntry: WeekEntry = { lates: [], absences: [], missedHours: 0, missedDays: 0, note: "" };
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function standHtml(r: OverviewRow | undefined): Html {
  return r ? html`${statusChip(r)}<span class="muted num-t">Halbjahr: ${plural(r.totalDays, "Fehltag", "Fehltage")} · Rest ${r.remainderHours} Std</span>` : html``;
}

/** Wochensumme der Fehlzeiten, z. B. „1 Tag · 3 Std“ (leer, wenn nichts eingetragen ist). */
function weekSum(d: Draft): string {
  const e = entryOf(d);
  const parts = [e.missedDays ? plural(e.missedDays, "Tag", "Tage") : "", e.missedHours ? `${e.missedHours} Std` : ""].filter(Boolean);
  return parts.length ? `Woche: ${parts.join(" · ")}` : "";
}

/** Aktualisiert Stand und Wochensumme einer Karte, ohne die Seite neu aufzubauen (Fokus und Klicks bleiben erhalten). */
function refreshCard(sid: string) {
  const r = tracker().overview(S.classId).find((x) => x.studentId === sid);
  const stand = root.querySelector(`[data-stand="${sid}"]`);
  if (stand) stand.innerHTML = String(standHtml(r));
  const sum = root.querySelector(`[data-sum="${sid}"]`);
  if (sum && S.draft[sid]) sum.textContent = weekSum(S.draft[sid]!);
}

function currentHalfYearId(): string {
  const t = tracker();
  return S.halfYearId || t.data.halfYears.find((h) => h.start <= today() && today() <= h.end)?.id || t.data.halfYears.at(-1)?.id || "";
}

function viewOverview(): Html {
  const t = tracker();
  if (!S.classId) return html`<p class="card">Lege zuerst unter „Schüler:innen“ eine Klasse an.</p>`;
  const hid = currentHalfYearId();
  const hy = t.data.halfYears.find((h) => h.id === hid);
  if (!hy) return html`<p class="card">Lege zuerst unter „Einstellungen“ ein Halbjahr an.</p>`;
  const rows = [...t.overview(S.classId, { halfYearId: hid })];
  if (S.sort === "days") rows.sort((a, b) => b.totalDays - a.totalDays || b.totalHours - a.totalHours);
  return html`
    <div class="toolbar">
      <label class="inline">Halbjahr
        <select data-field="halfYear">${t.data.halfYears.map((h) => html`<option value="${h.id}" ${h.id === hid ? raw("selected") : ""}>${h.name}</option>`)}</select></label>
      <label class="inline">Sortierung
        <select data-field="sort"><option value="days" ${S.sort === "days" ? raw("selected") : ""}>Fehltage (kritisch zuerst)</option><option value="name" ${S.sort === "name" ? raw("selected") : ""}>Vorname</option></select></label>
      <span class="spacer"></span>
      <button class="ghost" data-action="overviewCsv">CSV</button>
      <button class="ghost" data-action="overviewPrint">Drucken / PDF</button>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Vorname</th><th class="num" title="Erfasste Fehltage">Fehltage erf.</th><th class="num" title="Erfasste Fehlstunden (ohne Verspätungen)">Fehlstd. erf.</th><th class="num">Verspät.</th><th class="num">Std aus Versp.</th><th class="num">Fehlstd. gesamt</th><th class="num">Fehltage gesamt</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows.map((r) => html`<tr class="${r.status}">
        <td>${r.name}</td><td class="num">${r.recordedDays}</td><td class="num">${r.recordedHours}</td><td class="num">${r.lateCount}</td><td class="num">${r.hoursFromLates}</td><td class="num">${r.totalHours}</td>
        <td class="num"><strong>${r.totalDays}</strong></td><td>${statusChip(r)}</td>
        <td><button class="ghost" data-action="detail" data-sid="${r.studentId}">Details</button></td></tr>`)}</tbody>
    </table></div>
    ${rows.length === 0 ? html`<p class="muted">Keine Schüler:innen.</p>` : ""}`;
}

function viewDetail(): Html {
  const t = tracker();
  const hid = currentHalfYearId();
  const d = t.detail(S.detailId, hid || undefined);
  const r = d.result;
  return html`
    <div class="toolbar">
      <button class="ghost" data-action="tab" data-screen="overview">${icon("prev")}Übersicht</button>
      <button class="ghost" data-action="detailCsv">CSV</button>
      <button class="ghost" data-action="detailPrint">Drucken / PDF</button>
    </div>
    <h2>${d.student.name} · Klasse ${d.className} ${statusChip({ status: d.status, filedOn: d.filedOn })}</h2>
    <p class="muted">${d.halfYear.name}</p>
    <section class="card">
      <h3>Berechnung</h3>
      <ul class="calc">
        <li>Erfasste Fehlstunden: ${d.recordedHours}</li>
        <li>Fehlstunden aus langen Verspätungen: ${r.hoursFromLongLates}</li>
        <li>Fehlstunden aus häufigen Verspätungen: ${r.hoursFromShortLates}</li>
        <li class="total">Fehlstunden gesamt: ${r.totalHours}</li>
        <li>${r.daysFromHours} Fehltage aus Fehlstunden (${r.totalHours} ÷ ${d.settings.hoursPerDay}, abgerundet, Rest ${r.remainderHours})</li>
        <li>Erfasste Fehltage: ${d.recordedDays}</li>
        <li class="total">Fehltage gesamt: ${r.totalDays}</li>
      </ul>
    </section>
    <section class="card">
      <h3>Anzeige</h3>
      ${d.filedOn
        ? html`<p>Gestellt am <strong>${formatDate(d.filedOn)}</strong>. Die Zählung läuft weiter.</p>
               <button class="ghost" data-action="unmarkFiled">Markierung entfernen</button>`
        : html`<form data-form="filed" class="row"><label>Gestellt am <input type="date" name="date" value="${today()}" required></label>
               <button type="submit">Als gestellt markieren</button></form>`}
    </section>
    <section class="card"><h3>Wocheneinträge</h3>
      ${d.weeks.length ? html`<div class="table-wrap"><table><thead><tr><th>Woche</th><th class="num">Fehltage</th><th class="num">Fehlstd.</th><th>Bemerkung</th></tr></thead>
        <tbody>${d.weeks.map((w) => html`<tr><td>${weekLabel(w.week)}</td><td class="num">${w.missedDays}</td><td class="num">${w.missedHours}</td><td>${w.note}</td></tr>`)}</tbody></table></div>`
        : html`<p class="muted">Keine Einträge.</p>`}
    </section>
    <section class="card"><h3>Fehlzeiten nach Tagen</h3>
      ${d.absences.length ? html`<div class="table-wrap"><table><thead><tr><th>Datum</th><th>Umfang</th><th>Bemerkung</th></tr></thead>
        <tbody>${d.absences.map((a) => html`<tr><td>${formatDate(a.date)}</td><td>${absenceAmount(a)}</td><td>${a.note}</td></tr>`)}</tbody></table></div>`
        : html`<p class="muted">Keine tageweise erfassten Fehlzeiten.</p>`}
    </section>
    <section class="card"><h3>Verspätungen</h3>
      ${d.lateExplanation.length ? html`<div class="table-wrap"><table><thead><tr><th>Datum</th><th class="num">Min</th><th>Wirkung</th></tr></thead>
        <tbody>${d.lateExplanation.map((l) => html`<tr class="${l.hours ? "counts" : ""}"><td>${formatDate(l.date)}</td><td class="num">${l.minutes}</td><td>${describeLate(l, d.settings.longLateMinutes)}</td></tr>`)}</tbody></table></div>`
        : html`<p class="muted">Keine Verspätungen.</p>`}
    </section>`;
}

function viewStudents(): Html {
  const t = tracker();
  const students = t.data.students.filter((s) => s.classId === S.classId && (S.showArchived || !s.archived));
  return html`
    <section class="card"><h3>Klassen</h3>
      <form data-form="addClass" class="row"><label class="grow">Neue Klasse / Lerngruppe <input name="name" required maxlength="40" placeholder="z. B. 5a"></label><button type="submit">Anlegen</button></form>
    </section>
    ${S.classId ? html`
    <section class="card"><h3>Schüler:innen in ${t.data.classes.find((c) => c.id === S.classId)?.name}</h3>
      <form data-form="addStudent" class="row"><label class="grow">Vorname (bei Doppelungen mit Zusatz, z. B. „Anna K.“) <input name="name" required maxlength="40"></label><button type="submit">Hinzufügen</button></form>
      <ul class="list">${students.map((s) => html`<li class="${s.archived ? "archived" : ""}">
        <form data-form="rename" data-sid="${s.id}" class="row grow"><input name="name" value="${s.name}" required maxlength="40" aria-label="Vorname"><button class="ghost" type="submit">Umbenennen</button></form>
        ${s.archived ? html`<button class="ghost" data-action="restore" data-sid="${s.id}">Wiederherstellen</button>`
          : html`<button class="ghost" data-action="archive" data-sid="${s.id}">Archivieren</button>`}</li>`)}</ul>
      <label class="check"><input type="checkbox" data-field="showArchived" ${S.showArchived ? raw("checked") : ""}> Archivierte anzeigen</label>
    </section>` : ""}`;
}

function viewSettings(): Html {
  const t = tracker();
  const s = t.data.settings;
  const sug = suggestHalfYear(today());
  const num = (name: keyof AppSettings, label: string, hint = "") =>
    html`<label>${label}<input type="number" min="0" name="${name}" value="${s[name] as number}" required>${hint ? html`<small class="muted">${hint}</small>` : ""}</label>`;
  return html`
    <form data-form="settings" class="card"><h3>Regeln und Schwellen</h3>
      <div class="grid top-aligned">
        ${num("longLateMinutes", "Lange Verspätung ab (Min)", "zählt sofort als 1 Fehlstunde")}
        ${num("freeShortLates", "Folgenlose kurze Verspätungen", "danach zählt jede weitere als Fehlstunde")}
        ${num("hoursPerDay", "Fehlstunden je Fehltag")}
        ${num("warnDays", "Vorwarnung ab Fehltagen")}
        ${num("dueDays", "Anzeige fällig ab Fehltagen")}
        ${num("reminderHour", "Erinnerung sonntags um (Uhr)")}
        ${num("lockMinutes", "Sperre nach Inaktivität (Min)")}
        ${num("retentionMonths", "Löschvorschlag nach (Monaten)", "nach Ende eines Halbjahres")}
      </div>
      <label class="check"><input type="checkbox" name="preWarning" ${s.preWarning ? raw("checked") : ""}> Vorwarnung anzeigen</label>
      <button type="submit">Einstellungen speichern</button>
    </form>

    <section class="card"><h3>Halbjahre</h3>
      <ul class="list">${t.data.halfYears.map((h) => html`<li><span>${h.name} <span class="muted">(${formatDate(h.start)} – ${formatDate(h.end)})</span></span>
        ${t.expiredHalfYears().some((x) => x.id === h.id) ? html`<button class="danger" data-action="deleteHalfYear" data-hid="${h.id}">Daten löschen</button>` : ""}</li>`)}</ul>
      <form data-form="addHalfYear" class="grid">
        <label>Name <input name="name" value="${sug.name}" required></label>
        <label>Beginn <input type="date" name="start" value="${sug.start}" required></label>
        <label>Ende <input type="date" name="end" value="${sug.end}" required></label>
        <button type="submit">Halbjahr anlegen</button>
      </form>
    </section>

    <section class="card"><h3>Datei und Sicherheit</h3>
      <p class="muted">Datei: ${store.fileName ?? "noch nicht gespeichert"} · Revision ${S.session!.revision}</p>
      ${store.canOverwrite ? "" : html`<p class="muted">Dieser Browser kann die Datei nicht direkt überschreiben: Jedes Sichern erzeugt eine neue Datei
        (am iPad über „In Dateien sichern“ → „Ersetzen“). Am PC speichern Edge oder Chrome direkt in die gewählte Datei, ohne Kopien wie „(1)“.</p>`}
      <div class="actions wrap">
        <button data-action="save">Jetzt in Datei sichern</button>
        <button class="ghost" data-action="backup">${store.canOverwrite ? "Backup speichern unter …" : "Backup herunterladen"}</button>
        <button class="ghost" data-action="notifyPermission">Benachrichtigungen erlauben</button>
        <button class="ghost" data-action="lock">Sperren</button>
        <button class="ghost" data-action="close">Datei schließen</button>
      </div>
      <form data-form="password" class="row"><label class="grow">Neues Passwort (mind. 8 Zeichen) <input type="password" name="pw" autocomplete="new-password" minlength="8" required></label><button type="submit">Passwort ändern</button></form>
    </section>

    <section class="card"><h3>Änderungsprotokoll</h3>
      <ul class="log">${[...t.data.log].reverse().slice(0, 100).map((l) => html`<li><time>${l.at.replace("T", " ")}</time> ${l.text}</li>`)}</ul>
    </section>`;
}

function viewApp(): Html {
  const screen = S.screen;
  return html`
    <header class="top">
      <strong>Fehlzeiten</strong>
      ${classSelect()}
      <span class="spacer"></span>
      ${S.dirty ? html`<button data-action="save" class="dirty">Sichern ●</button>` : html`<span class="muted saved">gesichert</span>`}
      <button class="ghost" data-action="lock">${icon("lock")}Sperren</button>
    </header>
    <nav class="tabs">${nav.map(([k, label]) => html`<button data-action="tab" data-screen="${k}" class="${screen === k || (screen === "detail" && k === "overview") ? "on" : ""}">${label}</button>`)}</nav>
    <main>
      ${banners()}
      ${screen === "week" ? viewWeek() : screen === "overview" ? viewOverview() : screen === "detail" ? viewDetail()
        : screen === "students" ? viewStudents() : viewSettings()}
    </main>
    ${S.toast ? html`<div class="toast" role="status">${S.toast}</div>` : ""}`;
}

// Während ein Finger/die Maus gedrückt ist, nicht neu aufbauen: sonst ginge der folgende Klick ins Leere.
let pointerDown = false, renderPending = false;
document.addEventListener("pointerdown", () => { pointerDown = true; }, { capture: true, passive: true });
for (const type of ["pointerup", "pointercancel"]) {
  document.addEventListener(type, () => {
    pointerDown = false;
    if (renderPending) { renderPending = false; setTimeout(render, 0); }
  }, { capture: true, passive: true });
}

function render() {
  if (pointerDown) { renderPending = true; return; }
  const keep = document.activeElement as HTMLElement | null;
  const focusKey = keep?.getAttribute("data-draft") && keep.getAttribute("data-sid")
    ? `[data-draft="${keep.getAttribute("data-draft")}"][data-sid="${keep.getAttribute("data-sid")}"]` : null;
  root.innerHTML = String(S.locked ? viewLock() : S.session ? viewApp() : viewStart());
  if (focusKey) root.querySelector<HTMLInputElement>(focusKey)?.focus();
}

// ---------- Aktionen ----------

const val = (form: HTMLFormElement, name: string) => (form.elements.namedItem(name) as HTMLInputElement).value;

function afterOpen(stale: boolean) {
  S.screen = "week"; S.week = ""; S.draftKey = ""; S.notices = []; S.locked = false; S.startError = "";
  ensureSelection();
  if (stale) notice("warn", "Achtung: Diese Datei ist älter als der Stand, den dieses Gerät zuletzt gesehen hat. Möglicherweise hat iCloud noch nicht synchronisiert. Bitte prüfen, bevor du Änderungen speicherst.");
  const reminders = tracker().reminders();
  if (reminders.length) systemNotify("Fehlzeiten erfassen", `${reminders.map((r) => r.className).join(", ")}: ${weekLabel(reminders[0]!.week)} ist noch offen.`);
  if (!tracker().data.classes.length) S.screen = "students";
  else if (!tracker().data.halfYears.length) S.screen = "settings";
}

async function onSubmit(form: HTMLFormElement) {
  const kind = form.dataset.form;
  const t = S.session ? tracker() : null;
  switch (kind) {
    case "open": {
      const pw = val(form, "pw");
      const { session, stale } = await openSession(store, pw, { now: localNow, lastSeenRevision: lastSeenRevision() });
      S.session = session; rememberRevision(session.revision); S.dirty = false;
      afterOpen(stale);
      break;
    }
    case "create": {
      const pw = val(form, "pw");
      if (pw !== val(form, "pw2")) throw new Error("Die Passwörter stimmen nicht überein.");
      S.session = await createSession(store, pw, { now: localNow });
      S.dirty = true; S.generation++;
      afterOpen(false);
      notice("info", "Neue Datei angelegt. Lege jetzt Klasse, Schüler:innen und Halbjahr an. Danach unbedingt einmal sichern.");
      break;
    }
    case "unlock": {
      if (!S.session!.verifyPassword(val(form, "pw"))) throw new Error("Falsches Passwort.");
      S.locked = false; S.startError = ""; S.lastActivity = Date.now();
      break;
    }
    case "addClass": S.classId = t!.addClass(val(form, "name")); touched(); break;
    case "addStudent": t!.addStudent({ name: val(form, "name"), classId: S.classId }); S.draftKey = ""; touched(); break;
    case "rename": t!.renameStudent(form.dataset.sid!, val(form, "name")); touched(); break;
    case "addHalfYear": t!.startHalfYear({ name: val(form, "name"), start: val(form, "start"), end: val(form, "end") }); touched(); break;
    case "settings": {
      const patch: Partial<AppSettings> = { preWarning: (form.elements.namedItem("preWarning") as HTMLInputElement).checked };
      for (const k of ["longLateMinutes", "freeShortLates", "hoursPerDay", "warnDays", "dueDays", "reminderHour", "lockMinutes", "retentionMonths"] as const) {
        patch[k] = Number(val(form, k));
      }
      t!.updateSettings(patch); touched(); toast("Einstellungen gespeichert"); break;
    }
    case "filed": t!.markReportFiled(S.detailId, val(form, "date"), currentHalfYearId() || undefined); touched(); break;
    case "password": await S.session!.changePassword(val(form, "pw")); toast("Passwort geändert, Datei neu gespeichert"); S.dirty = false; break;
  }
}

async function onClick(el: HTMLElement) {
  const a = el.dataset.action;
  const t = S.session ? tracker() : null;
  switch (a) {
    case "startMode": S.startMode = el.dataset.mode as "open" | "create"; S.startError = ""; break;
    case "pick": await store.pick(); S.startError = ""; break;
    case "tab": S.screen = el.dataset.screen as Screen; S.notices = []; break;
    case "dismiss": S.notices.splice(Number(el.dataset.i), 1); break;
    case "lock": lock(); break;
    case "save": if (await persist()) toast("In Datei gesichert"); break;
    case "close": if (S.dirty && !confirm("Es gibt ungesicherte Änderungen. Trotzdem schließen?")) break; S.session = null; S.draftKey = ""; break;
    case "gotoWeek": S.classId = el.dataset.cid!; S.week = el.dataset.week!; S.screen = "week"; S.notices = []; break;
    case "weekShift": S.week = addDays(S.week, Number(el.dataset.d)); S.notices = []; break;
    case "weekDefault": S.week = defaultEntryWeek(today()); S.notices = []; break;
    case "addLate": {
      const sid = el.dataset.sid!;
      const q = (attr: string) => root.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-late-${attr}="${sid}"]`)!;
      const minutes = parseCount(q("min").value);
      if (!minutes || Number.isNaN(minutes)) throw new Error("Bitte die Minuten zu spät eintragen (ganze Zahl, 1 bis 45).");
      const d = S.draft[sid]!;
      const late = { date: schoolDays(S.week)[Number(q("day").value)]!, minutes };
      commit(sid, { ...d, lates: [...d.lates, late].sort((a, b) => a.date.localeCompare(b.date)) });
      break;
    }
    case "delLate": {
      const d = S.draft[el.dataset.sid!]!;
      commit(el.dataset.sid!, { ...d, lates: d.lates.filter((_, i) => i !== Number(el.dataset.i)) });
      break;
    }
    case "addAbsence": {
      const sid = el.dataset.sid!;
      const q = (attr: string) => root.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-abs-${attr}="${sid}"]`)!;
      const amount = q("amount").value;
      const absence: Absence = {
        date: schoolDays(S.week)[Number(q("day").value)]!,
        fullDay: amount === "day", hours: amount === "day" ? 0 : Number(amount), note: q("note").value.trim(),
      };
      const d = S.draft[sid]!;
      commit(sid, { ...d, absences: [...d.absences, absence].sort((a, b) => a.date.localeCompare(b.date) || Number(b.fullDay) - Number(a.fullDay)) });
      break;
    }
    case "delAbsence": {
      const d = S.draft[el.dataset.sid!]!;
      commit(el.dataset.sid!, { ...d, absences: d.absences.filter((_, i) => i !== Number(el.dataset.i)) });
      break;
    }
    case "delExtra": {
      const d = S.draft[el.dataset.sid!]!;
      commit(el.dataset.sid!, el.dataset.kind === "days" ? { ...d, extraDays: 0 } : { ...d, extraHours: 0 });
      break;
    }
    case "confirmWeek": {
      t!.confirmWeek(S.classId, S.week);
      S.dirty = true; S.generation++;
      if (await persist()) toast(`${weekLabel(S.week)} als erfasst bestätigt`);
      break;
    }
    case "detail": if (el.dataset.cid) S.classId = el.dataset.cid; S.detailId = el.dataset.sid!; S.screen = "detail"; S.notices = []; break;
    case "overviewCsv": download(`fehlzeiten-${className()}.csv`, overviewCsv(overviewInput()), "text/csv;charset=utf-8"); break;
    case "overviewPrint": openPrintable(overviewHtml(overviewInput())); break;
    case "detailCsv": download(`fehlzeiten-${t!.detail(S.detailId, currentHalfYearId() || undefined).student.name}.csv`, detailCsv(t!.detail(S.detailId, currentHalfYearId() || undefined)), "text/csv;charset=utf-8"); break;
    case "detailPrint": openPrintable(detailHtml(t!.detail(S.detailId, currentHalfYearId() || undefined))); break;
    case "unmarkFiled": t!.unmarkReportFiled(S.detailId, currentHalfYearId() || undefined); touched(); break;
    case "archive": t!.archiveStudent(el.dataset.sid!); S.draftKey = ""; touched(); break;
    case "restore": t!.restoreStudent(el.dataset.sid!); S.draftKey = ""; touched(); break;
    case "deleteHalfYear": {
      const h = t!.data.halfYears.find((x) => x.id === el.dataset.hid);
      if (h && confirm(`Alle Einträge des Halbjahres „${h.name}“ unwiderruflich löschen?`)) { t!.deleteHalfYear(h.id); S.draftKey = ""; touched(); }
      break;
    }
    case "backup": await store.saveCopy(await S.session!.exportBackup(), `fehlzeiten-backup-${today()}.fzt`); toast("Backup gespeichert"); break;
    case "notifyPermission":
      if ("Notification" in window) notice("info", `Benachrichtigungen: ${await Notification.requestPermission()}`);
      else notice("warn", "Dieser Browser unterstützt keine Benachrichtigungen. Hinweise erscheinen in der App.");
      break;
  }
}

const className = () => tracker().data.classes.find((c) => c.id === S.classId)?.name ?? "";
function overviewInput() {
  const hid = currentHalfYearId();
  return { className: className(), halfYear: tracker().data.halfYears.find((h) => h.id === hid)!, rows: tracker().overview(S.classId, { halfYearId: hid }) };
}

function lock() {
  if (S.dirty && store.silent) void persist();
  S.locked = true; S.startError = "";
}

async function guarded(fn: () => Promise<void> | void) {
  try {
    await fn();
  } catch (e) {
    const msg = errText(e);
    if (!S.session || S.locked) S.startError = msg; else notice("error", msg);
  }
  render();
}

// ---------- Verdrahtung ----------

root.addEventListener("click", (ev) => {
  const el = (ev.target as HTMLElement).closest<HTMLElement>("[data-action]");
  if (el) { ev.preventDefault(); void guarded(() => onClick(el)); }
});

root.addEventListener("submit", (ev) => {
  ev.preventDefault();
  void guarded(() => onSubmit(ev.target as HTMLFormElement));
});

root.addEventListener("input", (ev) => {
  const el = ev.target as HTMLInputElement;
  if (el.dataset.draft === "note" && el.dataset.sid && S.draft[el.dataset.sid]) S.draft[el.dataset.sid]!.note = el.value;
});

// Enter in den Zusatzfeldern fügt den Eintrag hinzu (wie der Button daneben).
root.addEventListener("keydown", (ev) => {
  const el = ev.target as HTMLElement;
  if (ev.key !== "Enter") return;
  const sid = el.dataset.absNote ?? el.dataset.lateMin;
  if (!sid) return;
  ev.preventDefault();
  const action = el.dataset.absNote ? "addAbsence" : "addLate";
  root.querySelector<HTMLElement>(`[data-action="${action}"][data-sid="${sid}"]`)?.click();
});

root.addEventListener("change", (ev) => {
  const el = ev.target as HTMLInputElement;
  // Bemerkung zur Woche: beim Verlassen des Feldes speichern, ohne die Seite neu aufzubauen
  // (ein gleichzeitiger Klick auf einen Button ginge sonst verloren).
  if (el.dataset.draft === "note" && el.dataset.sid && S.draft[el.dataset.sid]) {
    const sid = el.dataset.sid;
    try {
      commit(sid, { ...S.draft[sid]!, note: el.value });
      refreshCard(sid);
    } catch (e) {
      notice("error", errText(e));
      render();
    }
    return;
  }
  const f = el.dataset.field;
  if (f === "class") { S.classId = el.value; S.draftKey = ""; }
  else if (f === "halfYear") S.halfYearId = el.value;
  else if (f === "sort") S.sort = el.value as "days" | "name";
  else if (f === "showArchived") S.showArchived = el.checked;
  else return;
  render();
});

for (const type of ["pointerdown", "keydown", "touchstart"]) {
  document.addEventListener(type, () => { S.lastActivity = Date.now(); }, { passive: true });
}

setInterval(() => {
  if (!S.session || S.locked) return;
  if (Date.now() - S.lastActivity > tracker().data.settings.lockMinutes * 60_000) { lock(); render(); return; }
  // Sonntags-Erinnerung zur eingestellten Uhrzeit (nur solange die App offen ist)
  const d = new Date();
  const key = today();
  if (d.getDay() === 0 && d.getHours() >= tracker().data.settings.reminderHour && S.lastReminderDay !== key && tracker().reminders().length) {
    S.lastReminderDay = key;
    systemNotify("Fehlzeiten erfassen", "Die Vorwoche ist noch nicht erfasst.");
    render();
  }
}, 15_000);

// Nur im Produktions-Build: im Entwicklungsmodus würde der Offline-Cache Änderungen verdecken.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => { navigator.serviceWorker.register("./sw.js").catch(() => { /* ohne Offline-Cache weiter */ }); });
}

void store.restore().then(render);
render();
