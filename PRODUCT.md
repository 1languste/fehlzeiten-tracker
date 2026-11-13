# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Eine einzelne Lehrkraft, die allein mit der App arbeitet. Sie erfasst einmal pro Woche, meist sonntags, rückwirkend die vergangene Schulwoche (Mo–Fr) für eine Klasse. Geräte: Windows-PC (Edge/Chrome) und iPad (Safari, als PWA auf dem Home-Bildschirm). Keine weiteren Konten, Rollen oder Zugänge für Kolleg:innen, Schüler:innen oder Eltern.

## Product Purpose

Unentschuldigte Verspätungen, Fehlstunden und Fehltage je Schüler:in wöchentlich erfassen, automatisch nach den Regeln in `docs/anforderung.md` in Fehltage umrechnen und warnen, sobald eine Schulversäumnisanzeige fällig ist. Ersetzt händisches, fehleranfälliges Zählen und Umrechnen. Erfolg: Wochenerfassung einer Klasse in unter 5 Minuten, jederzeit ein nachvollziehbarer Stand je Schüler:in, keine verpasste Anzeige.

## Positioning

Läuft ohne Server und ohne Konto. Alle Daten liegen in einer passwortverschlüsselten Datei (AES-256-GCM), die die Lehrkraft selbst ablegt (z. B. iCloud Drive). Der Host (GitHub Pages) liefert nur den Code aus und sieht nie Schülerdaten.

## Operating Context

- Erfassung am Wochenende, ruhig, oft auf dem iPad; Auswertung und Export (CSV, Druck/PDF) als Anlage zur Anzeige am PC.
- Zahlen sind Grundlage einer behördlichen Anzeige: Änderungen werden protokolliert, die Berechnung ist in der Detailansicht nachvollziehbar.
- Bezugszeitraum ist das Schulhalbjahr, mit Ampel (grün, gelb, rot, erledigt).
- Automatische Sperre nach Inaktivität.

## Capabilities and Constraints

- Nur Vorname (bei Doppelungen mit Zusatz), Klasse und Fehlzeiten; keine Nachnamen, Gründe oder Gesundheitsdaten.
- Offline-fähig (Service Worker), Benachrichtigungen soweit der Browser sie erlaubt, Backup-Download, Löschvorschlag für abgelaufene Halbjahre.
- Regeln und Schwellen sind in den Einstellungen änderbar (Regelwerk wie in `docs/anforderung.md`).
- Stack: Vanilla TypeScript und Vite, ohne UI-Framework; Auslieferung als statische Seite über GitHub Pages.
- Technische Entscheidung: `docs/adr/0001-pwa-mit-verschluesselter-datei.md`. Begriffe: `GLOSSARY.md`.
- Offen: erneute Warnung nach gestellter Anzeige (z. B. ab 10 Fehltagen).

## Brand Commitments

Name: „Fehlzeiten-Tracker“ (kurz „Fehlzeiten“). Sprache Deutsch, Du-Form, gendergerecht mit Doppelpunkt („Schüler:innen“), sachlich und knapp. Keine weiteren Markenvorgaben.

## Evidence on Hand

Anforderung mit Rechenbeispielen als Testfälle (`docs/anforderung.md`), Unit-Tests für Regeln, Wochen, Export und Speicher. Keine echten Schülerdaten im Repository und keine Nutzerstudien.

## Product Principles

1. Datenschutz vor Komfort: Nichts verlässt das Gerät, nichts wird ohne Verschlüsselung abgelegt.
2. Schnelle Wochenerfassung: nur Felder mit Einträgen werden ausgefüllt, alles andere gilt als „ohne Fehlzeiten“.
3. Nachvollziehbar: Jede Zahl lässt sich bis zur einzelnen Verspätung zurückverfolgen und ist protokolliert.
4. Fällige Anzeigen sind unübersehbar und bleiben es, bis sie als gestellt markiert sind.
5. Ruhig im Alltag, laut nur bei Handlungsbedarf.

## Accessibility & Inclusion

Keine produktspezifischen Anforderungen genannt. Gelten sollen solide Standards: ausreichender Kontrast, Tastaturbedienung, Touch-Ziele ab 44 px, Hell- und Dunkelmodus.
