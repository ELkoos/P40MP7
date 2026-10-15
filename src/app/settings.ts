import { COMMAND_LABELS, type Command, type KeyMap } from "./keys";
import { WPM_MAX, WPM_MIN } from "../core/defaults";
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
  /** Własne przypisania klawiszy, np. z trybu uczenia pilota (E4). */
  keyMap: KeyMap;
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
  /** Podążanie za głosem (Q4): pozycję wyznacza rozpoznawanie mowy zamiast prędkości. Wymaga sieci. */
  followVoice: boolean;
  /** Język rozpoznawania, znacznik BCP 47. */
  voiceLang: string;
  /** Kompensacja opóźnienia rozpoznawania mowy, ms [H]: o tyle tekst wyprzedza ostatni rozpoznany wynik. */
  voiceLatencyMs: number;
  /** Podgląd diagnostyczny podążania za głosem i zapis logu do pliku. */
  voiceDebug: boolean;
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
  followVoice: false,
  voiceLang: "pl-PL",
  voiceLatencyMs: 1000,
  voiceDebug: false,
};

/** Języki rozpoznawania mowy do wyboru w ustawieniach. */
export const VOICE_LANGS: readonly (readonly [string, string])[] = [
  ["pl-PL", "polski"],
  ["en-US", "angielski (USA)"],
  ["en-GB", "angielski (Wielka Brytania)"],
  ["de-DE", "niemiecki"],
  ["uk-UA", "ukraiński"],
];

export const FONT_STACKS: Record<FontChoice, string> = {
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return normalizeSettings(JSON.parse(raw)) ?? { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Ustawienia z zapisu (localStorage, plik kopii) uzupełnione domyślnymi; null, gdy to nie są ustawienia v1. */
export function normalizeSettings(data: unknown): Settings | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const v = data as Record<string, unknown>;
  if (v.version !== 1) return null;
  const d = DEFAULT_SETTINGS;
  // Każde pole sprawdzane osobno: zły typ lub wartość spoza listy → domyślna, liczba spoza zakresu → przycięta
  // do zakresu z panelu ustawień. Plik może być edytowany ręcznie albo pochodzić z innej wersji.
  const num = (k: keyof Settings, min: number, max: number): number => {
    const x = v[k];
    return typeof x === "number" && Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : (d[k] as number);
  };
  const bool = (k: keyof Settings): boolean => (typeof v[k] === "boolean" ? (v[k] as boolean) : (d[k] as boolean));
  const str = (k: keyof Settings): string => (typeof v[k] === "string" ? (v[k] as string) : (d[k] as string));
  const oneOf = <T>(k: keyof Settings, allowed: readonly T[]): T => (allowed.includes(v[k] as T) ? (v[k] as T) : (d[k] as T));
  return {
    version: 1,
    mode: oneOf<Mode>("mode", ["A", "B"]),
    wpmA: num("wpmA", WPM_MIN, WPM_MAX),
    wpmB: num("wpmB", WPM_MIN, WPM_MAX),
    focusPct: num("focusPct", 10, 90),
    fontSizePx: v.fontSizePx === null ? null : typeof v.fontSizePx === "number" && Number.isFinite(v.fontSizePx) ? Math.min(160, Math.max(16, v.fontSizePx)) : d.fontSizePx,
    lineHeight: num("lineHeight", 1.1, 2),
    columnCh: num("columnCh", 20, 100),
    font: oneOf<FontChoice>("font", ["sans", "serif", "mono"]),
    theme: oneOf<Theme>("theme", ["dark", "light"]),
    countdownS: num("countdownS", 0, 10),
    rampMs: num("rampMs", 0, 5000),
    showNext: bool("showNext"),
    keyMap: normalizeKeyMap(v.keyMap),
    anchorPct: num("anchorPct", 0, 100),
    record: bool("record"),
    cameraEdge: oneOf<CameraEdge>("cameraEdge", ["top", "left", "right"]),
    recFocusPct: num("recFocusPct", 3, 40),
    recSideAnchorPct: num("recSideAnchorPct", 10, 50),
    recColumnCh: num("recColumnCh", 12, 60),
    recHeight: oneOf<720 | 1080>("recHeight", [720, 1080]),
    cameraId: str("cameraId"),
    micId: str("micId"),
    recAutoStart: bool("recAutoStart"),
    recPreviewWhilePlaying: bool("recPreviewWhilePlaying"),
    mirrorPreview: bool("mirrorPreview"),
    followVoice: bool("followVoice"),
    voiceLang: oneOf<string>("voiceLang", VOICE_LANGS.map(([code]) => code)),
    voiceLatencyMs: num("voiceLatencyMs", 0, 2500),
    voiceDebug: bool("voiceDebug"),
  };
}

/** Tylko przypisania klawisz → znana komenda. */
function normalizeKeyMap(x: unknown): KeyMap {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return {};
  const out: KeyMap = {};
  for (const [key, cmd] of Object.entries(x)) {
    if (key === "__proto__") continue;
    if (typeof cmd === "string" && Object.prototype.hasOwnProperty.call(COMMAND_LABELS, cmd)) out[key] = cmd as Command;
  }
  return out;
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
