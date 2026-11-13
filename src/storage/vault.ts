/**
 * Verschlüsselte Datei: Passwort -> PBKDF2-SHA256 -> AES-256-GCM (Web Crypto).
 * Die Metadaten (Revision, Speicherzeit) liegen im Klartext, sind aber als
 * authentifizierte Zusatzdaten (AAD) gegen nachträgliche Änderung geschützt.
 */
import type { Data } from "../tracker/types";

export interface Meta { revision: number; savedAt: string }

export class WrongPasswordError extends Error {
  constructor() {
    super("Falsches Passwort oder die Datei wurde verändert.");
    this.name = "WrongPasswordError";
  }
}

export class CorruptFileError extends Error {
  constructor(message = "Das ist keine gültige Fehlzeiten-Datei.") {
    super(message);
    this.name = "CorruptFileError";
  }
}

const FORMAT = "fehlzeiten-tracker";
const VERSION = 1;
export const DEFAULT_ITERATIONS = 600_000;
const MAX_ITERATIONS = 10_000_000;

const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

const aad = (iterations: number, meta: Meta) =>
  enc.encode(JSON.stringify({ format: FORMAT, version: VERSION, iterations, revision: meta.revision, savedAt: meta.savedAt }));

export async function seal(
  data: Data,
  password: string,
  meta: Meta,
  opts: { iterations?: number } = {},
): Promise<Uint8Array> {
  if (!password) throw new Error("Das Passwort darf nicht leer sein.");
  const iterations = opts.iterations ?? DEFAULT_ITERATIONS;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, iterations);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv as BufferSource, additionalData: aad(iterations, meta) as BufferSource },
      key,
      enc.encode(JSON.stringify(data)),
    ),
  );
  const file = {
    format: FORMAT, version: VERSION, kdf: "PBKDF2-SHA256", iterations,
    revision: meta.revision, savedAt: meta.savedAt,
    salt: toB64(salt), iv: toB64(iv), ct: toB64(ct),
  };
  return enc.encode(JSON.stringify(file));
}

export async function open(bytes: Uint8Array, password: string): Promise<{ data: Data; meta: Meta }> {
  let f: Record<string, unknown>;
  try {
    f = JSON.parse(dec.decode(bytes));
  } catch {
    throw new CorruptFileError();
  }
  if (
    !f || f.format !== FORMAT || f.version !== VERSION ||
    typeof f.iterations !== "number" || f.iterations < 1 || f.iterations > MAX_ITERATIONS ||
    typeof f.revision !== "number" || typeof f.savedAt !== "string" ||
    typeof f.salt !== "string" || typeof f.iv !== "string" || typeof f.ct !== "string"
  ) {
    throw new CorruptFileError();
  }
  const meta: Meta = { revision: f.revision, savedAt: f.savedAt };
  try {
    const key = await deriveKey(password, fromB64(f.salt), f.iterations);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64(f.iv) as BufferSource, additionalData: aad(f.iterations, meta) as BufferSource },
      key,
      fromB64(f.ct) as BufferSource,
    );
    return { data: JSON.parse(dec.decode(plain)) as Data, meta };
  } catch {
    throw new WrongPasswordError();
  }
}
