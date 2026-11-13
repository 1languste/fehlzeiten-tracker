# Glossar

Fachbegriffe, wie sie im Code und in der Oberfläche verwendet werden.

| Begriff | Bedeutung |
| --- | --- |
| **Lehrkraft** | Einzige Nutzerin der Anwendung. |
| **Schüler:in** | Person mit Vorname (bei Doppelungen mit Zusatz), gehört zu genau einer Klasse. |
| **Klasse** | Klasse oder Lerngruppe. |
| **Halbjahr** | Bezugszeitraum für alle Zähler; mit Beginn eines neuen Halbjahres starten alle Zähler bei null. |
| **Woche** | Schulwoche Montag bis Freitag, identifiziert durch ihren Montag (ISO-Datum). |
| **Wocheneintrag** | Eingaben einer Person für eine Woche: Verspätungen, Fehlstunden, Fehltage, Bemerkung. Eine Woche ohne Eintrag gilt als „ohne Fehlzeiten“. |
| **Verspätung** | Datum, Unterrichtsstunde, Minuten zu spät. |
| **Lange Verspätung** | Verspätung ab 20 Minuten: zählt sofort als 1 Fehlstunde und nicht zusätzlich als kurze. |
| **Kurze Verspätung** | Verspätung unter 20 Minuten: die ersten 2 bleiben folgenlos, jede weitere zählt als 1 Fehlstunde. |
| **Fehlstunde** | Versäumte Unterrichtsstunde, erfasst oder aus Verspätungen berechnet. |
| **Fehltag** | Versäumter Schultag, erfasst oder aus je 6 Fehlstunden berechnet (abgerundet). |
| **Rest** | Fehlstunden, die noch nicht für einen vollen Fehltag reichen. |
| **Ampel / Status** | Grün (unter 3 Fehltage), Gelb (Vorwarnung ab 3), Rot (ab 5, Schulversäumnisanzeige fällig), Erledigt (Anzeige gestellt). |
| **Schulversäumnisanzeige** | Behördliche Anzeige, die ab 5 Fehltagen im Halbjahr fällig ist. Wird manuell als „gestellt“ markiert; danach wird weitergezählt. |
| **Vorwarnung** | Hinweis bei Gelb, damit vorher ein Elterngespräch möglich ist. Abschaltbar. |
| **Erinnerung** | Hinweis, dass die Vorwoche noch nicht gespeichert wurde. |
| **Datei** | Verschlüsselte Datendatei (`.fzt`), enthält alles. Liegt z. B. in iCloud Drive. |
| **Revision** | Zähler der Datei; erkennt, ob eine ältere Version geöffnet wurde. |

## Architektur-Begriffe

| Begriff | Modul |
| --- | --- |
| **Rechenkern** | `src/core/rules.ts`: reine Funktionen für Verspätungen, Fehlstunden, Fehltage, Ampel. |
| **Tracker** | `src/tracker/tracker.ts`: gesamte Fachlogik hinter einer kleinen Schnittstelle. |
| **Vault** | `src/storage/vault.ts`: Verschlüsselung und Dateiformat. |
| **Session** | `src/storage/session.ts`: geöffnete Datei mit Tracker, Speichern, Backup, Passwortwechsel. |
| **FileStore** | Seam in `session.ts`: Ort der Datei. Heute iCloud-Datei im Browser, später Homelab. |
