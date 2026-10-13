import { describe, expect, it } from "vitest";
import { tokenize } from "../src/core/tokenizer";
import { VoiceFollower, VoiceMatcher, normalizeWord, wordSimilarity } from "../src/core/voice";

const TEXT = `Dzień dobry, nazywam się Jan Kowalski i przygotowałem krótkie wystąpienie.
Najpierw opowiem o tym, jak powstał projekt. Potem pokażę wyniki pomiarów.

Na koniec odpowiem na pytania z sali. Zaczynajmy od początku historii.`;

const words = tokenize(TEXT, { splitLongWords: false }).map((t) => t.text);
const idx = (w: string) => words.findIndex((x) => normalizeWord(x) === normalizeWord(w));

/** Symulacja wyników pośrednich: hipoteza rośnie o jedno słowo. */
function feed(m: VoiceMatcher, spoken: string[]): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 1; i <= spoken.length; i++) out.push(m.update(spoken.slice(0, i))?.word ?? null);
  return out;
}

describe("normalizeWord i wordSimilarity", () => {
  it("usuwa interpunkcję, wielkie litery i znaki diakrytyczne", () => {
    expect(normalizeWord("„Łódź,”")).toBe("lodz");
    expect(normalizeWord("Żółć!")).toBe("zolc");
    expect(normalizeWord("—")).toBe("");
  });

  it("podobieństwo Levenshteina", () => {
    expect(wordSimilarity("kowalski", "kowalski")).toBe(1);
    expect(wordSimilarity("kowalski", "kowalsky")).toBeCloseTo(7 / 8);
    expect(wordSimilarity("", "a")).toBe(0);
    expect(wordSimilarity("dom", "kot")).toBeCloseTo(1 / 3);
  });
});

describe("VoiceMatcher", () => {
  it("śledzi czytanie słowo po słowie od początku", () => {
    const m = new VoiceMatcher(words);
    const spoken = ["dzień", "dobry", "nazywam", "się", "jan", "kowalski"];
    const got = feed(m, spoken);
    // Pierwsze pewne słowo przy oczekiwanej pozycji wystarcza do startu.
    expect(got[0]).toBe(0);
    expect(got.slice(1)).toEqual([1, 2, 3, 4, 5]);
    expect(m.next).toBe(6);
  });

  it("toleruje błędy rozpoznania (zamienione i wtrącone słowa)", () => {
    const m = new VoiceMatcher(words);
    m.reset(idx("Najpierw"));
    const r = m.update(["najpierw", "opowiem", "o", "tym", "jaka", "powstał", "projekt"]);
    expect(r?.word).toBe(idx("projekt."));
    const r2 = m.update(["potem", "eee", "pokażę", "wyniki"]);
    expect(r2?.word).toBe(idx("wyniki"));
  });

  it("przeskakuje do przodu, gdy lektor pominie zdanie", () => {
    const m = new VoiceMatcher(words);
    m.reset(idx("Najpierw"));
    const r = m.update(["na", "koniec", "odpowiem", "na", "pytania"]);
    expect(r?.word).toBe(idx("pytania"));
  });

  it("nie kotwiczy się na krótkich słowach ani na jednym niepewnym słowie", () => {
    const m = new VoiceMatcher(words);
    m.reset(idx("Potem"));
    expect(m.update(["i", "na"])).toBeNull();
    expect(m.update(["sali"])).toBeNull();
    expect(m.next).toBe(idx("Potem"));
  });

  it("cofnięcie o więcej niż 2 słowa wymaga co najmniej 3 zgodnych słów", () => {
    const m = new VoiceMatcher(words);
    m.reset(idx("wyniki"));
    expect(m.update(["powstał", "projekt"])).toBeNull();
    const r = m.update(["jak", "powstał", "projekt"]);
    expect(r?.word).toBe(idx("projekt."));
  });

  it("zwraca null przy pustej hipotezie lub pustym tekście", () => {
    expect(new VoiceMatcher(words).update([])).toBeNull();
    expect(new VoiceMatcher([]).update(["coś"])).toBeNull();
  });
});

describe("VoiceFollower", () => {
  it("dąży płynnie do celu i nie przekracza go o więcej niż wyprzedzenie", () => {
    const f = new VoiceFollower({ tauMs: 100, maxLeadSlots: 1 });
    f.reset(0, 0);
    f.setTarget(3, 0);
    let p = 0;
    let prev = 0;
    for (let t = 0; t <= 2000; t += 16) {
      p = f.tick(t, p);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
    expect(p).toBeGreaterThan(2.9);
    expect(p).toBeLessThanOrEqual(4);
  });

  it("przy ciszy tekst stoi", () => {
    const f = new VoiceFollower({ tauMs: 100 });
    f.reset(5, 0);
    let p = 5;
    for (let t = 0; t <= 3000; t += 16) p = f.tick(t, p);
    expect(p).toBe(5);
  });

  it("ignoruje drobne cofnięcia celu, a duże skoki wykonuje od razu", () => {
    const f = new VoiceFollower({ tauMs: 100, snapSlots: 12, holdBackSlots: 2 });
    f.reset(10, 0);
    f.setTarget(9, 100);
    expect(f.tick(200, 10)).toBe(10);
    f.setTarget(40, 300);
    expect(f.tick(316, 10)).toBe(40);
  });

  it("kompensuje opóźnienie rozpoznawania: cel wyprzedza ostatni wynik o tempo × opóźnienie", () => {
    const f = new VoiceFollower({ latencyMs: 1000, maxExtraLeadSlots: 1, maxLeadSlots: 6 });
    f.reset(0, 0);
    f.setTarget(1, 400); // pierwszy wynik: bez pomiaru tempa
    f.setTarget(2, 800); // 1 slot / 400 ms
    expect(f.goal(800)).toBeCloseTo(2 + 2.5); // 1000 ms opóźnienia = 2,5 slotu
    expect(f.goal(1000)).toBeCloseTo(2 + 3); // + 200 ms od wyniku
    expect(f.goal(5000)).toBeCloseTo(2 + 3.5); // cisza: najwyżej 1 slot ponad kompensację
  });

  it("tempo startowe z ustawionej prędkości daje wyprzedzenie od pierwszego wyniku", () => {
    const f = new VoiceFollower({ latencyMs: 1000 });
    f.reset(0, 0, 150 / 60000); // 150 słów/min
    expect(f.goal(0)).toBe(0); // przed pierwszym wynikiem tekst stoi
    f.setTarget(3, 2000);
    expect(f.goal(2000)).toBeCloseTo(3 + 2.5);
  });

  it("wyprzedzenie ma twardy limit, a bez kompensacji zachowuje się jak dawniej", () => {
    const fast = new VoiceFollower({ latencyMs: 2500, maxLeadSlots: 4 });
    fast.reset(0, 0, 0.01);
    fast.setTarget(1, 100);
    expect(fast.goal(100)).toBeCloseTo(1 + 4);
    const none = new VoiceFollower({ latencyMs: 0, maxExtraLeadSlots: 1 });
    none.reset(0, 0);
    none.setTarget(1, 400);
    none.setTarget(2, 800);
    expect(none.goal(800)).toBeCloseTo(2);
    expect(none.goal(5000)).toBeCloseTo(3);
  });

  it("symulacja: lektor 150 sł./min, wyniki 1 s po słowie; tekst nadąża za lektorem", () => {
    const f = new VoiceFollower({ latencyMs: 1000 });
    const rate = 150 / 60000;
    f.reset(0, 0, rate);
    let p = 0;
    let worst = 0;
    for (let t = 0; t <= 20000; t += 16) {
      // Słowo k jest wypowiedziane w chwili k/rate; wynik przychodzi 1 s później, cel = k + 1.
      const recognized = Math.floor((t - 1000) * rate);
      if (recognized >= 0) f.setTarget(recognized + 1, t);
      p = f.tick(t, p);
      if (t > 3000) worst = Math.max(worst, t * rate - p);
    }
    // Bez kompensacji (stare ustawienia) zaległość wynosi ok. 2,1 słowa; z kompensacją poniżej 1 słowa.
    expect(worst).toBeLessThan(1);
  });
});
