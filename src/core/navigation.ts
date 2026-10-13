import { tokenIndexAt } from "./schedule";
import type { Token } from "./types";

/** Jeśli od początku zdania minęło mniej niż tyle slotów, cofamy do poprzedniego [H] (6.4). */
export const BACK_GRACE_SLOTS = 1;

/** Pozycja początku bieżącego zdania albo poprzedniego, gdy jesteśmy tuż po starcie bieżącego (F-11). */
export function previousSentence(tokens: readonly Token[], schedule: Float64Array, p: number): number {
  const i = tokenIndexAt(schedule, p);
  if (i < 0) return 0;
  const start = tokens[i]!.sentenceStart;
  if (p - schedule[start]! >= BACK_GRACE_SLOTS || start === 0) return schedule[start]!;
  return schedule[tokens[start - 1]!.sentenceStart]!;
}

export function nextSentence(tokens: readonly Token[], schedule: Float64Array, p: number): number {
  const i = tokenIndexAt(schedule, p);
  if (i < 0) return 0;
  for (let k = i + 1; k < tokens.length; k++) {
    if (tokens[k]!.sentenceStart === k) return schedule[k]!;
  }
  return schedule[tokens.length]!;
}

export function previousParagraph(tokens: readonly Token[], schedule: Float64Array, p: number): number {
  const i = tokenIndexAt(schedule, p);
  if (i < 0) return 0;
  const start = tokens[i]!.paragraphStart;
  if (p - schedule[start]! >= BACK_GRACE_SLOTS || start === 0) return schedule[start]!;
  return schedule[tokens[start - 1]!.paragraphStart]!;
}

export function nextParagraph(tokens: readonly Token[], schedule: Float64Array, p: number): number {
  const i = tokenIndexAt(schedule, p);
  if (i < 0) return 0;
  for (let k = i + 1; k < tokens.length; k++) {
    if (tokens[k]!.paragraphStart === k) return schedule[k]!;
  }
  return schedule[tokens.length]!;
}

/** Zakres tokenów [start, end] zdania zawierającego token i (podgląd kontekstu w trybie B). */
export function sentenceRange(tokens: readonly Token[], i: number): [number, number] {
  const start = tokens[i]!.sentenceStart;
  let end = i;
  while (end < tokens.length - 1 && tokens[end + 1]!.sentenceStart === start) end++;
  return [start, end];
}
