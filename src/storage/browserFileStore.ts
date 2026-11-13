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
  /** Gemerkte Datei aus einer früheren Sitzung laden (nur mit Dateizugriff). */
  restore(): Promise<void>;
  /** Dateiauswahl (nur aus einem Klick heraus aufrufen). */
  pick(): Promise<void>;
  forget(): Promise<void>;
}

export function createBrowserStore(suggestedName = "fehlzeiten.fzt"): BrowserStore {
  let handle: Handle | null = null;
  let picked: Uint8Array | null = null;
  let name: string | null = null;

  const canHandle = typeof w.showOpenFilePicker === "function";

  async function ensurePermission(h: Handle): Promise<void> {
    const opts = { mode: "readwrite" };
    if ((await h.queryPermission?.(opts)) === "granted") return;
    if ((await h.requestPermission?.(opts)) !== "granted") throw new Error("Zugriff auf die Datei wurde nicht erlaubt.");
  }

  async function shareOrDownload(bytes: Uint8Array): Promise<void> {
    const file = new File([bytes as BlobPart], suggestedName, { type: "application/octet-stream" });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: suggestedName });
        return;
      } catch (e) {
        if ((e as Error).name === "AbortError") throw new Error("Speichern abgebrochen.");
        /* sonst: auf Download ausweichen */
      }
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = suggestedName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  return {
    get silent() { return !!handle; },
    get fileName() { return name; },

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
      if (!handle && typeof w.showSaveFilePicker === "function") {
        handle = await w.showSaveFilePicker({ suggestedName });
        name = handle.name;
        await idb((s) => s.put(handle, KEY), "readwrite");
      }
      if (handle) {
        await ensurePermission(handle);
        const writable = await handle.createWritable();
        await writable.write(bytes);
        await writable.close();
        return;
      }
      picked = bytes;
      await shareOrDownload(bytes);
    },

    async forget() {
      handle = null; picked = null; name = null;
      await idb((s) => s.delete(KEY), "readwrite");
    },
  };
}
