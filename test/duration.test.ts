import { describe, expect, it } from "vitest";
import { durationFromParts } from "../src/app/duration";

describe("durationFromParts", () => {
  it("minuty i sekundy", () => {
    expect(durationFromParts("3", "30")).toBe(210_000);
    expect(durationFromParts(" 0 ", "45")).toBe(45_000);
  });
  it("puste pole = 0", () => {
    expect(durationFromParts("2", "")).toBe(120_000);
    expect(durationFromParts("", "50")).toBe(50_000);
  });
  it("odrzuca błędne wartości", () => {
    expect(durationFromParts("", "")).toBeNull();
    expect(durationFromParts("0", "0")).toBeNull();
    expect(durationFromParts("1", "60")).toBeNull();
    expect(durationFromParts("1.5", "")).toBeNull();
    expect(durationFromParts("-1", "")).toBeNull();
  });
});
