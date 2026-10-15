import { VoiceFollower, VoiceMatcher, type VoiceFollowOptions } from "../../src/core/voice";

/** Diagnostyka symulacji: ustaw na true lokalnie, żeby wypisać postoje i najgorszy moment. */
const DEBUG = false;
const debug = (msg: string) => console.log(msg);


/** Tekst do symulacji: zwykła polska proza (powtórzona), bez znaczenia dla wyników poza długością słów. */
const BASE = `Dzień dobry państwu. Dzisiaj chciałbym opowiedzieć o tym, jak przygotować się do nagrania krótkiego materiału wideo.
Najważniejsze jest spokojne tempo i naturalny głos. Warto przeczytać tekst kilka razy na głos, zanim włączymy kamerę.
Prompter pomaga utrzymać kontakt wzrokowy z widzem, ale tylko wtedy, gdy tekst przesuwa się razem z nami.
Jeżeli tekst ucieka do przodu albo zostaje w tyle, zaczynamy się gubić i nagranie trzeba powtarzać.
Dlatego ustawiamy wygodną wielkość liter, odpowiednią szerokość kolumny i punkt odczytu blisko obiektywu.
Na koniec sprawdzamy dźwięk, światło i tło, a potem możemy zaczynać.`;
export const WORDS = (BASE + " " + BASE + " " + BASE).split(/\s+/).filter(Boolean);

export interface SimOptions {
  wpm: number;
  /** Prawdopodobieństwo poprawnego rozpoznania słowa. */
  accuracy: number;
  /** Odstęp między wynikami, ms [min, max]. */
  interval: [number, number];
  /** Opóźnienie wyniku względem mowy, ms [min, max]. */
  latency: [number, number];
  /** Co ile ms kończy się sesja rozpoznawania (hipoteza od nowa) i ile ms trwa przerwa. */
  sessionMs: number;
  gapMs: number;
  /** Przerwy lektora: [początek ms, długość ms]. */
  pauses: [number, number][];
  durationMs: number;
  seed: number;
}

export const DEFAULT_SIM: SimOptions = {
  wpm: 150,
  accuracy: 0.8,
  interval: [250, 600],
  latency: [500, 1100],
  sessionMs: 15000,
  gapMs: 600,
  pauses: [[20000, 3000]],
  durationMs: 45000,
  seed: 11,
};

export interface SimResult {
  /** Średnia i najgorsza różnica |pozycja lektora − p| w słowach (w trakcie mowy, po rozbiegu). */
  meanLag: number;
  worstLag: number;
  /** Ile razy tekst zatrzymał się (> 0,5 s), gdy lektor mówił. */
  stopsWhileSpeaking: number;
  /** Łączna droga cofania w słowach i liczba cofnięć w trakcie mowy. */
  backwardWords: number;
  backwardWhileSpeaking: number;
  /** Największy krok na klatkę. */
  maxStep: number;
  /** Najdalej, o ile słów tekst wyprzedził lektora (po rozbiegu, także w przerwie). */
  maxAhead: number;
}

/** Cała ścieżka jak w odtwarzaczu: hipotezy rozpoznawania → VoiceMatcher → VoiceFollower → p (slot = słowo). */
export function simulate(
  opt: Partial<SimOptions> = {},
  follow: Partial<VoiceFollowOptions> = {},
  useActivity = true,
  /** Detektor głosu z mikrofonu: reaguje z tym opóźnieniem, ms; null = brak. */
  vadDelayMs: number | null = null,
): SimResult {
  const o = { ...DEFAULT_SIM, ...opt };
  let seed = o.seed;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const rate = o.wpm / 60000;
  // Czas mowy z przerwami: ile słów lektor wypowiedział do chwili t.
  const spokenAt = (t: number) => {
    let talk = t;
    for (const [s, d] of o.pauses) if (t > s) talk -= Math.min(d, t - s);
    return Math.min(WORDS.length, talk * rate);
  };
  const speaking = (t: number) => !o.pauses.some(([s, d]) => t >= s && t < s + d);
  const recognized = WORDS.map((w, i) => (rnd() < o.accuracy ? w : `xq${i}zz`));

  const matcher = new VoiceMatcher(WORDS);
  const f = new VoiceFollower(follow);
  f.reset(0, 0, rate);
  let p = 0;
  let next = 300;
  let sessionStart = 0;
  let res: SimResult = { meanLag: 0, worstLag: 0, stopsWhileSpeaking: 0, backwardWords: 0, backwardWhileSpeaking: 0, maxStep: 0, maxAhead: 0 };
  let sum = 0;
  let n = 0;
  let stoppedFor = 0;
  let wasBack = false;
  let worstInfo = "";
  let aheadInfo = "";
  for (let t = 0; t <= o.durationMs; t += 16) {
    if (t - sessionStart > o.sessionMs) {
      sessionStart = t + o.gapMs;
      // Jak w odtwarzaczu: wznowienie sesji tuż po mowie nie jest ciszą.
      if (useActivity) f.bridgeRestart(t);
    }
    if (t >= next && t >= sessionStart) {
      const lat = o.latency[0] + rnd() * (o.latency[1] - o.latency[0]);
      const heardUpTo = Math.floor(spokenAt(Math.max(0, t - lat)));
      const fromWord = Math.floor(spokenAt(Math.max(0, sessionStart - lat)));
      const hyp = recognized.slice(fromWord, heardUpTo);
      // Ostatnie słowo hipotezy pośredniej bywa ucięte.
      if (hyp.length > 0 && rnd() < 0.4) hyp[hyp.length - 1] = hyp[hyp.length - 1]!.slice(0, 2);
      if (hyp.length > 0) {
        if (useActivity && speaking(t - lat)) f.heard(t);
        const m = matcher.update(hyp.slice(-12));
        if (m) f.setTarget(m.word + 1, t);
      }
      next = t + o.interval[0] + rnd() * (o.interval[1] - o.interval[0]);
    }
    if (vadDelayMs !== null) f.voiceActivity(t, t >= vadDelayMs && speaking(t - vadDelayMs));
    const q = f.tick(t, p);
    const step = q - p;
    res.maxStep = Math.max(res.maxStep, Math.abs(step));
    const talking = speaking(t) && t > 3000;
    if (t > 3000 && q - spokenAt(t) > res.maxAhead) {
      res.maxAhead = q - spokenAt(t);
      if (DEBUG) { const st = f.state(t); aheadInfo = `t=${t} p=${q.toFixed(1)} spoken=${spokenAt(t).toFixed(1)} mode=${st.mode} target=${st.target} goal=${st.goal.toFixed(1)} sinceMatch=${st.msSinceMatch} sinceSpeech=${st.msSinceSpeech} rate=${(st.rate * 60000).toFixed(0)}`; }
    }
    if (step < -1e-9) {
      res.backwardWords += -step;
      if (talking && !wasBack) res.backwardWhileSpeaking++;
      wasBack = true;
    } else wasBack = false;
    if (talking) {
      stoppedFor = step <= 1e-9 ? stoppedFor + 16 : 0;
      if (stoppedFor === 512) {
        res.stopsWhileSpeaking++;
        if (DEBUG) { const st = f.state(t); debug(`  stop t=${t} mode=${st.mode} p=${q.toFixed(1)} goal=${st.goal.toFixed(1)} target=${st.target} spoken=${spokenAt(t).toFixed(1)} sinceMatch=${st.msSinceMatch} sinceSpeech=${st.msSinceSpeech} rate=${(st.rate*60000).toFixed(0)} meas=${st.measured}`); }
      }
      const d = Math.abs(spokenAt(t) - q);
      sum += d;
      n++;
      if (d > res.worstLag && DEBUG) { const st = f.state(t); worstInfo = `t=${t} p=${q.toFixed(1)} spoken=${spokenAt(t).toFixed(1)} mode=${st.mode} target=${st.target} goal=${st.goal.toFixed(1)} rate=${(st.rate * 60000).toFixed(0)}wpm`; }
      res.worstLag = Math.max(res.worstLag, d);
    }
    p = q;
  }
  res.meanLag = sum / n;
  if (DEBUG) debug(`  worst ${worstInfo}`);
  if (DEBUG) debug(`  ahead ${aheadInfo}`);
  return res;
}
