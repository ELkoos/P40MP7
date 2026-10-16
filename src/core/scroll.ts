/** Wiersz zmierzony po ułożeniu tekstu w trybie A (6.5 pkt 2). */
export interface MeasuredLine {
  /** Górna krawędź wiersza w px względem kolumny. */
  y: number;
  firstToken: number;
  lastToken: number;
}

/**
 * Pionowa pozycja czytania y(p) w px (6.5 pkt 3): interpolacja wewnątrz wiersza proporcjonalnie
 * do postępu czytania jego słów, więc tekst płynie ze stałą prędkością zamiast skakać o wiersz.
 * `lineHeight` służy jako odległość do kolejnego wiersza dla ostatniego wiersza tekstu.
 */
export function scrollY(lines: readonly MeasuredLine[], schedule: Float64Array, p: number, lineHeight: number): number {
  if (lines.length === 0) return 0;
  let lo = 0;
  let hi = lines.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (schedule[lines[mid]!.firstToken]! <= p) lo = mid;
    else hi = mid - 1;
  }
  const line = lines[lo]!;
  const nextY = lines[lo + 1]?.y ?? line.y + lineHeight;
  const a = schedule[line.firstToken]!;
  const b = schedule[line.lastToken + 1]!;
  const f = b > a ? Math.min(1, Math.max(0, (p - a) / (b - a))) : 0;
  return line.y + (nextY - line.y) * f;
}

/** Przesunięcie kolumny: translateY(F − y(p) − h/2) (6.5 pkt 4). */
export function columnOffset(focusY: number, y: number, lineHeight: number): number {
  return focusY - y - lineHeight / 2;
}

/**
 * Pozycja czytania przy podążaniu za głosem: górna krawędź wiersza, w którym jest p, bez przesuwania wewnątrz wiersza.
 * Wiersz stoi na linii odczytu, dopóki lektor go czyta, a następny jest widoczny pod nim; przy płynnym przewijaniu
 * (scrollY) ostatnie słowa wiersza uciekały już nad linię odczytu, a początek następnego był jeszcze pod przyciemnieniem.
 */
export function lineStepY(lines: readonly MeasuredLine[], schedule: Float64Array, p: number): number {
  if (lines.length === 0) return 0;
  let lo = 0;
  let hi = lines.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (schedule[lines[mid]!.firstToken]! <= p) lo = mid;
    else hi = mid - 1;
  }
  return lines[lo]!.y;
}

/** Wygładzenie skoku o wiersz: wykładnicze dojście do celu ze stałą czasową tauMs (po 3·tau zostaje 5% drogi). */
export function easeToward(current: number, target: number, dtMs: number, tauMs: number): number {
  if (dtMs <= 0) return current;
  const next = current + (target - current) * (1 - Math.exp(-dtMs / tauMs));
  return Math.abs(target - next) < 0.5 ? target : next;
}
