import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, normalizeSettings } from "../src/app/settings";
import { parseBackupFile } from "../src/app/backup";

describe("ustawienia z pliku", () => {
  it("poprawne ustawienia przechodzą bez zmian", () => {
    const s = { ...DEFAULT_SETTINGS, mode: "B", wpmB: 320, theme: "light", fontSizePx: 64, keyMap: { "code:F13": "toggle" } };
    expect(normalizeSettings(s)).toEqual(s);
  });

  it("zły typ lub wartość spoza listy → domyślna", () => {
    const s = normalizeSettings({ version: 1, theme: "x", mode: "C", focusPct: null, wpmA: "200", font: 3, record: "tak", recHeight: 480, voiceLang: "fr-FR", fontSizePx: "duża" })!;
    expect(s.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(s.mode).toBe(DEFAULT_SETTINGS.mode);
    expect(s.focusPct).toBe(DEFAULT_SETTINGS.focusPct);
    expect(s.wpmA).toBe(DEFAULT_SETTINGS.wpmA);
    expect(s.font).toBe(DEFAULT_SETTINGS.font);
    expect(s.record).toBe(DEFAULT_SETTINGS.record);
    expect(s.recHeight).toBe(DEFAULT_SETTINGS.recHeight);
    expect(s.voiceLang).toBe(DEFAULT_SETTINGS.voiceLang);
    expect(s.fontSizePx).toBe(DEFAULT_SETTINGS.fontSizePx);
  });

  it("liczby spoza zakresu są przycinane, NaN i Infinity → domyślne", () => {
    const s = normalizeSettings({ version: 1, wpmA: 5000, focusPct: -3, countdownS: 99, fontSizePx: 4, rampMs: Number.NaN })!;
    expect(s.wpmA).toBe(1000);
    expect(s.focusPct).toBe(10);
    expect(s.countdownS).toBe(10);
    expect(s.fontSizePx).toBe(16);
    expect(s.rampMs).toBe(DEFAULT_SETTINGS.rampMs);
  });

  it("fontSizePx: null = automatycznie", () => {
    expect(normalizeSettings({ version: 1, fontSizePx: null })!.fontSizePx).toBeNull();
  });

  it("keyMap: tylko znane komendy, bez __proto__, nieznane pola pomijane", () => {
    const raw = JSON.parse('{"version":1,"extra":1,"keyMap":{"a":"toggle","b":"zrobKawe","c":5,"__proto__":"toggle"}}');
    const s = normalizeSettings(raw)!;
    expect(s.keyMap).toEqual({ a: "toggle" });
    expect(Object.getPrototypeOf(s.keyMap)).toBe(Object.prototype);
    expect("extra" in s).toBe(false);
  });

  it("inna wersja lub nie-obiekt → null; kopia z takimi ustawieniami jest odrzucana", () => {
    expect(normalizeSettings({ version: 2 })).toBeNull();
    expect(normalizeSettings([])).toBeNull();
    expect(() => parseBackupFile('{"format":"prompter-backup","version":1,"scripts":[],"settings":{"version":2}}')).toThrow("Ustawienia");
  });

  it("kopia z błędnymi polami wczytuje się z poprawionymi wartościami", () => {
    const { settings } = parseBackupFile('{"format":"prompter-backup","version":1,"scripts":[],"settings":{"version":1,"theme":"x","wpmA":140}}');
    expect(settings!.theme).toBe("dark");
    expect(settings!.wpmA).toBe(140);
  });
});
