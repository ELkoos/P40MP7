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
  /** Szacowane opóźnienie rozpoznawania, ms: o tyle tempa mowy tekst wyprzedza ostatni wynik. */
  latencyMs: number;
  /** Okno pomiaru tempa mowy, ms: tempo = przyrost wyników w tym oknie / czas. */
  rateWindowMs: number;
  /** Czas, w którym korekta zbiera różnicę między pozycją a celem, ms (większy = łagodniej). */
  correctionMs: number;
  /** Stała czasowa zmian prędkości przewijania, ms (bez szarpnięć). */
  velocityTauMs: number;
  /** Po tylu ms bez nowego wyniku uznajemy ciszę: cel przestaje rosnąć, tekst dojeżdża i staje. */
  silenceMs: number;
  /** Po tylu ms bez nowego wyniku tekst wraca łagodnie do ostatniego rozpoznanego słowa (lektor skończył). */
  rewindAfterMs: number;
  /** Ile slotów ponad kompensację opóźnienia tekst może wyprzedzić wynik, gdy kolejny się spóźnia. */
  maxExtraLeadSlots: number;
  /** Najwyższa prędkość jako wielokrotność zmierzonego tempa (dogonienie po zaległości). */
  maxSpeedup: number;
  /** Różnica, powyżej której p przeskakuje (lektor przeskoczył fragment), w slotach. */
  snapSlots: number;
  /** Limit kroku czasu, ms. */
  maxDtMs: number;
}

export const DEFAULT_VOICE_FOLLOW: VoiceFollowOptions = {
  latencyMs: 1000,
  rateWindowMs: 4000,
  correctionMs: 1500,
  velocityTauMs: 400,
  silenceMs: 1500,
  rewindAfterMs: 2500,
  maxExtraLeadSlots: 2,
  maxSpeedup: 1.8,
  snapSlots: 12,
  maxDtMs: 100,
};

/** Najwyższe przyjmowane tempo mówienia, sloty na ms (10 słów/s). */
const MAX_RATE = 0.01;

/**
 * Prowadzenie pozycji p za lektorem jak operator promptera: tekst przesuwa się płynnie z prędkością
 * równą zmierzonemu tempu mowy, a różnica względem rozpoznanej pozycji jest zbierana łagodnie przez
 * zmianę prędkości, nie skokiem. Wyniki rozpoznawania przychodzą paczkami (kilka słów naraz),
 * więc ustawianie pozycji wprost na wynik dawało przeskoki.
 * Przy ciszy cel przestaje rosnąć i tekst zatrzymuje się (8.1), wracając łagodnie o wyprzedzenie,
 * jeśli lektor skończył wcześniej. W trakcie mowy tekst się nie cofa; tylko duża różnica (skok lektora)
 * przestawia pozycję od razu.
 */
export class VoiceFollower {
  /** Ostatnia rozpoznana pozycja (początek słowa do przeczytania). */
  private target = 0;
  private lastAdvance = 0;
  /** Historia wyników do pomiaru tempa: [czas, cel]. */
  private history: [number, number][] = [];
  private priorRate = 0;
  private velocity = 0;
  private lastTick: number | null = null;
  private started = false;
  private readonly opt: VoiceFollowOptions;

  constructor(options: Partial<VoiceFollowOptions> = {}) {
    this.opt = { ...DEFAULT_VOICE_FOLLOW, ...options };
  }

  /**
   * Nowy punkt startu (start słuchania, nawigacja ręczna).
   * `priorRate`: tempo startowe w slotach na ms (np. z ustawionej prędkości), zanim zmierzymy własne.
   */
  reset(p: number, now: number, priorRate = 0): void {
    this.target = p;
    this.lastAdvance = now;
    this.history = [];
    this.priorRate = Math.min(Math.max(0, priorRate), MAX_RATE);
    this.velocity = 0;
    this.lastTick = null;
    this.started = false;
  }

  /** Pozycja w slotach, do której lektor doszedł (początek następnego słowa do przeczytania). */
  setTarget(slot: number, now: number): void {
    if (slot > this.target) {
      if (slot - this.target >= this.opt.snapSlots) this.history = [];
      this.target = slot;
      this.lastAdvance = now;
      this.history.push([now, slot]);
      this.started = true;
    } else if (this.target - slot >= this.opt.snapSlots) {
      // Lektor wrócił daleko wstecz: nowy początek pomiaru.
      this.target = slot;
      this.lastAdvance = now;
      this.history = [[now, slot]];
      this.started = true;
    }
    // Drobne cofnięcia (poprawki wyników pośrednich) pomijamy.
  }

  /** Tempo mowy, sloty na ms: przyrost wyników w oknie; przed pomiarem tempo startowe. */
  rate(now: number): number {
    const from = now - this.opt.rateWindowMs;
    while (this.history.length > 2 && this.history[0]![0] < from) this.history.shift();
    const h = this.history;
    if (h.length >= 2) {
      const dt = h[h.length - 1]![0] - h[0]![0];
      if (dt >= 800) return Math.min(MAX_RATE, (h[h.length - 1]![1] - h[0]![1]) / dt);
    }
    return this.priorRate;
  }

  /** Gdzie powinien być tekst: ostatni wynik + to, co lektor powiedział od tamtej chwili (do ciszy). */
  goal(now: number): number {
    if (!this.started) return this.target;
    const since = Math.max(0, now - this.lastAdvance);
    // Cisza: wyniki przestały rosnąć, więc lektor skończył na ostatnim rozpoznanym słowie.
    if (since > this.opt.silenceMs) return this.target;
    // W trakcie mowy: wynik obejmuje tylko słowa skończone (lektor jest średnio w połowie następnego)
    // i jest spóźniony o opóźnienie rozpoznawania plus czas od jego nadejścia; gdy kolejny wynik się spóźnia,
    // tekst wyprzedza najwyżej o maxExtraLeadSlots ponad kompensację.
    const rate = this.rate(now);
    const latencyLead = rate * this.opt.latencyMs;
    return this.target + 0.5 + Math.min(rate * (this.opt.latencyMs + since), latencyLead + this.opt.maxExtraLeadSlots);
  }

  /** Wywoływane w każdej klatce; zwraca nowe p. */
  tick(now: number, p: number): number {
    const o = this.opt;
    const dt = this.lastTick === null ? 0 : Math.min(Math.max(0, now - this.lastTick), o.maxDtMs);
    this.lastTick = now;
    if (!this.started) return p;
    const g = this.goal(now);
    const diff = g - p;
    if (Math.abs(diff) >= o.snapSlots) {
      this.velocity = 0;
      return g;
    }
    const rate = this.rate(now);
    const silent = now - this.lastAdvance > o.silenceMs;
    const rewind = now - this.lastAdvance > o.rewindAfterMs;
    const maxSpeed = Math.max(rate, this.priorRate) * o.maxSpeedup;
    let want: number;
    if (rewind && diff < -1) {
      // Lektor przestał mówić, a tekst pojechał dalej o wyprzedzenie: łagodny powrót do miejsca, gdzie skończył.
      want = Math.max(diff / o.correctionMs, -maxSpeed);
    } else if (diff <= 0 || (silent && diff < 0.1)) {
      want = 0;
    } else {
      // Tempo mowy (poza ciszą) plus łagodna korekta różnicy.
      want = Math.min((silent ? 0 : rate) + diff / o.correctionMs, maxSpeed);
    }
    this.velocity += (want - this.velocity) * (1 - Math.exp(-dt / o.velocityTauMs));
    // Zatrzymanie do zera zamiast nieskończenie wolnego pełzania.
    if (want === 0 && Math.abs(this.velocity) < 1e-5) this.velocity = 0;
    const next = p + this.velocity * dt;
    // Nie mijamy celu w żadnym kierunku; w trakcie mowy tekst nie cofa się.
    if (this.velocity >= 0) return Math.min(next, Math.max(p, g));
    return Math.max(next, Math.min(p, g));
  }
}
