/**
 * Czas docelowy z dwóch pól (minuty, sekundy) → ms. Pola przyjmują tylko cyfry,
 * bo klawiatura numeryczna na telefonie nie ma znaku „:”. Puste pole = 0.
 * null, gdy pole zawiera coś poza cyframi, sekundy > 59 albo łącznie 0.
 */
export function durationFromParts(minText: string, secText: string): number | null {
  const m = minText.trim();
  const s = secText.trim();
  if (!/^\d*$/.test(m) || !/^\d*$/.test(s)) return null;
  const min = m === "" ? 0 : Number(m);
  const sec = s === "" ? 0 : Number(s);
  if (sec > 59) return null;
  const ms = (min * 60 + sec) * 1000;
  return ms > 0 ? ms : null;
}
