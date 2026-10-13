/**
 * Czyste funkcje trybu nagrywania wideo (bez DOM), testowane w Node.
 *
 * Kolejność formatów: MP4 przed WebM, bo plik WebM z MediaRecorder w Chromium nie ma zapisanego
 * czasu trwania (sprawdzone ffprobe: duration=N/A), co utrudnia przewijanie w części odtwarzaczy.
 */

/** Kandydaci MIME w kolejności preferencji. */
export const MIME_CANDIDATES: readonly string[] = [
  // H.264 + AAC: najlepszy do montażu; Chrome i Edge z kodekami własnościowymi, Safari [Z].
  'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
  // Ogólny MP4: w Chromium 141 daje VP9 + Opus (sprawdzone), w Safari H.264 + AAC [Z].
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  // Firefox [Z].
  "video/webm",
];

/** Pierwszy obsługiwany format; "" = niech przeglądarka wybierze sama. */
export function pickMimeType(isSupported: (mime: string) => boolean, candidates: readonly string[] = MIME_CANDIDATES): string {
  for (const m of candidates) {
    try {
      if (isSupported(m)) return m;
    } catch {
      // Niektóre przeglądarki rzucają wyjątek dla nieznanych parametrów; traktujemy jak brak obsługi.
    }
  }
  return "";
}

/** Rozszerzenie pliku dla typu MIME faktycznie zwróconego przez MediaRecorder. */
export function extensionFor(mime: string): string {
  const base = mime.split(";")[0]!.trim().toLowerCase();
  if (base === "video/mp4" || base === "audio/mp4") return "mp4";
  if (base === "video/webm" || base === "audio/webm") return "webm";
  if (base === "video/x-matroska") return "mkv";
  if (base === "video/quicktime") return "mov";
  return "webm";
}

/**
 * Nazwa pliku: tytuł tekstu i data z godziną, tylko znaki ASCII.
 * Polskie litery są zamieniane, bo Chromium 141 (headless) ignoruje atrybut download
 * z literami spoza ASCII i zapisuje plik jako „download” (sprawdzone w Playwright).
 */
export function recordingFileName(title: string, date: Date, ext: string): string {
  const clean = title
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9 ._()-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60)
    .replace(/[ .]+$/, "");
  const p = (n: number) => n.toString().padStart(2, "0");
  const stamp = `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}_${p(date.getHours())}-${p(date.getMinutes())}-${p(date.getSeconds())}`;
  return `${clean || "nagranie"}_${stamp}.${ext}`;
}

/** Docelowy strumień wideo w bitach na sekundę dla wysokości obrazu [H]. */
export function videoBitrateFor(height: number): number {
  if (height >= 1080) return 8_000_000;
  if (height >= 720) return 5_000_000;
  return 2_500_000;
}

export type CameraEdge = "top" | "left" | "right";

/** Położenie tekstu przy kamerze: punkt odczytu (% wysokości) i środek kolumny (% szerokości). */
export interface NearCameraLayout {
  focusPct: number;
  anchorPct: number;
}

/**
 * Tekst jak najbliżej obiektywu, żeby wzrok nie uciekał od kamery.
 * Kamera u góry (laptop, telefon pionowo): punkt odczytu wysoko, kolumna na środku.
 * Kamera z boku (telefon poziomo): punkt odczytu w połowie wysokości, kolumna przy tej krawędzi.
 */
export function nearCameraLayout(edge: CameraEdge, topFocusPct: number, sideAnchorPct: number): NearCameraLayout {
  switch (edge) {
    case "top":
      return { focusPct: topFocusPct, anchorPct: 50 };
    case "left":
      return { focusPct: 50, anchorPct: sideAnchorPct };
    case "right":
      return { focusPct: 50, anchorPct: 100 - sideAnchorPct };
  }
}

/**
 * Środek kolumny w pikselach: żądany punkt, ale tak, żeby kolumna mieściła się w ekranie
 * z marginesem `marginPx` po obu stronach.
 */
export function clampedCenterPx(anchorPct: number, stageWidth: number, columnWidth: number, marginPx: number): number {
  const want = (stageWidth * anchorPct) / 100;
  const half = columnWidth / 2;
  const min = half + marginPx;
  const max = stageWidth - half - marginPx;
  if (min > max) return stageWidth / 2;
  return Math.min(max, Math.max(min, want));
}

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2).replace(".", ",")} GB`;
}
