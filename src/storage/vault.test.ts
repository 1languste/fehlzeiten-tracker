import { describe, expect, it } from "vitest";
import { createTracker } from "../tracker/tracker";
import { CorruptFileError, open, seal, WrongPasswordError } from "./vault";

const FAST = { iterations: 1000 }; // nur für Tests schneller; Standard ist deutlich höher

function sampleData() {
  const t = createTracker({ now: () => "2026-11-15T10:00:00" });
  const c = t.addClass("Klasse-Sonnenblume");
  t.addStudent({ name: "Annabelle-Teststudentin", classId: c });
  return t.data;
}

const meta = { revision: 3, savedAt: "2026-11-15T10:00:00" };
const text = (b: Uint8Array) => new TextDecoder().decode(b);

describe("vault", () => {
  it("entschlüsselt mit dem richtigen Passwort wieder zu denselben Daten und Metadaten", async () => {
    const data = sampleData();
    const bytes = await seal(data, "geheim-123", meta, FAST);
    const opened = await open(bytes, "geheim-123");
    expect(opened.data).toEqual(data);
    expect(opened.meta).toEqual(meta);
  });

  it("lehnt ein falsches Passwort ab", async () => {
    const bytes = await seal(sampleData(), "geheim-123", meta, FAST);
    await expect(open(bytes, "falsch")).rejects.toBeInstanceOf(WrongPasswordError);
  });

  it("enthält im Klartext keine Schülerdaten, und zwei Speicherungen sehen verschieden aus", async () => {
    const data = sampleData();
    const a = await seal(data, "geheim-123", meta, FAST);
    const b = await seal(data, "geheim-123", meta, FAST);
    // bewusst lange, eindeutige Namen: kurze Zeichenfolgen könnten zufällig in Base64 vorkommen
    expect(text(a)).not.toContain("Annabelle");
    expect(text(a)).not.toContain("Sonnenblume");
    expect(text(a)).not.toBe(text(b)); // zufälliger Salt und IV
  });

  it("erkennt Manipulation am Inhalt und an den Metadaten", async () => {
    const bytes = await seal(sampleData(), "geheim-123", meta, FAST);
    const file = JSON.parse(text(bytes));

    const flipped = { ...file, ct: (file.ct[0] === "A" ? "B" : "A") + file.ct.slice(1) };
    await expect(open(new TextEncoder().encode(JSON.stringify(flipped)), "geheim-123")).rejects.toThrow();

    const newerRevision = { ...file, revision: 99 }; // Revision nachträglich hochgesetzt
    await expect(open(new TextEncoder().encode(JSON.stringify(newerRevision)), "geheim-123")).rejects.toThrow();
  });

  it("meldet Dateien, die keine Fehlzeiten-Datei sind, als beschädigt", async () => {
    await expect(open(new TextEncoder().encode("hallo"), "x")).rejects.toBeInstanceOf(CorruptFileError);
    await expect(open(new TextEncoder().encode('{"format":"anderes"}'), "x")).rejects.toBeInstanceOf(CorruptFileError);
    await expect(open(new Uint8Array(), "x")).rejects.toBeInstanceOf(CorruptFileError);
  });

  it("lehnt ein leeres Passwort ab", async () => {
    await expect(seal(sampleData(), "", meta, FAST)).rejects.toThrow();
  });
});
