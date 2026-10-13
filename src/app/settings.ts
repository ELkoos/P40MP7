import type { CameraEdge } from "../core/recording";

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
  /** Środek kolumny (A) lub punkt ORP (B), % szerokości ekranu. Bez nagrywania 50. */
  anchorPct: number;

  // Nagrywanie wideo (src/app/recorder.ts).
  record: boolean;
  /** Gdzie jest kamera względem ekranu; tekst ustawiany jak najbliżej niej. */
  cameraEdge: CameraEdge;
  /** Kamera u góry: punkt odczytu od góry, % wysokości. */
  recFocusPct: number;
  /** Kamera z boku: środek kolumny od tej krawędzi, % szerokości. */
  recSideAnchorPct: number;
  /** Węższa kolumna przy nagrywaniu: mniejszy ruch oczu na boki. */
  recColumnCh: number;
  recHeight: 720 | 1080;
  /** "" = domyślne urządzenie. */
  cameraId: string;
  micId: string;
  /** Nagrywanie startuje z odliczaniem i kończy się chwilę po końcu tekstu. */
  recAutoStart: boolean;
  /** Podgląd kamery także w trakcie czytania (domyślnie tylko w pauzie). */
  recPreviewWhilePlaying: boolean;
  /** Podgląd jak w lustrze; zapisany plik nigdy nie jest odbity. */
  mirrorPreview: boolean;
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
  anchorPct: 50,
  record: false,
  cameraEdge: "top",
  recFocusPct: 10,
  recSideAnchorPct: 25,
  recColumnCh: 24,
  recHeight: 1080,
  cameraId: "",
  micId: "",
  recAutoStart: true,
  recPreviewWhilePlaying: false,
  mirrorPreview: true,
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
    return { ...DEFAULT_SETTINGS, ...parsed };
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
