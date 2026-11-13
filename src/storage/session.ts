/**
 * Eine geöffnete, entschlüsselte Datei: Tracker + Speichern/Backup/Passwortwechsel.
 * Wo die Bytes liegen, entscheidet der FileStore (iCloud-Datei heute, Homelab später).
 */
import { createTracker, emptyData, type Tracker } from "../tracker/tracker";
import { open, seal } from "./vault";

/** Seam: Orte, an denen die verschlüsselte Datei liegen kann. */
export interface FileStore {
  /** Liefert die Bytes oder null, wenn noch keine Datei existiert. */
  read(): Promise<Uint8Array | null>;
  write(bytes: Uint8Array): Promise<void>;
}

export interface Session {
  readonly tracker: Tracker;
  /** Revision der zuletzt gelesenen oder geschriebenen Datei. */
  readonly revision: number;
  /** Schreibt in den FileStore und gibt die neue Revision zurück. */
  save(): Promise<number>;
  changePassword(newPassword: string): Promise<void>;
  /** Für die Bildschirmsperre: stimmt das Passwort mit dem der geöffneten Datei überein? */
  verifyPassword(candidate: string): boolean;
  /** Verschlüsselte Kopie für USB-Stick o. Ä.; berührt den FileStore nicht. */
  exportBackup(): Promise<Uint8Array>;
}

interface Options { now?: () => string; iterations?: number }

const MIN_PASSWORD = 8;

function checkPassword(pw: string): void {
  if (pw.length < MIN_PASSWORD) throw new Error(`Das Passwort braucht mindestens ${MIN_PASSWORD} Zeichen.`);
}

function build(store: FileStore, password: string, data: ReturnType<typeof emptyData>, revision: number, o: Options): Session {
  const now = o.now ?? (() => new Date().toISOString());
  const tracker = createTracker({ data, now });
  let pw = password;
  let rev = revision;
  // Speichervorgänge laufen strikt nacheinander, sonst könnte ein älterer Stand einen neueren überschreiben.
  let queue: Promise<unknown> = Promise.resolve();

  const sealNext = (r: number) =>
    seal(tracker.data, pw, { revision: r, savedAt: now() }, o.iterations ? { iterations: o.iterations } : {});

  const session: Session = {
    tracker,
    get revision() { return rev; },
    save() {
      const run = async () => {
        const next = rev + 1;
        await store.write(await sealNext(next));
        rev = next;
        return rev;
      };
      const result = queue.then(run, run);
      queue = result.catch(() => undefined);
      return result;
    },
    async changePassword(newPassword) {
      checkPassword(newPassword);
      pw = newPassword;
      await session.save();
    },
    verifyPassword(candidate) {
      return candidate.length > 0 && candidate === pw;
    },
    async exportBackup() {
      return sealNext(rev);
    },
  };
  return session;
}

/** Neue, leere Datei. Schreibt erst beim ersten `save()`. */
export async function createSession(store: FileStore, password: string, o: Options = {}): Promise<Session> {
  checkPassword(password);
  return build(store, password, emptyData(), 0, o);
}

/**
 * Öffnet die vorhandene Datei. `stale` ist true, wenn sie älter ist als der Stand,
 * den dieses Gerät zuletzt gesehen hat (z. B. weil iCloud noch nicht synchronisiert hat).
 */
export async function openSession(
  store: FileStore,
  password: string,
  o: Options & { lastSeenRevision?: number } = {},
): Promise<{ session: Session; stale: boolean }> {
  const bytes = await store.read();
  if (!bytes) throw new Error("Keine Datei gefunden.");
  const { data, meta } = await open(bytes, password);
  return {
    session: build(store, password, data, meta.revision, o),
    stale: o.lastSeenRevision !== undefined && meta.revision < o.lastSeenRevision,
  };
}
