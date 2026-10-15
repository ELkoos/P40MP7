import { describe, expect, it } from "vitest";
import { buildServiceWorker } from "../sw/build";
import { SW_TEMPLATE as template } from "../sw/template";

describe("sw.js z builda", () => {
  it("wstawia listę plików i wersję", () => {
    const out = buildServiceWorker(template, ["./assets/b-2.js", "./assets/a-1.js"]);
    expect(out).toContain('const ASSETS = ["./assets/a-1.js","./assets/b-2.js"];');
    expect(out).toMatch(/const VERSION = "[0-9a-f]{8}";/);
    expect(out).not.toContain('const VERSION = "dev"');
  });

  it("nowa wersja plików daje inny sw.js, ta sama lista ten sam", () => {
    const a = buildServiceWorker(template, ["./assets/index-AAA.js"]);
    expect(buildServiceWorker(template, ["./assets/index-AAA.js"])).toBe(a);
    expect(buildServiceWorker(template, ["./assets/index-BBB.js"])).not.toBe(a);
  });

  it("nawigacja zapisuje do cache tylko poprawną odpowiedź", () => {
    expect(template).toMatch(/if \(res\.ok\) \{\s*const copy = res\.clone\(\);\s*caches\.open\(CACHE\)\.then\(\(c\) => c\.put\("\.\/index\.html", copy\)\)/);
  });

  it("rzuca, gdy szablon nie ma znaczników", () => {
    expect(() => buildServiceWorker("self.x = 1;", [])).toThrow("znaczników");
  });
});
