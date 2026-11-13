# Fehlzeiten-Tracker

App für Lehrkräfte: unentschuldigte Fehlzeiten wöchentlich erfassen, Verspätungen und Fehlstunden automatisch in Fehltage umrechnen und rechtzeitig vor einer fälligen Schulversäumnisanzeige warnen.

- Läuft im Browser (PWA) auf Windows-PC und iPad, ohne Server
- Datensparsam: nur Vornamen, Klasse, Fehlzeiten
- Alle Daten in **einer verschlüsselten Datei** (AES-256-GCM, Passwort), z. B. in iCloud Drive
- Regeln und Schwellen: [docs/anforderung.md](docs/anforderung.md), Begriffe: [GLOSSARY.md](GLOSSARY.md), Entscheidung: [docs/adr/0001-pwa-mit-verschluesselter-datei.md](docs/adr/0001-pwa-mit-verschluesselter-datei.md)

> Dieses Repository enthält nur Code und Dokumentation, niemals echte Schülerdaten.

## Entwickeln

```
npm install
npm test          # Unit-Tests (Vitest)
npm run dev       # lokaler Entwicklungsserver
npm run build     # Produktions-Build nach dist/
```

Der Build ist eine statische Seite mit relativen Pfaden und kann in jedem Verzeichnis eines statischen Hosters liegen (z. B. GitHub Pages). Der Host sieht nie Schülerdaten, sondern liefert nur die App aus.

## Veröffentlichen (GitHub Pages)

Einmalig im Repository: **Settings → Pages → Source: GitHub Actions**. Danach baut und veröffentlicht [.github/workflows/pages.yml](.github/workflows/pages.yml) bei jedem Push auf `main` (erst Tests, dann Build). Die App liegt unter `https://<benutzer>.github.io/fehlzeiten-tracker/`.

## Benutzung

1. App im Browser öffnen und auf dem iPad „Zum Home-Bildschirm“, auf Windows in Edge/Chrome „Als App installieren“.
2. Erstes Mal: **Neue Datei**, Passwort vergeben, Datei in iCloud Drive speichern. Dann Klasse, Schüler:innen und Halbjahr anlegen.
3. Danach: **Datei wählen**, Passwort eingeben.
   - Windows (Edge/Chrome): die Datei wird gemerkt und automatisch gespeichert.
   - iPad (Safari): nach dem Speichern erscheint der Teilen-Dialog, dort „In Dateien sichern“ und die vorhandene Datei ersetzen.
4. Wöchentlich unter **Erfassen** die Vorwoche eintragen. Die Übersicht zeigt Ampel und Warnungen.

Das Passwort lässt sich nicht zurücksetzen. Backups: Einstellungen → „Backup herunterladen“.

## Aufbau

| Modul | Aufgabe |
| --- | --- |
| `src/core/` | Rechenkern und Kalenderwochen, reine Funktionen |
| `src/tracker/` | Fachlogik: Schüler:innen, Wochen, Übersicht, Detail, Warnungen, Protokoll |
| `src/storage/` | Verschlüsselung (`vault`), geöffnete Datei (`session`), Browser-Dateizugriff |
| `src/export/` | CSV und druckbare Ansicht (PDF über „Drucken“) |
| `src/ui/` | dünne Oberfläche |

Die Module sind per Test an ihrer Schnittstelle abgesichert. Browser-spezifischer Code (`browserFileStore.ts`, `ui/app.ts`) ist nicht per Unit-Test abgedeckt.

## Grenzen

- Keine geplanten Systembenachrichtigungen: Erinnerung und Warnungen erscheinen in der App (und als Benachrichtigung, wo der Browser es erlaubt und die App offen ist).
- Auf dem iPad ist das Speichern ein manueller Schritt.
- Nicht auf zwei Geräten gleichzeitig bearbeiten. Beim Öffnen einer älteren Dateiversion warnt die App.
- Der Dateiformat-Stand ist `schemaVersion 1`; Änderungen am Datenmodell brauchen eine Migration.

## Status

Funktionsumfang laut Anforderung umgesetzt. Offen: Datenschutzfreigabe der Schule, Umzug auf das Homelab (siehe ADR).
