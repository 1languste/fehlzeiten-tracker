/**
 * FileStore für den Browser (Adapter am Seam aus session.ts).
 *
 * - Edge/Chrome (Windows): Dateizugriff mit gemerktem Handle -> Datei wird beim nächsten Start
 *   ohne erneute Auswahl geöffnet und still überschrieben.
 * - Safari (iPad): kein dauerhafter Dateizugriff. Öffnen per Dateiauswahl, Speichern über
 *   den Teilen-Dialog ("In Dateien sichern") oder als Download.
 *
 * Diese Klasse braucht echte Browser-APIs und ist deshalb nicht per Unit-Test abgedeckt.
 */
import type { FileStore } from "./session";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Handle = any;
const w = window as any;

const DB = "fzt-handles";
const KEY = "file";

function idb<T>(run: (store: IDBObjectStore) => IDBRequest<T>, mode: IDBTransactionMode): Promise<T | undefined> {
  return new Promise((resolve) => {
    try {
      const open = indexedDB.open(DB, 1);
      open.onupgradeneeded = () => open.result.createObjectStore("kv");
      open.onerror = () => resolve(undefined);
      open.onsuccess = () => {
        const req = run(open.result.transaction("kv", mode).objectStore("kv"));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(undefined);
      };
    } catch {
      resolve(undefined);
    }
  });
}

export interface BrowserStore extends FileStore {
  /** true, wenn Speichern ohne Dialog möglich ist (Dateizugriff vorhanden). */
  readonly silent: boolean;
  readonly fileName: string | null;
  /** true, wenn der Browser Dateien direkt überschreiben und Speicherorte wählen lässt (Edge/Chrome). */
  readonly canOverwrite: boolean;
  /** Gemerkte Datei aus einer früheren Sitzung laden (nur mit Dateizugriff). */
  restore(): Promise<void>;
  /** Dateiauswahl (nur aus einem Klick heraus aufrufen). */
  pick(): Promise<void>;
  forget(): Promise<void>;
  /** Kopie (Backup) speichern: mit Ordnerwahl, wenn möglich, sonst als Download. Nur aus einem Klick heraus. */
  saveCopy(bytes: Uint8Array, fileName: string): Promise<void>;
}

export function createBrowserStore(suggestedName = "fehlzeiten.fzt"): BrowserStore {
  let handle: Handle | null = null;
  let picked: Uint8Array | null = null;
  let name: string | null = null;

  const canHandle = typeof w.showOpenFilePicker === "function";
  const canSavePick = typeof w.showSaveFilePicker === "function";

  function download(bytes: Uint8Array, fileName: string): void {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/octet-stream" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  async function writeTo(h: Handle, bytes: Uint8Array): Promise<void> {
    const writable = await h.createWritable();
    await writable.write(bytes);
    await writable.close();
  }

  async function ensurePermission(h: Handle): Promise<void> {
    const opts = { mode: "readwrite" };
    if ((await h.queryPermission?.(opts)) === "granted") return;
    if ((await h.requestPermission?.(opts)) !== "granted") throw new Error("Zugriff auf die Datei wurde nicht erlaubt.");
  }

  async function shareOrDownload(bytes: Uint8Array): Promise<void> {
    // Unter dem Namen der geöffneten Datei sichern: nur dann bietet „Dateien“ im selben Ordner „Ersetzen“ an.
    const fileName = name ?? suggestedName;
    const file = new File([bytes as BlobPart], fileName, { type: "application/octet-stream" });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        // Bewusst ohne title/text: iOS legt daraus sonst eine zusätzliche, leere .txt-Datei an.
        await navigator.share({ files: [file] });
        return;
      } catch (e) {
        if ((e as Error).name === "AbortError") throw new Error("Speichern abgebrochen.");
        /* sonst: auf Download ausweichen */
      }
    }
    download(bytes, fileName);
  }

  return {
    get silent() { return !!handle; },
    get fileName() { return name; },
    get canOverwrite() { return canHandle && canSavePick; },

    async restore() {
      if (!canHandle) return;
      const h = await idb<Handle>((s) => s.get(KEY), "readonly");
      if (h) { handle = h; name = h.name; }
    },

    async pick() {
      if (canHandle) {
        const [h] = await w.showOpenFilePicker({ multiple: false });
        handle = h;
        name = h.name;
        picked = null;
        await idb((s) => s.put(h, KEY), "readwrite");
        return;
      }
      const file = await new Promise<File>((resolve, reject) => {
        const input = document.createElement("input");
        input.type = "file"; // bewusst ohne accept: iOS kennt die Endung .fzt nicht und würde die Datei ausgrauen
        input.onchange = () => (input.files?.[0] ? resolve(input.files[0]) : reject(new Error("Keine Datei gewählt.")));
        input.oncancel = () => reject(new Error("Keine Datei gewählt."));
        input.click();
      });
      picked = new Uint8Array(await file.arrayBuffer());
      name = file.name;
    },

    async read() {
      if (handle) {
        await ensurePermission(handle);
        return new Uint8Array(await (await handle.getFile()).arrayBuffer());
      }
      return picked;
    },

    async write(bytes) {
      if (!handle && canSavePick) {
        try {
          handle = await w.showSaveFilePicker({ suggestedName });
        } catch (e) {
          if ((e as Error).name === "AbortError") throw new Error("Speichern abgebrochen.");
          throw e;
        }
        name = handle.name;
        await idb((s) => s.put(handle, KEY), "readwrite");
      }
      if (handle) {
        await ensurePermission(handle);
        await writeTo(handle, bytes);
        return;
      }
      picked = bytes;
      await shareOrDownload(bytes);
    },

    async forget() {
      handle = null; picked = null; name = null;
      await idb((s) => s.delete(KEY), "readwrite");
    },

    async saveCopy(bytes, fileName) {
      if (!canSavePick) { download(bytes, fileName); return; }
      let h: Handle;
      try {
        h = await w.showSaveFilePicker({ suggestedName: fileName });
      } catch (e) {
        if ((e as Error).name === "AbortError") throw new Error("Backup abgebrochen.");
        throw e;
      }
      // Die gewählte Datei nicht als Arbeitsdatei merken: das Backup bleibt eine eigenständige Kopie.
      await writeTo(h, bytes);
    },
  };
}
