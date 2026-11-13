import { describe, expect, it } from "vitest";
import { createSession, openSession, type FileStore } from "./session";
import { WrongPasswordError, open } from "./vault";

const FAST = { iterations: 1000 };
const T = (hhmm = "10:00:00") => () => `2026-11-15T${hhmm}`;

/** Austauschbarer Speicher (Fake): hier nur im Arbeitsspeicher. */
class MemoryStore implements FileStore {
  bytes: Uint8Array | null = null;
  writes = 0;
  async read() { return this.bytes; }
  async write(b: Uint8Array) { this.bytes = b; this.writes++; }
}

describe("session", () => {
  it("speichert und lädt die Daten wieder, mit hochzählender Revision", async () => {
    const store = new MemoryStore();
    const s = await createSession(store, "pw-123456", { now: T(), ...FAST });
    s.tracker.startHalfYear({ name: "H1", start: "2026-08-10", end: "2027-01-29" });
    const c = s.tracker.addClass("5a");
    s.tracker.addStudent({ name: "Anna", classId: c });
    expect(await s.save()).toBe(1);
    expect(await s.save()).toBe(2);

    const { session, stale } = await openSession(store, "pw-123456", { now: T(), lastSeenRevision: 2 });
    expect(stale).toBe(false);
    expect(session.revision).toBe(2);
    expect(session.tracker.overview(c).map((r) => r.name)).toEqual(["Anna"]);
  });

  it("warnt, wenn die geöffnete Datei älter ist als der zuletzt gesehene Stand", async () => {
    const store = new MemoryStore();
    const s = await createSession(store, "pw-123456", { now: T(), ...FAST });
    await s.save(); // Revision 1
    const old = store.bytes!;
    await s.save(); // Revision 2
    store.bytes = old; // iCloud liefert die alte Version zurück

    const { stale } = await openSession(store, "pw-123456", { now: T(), lastSeenRevision: 2 });
    expect(stale).toBe(true);
  });

  it("lehnt ein falsches Passwort ab und meldet eine fehlende Datei", async () => {
    const store = new MemoryStore();
    const s = await createSession(store, "pw-123456", { now: T(), ...FAST });
    await s.save();
    await expect(openSession(store, "falsch", { now: T() })).rejects.toBeInstanceOf(WrongPasswordError);
    await expect(openSession(new MemoryStore(), "x", { now: T() })).rejects.toThrow(/keine Datei/i);
  });

  it("wechselt das Passwort: das alte gilt danach nicht mehr", async () => {
    const store = new MemoryStore();
    const s = await createSession(store, "alt-123456", { now: T(), ...FAST });
    await s.save();
    await s.changePassword("neu-123456");
    await expect(openSession(store, "alt-123456", { now: T() })).rejects.toBeInstanceOf(WrongPasswordError);
    await expect(openSession(store, "neu-123456", { now: T() })).resolves.toBeDefined();
  });

  it("erzeugt ein Backup, das für sich mit dem Passwort lesbar ist", async () => {
    const store = new MemoryStore();
    const s = await createSession(store, "pw-123456", { now: T(), ...FAST });
    const c = s.tracker.addClass("5a");
    s.tracker.addStudent({ name: "Anna", classId: c });
    const backup = await s.exportBackup();
    expect(store.writes).toBe(0); // ein Backup verändert die Hauptdatei nicht
    const opened = await open(backup, "pw-123456");
    expect(opened.data.students.map((x) => x.name)).toEqual(["Anna"]);
  });

  it("prüft das Passwort für die Bildschirmsperre, ohne die Datei anzufassen", async () => {
    const store = new MemoryStore();
    const s = await createSession(store, "pw-123456", { now: T(), ...FAST });
    expect(s.verifyPassword("pw-123456")).toBe(true);
    expect(s.verifyPassword("pw-12345")).toBe(false);
    expect(s.verifyPassword("")).toBe(false);
    expect(store.writes).toBe(0);
    await s.changePassword("neu-123456");
    expect(s.verifyPassword("pw-123456")).toBe(false);
    expect(s.verifyPassword("neu-123456")).toBe(true);
  });

  it("schreibt gleichzeitige Speichervorgänge der Reihe nach, der neueste Stand gewinnt", async () => {
    // Der erste Schreibvorgang ist langsam (z. B. iCloud), der zweite schnell.
    class SlowFirstStore extends MemoryStore {
      async write(b: Uint8Array) {
        if (this.writes === 0) await new Promise((r) => setTimeout(r, 40));
        await super.write(b);
      }
    }
    const store = new SlowFirstStore();
    const s = await createSession(store, "pw-123456", { now: T(), ...FAST });
    const c = s.tracker.addClass("5a");

    const first = s.save();
    s.tracker.addStudent({ name: "Anna", classId: c }); // Änderung, während der erste Speichervorgang läuft
    const second = s.save();
    const revisions = await Promise.all([first, second]);

    expect(revisions).toEqual([1, 2]);
    const { data, meta } = await open(store.bytes!, "pw-123456");
    expect(meta.revision).toBe(2);
    expect(data.students.map((x) => x.name)).toEqual(["Anna"]);
  });

  it("verlangt für neue Passwörter eine Mindestlänge", async () => {
    await expect(createSession(new MemoryStore(), "kurz", { now: T(), ...FAST })).rejects.toThrow(/Zeichen/);
  });
});
