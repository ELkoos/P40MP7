const LETTER = /[\p{L}\p{N}]/u;

/** Indeks litery ORP (0 = pierwsza litera) w zależności od liczby liter L [H], tabela 6.3. */
export function orpLetterIndex(letters: number): number {
  if (letters <= 1) return 0;
  if (letters <= 5) return 1;
  if (letters <= 9) return 2;
  if (letters <= 13) return 3;
  return 4;
}

/** Indeks znaku ORP w Array.from(text), z pominięciem interpunkcji; -1 gdy brak liter. */
export function orpCharIndex(text: string, letters: number): number {
  if (letters === 0) return -1;
  const target = orpLetterIndex(letters);
  const chars = Array.from(text);
  let seen = 0;
  for (let i = 0; i < chars.length; i++) {
    if (LETTER.test(chars[i]!)) {
      if (seen === target) return i;
      seen++;
    }
  }
  return -1;
}

/** Podział słowa na przedrostek, literę ORP i resztę, do renderera RSVP (6.6). */
export function splitAtOrp(text: string, orpIndex: number): { prefix: string; orp: string; suffix: string } {
  if (orpIndex < 0) return { prefix: text, orp: "", suffix: "" };
  const chars = Array.from(text);
  return {
    prefix: chars.slice(0, orpIndex).join(""),
    orp: chars[orpIndex] ?? "",
    suffix: chars.slice(orpIndex + 1).join(""),
  };
}

/** Lewa krawędź słowa tak, by środek litery ORP wypadł w anchorX (6.6 pkt 3). */
export function rsvpLeftEdge(anchorX: number, prefixWidth: number, orpWidth: number): number {
  return anchorX - prefixWidth - orpWidth / 2;
}
