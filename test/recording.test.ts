import { describe, expect, it } from "vitest";
import {
  MIME_CANDIDATES,
  clampedCenterPx,
  extensionFor,
  formatBytes,
  nearCameraLayout,
  pickMimeType,
  recordingFileName,
  videoBitrateFor,
} from "../src/core/recording";

describe("pickMimeType", () => {
  it("wybiera pierwszy obsługiwany w kolejności preferencji", () => {
    // Odpowiedzi isTypeSupported zmierzone w Chromium 141 (Playwright).
    const chromium141 = new Set(["video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]);
    expect(pickMimeType((m) => chromium141.has(m))).toBe("video/mp4");
  });

  it("H.264 ma pierwszeństwo, gdy jest dostępny", () => {
    expect(pickMimeType(() => true)).toBe(MIME_CANDIDATES[0]);
  });

  it("schodzi do WebM, gdy MP4 nieobsługiwany", () => {
    expect(pickMimeType((m) => m.startsWith("video/webm"))).toBe("video/webm;codecs=vp9,opus");
  });

  it("zwraca pusty napis, gdy nic nie pasuje albo sprawdzenie rzuca wyjątek", () => {
    expect(pickMimeType(() => false)).toBe("");
    expect(
      pickMimeType(() => {
        throw new Error("x");
      }),
    ).toBe("");
  });
});

describe("extensionFor", () => {
  it("rozpoznaje typ niezależnie od parametrów kodeków", () => {
    expect(extensionFor("video/mp4;codecs=vp9,opus")).toBe("mp4");
    expect(extensionFor('video/mp4;codecs="avc1.42E01E,mp4a.40.2"')).toBe("mp4");
    expect(extensionFor("video/webm;codecs=vp8,opus")).toBe("webm");
    expect(extensionFor("video/x-matroska;codecs=avc1")).toBe("mkv");
    expect(extensionFor("")).toBe("webm");
  });
});

describe("recordingFileName", () => {
  const d = new Date(2026, 9, 13, 9, 5, 7);

  it("tytuł i znacznik czasu", () => {
    expect(recordingFileName("Wstęp do kursu", d, "mp4")).toBe("Wstep do kursu_2026-10-13_09-05-07.mp4");
  });

  it("zamienia polskie litery na ASCII", () => {
    expect(recordingFileName("Zażółć gęślą jaźń ŁÓDŹ", d, "mp4")).toBe("Zazolc gesla jazn LODZ_2026-10-13_09-05-07.mp4");
  });

  it("usuwa znaki niedozwolone w nazwach plików, emoji i kropki na końcu", () => {
    expect(recordingFileName('a/b:c*?"<>|d 🎬...', d, "webm")).toBe("a b c d_2026-10-13_09-05-07.webm");
  });

  it("pusty tytuł daje nazwę domyślną", () => {
    expect(recordingFileName("  ", d, "mp4")).toBe("nagranie_2026-10-13_09-05-07.mp4");
  });

  it("skraca długi tytuł do 60 znaków", () => {
    const name = recordingFileName("x".repeat(200), d, "mp4");
    expect(name).toBe(`${"x".repeat(60)}_2026-10-13_09-05-07.mp4`);
  });
});

describe("nearCameraLayout", () => {
  it("kamera u góry: punkt odczytu wysoko, kolumna na środku", () => {
    expect(nearCameraLayout("top", 10, 25)).toEqual({ focusPct: 10, anchorPct: 50 });
  });

  it("kamera z boku: środek wysokości, kolumna przy tej krawędzi", () => {
    expect(nearCameraLayout("left", 10, 25)).toEqual({ focusPct: 50, anchorPct: 25 });
    expect(nearCameraLayout("right", 10, 25)).toEqual({ focusPct: 50, anchorPct: 75 });
  });
});

describe("clampedCenterPx", () => {
  it("środek bez ograniczeń", () => {
    expect(clampedCenterPx(50, 1000, 400, 16)).toBe(500);
  });

  it("kolumna nie wychodzi poza ekran", () => {
    expect(clampedCenterPx(5, 1000, 400, 16)).toBe(216);
    expect(clampedCenterPx(95, 1000, 400, 16)).toBe(784);
  });

  it("kolumna szersza niż ekran: środek", () => {
    expect(clampedCenterPx(10, 300, 400, 16)).toBe(150);
  });
});

describe("pomocnicze", () => {
  it("bitrate zależny od wysokości", () => {
    expect(videoBitrateFor(1080)).toBe(8_000_000);
    expect(videoBitrateFor(720)).toBe(5_000_000);
    expect(videoBitrateFor(480)).toBe(2_500_000);
  });

  it("formatBytes", () => {
    expect(formatBytes(512 * 1024)).toBe("512 KB");
    expect(formatBytes(37.5 * 1024 * 1024)).toBe("37,5 MB");
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe("2,00 GB");
  });
});
