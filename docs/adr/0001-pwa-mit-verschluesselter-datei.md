# ADR 0001: PWA mit verschlüsselter Datei in iCloud Drive

Stand: 13.11.2026 · Status: angenommen

## Entscheidung

Die Anwendung ist eine PWA (Web-App) ohne Server. Alle Daten liegen in **einer verschlüsselten Datei** (AES-256-GCM, Schlüssel per PBKDF2 aus dem Passwort), die in iCloud Drive liegt. Windows-PC und iPad greifen auf dieselbe Datei zu.

## Gründe

- Die Lehrkraft nutzt Windows-PC und iPad. Tauri und Electron laufen nicht auf dem iPad.
- Schülerdaten, auch nur Vornamen, sollen nicht lesbar bei einem Drittanbieter liegen. Verschlüsselung im Gerät erfüllt das; Apple sieht nur Bytes.
- Kein Server, keine Betriebskosten, keine Pflege.

## Folgen und Einschränkungen

- Safari auf dem iPad kann Dateien nicht im Hintergrund überschreiben: Öffnen per Dateiauswahl, Speichern über „In Dateien sichern“.
- Windows (Edge/Chrome) merkt sich die Datei und speichert still.
- Echte geplante Benachrichtigungen (Sonntags-Erinnerung) sind ohne Server nicht möglich. Die Erinnerung erscheint beim Öffnen der App und, solange sie offen ist, zur eingestellten Uhrzeit.
- Gleichzeitige Bearbeitung auf zwei Geräten kann iCloud-Konfliktkopien erzeugen. Die Revision in der Datei warnt, wenn eine ältere Version geöffnet wird.

## Geplanter Umzug auf das Homelab

Der Speicherort steckt hinter der Schnittstelle `FileStore` (`src/storage/session.ts`). Für das Homelab kommt ein weiterer Adapter dazu (HTTP statt Datei), die Verschlüsselung im Gerät bleibt. Damit entfallen Dateiauswahl und manuelles Sichern auf dem iPad. Erreichbarkeit von außen wäre per VPN (z. B. Tailscale) zu lösen. Fachlogik, Verschlüsselung und Oberfläche bleiben unverändert.

## Offen

- Datenschutzfreigabe der Schule für die Ablage in iCloud klären (Schulleitung / Datenschutzbeauftragte).
