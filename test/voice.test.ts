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
  /** Lektor 150 sł./min; wyniki co 500–900 ms paczkami, z opóźnieniem 700–1300 ms (deterministycznie). */
  function simulate(f: VoiceFollower, untilMs: number, stopSpeakingAt = Infinity, longGaps = false) {
    const rate = 150 / 60000;
    const spokenAt = (t: number) => Math.min(t, stopSpeakingAt) * rate;
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    let nextResult = 600;
    let p = 0;
    const out: { t: number; p: number; spoken: number }[] = [];
    for (let t = 0; t <= untilMs; t += 16) {
      if (t >= nextResult) {
        const latency = 700 + rnd() * 600;
        const heard = Math.floor(spokenAt(Math.max(0, t - latency)));
        // W ciszy rozpoznawanie nie zwraca nowych wyników (ostatni przychodzi z opóźnieniem).
        if (heard > 0 && t - latency <= stopSpeakingAt) f.setTarget(heard, t);
        // longGaps: co trzeci wynik spóźniony do 1,2–1,6 s (nieregularne paczki usługi).
        nextResult = t + (longGaps && rnd() < 0.33 ? 1200 + rnd() * 400 : 500 + rnd() * 400);
      }
      p = f.tick(t, p);
      out.push({ t, p, spoken: spokenAt(t) });
    }
    return out;
  }

  it("płynnie: wyniki paczkami nie dają przeskoków", () => {
    const f = new VoiceFollower({ latencyMs: 1000 });
    f.reset(0, 0, 150 / 60000);
    const run = simulate(f, 30000);
    let maxStep = 0;
    for (let k = 1; k < run.length; k++) maxStep = Math.max(maxStep, run[k]!.p - run[k - 1]!.p);
    // 150 sł./min to 0,04 słowa na klatkę 16 ms; limit przyspieszenia 1,8×.
    expect(maxStep).toBeLessThan(0.08);
  });

  it("nieregularne wyniki w trakcie mowy nie cofają tekstu i nie dają przeskoków", () => {
    const f = new VoiceFollower({ latencyMs: 1000 });
    f.reset(0, 0, 150 / 60000);
    const run = simulate(f, 30000, Infinity, true);
    let maxStep = 0;
    let minStep = 0;
    for (let k = 1; k < run.length; k++) {
      maxStep = Math.max(maxStep, run[k]!.p - run[k - 1]!.p);
      minStep = Math.min(minStep, run[k]!.p - run[k - 1]!.p);
    }
    expect(maxStep).toBeLessThan(0.08);
    expect(minStep).toBe(0);
  });

  it("nadąża za lektorem: po rozbiegu średnio mniej niż 1 słowo różnicy", () => {
    const f = new VoiceFollower({ latencyMs: 1000 });
    f.reset(0, 0, 150 / 60000);
    const run = simulate(f, 30000).filter((r) => r.t > 5000);
    const mean = run.reduce((a, r) => a + Math.abs(r.spoken - r.p), 0) / run.length;
    const worst = Math.max(...run.map((r) => Math.abs(r.spoken - r.p)));
    expect(mean).toBeLessThan(1);
    expect(worst).toBeLessThan(2);
  });

  it("przy ciszy tekst dojeżdża i staje", () => {
    const f = new VoiceFollower({ latencyMs: 1000 });
    f.reset(0, 0, 150 / 60000);
    const run = simulate(f, 26000, 10000);
    const at = (t: number) => run.find((r) => r.t >= t)!.p;
    expect(at(25000)).toBe(at(20000));
    // Po ciszy tekst wraca łagodnie do ostatniego wyniku (lektor skończył na 25. słowie; ostatni
    // wynik w symulacji obejmuje 23–24 słowa, bo przychodzi z opóźnieniem 0,7–1,3 s).
    expect(Math.abs(at(25000) - 10000 * (150 / 60000))).toBeLessThan(2);
    let minStep = 0;
    for (let k = 1; k < run.length; k++) minStep = Math.min(minStep, run[k]!.p - run[k - 1]!.p);
    expect(minStep).toBeGreaterThan(-0.08);
  });

  it("przed pierwszym wynikiem tekst stoi; drobne cofnięcia nie cofają tekstu", () => {
    const f = new VoiceFollower();
    f.reset(5, 0, 0.0025);
    let p = 5;
    for (let t = 0; t <= 2000; t += 16) p = f.tick(t, p);
    expect(p).toBe(5);
    f.setTarget(8, 2000);
    for (let t = 2016; t <= 2600; t += 16) p = f.tick(t, p);
    const before = p;
    f.setTarget(6, 2600);
    for (let t = 2616; t <= 3200; t += 16) p = f.tick(t, p);
    expect(p).toBeGreaterThanOrEqual(before);
  });

  it("duży skok lektora przestawia tekst od razu", () => {
    const f = new VoiceFollower({ snapSlots: 12 });
    f.reset(10, 0);
    f.setTarget(11, 100);
    f.setTarget(40, 300);
    expect(f.tick(316, 10)).toBeGreaterThanOrEqual(40);
    f.setTarget(5, 400);
    const back = f.tick(416, 40);
    expect(back).toBeGreaterThanOrEqual(5);
    expect(back).toBeLessThan(6);
  });

  it("measuredRate: null przed pomiarem (bez tempa startowego), potem tempo z wyników", () => {
    const f = new VoiceFollower();
    f.reset(0, 0, 140 / 60000);
    expect(f.measuredRate(0)).toBeNull();
    expect(f.rate(0)).toBeCloseTo(140 / 60000);
    // Tempo liczone zegarem mowy, który biegnie w klatkach (tick).
    let p = 0;
    for (let t = 0; t <= 3000; t += 16) {
      if (t === 1008) {
        f.setTarget(2, t);
        expect(f.measuredRate(t)).toBeNull();
      }
      if (t === 2000) f.setTarget(4, t);
      p = f.tick(t, p);
    }
    f.setTarget(7, 3008);
    // 5 słów w 2 s = 150 sł./min
    expect(f.measuredRate(3008)! * 60000).toBeCloseTo(150, 0);
  });
});
