import type { KeyMap } from "./keys";

export type Mode = "A" | "B";
export type Theme = "dark" | "light";
export type FontChoice = "sans" | "serif" | "mono";

/** Ustawienia (sekcja 7 dokumentu). Zapisywane w localStorage pod kluczem SETTINGS_KEY. */
export interface Settings {
  version: 1;
  mode: Mode;
  wpmA: number;
  wpmB: number;
  /** Pozycja punktu odczytu od góry, % wysokości ekranu. */
  focusPct: number;
  /** null = automatycznie: 48 px na szerokim ekranie, 32 px na wąskim. */
  fontSizePx: number | null;
  lineHeight: number;
  columnCh: number;
  font: FontChoice;
  theme: Theme;
  countdownS: number;
  rampMs: number;
  /** Tryb B: podgląd następnego słowa. */
  showNext: boolean;
  /** Własne przypisania klawiszy, np. z trybu uczenia pilota (E4). */
  keyMap: KeyMap;
}

export const SETTINGS_KEY = "prompter.settings";

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  mode: "A",
  wpmA: 140,
  wpmB: 250,
  focusPct: 30,
  fontSizePx: null,
  lineHeight: 1.4,
  columnCh: 60,
  font: "sans",
  theme: "dark",
  countdownS: 3,
  rampMs: 2000,
  showNext: false,
  keyMap: {},
};

export const FONT_STACKS: Record<FontChoice, string> = {
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    if (parsed.version !== 1) return { ...DEFAULT_SETTINGS };
    const keyMap = typeof parsed.keyMap === "object" && parsed.keyMap !== null ? parsed.keyMap : {};
    return { ...DEFAULT_SETTINGS, ...parsed, keyMap };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // Brak dostępu do localStorage (np. tryb prywatny): ustawienia działają do zamknięcia karty.
  }
}

export function effectiveFontSize(s: Settings): number {
  if (s.fontSizePx !== null) return s.fontSizePx;
  return window.innerWidth < 700 ? 32 : 48;
}

export function wpmFor(s: Settings): number {
  return s.mode === "A" ? s.wpmA : s.wpmB;
}
