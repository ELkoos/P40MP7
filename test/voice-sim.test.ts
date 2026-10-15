import { describe, expect, it } from "vitest";
import { simulate } from "./sim/pipeline";

// Krok na klatkę 16 ms: 150 sł./min to 0,04 słowa; nadrabianie dużej straty najwyżej 3× tempa (0,12).
const MAX_STEP = 0.13;

// Cała ścieżka (hipotezy z błędami, restarty sesji, przerwa lektora) na kilku ziarnach i jakościach rozpoznawania.
const CASES = [11, 23, 47, 5, 99].flatMap((seed) => [0.8, 0.65].map((accuracy) => ({ seed, accuracy })));

describe("podążanie za głosem: symulacja całej ścieżki", () => {
  for (const c of CASES) {
    it(`bez detektora głosu (ziarno ${c.seed}, trafność ${c.accuracy})`, () => {
      const r = simulate(c);
      expect(r.backwardWhileSpeaking).toBe(0);
      expect(r.maxStep).toBeLessThan(MAX_STEP);
      expect(r.stopsWhileSpeaking).toBeLessThanOrEqual(3);
      expect(r.meanLag).toBeLessThan(2);
    });
    it(`z detektorem głosu (ziarno ${c.seed}, trafność ${c.accuracy})`, () => {
      const r = simulate(c, {}, true, 150);
      expect(r.backwardWhileSpeaking).toBe(0);
      expect(r.maxStep).toBeLessThan(MAX_STEP);
      expect(r.stopsWhileSpeaking).toBeLessThanOrEqual(1);
      expect(r.meanLag).toBeLessThan(1.2);
      expect(r.worstLag).toBeLessThan(6);
      // Przerwa lektora: tekst wyprzedza go najwyżej o kilka słów i nie wraca (cofanie tylko po większym wyprzedzeniu).
      expect(r.maxAhead).toBeLessThan(4);
      expect(r.backwardWords).toBeLessThan(0.5);
    });
  }
});
