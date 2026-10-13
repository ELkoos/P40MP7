import type { Script } from "./storage";

/** Kopia biblioteki tekstów (E1). Plik JSON bez danych spoza aplikacji. */
export interface Backup {
  format: "prompter-backup";
  version: 1;
  exportedAt: number;
  scripts: Script[];
}

export function makeBackup(scripts: readonly Script[], now: number): Backup {
  return { format: "prompter-backup", version: 1, exportedAt: now, scripts: scripts.map((s) => ({ ...s })) };
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
  return b.scripts.map((s) => ({ ...s, lastWord: Math.max(0, Math.floor(s.lastWord)) }));
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

/** Nazwa pliku bezpieczna w systemach plików, z polskimi literami. */
export function safeFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned.length > 0 ? cleaned : "tekst";
}
