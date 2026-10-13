import { describe, expect, it } from "vitest";
import { PlaybackClock } from "../src/core/clock";
import { nextParagraph, nextSentence, previousSentence } from "../src/core/navigation";
import { buildSchedule, remainingMs, tokenFraction, tokenIndexAt } from "../src/core/schedule";
import { columnOffset, scrollY } from "../src/core/scroll";
import { tokenize } from "../src/core/tokenizer";

describe("buildSchedule", () => {
  it("normalizuje wagi do średniej 1, więc S[N] = N", () => {
    const t = tokenize("Pierwsze zdanie, z przecinkiem. Drugie zdanie.\n\nNowy akapit");
    const s = buildSchedule(t);
    expect(s.length).toBe(t.length + 1);
    expect(s[t.length]!).toBeCloseTo(t.length, 10);
    for (let i = 0; i < t.length; i++) expect(s[i + 1]!).toBeGreaterThan(s[i]!);
  });

  it("czas całości przy V WPM to N × 60000 / V", () => {
    const t = tokenize("jeden dwa trzy cztery pięć sześć siedem osiem dziewięć dziesięć");
    const s = buildSchedule(t);
    expect(remainingMs(s, 0, 150)).toBeCloseTo((10 * 60000) / 150, 6);
  });

  it("tokenIndexAt i tokenFraction", () => {
    const s = new Float64Array([0, 1, 3, 4]);
    expect(tokenIndexAt(s, 0)).toBe(0);
    expect(tokenIndexAt(s, 0.99)).toBe(0);
    expect(tokenIndexAt(s, 1)).toBe(1);
    expect(tokenIndexAt(s, 2.5)).toBe(1);
    expect(tokenIndexAt(s, 10)).toBe(2);
    expect(tokenFraction(s, 1, 2)).toBeCloseTo(0.5);
    expect(tokenIndexAt(new Float64Array([0]), 0)).toBe(-1);
  });
});

describe("PlaybackClock", () => {
  const noRamp = { rampMs: 0 };

  it("przesuwa p o dt × V / 60000", () => {
    const c = new PlaybackClock(100, { wpm: 120, ...noRamp });
    c.play(0);
    for (let t = 16; t <= 1000; t += 16) c.tick(t);
    c.tick(1000);
    // 120 WPM = 2 sloty na sekundę.
    expect(c.p).toBeCloseTo(2, 6);
  });

  it("tempo nie zależy od liczby klatek (N-05)", () => {
    const a = new PlaybackClock(100, { wpm: 300, ...noRamp });
    const b = new PlaybackClock(100, { wpm: 300, ...noRamp });
    a.play(0);
    b.play(0);
    for (let t = 0; t <= 3000; t += 8) a.tick(t);
    for (let t = 0; t <= 3000; t += 50) b.tick(t);
    expect(a.p).toBeCloseTo(b.p, 6);
    expect(a.p).toBeCloseTo(15, 6);
  });

  it("ogranicza krok po zamrożeniu karty do 100 ms", () => {
    const c = new PlaybackClock(100, { wpm: 600, ...noRamp });
    c.play(0);
    c.tick(5000);
    expect(c.p).toBeCloseTo((100 * 600) / 60000, 6);
  });

  it("zmiana WPM nie zmienia p (F-06)", () => {
    const c = new PlaybackClock(100, { wpm: 120, ...noRamp });
    c.play(0);
    c.tick(100);
    const before = c.p;
    c.setWpm(600);
    expect(c.p).toBe(before);
    c.tick(200);
    expect(c.p - before).toBeCloseTo((100 * 600) / 60000, 6);
  });

  it("rozbieg od 50% do 100% przez 2 s (F-13)", () => {
    const c = new PlaybackClock(100, { wpm: 60 });
    c.play(0);
    expect(c.rampFactor(0)).toBeCloseTo(0.5);
    expect(c.rampFactor(1000)).toBeCloseTo(0.75);
    expect(c.rampFactor(5000)).toBeCloseTo(1);
  });

  it("pauza zamraża p, koniec tekstu przechodzi w finished", () => {
    const c = new PlaybackClock(1, { wpm: 60, ...noRamp });
    c.play(0);
    c.tick(50);
    c.pause();
    const frozen = c.p;
    c.tick(5000);
    expect(c.p).toBe(frozen);
    c.play(6000);
    for (let t = 6000; t <= 8000; t += 50) c.tick(t);
    expect(c.p).toBe(1);
    expect(c.state).toBe("finished");
  });

  it("ogranicza WPM do zakresu 50–1000", () => {
    const c = new PlaybackClock(10, { wpm: 5 });
    expect(c.wpm).toBe(50);
    c.setWpm(5000);
    expect(c.wpm).toBe(1000);
  });
});

describe("nawigacja (F-11)", () => {
  const t = tokenize("Raz dwa trzy. Cztery pięć sześć.\n\nSiedem osiem.");
  const s = buildSchedule(t);

  it("cofa do początku bieżącego zdania", () => {
    expect(previousSentence(t, s, s[5]! + 0.1)).toBe(s[3]);
  });
  it("tuż po początku zdania cofa do poprzedniego", () => {
    expect(previousSentence(t, s, s[3]! + 0.2)).toBe(s[0]);
  });
  it("przeskakuje do następnego zdania i akapitu", () => {
    expect(nextSentence(t, s, s[0]!)).toBe(s[3]);
    expect(nextParagraph(t, s, s[0]!)).toBe(s[6]);
  });
});

describe("scrollY (6.5)", () => {
  // Dwa wiersze po 2 słowa, każde słowo 1 slot.
  const s = new Float64Array([0, 1, 2, 3, 4]);
  const lines = [
    { y: 0, firstToken: 0, lastToken: 1 },
    { y: 40, firstToken: 2, lastToken: 3 },
  ];
  it("interpoluje liniowo wewnątrz wiersza", () => {
    expect(scrollY(lines, s, 0, 40)).toBe(0);
    expect(scrollY(lines, s, 1, 40)).toBe(20);
    expect(scrollY(lines, s, 2, 40)).toBe(40);
    expect(scrollY(lines, s, 3, 40)).toBe(60);
    expect(scrollY(lines, s, 4, 40)).toBe(80);
  });
  it("przesunięcie kolumny", () => {
    expect(columnOffset(300, 60, 40)).toBe(220);
  });
});
