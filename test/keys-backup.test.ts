import { describe, expect, it } from "vitest";
import { makeBackup, mergeScripts, parseBackup, parseBackupFile, safeFileName } from "../src/app/backup";
import { DEFAULT_SETTINGS } from "../src/app/settings";
import { assignKey, defaultKeysFor, keyId, keyLabel, resolveCommand, unassignKey } from "../src/app/keys";
import type { Script } from "../src/app/storage";

describe("klawisze", () => {
  it("keyId używa code, gdy key jest nieznany", () => {
    expect(keyId({ key: "PageDown", code: "PageDown" })).toBe("PageDown");
    expect(keyId({ key: "Unidentified", code: "F13" })).toBe("code:F13");
    expect(keyId({ key: "", code: "KeyX" })).toBe("code:KeyX");
  });

  it("własne przypisanie ma pierwszeństwo przed domyślnym", () => {
    expect(resolveCommand("PageDown", {})).toBe("nextParagraph");
    expect(resolveCommand("PageDown", { PageDown: "toggle" })).toBe("toggle");
    expect(resolveCommand("x", {})).toBeNull();
  });

  it("assign i unassign nie modyfikują wejścia", () => {
    const m0 = {};
    const m1 = assignKey(m0, "code:F13", "toggle");
    const m2 = assignKey(m1, "code:F13", "faster");
    expect(m0).toEqual({});
    expect(m2).toEqual({ "code:F13": "faster" });
    expect(unassignKey(m2, "code:F13")).toEqual({});
    expect(m2).toEqual({ "code:F13": "faster" });
  });

  it("etykiety i domyślne klawisze", () => {
    expect(keyLabel(" ")).toBe("Spacja");
    expect(keyLabel("code:F13")).toBe("F13");
    expect(defaultKeysFor("nextParagraph")).toEqual(["PageDown"]);
  });
});

const s = (id: string, updatedAt: number, body = "tekst"): Script => ({
  id,
  title: id,
  body,
  createdAt: 1,
  updatedAt,
  lastWord: 0,
});

describe("kopia biblioteki", () => {
  it("makeBackup → JSON → parseBackup zachowuje teksty", () => {
    const list = [s("a", 5), s("b", 7, "Zażółć gęślą jaźń.")];
    expect(parseBackup(JSON.stringify(makeBackup(list, 123)))).toEqual(list);
  });

  it("parseBackup odrzuca błędne pliki z komunikatem", () => {
    expect(() => parseBackup("{")).toThrow("JSON");
    expect(() => parseBackup('{"format":"x"}')).toThrow("kopia");
    expect(() => parseBackup('{"format":"prompter-backup","version":2,"scripts":[]}')).toThrow("wersja");
    expect(() => parseBackup('{"format":"prompter-backup","version":1}')).toThrow("listy");
    expect(() => parseBackup('{"format":"prompter-backup","version":1,"scripts":[{"id":"a"}]}')).toThrow("nr 1");
  });

  it("kopia z ustawieniami: eksport i import zachowują ustawienia i teksty", () => {
    const settings = { ...DEFAULT_SETTINGS, wpmA: 173, theme: "light" as const, keyMap: { "key:KeyQ": "toggle" as const } };
    const r = parseBackupFile(JSON.stringify(makeBackup([s("a", 1)], 0, settings)));
    expect(r.settings).toEqual(settings);
    expect(r.scripts.map((x) => x.id)).toEqual(["a"]);
  });

  it("starsza kopia bez ustawień: teksty wczytane, ustawienia null", () => {
    const r = parseBackupFile(JSON.stringify(makeBackup([s("a", 1)], 0)));
    expect(r.settings).toBeNull();
    expect(r.scripts).toHaveLength(1);
  });

  it("brakujące pola ustawień uzupełnia domyślnymi, zła wersja ustawień to błąd", () => {
    const text = (settings: unknown) => JSON.stringify({ format: "prompter-backup", version: 1, exportedAt: 0, settings, scripts: [] });
    expect(parseBackupFile(text({ version: 1, wpmA: 200 })).settings).toEqual({ ...DEFAULT_SETTINGS, wpmA: 200 });
    expect(() => parseBackupFile(text({ version: 2 }))).toThrow("Ustawienia");
    expect(() => parseBackupFile(text("x"))).toThrow("Ustawienia");
  });

  it("parseBackup normalizuje lastWord", () => {
    const b = makeBackup([{ ...s("a", 1), lastWord: -3.7 }], 0);
    expect(parseBackup(JSON.stringify(b))[0]!.lastWord).toBe(0);
  });

  it("mergeScripts: nowe dodaje, starsze pomija, nowsze nadpisuje", () => {
    const r = mergeScripts([s("a", 10), s("b", 10)], [s("a", 5), s("b", 20), s("c", 1)]);
    expect(r.toWrite.map((x) => x.id)).toEqual(["b", "c"]);
    expect([r.added, r.updated, r.unchanged]).toEqual([1, 1, 1]);
  });

  it("safeFileName usuwa znaki niedozwolone, zostawia polskie litery", () => {
    expect(safeFileName('Wywiad: "część" 1/2')).toBe("Wywiad część 1 2");
    expect(safeFileName("  ")).toBe("tekst");
  });
});
