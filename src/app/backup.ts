import { normalizeSettings, type Settings } from "./settings";
import type { Script } from "./storage";

/**
 * Kopia ustawień i biblioteki tekstów (E1). Plik JSON bez danych spoza aplikacji.
 * `settings` doszło później: starsze pliki go nie mają i nadal się wczytują.
 */
export interface Backup {
  format: "prompter-backup";
  version: 1;
  exportedAt: number;
  settings?: Settings;
  scripts: Script[];
}

export function makeBackup(scripts: readonly Script[], now: number, settings?: Settings): Backup {
  const b: Backup = { format: "prompter-backup", version: 1, exportedAt: now, scripts: scripts.map((s) => ({ ...s })) };
  if (settings) b.settings = { ...settings, keyMap: { ...settings.keyMap } };
  return b;
}

function isScript(x: unknown): x is Script {
  if (typeof x !== "object" || x === null) return false;
  const s = x as Record<string, unknown>;
  return (
    typeof s.id === "string" &&
    s.id.length > 0 &&
    typeof s.title === "string" &&
    typeof s.body === "string" &&
    typeof s.createdAt === "number" &&
    typeof s.updatedAt === "number" &&
    typeof s.lastWord === "number"
  );
}

/** Odczyt pliku kopii; rzuca Error z komunikatem dla użytkownika. */
export function parseBackup(text: string): Script[] {
  return parseBackupFile(text).scripts;
}

/** Odczyt pliku kopii z ustawieniami (null, gdy plik ich nie ma); rzuca Error z komunikatem dla użytkownika. */
export function parseBackupFile(text: string): { scripts: Script[]; settings: Settings | null } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Plik nie jest poprawnym JSON.");
  }
  const b = data as Partial<Backup>;
  if (b?.format !== "prompter-backup") throw new Error("To nie jest kopia biblioteki promptera.");
  if (b.version !== 1) throw new Error(`Nieobsługiwana wersja kopii: ${String(b.version)}.`);
  if (!Array.isArray(b.scripts)) throw new Error("Kopia nie zawiera listy tekstów.");
  const bad = b.scripts.findIndex((s) => !isScript(s));
  if (bad >= 0) throw new Error(`Tekst nr ${bad + 1} w kopii ma niepoprawny format.`);
  let settings: Settings | null = null;
  if (b.settings !== undefined) {
    settings = normalizeSettings(b.settings);
    if (!settings) throw new Error("Ustawienia w kopii mają niepoprawny format.");
  }
  return { scripts: b.scripts.map((s) => ({ ...s, lastWord: Math.max(0, Math.floor(s.lastWord)) })), settings };
}

export interface MergeResult {
  toWrite: Script[];
  added: number;
  updated: number;
  unchanged: number;
}

/** Scalanie z biblioteką: nowe teksty są dodawane, istniejące nadpisywane tylko nowszą wersją (updatedAt). */
export function mergeScripts(existing: readonly Script[], incoming: readonly Script[]): MergeResult {
  const byId = new Map(existing.map((s) => [s.id, s]));
  const result: MergeResult = { toWrite: [], added: 0, updated: 0, unchanged: 0 };
  for (const s of incoming) {
    const cur = byId.get(s.id);
    if (!cur) {
      result.toWrite.push(s);
      result.added++;
    } else if (s.updatedAt > cur.updatedAt) {
      result.toWrite.push(s);
      result.updated++;
    } else {
      result.unchanged++;
    }
  }
  return result;
}

/**
 * Wersja otwartego w edytorze tekstu, którą import zapisał do bazy; null, gdy import go nie zmienił.
 * Edytor musi ją wczytać, bo inaczej najbliższy zapis nadpisze import starą treścią z formularza.
 */
export function importedVersionOf(openId: string | undefined, toWrite: readonly Script[]): Script | null {
  if (openId === undefined) return null;
  const s = toWrite.find((x) => x.id === openId);
  return s ? { ...s } : null;
}

/** Nazwa pliku bezpieczna w systemach plików, z polskimi literami. */
export function safeFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned.length > 0 ? cleaned : "tekst";
}
