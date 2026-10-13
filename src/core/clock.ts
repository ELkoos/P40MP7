import { DEFAULT_RAMP, MAX_FRAME_DT_MS, WPM_MAX, WPM_MIN } from "./defaults";

export type PlaybackState = "ready" | "playing" | "paused" | "finished";

export interface ClockOptions {
  wpm: number;
  rampMs?: number;
  rampFrom?: number;
  maxDtMs?: number;
}

/**
 * Zegar odtwarzania (6.4). Pozycja p w slotach rośnie z czasem w tempie V/60000 slotów na ms.
 * Czas `now` (ms, np. z performance.now() lub z callbacku rAF) jest wstrzykiwany, więc zegar nie zależy od DOM.
 */
export class PlaybackClock {
  private _p = 0;
  private _wpm: number;
  private _state: PlaybackState = "ready";
  private last: number | null = null;
  private rampStart = 0;
  private readonly rampMs: number;
  private readonly rampFrom: number;
  private readonly maxDt: number;

  constructor(private end: number, opt: ClockOptions) {
    this._wpm = clampWpm(opt.wpm);
    this.rampMs = opt.rampMs ?? DEFAULT_RAMP.durationMs;
    this.rampFrom = opt.rampFrom ?? DEFAULT_RAMP.from;
    this.maxDt = opt.maxDtMs ?? MAX_FRAME_DT_MS;
  }

  get p(): number {
    return this._p;
  }
  get wpm(): number {
    return this._wpm;
  }
  get state(): PlaybackState {
    return this._state;
  }

  /** Mnożnik rozbiegu k: od rampFrom do 1 liniowo przez rampMs. */
  rampFactor(now: number): number {
    if (this.rampMs <= 0) return 1;
    const t = Math.min(1, Math.max(0, (now - this.rampStart) / this.rampMs));
    return this.rampFrom + (1 - this.rampFrom) * t;
  }

  play(now: number): void {
    if (this._state === "playing" || this.end <= 0) return;
    if (this._state === "finished") this._p = 0;
    this._state = "playing";
    this.last = now;
    this.rampStart = now;
  }

  pause(): void {
    if (this._state === "playing") this._state = "paused";
    this.last = null;
  }

  /** Zmiana prędkości (F-06): zmienia tylko tempo, p zostaje ciągłe. */
  setWpm(wpm: number): void {
    this._wpm = clampWpm(wpm);
  }

  /** Skok do pozycji (cofnięcie, przeskok); przy odtwarzaniu włącza rozbieg od `now`. */
  seek(p: number, now?: number): void {
    this._p = Math.min(this.end, Math.max(0, p));
    if (this._state === "finished" && this._p < this.end) this._state = "paused";
    if (this._state === "playing" && now !== undefined) {
      this.rampStart = now;
      this.last = now;
    }
  }

  /** Nowy tekst: nowy koniec, pozycja na początku. */
  reset(end: number): void {
    this.end = end;
    this._p = 0;
    this._state = "ready";
    this.last = null;
  }

  /** Wywoływane w każdej klatce; zwraca bieżące p. */
  tick(now: number): number {
    if (this._state !== "playing") return this._p;
    const dt = this.last === null ? 0 : Math.min(Math.max(0, now - this.last), this.maxDt);
    this.last = now;
    this._p += dt * (this._wpm / 60000) * this.rampFactor(now);
    if (this._p >= this.end) {
      this._p = this.end;
      this._state = "finished";
    }
    return this._p;
  }
}

export function clampWpm(wpm: number): number {
  return Math.min(WPM_MAX, Math.max(WPM_MIN, wpm));
}
