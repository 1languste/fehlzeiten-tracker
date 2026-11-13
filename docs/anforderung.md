# Anforderung: Fehlzeiten-Tracker mit Warnung zur Schulversäumnisanzeige

Stand: 13.11.2026

## Ausgangslage und Ziel

Gesucht ist eine einfache Anwendung, mit der eine Lehrkraft die unentschuldigten Fehlzeiten ihrer Schüler:innen wöchentlich erfasst und automatisch gewarnt wird, sobald eine Schulversäumnisanzeige gestellt werden muss.

Bisher werden Verspätungen und Fehlstunden händisch gezählt und umgerechnet. Das ist fehleranfällig, weil mehrere Umrechnungsregeln greifen (Minuten → Fehlstunden, Verspätungsanzahl → Fehlstunden, Fehlstunden → Fehltage). Die Anwendung soll diese Regeln automatisch anwenden und jederzeit einen aktuellen Stand je Schüler:in zeigen.

## Nutzer:innen und Nutzungsrhythmus

Einzige Nutzerin ist die Lehrkraft selbst. Weitere Konten, Rollen oder Zugänge für Kolleg:innen, Schüler:innen oder Eltern sind nicht nötig.

- Die Eingabe erfolgt einmal pro Woche, in der Regel am Sonntag, rückwirkend für die vergangene Schulwoche (Montag bis Freitag).
- Die Eingabe muss schnell gehen: alle Schüler:innen einer Klasse auf einer Seite, nur Felder mit Einträgen werden ausgefüllt.
- Nachträgliches Korrigieren vergangener Wochen muss möglich sein (z. B. wenn eine Entschuldigung später eingeht).

## Funktionale Anforderungen

### F1 – Schüler:innen verwalten

- Schüler:innen von Hand anlegen, umbenennen, archivieren. Erfasst wird nur der Vorname, keine Klarnamen; bei gleichen Vornamen ein kurzer Zusatz (z. B. Initial des Nachnamens).
- Mehrere Klassen bzw. Lerngruppen anlegen und Schüler:innen zuordnen.
- Archivierte Schüler:innen (z. B. nach Schulwechsel) bleiben in der Historie erhalten, erscheinen aber nicht mehr in der Wochenerfassung.
- Ein Import aus Dateien ist nicht nötig.

### F2 – Wöchentliche Erfassung

Pro Schüler:in und Schulwoche (Kalenderwoche) werden erfasst:

| Feld | Typ | Hinweis |
| --- | --- | --- |
| Verspätungen | Liste von Einträgen | je Eintrag: Datum, Unterrichtsstunde, Minuten zu spät |
| Unentschuldigte Fehlstunden | Zahl (ganze Stunden) | einzelne versäumte Unterrichtsstunden |
| Unentschuldigte Fehltage | Zahl (ganze Tage) | komplett versäumte Schultage |
| Bemerkung | Freitext, optional | z. B. „Entschuldigung nachgereicht“ |

- Die Erfassungsmaske zeigt standardmäßig die vergangene Kalenderwoche.
- Eine Woche, in der nichts eingetragen wurde, gilt als „ohne Fehlzeiten“.
- Jeder Eintrag lässt sich nachträglich bearbeiten oder löschen; alle Summen werden dann neu berechnet.

### F3 – Übersicht

- Tabelle aller Schüler:innen einer Klasse mit: Anzahl Verspätungen, daraus resultierende Fehlstunden, unentschuldigte Fehlstunden gesamt, umgerechnete Fehltage gesamt, Status (siehe Ampel unten).
- Sortierbar nach Fehltagen, damit kritische Fälle oben stehen.
- Detailansicht je Schüler:in mit allen Wocheneinträgen und der nachvollziehbaren Berechnung (welche Verspätung zählte als wievielte Fehlstunde).
- Export der Übersicht und der Detailansicht als PDF oder CSV, z. B. als Anlage zur Schulversäumnisanzeige.

### F4 – Status-Ampel

| Status | Bedingung (Vorschlag) |
| --- | --- |
| Grün | weniger als 3 Fehltage |
| Gelb | 3 oder 4 Fehltage (Vorwarnung) |
| Rot | 5 oder mehr Fehltage → Schulversäumnisanzeige fällig |
| Erledigt | Anzeige wurde gestellt (manuell markiert, mit Datum); die Zählung läuft danach weiter |

## Berechnungsregeln

Alle Werte werden kumuliert je Schulhalbjahr gerechnet. Mit Beginn eines neuen Halbjahres starten alle Zähler bei null. Alle Schwellenwerte müssen in den Einstellungen änderbar sein.

1. **Lange Verspätung:** Eine Verspätung von 20 Minuten oder mehr in einer Unterrichtsstunde (45 Minuten) zählt sofort als 1 Fehlstunde. Sie zählt nicht zusätzlich bei Regel 2 mit.
2. **Häufige Verspätungen:** Die übrigen Verspätungen (unter 20 Minuten) werden gezählt. Die 1. und 2. bleiben folgenlos. Die 3. Verspätung zählt als 1 Fehlstunde, ebenso jede weitere (4., 5., …).
3. **Fehlstunden gesamt** = erfasste unentschuldigte Fehlstunden + Fehlstunden aus Regel 1 + Fehlstunden aus Regel 2.
4. **Umrechnung in Fehltage:** Je 6 Fehlstunden ergeben 1 Fehltag (ganzzahlig abgerundet). Der Rest bleibt stehen und wird mit späteren Fehlstunden weiter aufaddiert.
5. **Fehltage gesamt** = erfasste unentschuldigte Fehltage + Fehltage aus Regel 4.
6. **Schulversäumnisanzeige:** Erreicht „Fehltage gesamt“ den Wert 5, wird die Anzeige als fällig markiert. Nach der Anzeige wird im selben Halbjahr weitergezählt, nichts wird zurückgesetzt.

Als Formel:

```
Fehltage gesamt = Fehltage_erfasst
                + abrunden( (Fehlstunden_erfasst + V_ab20 + max(0, V_unter20 − 2)) / 6 )
```

Dabei ist V_ab20 die Anzahl der Verspätungen ab 20 Minuten und V_unter20 die Anzahl der kürzeren Verspätungen im Schulhalbjahr. Lange Verspätungen gehen nicht zusätzlich in V_unter20 ein.

## Benachrichtigungen

Die Anwendung informiert aktiv, sobald nach dem Speichern einer Woche eine Schwelle erreicht ist.

- **Schulversäumnisanzeige fällig:** deutlicher Hinweis direkt nach dem Speichern sowie eine Systembenachrichtigung des Computers, mit Vorname, Klasse, Fehltagen gesamt und Sprung zur Detailansicht. Kein E-Mail-Versand, da die Anwendung offline läuft.
- **Vorwarnung:** Hinweis bei 3 bzw. 4 Fehltagen, damit vorher ein Elterngespräch möglich ist (optional abschaltbar).
- **Erinnerung an die Eingabe:** sonntags zu einer einstellbaren Uhrzeit per Systembenachrichtigung, falls die Vorwoche noch nicht erfasst ist; spätestens beim nächsten Programmstart.
- Eine fällige Anzeige bleibt so lange hervorgehoben, bis sie als „gestellt“ markiert wird. Danach keine erneute Warnung für denselben Stand.

## Nicht-funktionale Anforderungen

- **Betrieb:** Die Anwendung läuft ausschließlich lokal auf dem Computer der Lehrkraft (Desktop-Anwendung oder lokal gestartete Web-Anwendung). Kein Server, keine Cloud, keine Internetverbindung nötig. Daten liegen in einer lokalen Datei bzw. Datenbank.
- **Datensparsamkeit:** nur Vorname (ggf. mit Zusatz), Klasse und Fehlzeiten; keine Nachnamen, keine Gründe für Fehlzeiten, keine Gesundheitsdaten.
- **Zugriffsschutz:** Datendatei verschlüsselt und mit Passwort geschützt; automatische Sperre nach Inaktivität.
- **Datensicherung:** einfache Backup-Funktion (Sicherung in eine Datei, z. B. auf USB-Stick) und Wiederherstellung.
- **Löschung:** abgelaufene Halbjahre nach einer einstellbaren Frist zur Löschung vorschlagen.
- **Bedienung:** Wochenerfassung einer Klasse in unter 5 Minuten.
- **Nachvollziehbarkeit:** Änderungen an Einträgen werden mit Datum protokolliert, da die Zahlen Grundlage einer behördlichen Anzeige sind.

## Rechenbeispiele als Testfälle

Die Werte gelten kumuliert im Schulhalbjahr.

| Nr. | Eingaben | Fehlstunden gesamt | Fehltage gesamt | Status |
| --- | --- | --- | --- | --- |
| 1 | 2 Verspätungen à 5 min | 0 | 0 | Grün |
| 2 | 4 Verspätungen à 10 min | 2 (3. und 4.) | 0 | Grün |
| 3 | 1 Verspätung à 25 min | 1 | 0 | Grün |
| 4 | 4 Fehlstunden + 3 Verspätungen à 10 min | 5 | 0 (Rest 5) | Grün |
| 5 | wie Nr. 4, in der Folgewoche + 1 Fehlstunde | 6 | 1 | Grün |
| 6 | 3 Fehltage + 11 Fehlstunden | 11 | 4 (Rest 5) | Gelb |
| 7 | 4 Fehltage + 6 Fehlstunden | 6 | 5 | Rot – Anzeige fällig |

## Festlegungen und offene Punkte

Festgelegt:

- Eine Verspätung ab 20 Minuten zählt nur einmal, als 1 Fehlstunde.
- Bezugszeitraum ist das Schulhalbjahr.
- Nach einer gestellten Anzeige wird weitergezählt.
- Die 20-Minuten-Grenze gilt je Unterrichtsstunde à 45 Minuten.
- Einzige Nutzerin ist die Lehrkraft.
- Betrieb nur lokal auf dem eigenen Computer.
- Schüler:innen werden von Hand eingetragen, nur mit Vornamen.

Noch offen:

- [ ] Welches Betriebssystem hat der Computer (Windows, macOS, Linux)?
- [ ] Soll nach einer gestellten Anzeige bei weiteren Fehltagen erneut gewarnt werden, z. B. ab 10 Fehltagen?
