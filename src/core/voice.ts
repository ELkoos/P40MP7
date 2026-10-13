/**
 * Podążanie za głosem (Q4, 8.1): dopasowanie rozpoznanych słów do tekstu i płynne prowadzenie pozycji p.
 * Bez DOM i bez zależności od silnika rozpoznawania; silnik podaje tylko listę ostatnio rozpoznanych słów.
 */

/** Słowo do porównań: małe litery, bez znaków diakrytycznych i interpunkcji. */
export function normalizeWord(word: string): string {
  return word
    .toLowerCase()
    .replace(/ł/g, "l")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/** Podobieństwo 0..1: 1 − odległość Levenshteina / długość dłuższego słowa. */
export function wordSimilarity(a: string, b: string): number {
  if (a === b) return a.length > 0 ? 1 : 0;
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) return 0;
  let prev = new Array<number>(m + 1);
  let cur = new Array<number>(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return 1 - prev[m]! / Math.max(n, m);
}

/** Wartości [H]; do strojenia na nagraniach. */
export interface VoiceMatchOptions {
  /** Ile słów przed oczekiwaną pozycją przeszukujemy (powtórzenia, cofnięcia lektora). */
  lookBehind: number;
  /** Ile słów za oczekiwaną pozycją przeszukujemy (pominięte fragmenty). */
  lookAhead: number;
  /** Ile ostatnich rozpoznanych słów dopasowujemy. */
  tail: number;
  /** Minimalne podobieństwo, od którego słowa uznajemy za zgodne. */
  minSimilarity: number;
  /** Kara za słowo pominięte po jednej ze stron. */
  gap: number;
  /** Kara za parę niezgodnych słów. */
  mismatch: number;
  /** Waga słów o długości <= 2 (i, w, z, na), które łatwo trafić przypadkiem. */
  shortWordWeight: number;
  /** Minimalny wynik po karze za odległość. */
  minScore: number;
  /** Minimalna liczba zgodnych słów; wyjątek: pojedyncze pewne słowo tuż przy oczekiwanej pozycji. */
  minMatches: number;
  /** Minimalna liczba zgodnych słów przy skoku wstecz o więcej niż 2 słowa. */
  minMatchesBack: number;
}

export const DEFAULT_VOICE_MATCH: VoiceMatchOptions = {
  lookBehind: 15,
  lookAhead: 40,
  tail: 8,
  minSimilarity: 0.7,
  gap: 0.6,
  mismatch: 0.6,
  shortWordWeight: 0.4,
  minScore: 1.2,
  minMatches: 2,
  minMatchesBack: 3,
};

export interface VoiceMatch {
  /** Indeks słowa tekstu, które lektor właśnie wypowiedział. */
  word: number;
  /** Wynik dopasowania po karze za odległość. */
  score: number;
  /** Liczba zgodnych par słów. */
  matched: number;
}

/**
 * Dopasowanie końcówki rozpoznanego tekstu do słów tekstu w oknie wokół oczekiwanej pozycji
 * (lokalne dopasowanie sekwencji z przybliżonym porównaniem słów).
 * `words[k]` to słowo źródłowe k, czyli tokeny z `tokenize(body, { splitLongWords: false })`.
 */
export class VoiceMatcher {
  private readonly words: string[];
  private readonly opt: VoiceMatchOptions;
  private _next = 0;

  constructor(words: readonly string[], options: Partial<VoiceMatchOptions> = {}) {
    this.words = words.map(normalizeWord);
    this.opt = { ...DEFAULT_VOICE_MATCH, ...options };
  }

  /** Indeks słowa, którego lektor ma powiedzieć jako następnego. */
  get next(): number {
    return this._next;
  }

  /** Ustawienie oczekiwanej pozycji po nawigacji ręcznej. */
  reset(word: number): void {
    this._next = Math.min(this.words.length, Math.max(0, word));
  }

  /** Dopasowanie bieżącej hipotezy rozpoznawania; przy sukcesie przesuwa `next` za dopasowane słowo. */
  update(recognized: readonly string[]): VoiceMatch | null {
    const o = this.opt;
    const r = recognized.map(normalizeWord).filter((w) => w.length > 0).slice(-o.tail);
    const m = r.length;
    if (m === 0 || this.words.length === 0) return null;

    const a = Math.max(0, this._next - o.lookBehind);
    const b = Math.min(this.words.length, this._next + o.lookAhead);
    const len = b - a;
    if (len <= 0) return null;

    // H: wynik, C: liczba zgodnych par, S: podobieństwo w komórce dopasowania (0 gdy komórka nie jest dopasowaniem).
    const cols = len + 1;
    const H = new Float64Array((m + 1) * cols);
    const C = new Int32Array((m + 1) * cols);
    const S = new Float64Array((m + 1) * cols);
    let best: VoiceMatch | null = null;
    let bestDist = Infinity;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= len; j++) {
        const k = i * cols + j;
        const t = this.words[a + j - 1]!;
        const sim = wordSimilarity(r[i - 1]!, t);
        const isMatch = sim >= o.minSimilarity;
        const s = isMatch ? sim * (t.length <= 2 ? o.shortWordWeight : 1) : -o.mismatch;
        const diag = H[(i - 1) * cols + j - 1]! + s;
        const up = H[(i - 1) * cols + j]! - o.gap;
        const left = H[i * cols + j - 1]! - o.gap;
        let h = 0;
        let c = 0;
        if (diag > h) {
          h = diag;
          c = C[(i - 1) * cols + j - 1]! + (isMatch ? 1 : 0);
        }
        if (up > h) {
          h = up;
          c = C[(i - 1) * cols + j]!;
        }
        if (left > h) {
          h = left;
          c = C[i * cols + j - 1]!;
        }
        H[k] = h;
        C[k] = c;
        const matchCell = isMatch && h === diag && h > 0;
        S[k] = matchCell ? sim : 0;

        // Koniec dopasowania: ostatnie rozpoznane słowo albo przedostatnie (ostatnie bywa niestabilne w wynikach pośrednich).
        if (!matchCell || i < m - 1) continue;
        const word = a + j - 1;
        const d = word - this._next;
        const score = h - (i < m ? 0.3 : 0) - distancePenalty(d);
        const strongSingle = c === 1 && m <= 2 && d >= 0 && d <= 1 && t.length >= 3 && sim >= 0.85;
        if (c < o.minMatches && !strongSingle) continue;
        if (d < -2 && c < o.minMatchesBack) continue;
        if (!strongSingle && score < o.minScore) continue;
        if (best === null || score > best.score || (score === best.score && Math.abs(d) < bestDist)) {
          best = { word, score, matched: c };
          bestDist = Math.abs(d);
        }
      }
    }

    if (best) this._next = best.word + 1;
    return best;
  }
}

/** Kara za odległość od oczekiwanej pozycji [H]: bez kary od −1 do +3 słów. */
function distancePenalty(d: number): number {
  if (d > 3) return 0.05 * (d - 3);
  if (d < -1) return 0.15 * (-1 - d);
  return 0;
}

/** Wartości [H]. */
export interface VoiceFollowOptions {
  /** Stała czasowa wygładzania ruchu p, ms. */
  tauMs: number;
  /** Maksymalne wyprzedzenie celu na podstawie tempa mówienia, w slotach (kompensuje opóźnienie rozpoznawania). */
  maxLeadSlots: number;
  /** Różnica, powyżej której p przeskakuje zamiast płynąć, w slotach. */
  snapSlots: number;
  /** Cofnięcie celu mniejsze niż tyle slotów jest ignorowane (poprawki wyników pośrednich). */
  holdBackSlots: number;
  /** Limit kroku czasu, ms. */
  maxDtMs: number;
}

export const DEFAULT_VOICE_FOLLOW: VoiceFollowOptions = {
  tauMs: 250,
  maxLeadSlots: 1,
  snapSlots: 12,
  holdBackSlots: 2,
  maxDtMs: 100,
};

/**
 * Prowadzenie pozycji p za lektorem: cel ustawiany przy każdym dopasowaniu, p dąży do niego płynnie.
 * Przy ciszy cel stoi, więc tekst się zatrzymuje (8.1).
 */
export class VoiceFollower {
  private target = 0;
  private lastAdvance = 0;
  /** Tempo mówienia w slotach na ms (średnia wykładnicza). */
  private rate = 0;
  private lastTick: number | null = null;
  private readonly opt: VoiceFollowOptions;

  constructor(options: Partial<VoiceFollowOptions> = {}) {
    this.opt = { ...DEFAULT_VOICE_FOLLOW, ...options };
  }

  /** Nowy punkt startu (start słuchania, nawigacja ręczna); zeruje tempo. */
  reset(p: number, now: number): void {
    this.target = p;
    this.lastAdvance = now;
    this.rate = 0;
    this.lastTick = null;
  }

  /** Pozycja w slotach, do której lektor doszedł (początek następnego słowa do przeczytania). */
  setTarget(slot: number, now: number): void {
    const delta = slot - this.target;
    if (delta > 0) {
      const dt = now - this.lastAdvance;
      if (dt > 0 && delta < this.opt.snapSlots) {
        const inst = Math.min(delta / dt, 0.02);
        this.rate = this.rate === 0 ? inst : this.rate * 0.7 + inst * 0.3;
      }
      this.lastAdvance = now;
      this.target = slot;
    } else if (-delta >= this.opt.holdBackSlots) {
      this.target = slot;
      this.lastAdvance = now;
      this.rate = 0;
    }
  }

  /** Cel z wyprzedzeniem wynikającym z tempa mówienia. */
  goal(now: number): number {
    const lead = Math.min(this.opt.maxLeadSlots, this.rate * Math.max(0, now - this.lastAdvance));
    return this.target + lead;
  }

  /** Wywoływane w każdej klatce; zwraca nowe p. */
  tick(now: number, p: number): number {
    const dt = this.lastTick === null ? 0 : Math.min(Math.max(0, now - this.lastTick), this.opt.maxDtMs);
    this.lastTick = now;
    const g = this.goal(now);
    const diff = g - p;
    if (Math.abs(diff) >= this.opt.snapSlots) return g;
    // Drobne cofnięcia celu nie cofają tekstu.
    if (diff < 0 && -diff < this.opt.holdBackSlots) return p;
    return p + diff * (1 - Math.exp(-dt / this.opt.tauMs));
  }
}
