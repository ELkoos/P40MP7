import type { Token } from "./types";

/**
 * Pozycje skumulowane w slotach (6.2): S[0] = 0, S[i+1] = S[i] + w_i / w̄.
 * Długość N+1; S[N] to koniec tekstu. Niezależne od WPM.
 */
export function buildSchedule(tokens: readonly Token[]): Float64Array {
  const n = tokens.length;
  const s = new Float64Array(n + 1);
  if (n === 0) return s;
  let sum = 0;
  for (const t of tokens) sum += t.weight;
  const mean = sum / n;
  for (let i = 0; i < n; i++) s[i + 1] = s[i]! + tokens[i]!.weight / mean;
  return s;
}

/** Największe i z S[i] <= p, ograniczone do [0, N-1]; -1 dla pustego tekstu. */
export function tokenIndexAt(schedule: Float64Array, p: number): number {
  const n = schedule.length - 1;
  if (n <= 0) return -1;
  if (p <= 0) return 0;
  if (p >= schedule[n]!) return n - 1;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (schedule[mid]! <= p) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Ułamek bieżącego tokenu, 0..1. */
export function tokenFraction(schedule: Float64Array, i: number, p: number): number {
  const a = schedule[i]!;
  const b = schedule[i + 1]!;
  if (b <= a) return 0;
  return Math.min(1, Math.max(0, (p - a) / (b - a)));
}

/** Czas do końca w ms przy danym WPM (F-22). */
export function remainingMs(schedule: Float64Array, p: number, wpm: number): number {
  const end = schedule[schedule.length - 1]!;
  return (Math.max(0, end - p) * 60000) / wpm;
}

/**
 * Prędkość (WPM), przy której tekst od pozycji p do końca zajmie targetMs (F-22 odwrócone).
 * Uwzględnia stratę czasu na jeden rozbieg: (1 − rampFrom) × rampMs / 2, przy założeniu, że rozbieg kończy się przed końcem tekstu.
 * Wynik nie jest przycinany do WPM_MIN–WPM_MAX; Infinity, gdy targetMs nie starcza nawet na rozbieg.
 */
export function wpmForDuration(schedule: Float64Array, p: number, targetMs: number, rampMs = 0, rampFrom = 1): number {
  const end = schedule[schedule.length - 1]!;
  const slots = Math.max(0, end - p);
  const fullSpeedMs = targetMs - ((1 - rampFrom) * rampMs) / 2;
  if (fullSpeedMs <= 0) return Number.POSITIVE_INFINITY;
  return (slots * 60000) / fullSpeedMs;
}

/** Indeks pierwszego tokenu należącego do danego słowa źródłowego (zmiana trybu, 4). */
export function tokenIndexOfWord(tokens: readonly { sourceWord: number }[], word: number): number {
  let lo = 0;
  let hi = tokens.length - 1;
  if (hi < 0) return -1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (tokens[mid]!.sourceWord < word) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
