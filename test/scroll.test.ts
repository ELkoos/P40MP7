import { describe, expect, it } from "vitest";
import { easeToward, lineStepY, type MeasuredLine } from "../src/core";

describe("przesuw o wiersz przy głosie", () => {
  // Dwa wiersze po 3 słowa, każde słowo 1 slot.
  const schedule = Float64Array.from([0, 1, 2, 3, 4, 5, 6]);
  const lines: MeasuredLine[] = [
    { y: 0, firstToken: 0, lastToken: 2 },
    { y: 40, firstToken: 3, lastToken: 5 },
  ];

  it("wiersz stoi przez cały czas czytania, także na ostatnim słowie", () => {
    expect(lineStepY(lines, schedule, 0)).toBe(0);
    expect(lineStepY(lines, schedule, 2.9)).toBe(0);
    expect(lineStepY(lines, schedule, 3)).toBe(40);
    expect(lineStepY(lines, schedule, 99)).toBe(40);
  });

  it("dojście do celu kończy się w ~3 stałe czasowe", () => {
    let y = 0;
    for (let t = 0; t < 150; t += 16) y = easeToward(y, 40, 16, 50);
    expect(y).toBeGreaterThan(38);
    for (let t = 0; t < 200; t += 16) y = easeToward(y, 40, 16, 50);
    expect(y).toBe(40);
    expect(easeToward(5, 40, 0, 50)).toBe(5);
  });
});
