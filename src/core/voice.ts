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
  /** Po ciszy tekst wraca tylko, gdy wyprzedził miejsce, gdzie lektor zamilkł, o więcej słów niż tyle. */
  rewindMinSlots: number;
  /**
   * Najwyżej o tyle słów tekst może wyprzedzić ostatnie rozpoznane słowo (lub miejsce, gdzie lektor zamilkł).
   * Chrome na Androidzie zwraca słowa prawie na bieżąco, więc większe wyprzedzenie to tekst przed lektorem.
   */
  maxLeadSlots: number;
  /** Okno pomiaru tempa mowy, ms: tempo = przyrost wyników w tym oknie / czas. */
  rateWindowMs: number;
  /** Czas, w którym korekta zbiera różnicę między pozycją a celem, ms (większy = łagodniej). */
  correctionMs: number;
  /** Stała czasowa zmian prędkości przewijania, ms (bez szarpnięć). */
  velocityTauMs: number;
  /**
   * Ile ms po ostatnim dopasowaniu tekst jedzie dalej z tempem mowy, jeśli lektor nadal mówi
   * (rozpoznawanie słyszy mowę, ale słowa się nie dopasowały: błędy rozpoznania, wznowienie sesji).
   */
  deadReckonMs: number;
  /** Po tylu ms bez żadnej rozpoznanej mowy uznajemy ciszę: tekst dojeżdża i staje. */
  silenceMs: number;
  /** Przy detektorze głosu z mikrofonu (bez opóźnienia usługi): cisza po tylu ms bez głosu. */
  vadSilenceMs: number;
  /** Ile ms po ostatnim wyniku z mową tekst może jeszcze jechać z tempa, gdy wyniki ustały (bez detektora). */
  speechTailMs: number;
  /** Po tylu ms ciszy tekst wraca łagodnie do miejsca, gdzie lektor zamilkł (gdy wyprzedził je o `rewindMinSlots`). */
  rewindAfterMs: number;
  /** Podgląd diagnostyczny: tryb „z tempa”, gdy ostatnie dopasowanie jest starsze niż tyle ms. */
  freshMatchMs: number;
  /** Najwyższa prędkość jako wielokrotność tempa; przy dużej zaległości większa (`catchUpSpeedup`). */
  maxSpeedup: number;
  catchUpSpeedup: number;
  /** Zaległość w slotach, od której obowiązuje `catchUpSpeedup`. */
  catchUpSlots: number;
  /** W trakcie mowy tekst przed celem najpierw zwalnia (do `minSpeedFraction` tempa), a staje dopiero tyle slotów przed celem. */
  aheadStopSlots: number;
  minSpeedFraction: number;
  /** Różnica, powyżej której p przeskakuje (lektor przeskoczył duży fragment), w slotach. */
  snapSlots: number;
  /** Limit kroku czasu, ms. */
  maxDtMs: number;
}

export const DEFAULT_VOICE_FOLLOW: VoiceFollowOptions = {
  latencyMs: 1000,
  rateWindowMs: 6000,
  rewindMinSlots: 2,
  maxLeadSlots: Infinity,
  correctionMs: 1500,
  velocityTauMs: 400,
  deadReckonMs: 5000,
  silenceMs: 1200,
  vadSilenceMs: 350,
  speechTailMs: 700,
  rewindAfterMs: 2500,
  freshMatchMs: 1500,
  maxSpeedup: 1.8,
  catchUpSpeedup: 3,
  catchUpSlots: 4,
  aheadStopSlots: 2,
  minSpeedFraction: 0.35,
  snapSlots: 25,
  maxDtMs: 100,
};

/** Najwyższe przyjmowane tempo mówienia, sloty na ms (10 słów/s). */
const MAX_RATE = 0.01;

/** Stan do podglądu diagnostycznego. */
export interface VoiceFollowState {
  target: number;
  goal: number;
  /** Tempo, sloty na ms (zmierzone albo startowe). */
  rate: number;
  measured: boolean;
  msSinceMatch: number;
  msSinceSpeech: number;
  mode: "czeka" | "za głosem" | "z tempa" | "cisza" | "powrót";
}

/** Tempo mierzymy dopiero z wyników obejmujących tyle ms mowy (z 2–3 słów wychodziło 187 sł./min zamiast ok. 140). */
const MIN_RATE_SPAN_MS = 1500;

/**
 * Prowadzenie pozycji p za lektorem jak operator promptera: tekst przesuwa się płynnie z prędkością
 * równą zmierzonemu tempu mowy, a różnica względem rozpoznanej pozycji jest zbierana łagodnie przez
 * zmianę prędkości, nie skokiem (wyniki rozpoznawania przychodzą paczkami).
 *
 * Mowa i dopasowanie to osobne sygnały: dopóki rozpoznawanie słyszy mowę (`heard`), tekst jedzie
 * z tempem także bez nowych dopasowań (błędy rozpoznania, wznowienie sesji), najwyżej `deadReckonMs`.
 * Staje dopiero przy ciszy, a cofa się łagodnie tylko wtedy, gdy przed ciszą dopasowania były świeże,
 * czyli wiadomo, gdzie lektor skończył. W trakcie mowy tekst się nie cofa.
 */
export class VoiceFollower {
  /** Ostatnia rozpoznana pozycja (początek słowa do przeczytania). */
  private target = 0;
  private lastAdvance = 0;
  private lastSpeech = 0;
  /** Detektor głosu: null = brak (cisza z wyników rozpoznawania), inaczej czas ostatniego głosu. */
  private vadLast: number | null = null;
  private vadActive = false;
  /** Czas mowy od ostatniego dopasowania, ms (bez przerw): o tyle lektor jest dalej niż wynik. */
  private talkMs = 0;
  /** Czas mowy w chwili ostatniego wyniku ze słowami (bez dobiegu po nim). */
  private talkAtSpeech = 0;
  /**
   * Szacowane miejsce, gdzie lektor zamilkł (ustalane przy wykryciu ciszy); po wznowieniu mowy liczymy
   * od niego, dopóki nowe dopasowanie go nie wyprzedzi. null = mowa ciągła od ostatniego dopasowania.
   */
  private stop: number | null = null;
  private wasSilent = false;
  /** Rozpoznawanie zgłosiło koniec wypowiedzi (Android kończy sesję po każdej): cisza do następnego wyniku. */
  private ended = false;
  /** Łączny czas mowy od startu (bez przerw lektora), ms: zegar pomiaru tempa. */
  private speechClock = 0;
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
    this.lastSpeech = now;
    this.history = [];
    this.speechClock = 0;
    this.priorRate = Math.min(Math.max(0, priorRate), MAX_RATE);
    this.velocity = 0;
    this.lastTick = null;
    this.started = false;
    this.talkMs = 0;
    this.talkAtSpeech = 0;
    this.stop = null;
    this.wasSilent = false;
    this.ended = false;
    if (this.vadLast !== null) this.vadLast = now;
  }

  /**
   * Detektor głosu z mikrofonu (poziom dźwięku, bez opóźnienia usługi). Gdy jest, to on decyduje o ciszy:
   * tekst staje, kiedy lektor milknie, i rusza, kiedy zaczyna mówić (po pierwszym wyniku rozpoznawania).
   */
  voiceActivity(now: number, active: boolean): void {
    if (this.vadLast === null || active) this.vadLast = now;
    this.vadActive = active;
    // Bez pierwszego wyniku rozpoznawania tekst stoi: sam poziom dźwięku nie mówi, gdzie lektor jest.
  }

  /** Detektor wyłączony (np. odbierał mikrofon rozpoznawaniu): cisza znów wynika z wyników rozpoznawania. */
  clearVoiceActivity(now: number): void {
    this.vadLast = null;
    this.vadActive = false;
    this.lastSpeech = Math.max(this.lastSpeech, now);
  }

  /** Rozpoznawanie usłyszało mowę (dowolny wynik ze słowami), niezależnie od dopasowania. */
  heard(now: number): void {
    this.lastSpeech = Math.max(this.lastSpeech, now);
    this.talkAtSpeech = this.talkMs;
    this.ended = false;
  }

  /**
   * Koniec wypowiedzi wg rozpoznawania. Chrome na Androidzie kończy sesję dopiero po ciszy lektora
   * (logi z Androida 10: sesja kończy się zaraz po wyniku końcowym), więc to pewny znak ciszy, bez czekania
   * `silenceMs`. Ostatni wynik jest wtedy końcowy, czyli obejmuje całą wypowiedź.
   */
  speechEnded(_now: number): void {
    if (this.vadLast === null) this.ended = true;
  }

  /**
   * Sesja rozpoznawania kończy się i zaraz wznawia (Chrome robi to po ciszy, po limicie czasu, a na Androidzie
   * po każdej wypowiedzi). Jeśli mowa była przed chwilą, przerwa na wznowienie nie jest ciszą lektora.
   */
  bridgeRestart(now: number): void {
    if (now - this.lastSpeech <= this.opt.silenceMs) this.lastSpeech = now;
  }

  /** Pozycja w slotach, do której lektor doszedł (początek następnego słowa do przeczytania). */
  setTarget(slot: number, now: number): void {
    this.heard(now);
    if (slot > this.target) {
      if (slot - this.target >= this.opt.snapSlots) {
        this.history = [];
        this.stop = null;
      }
      this.target = slot;
      this.lastAdvance = now;
      this.history.push([this.speechClock, slot]);
      this.started = true;
      // Po przerwie spóźnione wyniki sprzed niej nie cofają celu: liczymy dalej od miejsca, gdzie lektor zamilkł.
      if (this.stop !== null && this.fromMatch(this.rate(now)) < this.speakingGoal(now)) return;
      this.stop = null;
      this.talkMs = 0;
      this.talkAtSpeech = 0;
    } else if (this.target - slot >= this.opt.snapSlots) {
      // Lektor wrócił daleko wstecz: nowy początek pomiaru.
      this.target = slot;
      this.lastAdvance = now;
      this.talkMs = 0;
      this.talkAtSpeech = 0;
      this.stop = null;
      this.history = [[this.speechClock, slot]];
      this.started = true;
    }
    // Drobne cofnięcia (poprawki wyników pośrednich) pomijamy.
  }

  /** Tempo mowy, sloty na ms: przyrost wyników w oknie; przed pomiarem tempo startowe. */
  rate(now: number): number {
    return this.measuredRate(now) ?? this.priorRate;
  }

  /** Zmierzone tempo mowy, sloty na ms; null, dopóki wyniki nie obejmują co najmniej 0,8 s. */
  measuredRate(_now?: number): number | null {
    // Czas liczony tylko podczas mowy: przerwa lektora w oknie nie zaniża tempa.
    const from = this.speechClock - this.opt.rateWindowMs;
    while (this.history.length > 2 && this.history[0]![0] < from) this.history.shift();
    const h = this.history;
    if (h.length >= 2) {
      const dt = h[h.length - 1]![0] - h[0]![0];
      if (dt >= MIN_RATE_SPAN_MS) return Math.min(MAX_RATE, (h[h.length - 1]![1] - h[0]![1]) / dt);
    }
    return null;
  }

  private silent(now: number): boolean {
    if (this.ended) return true;
    if (this.vadLast !== null) return !this.vadActive && now - this.vadLast > this.opt.vadSilenceMs;
    return now - this.lastSpeech > this.opt.silenceMs;
  }

  /** Czy lektor mówi teraz: z detektora głosu albo (bez niego) krótko po ostatnim wyniku z mową. */
  private talking(now: number): boolean {
    if (this.ended) return false;
    if (this.vadLast !== null) return this.vadActive || now - this.vadLast <= this.opt.vadSilenceMs;
    return now - this.lastSpeech <= this.opt.speechTailMs;
  }

  /** Po ciszy: czy już wracać do miejsca, gdzie lektor zamilkł (wyniki zdążyły dojść). */
  private rewinding(now: number): boolean {
    const quietSince = this.vadLast ?? this.lastSpeech;
    return this.silent(now) && now - quietSince > this.opt.rewindAfterMs;
  }

  /** Pozycja lektora wynikająca z ostatniego dopasowania (bez mowy po nim): lektor jest w połowie następnego słowa, a wynik spóźniony o opóźnienie rozpoznawania. */
  private fromMatch(rate: number): number {
    return this.target + 0.5 + rate * this.opt.latencyMs;
  }

  /** Punkt odniesienia w trakcie mowy: dopasowanie albo (po przerwie) miejsce, gdzie lektor zamilkł. */
  private base(rate: number): number {
    return this.stop ?? this.fromMatch(rate);
  }

  /**
   * Gdzie lektor zamilkł. Z detektorem: cel w chwili umilknięcia (czas mowy przestał rosnąć). Bez niego
   * ostatni wynik ze słowami obejmuje mowę sprzed opóźnienia rozpoznawania, a lektor zamilkł gdzieś
   * pomiędzy, więc liczymy połowę opóźnienia.
   */
  private stopEstimate(now: number): number {
    const rate = this.rate(now);
    if (this.vadLast !== null) return this.base(rate) + rate * Math.min(this.talkMs, this.opt.deadReckonMs);
    if (this.ended) {
      // Wynik końcowy obejmuje całą wypowiedź: lektor skończył przy nim, bez opóźnienia rozpoznawania.
      const spoke = this.stop === null ? Math.max(0, this.lastSpeech - this.lastAdvance) : this.talkAtSpeech;
      const from = this.stop ?? this.target + 0.5;
      return Math.max(from + rate * Math.min(spoke, this.opt.deadReckonMs), this.target + 0.5);
    }
    const half = this.stop === null ? rate * this.opt.latencyMs * 0.5 : 0;
    const est = this.base(rate) + rate * Math.min(this.talkAtSpeech, this.opt.deadReckonMs) - half;
    return Math.max(est, this.target + 0.5);
  }

  /** Gdzie powinien być tekst. */
  goal(now: number): number {
    if (!this.started) return this.target;
    // W ciszy cel stoi tam, gdzie lektor zamilkł (tick zapisuje to przy wykryciu ciszy).
    if (this.silent(now)) return this.stop ?? this.stopEstimate(now);
    // Szacowana pozycja lektora: punkt odniesienia plus tempo × czas mowy od niego. Czas mowy nie rośnie
    // w ciszy, a ograniczenie `deadReckonMs` chroni przed ucieczką, gdy dopasowania długo nie przychodzą.
    return this.speakingGoal(now);
  }

  private speakingGoal(now: number): number {
    const rate = this.rate(now);
    return this.base(rate) + rate * Math.min(this.talkMs, this.opt.deadReckonMs);
  }

  /** Granica wyprzedzenia: ostatnie rozpoznane słowo (albo miejsce, gdzie lektor zamilkł) plus `maxLeadSlots`. */
  private leadCap(): number {
    return Math.max(this.target, this.stop ?? -Infinity) + this.opt.maxLeadSlots;
  }

  /** Stan do podglądu diagnostycznego. */
  state(now: number): VoiceFollowState {
    const measured = this.measuredRate(now);
    const silent = this.silent(now);
    const sinceMatch = now - this.lastAdvance;
    let mode: VoiceFollowState["mode"] = "czeka";
    if (this.started) {
      if (silent) mode = this.rewinding(now) ? "powrót" : "cisza";
      else mode = sinceMatch > this.opt.freshMatchMs ? "z tempa" : "za głosem";
    }
    return {
      target: this.target,
      goal: this.goal(now),
      rate: measured ?? this.priorRate,
      measured: measured !== null,
      msSinceMatch: sinceMatch,
      msSinceSpeech: now - this.lastSpeech,
      mode,
    };
  }

  /** Wywoływane w każdej klatce; zwraca nowe p. */
  tick(now: number, p: number): number {
    const o = this.opt;
    const dt = this.lastTick === null ? 0 : Math.min(Math.max(0, now - this.lastTick), o.maxDtMs);
    this.lastTick = now;
    if (!this.started) return p;
    const silentNow = this.silent(now);
    if (silentNow && !this.wasSilent) {
      // Wykryta cisza: zapamiętujemy, gdzie lektor zamilkł; po wznowieniu liczymy od tego miejsca.
      this.stop = this.stopEstimate(now);
      this.talkMs = 0;
      this.talkAtSpeech = 0;
    }
    this.wasSilent = silentNow;
    if (this.talking(now)) this.talkMs += dt;
    // Zegar tempa staje dopiero w rozpoznanej ciszy (krótkie luki między wynikami to nadal mowa).
    if (!this.silent(now)) this.speechClock += dt;
    const g = this.goal(now);
    const diff = g - p;
    if (Math.abs(diff) >= o.snapSlots) {
      this.velocity = 0;
      return g;
    }
    const rate = this.rate(now);
    const silent = this.silent(now);
    const rewind = this.rewinding(now);
    const base = Math.max(rate, this.priorRate);
    const maxSpeed = base * (diff > o.catchUpSlots ? o.catchUpSpeedup : o.maxSpeedup);
    let want: number;
    if (silent) {
      if (rewind && diff < -o.rewindMinSlots) {
        // Lektor skończył, a tekst pojechał dalej o wyprzedzenie: łagodny powrót do miejsca, gdzie skończył.
        want = Math.max(diff / o.correctionMs, -base * o.maxSpeedup);
      } else {
        // Cisza: dojazd do ostatniego wyniku, bez ruchu dalej.
        want = diff < 0.1 ? 0 : Math.min(diff / o.correctionMs, maxSpeed);
      }
    } else {
      // Mowa trwa: tempo mowy plus łagodna korekta. Gdy tekst jest nieco przed celem (cel waha się
      // przy każdej paczce wyników), tekst zwalnia zamiast stawać; staje dopiero `aheadStopSlots` przed celem.
      want = rate + diff / o.correctionMs;
      const floor = diff > -o.aheadStopSlots ? rate * o.minSpeedFraction : 0;
      want = Math.min(Math.max(want, floor), maxSpeed);
    }
    // Łagodne hamowanie przed granicą wyprzedzenia (bez szarpnięcia przy dojściu do niej).
    const cap = this.leadCap();
    if (want > 0) want = Math.min(want, Math.max(0, cap - p) / o.correctionMs * 4);
    this.velocity += (want - this.velocity) * (1 - Math.exp(-dt / o.velocityTauMs));
    // Zatrzymanie do zera zamiast nieskończenie wolnego pełzania.
    if (want === 0 && Math.abs(this.velocity) < 1e-5) this.velocity = 0;
    const next = p + this.velocity * dt;
    if (this.velocity >= 0) {
      // W ciszy nie mijamy celu; w trakcie mowy najwyżej `aheadStopSlots` przed nim.
      const limit = Math.min(silent ? g : g + o.aheadStopSlots, cap);
      return Math.min(next, Math.max(p, limit));
    }
    return Math.max(next, Math.min(p, g));
  }
}

/**
 * Słowa hipotezy z kolejnych wyników jednej sesji rozpoznawania. Chrome na Androidzie zwraca wyniki
 * narastająco (każdy zawiera poprzedni, np. „i raz”, „i raz i dwa”), więc zwykłe sklejenie dubluje tekst
 * (log z Androida 10, Chrome 155). Wynik, który zaczyna się od poprzedniego, zastępuje go.
 */
export function mergeTranscripts(parts: string[]): string[] {
  const kept: string[][] = [];
  for (const part of parts) {
    const words = part.split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0) continue;
    const prev = kept[kept.length - 1];
    if (prev && prev.length <= words.length && prev.every((w, i) => w.toLowerCase() === words[i]!.toLowerCase())) {
      kept[kept.length - 1] = words;
    } else kept.push(words);
  }
  return kept.flat();
}
