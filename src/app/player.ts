import {
  PlaybackClock,
  buildSchedule,
  nextParagraph,
  nextSentence,
  previousParagraph,
  previousSentence,
  remainingMs,
  tokenIndexAt,
  tokenIndexOfWord,
  tokenize,
  VoiceFollower,
  VoiceMatcher,
  type Token,
} from "../core";
import { RecordingController } from "./recorder";
import { RsvpRenderer, ScrollRenderer, type Renderer } from "./renderers";
import { keyId, resolveCommand, type Command } from "./keys";
import { effectiveFontSize, saveSettings, wpmFor, type Settings } from "./settings";
import { SpeechListener, speechSupport, type ListenerStatus } from "./speech";
import { VoiceActivityDetector } from "./vad";
import { VoiceLog } from "./voicelog";
import { WakeLockHolder } from "./wakelock";

export type { Command } from "./keys";

const NAVIGATION: ReadonlySet<Command> = new Set(["prevSentence", "nextSentence", "prevParagraph", "nextParagraph", "home"]);
const WPM_STEP = 10;
const HUD_MS = 2000;
const SWIPE_PX = 40;
const FONT_STEP = 4;
const FOCUS_STEP = 5;
const COLUMN_STEP = 5;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Tyle ms mowy wg detektora bez żadnego wyniku rozpoznawania wyłącza detektor. */
const VAD_NO_RESULT_MS = 4000;

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

function formatTime(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Ekran odtwarzania: maszyna stanów, pętla rAF, wejście, Wake Lock (sekcje 5 i 6.4). */
export class Player {
  private el: HTMLDivElement;
  private stage: HTMLDivElement;
  private hud: HTMLDivElement;
  private hudInfo: HTMLDivElement;
  private overlay: HTMLDivElement;
  private tokens: Token[] = [];
  private schedule: Float64Array = new Float64Array(1);
  private clock!: PlaybackClock;
  private renderer: Renderer | null = null;
  private raf = 0;
  private hudUntil = 0;
  private countdownTimer = 0;
  private counting = false;
  private wakeLock = new WakeLockHolder();
  private resizeObserver: ResizeObserver;
  private lastInfo = "";
  private pointerStart: { x: number; y: number; t: number } | null = null;
  private rec: RecordingController | null = null;
  private finishedSeen = false;
  /** Podążanie za głosem; null, gdy wyłączone w ustawieniach lub niedostępne. */
  private voice: { listener: SpeechListener; matcher: VoiceMatcher; follower: VoiceFollower } | null = null;
  private voiceStatus: ListenerStatus = "off";
  private voiceMessage = "";
  /** Detektor głosu z mikrofonu (lokalny); null, gdy niedostępny. */
  private vad: VoiceActivityDetector | null = null;
  private vadStarting = false;
  /** Diagnostyka głosu (ustawienie voiceDebug). */
  private voiceLog: VoiceLog | null = null;
  private debugEl: HTMLPreElement | null = null;
  private lastHeard: string[] = [];
  private lastMatchText = "—";
  private lastDebugAt = 0;
  private lastPosLogAt = 0;
  private lastVadLogged: boolean | null = null;
  /** Wyniki rozpoznawania ze słowami w tym otwarciu odtwarzacza i czas mowy wg detektora bez żadnego wyniku. */
  private resultCount = 0;
  private vadTalkNoResultMs = 0;
  private lastFrameAt: number | null = null;
  /** Detektor wyłączony na stałe w tym otwarciu (Android albo odbierał mikrofon rozpoznawaniu). */
  private vadDisabled = false;

  constructor(
    private host: HTMLElement,
    private body: string,
    startWord: number,
    private settings: Settings,
    private onExit: (lastWord: number) => void,
    title = "",
  ) {
    this.el = document.createElement("div");
    this.el.className = `player theme-${settings.theme}`;
    // Na telefonie pionowa kolumna przycisków rezerwuje miejsce na STOP nagrywania.
    this.el.classList.toggle("has-rec", settings.record);
    this.stage = document.createElement("div");
    this.stage.className = "stage";
    this.overlay = document.createElement("div");
    this.overlay.className = "overlay";
    this.overlay.hidden = true;
    this.hud = document.createElement("div");
    this.hud.className = "hud";
    this.hudInfo = document.createElement("div");
    this.hudInfo.className = "hud-info";
    this.hud.append(this.hudInfo, this.buildToolbar());
    this.el.append(this.stage, this.overlay, this.hud);
    host.appendChild(this.el);
    if (settings.record) this.rec = new RecordingController(this.el, settings, title, () => this.pause());

    this.build(startWord);
    if (settings.followVoice && speechSupport().ok) {
      // Dopasowanie po słowach źródłowych: tokeny bez dzielenia długich słów, indeks tokenu = sourceWord.
      const words = tokenize(body, { splitLongWords: false }).map((t) => t.text);
      this.voice = {
        matcher: new VoiceMatcher(words),
        follower: new VoiceFollower({ latencyMs: settings.voiceLatencyMs }),
        listener: new SpeechListener(
          settings.voiceLang,
          (heard) => this.onHeard(heard),
          (status, message) => {
            this.voiceStatus = status;
            this.voiceMessage = message ?? (status === "error" ? this.voiceMessage : "");
            if (status === "error") this.showHud();
            this.voiceLog?.add([performance.now(), "status", status, message ?? ""]);
          },
          () => {
            const now = performance.now();
            this.voice?.follower.bridgeRestart(now);
            this.voiceLog?.add([now, "restart"]);
          },
        ),
      };
      if (settings.voiceDebug) this.buildVoiceDebug(words);
    }

    this.onKey = this.onKey.bind(this);
    this.onVisibility = this.onVisibility.bind(this);
    window.addEventListener("keydown", this.onKey);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.stage.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    this.stage.addEventListener("pointerup", (e) => this.onPointerUp(e));
    this.resizeObserver = new ResizeObserver(() => this.renderer?.layout());
    this.resizeObserver.observe(this.stage);
    document.fonts?.ready.then(() => this.renderer?.layout());

    this.showHud();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private buildToolbar(): HTMLDivElement {
    const wrap = document.createElement("div");
    wrap.className = "toolbars";
    const rows: [string, string, Command][][] = [
      [
        ["⏮", "Poprzednie zdanie", "prevSentence"],
        ["−", "Wolniej", "slower"],
        ["⏯", "Start / pauza", "toggle"],
        ["+", "Szybciej", "faster"],
        ["⏭", "Następne zdanie", "nextSentence"],
        ["A/B", "Zmień tryb", "switchMode"],
        ...(this.settings.record ? ([["●", "Nagrywanie start / stop (R)", "record"]] as [string, string, Command][]) : []),
        ["⛶", "Pełny ekran", "fullscreen"],
        ["✕", "Wyjdź do edytora", "exit"],
      ],
      // E3: strojenie wyglądu bez wychodzenia z odtwarzacza.
      [
        ["A−", "Mniejsza czcionka", "fontDown"],
        ["A+", "Większa czcionka", "fontUp"],
        ["▲", "Punkt odczytu wyżej", "focusUp"],
        ["▼", "Punkt odczytu niżej", "focusDown"],
        ["→←", "Węższa kolumna", "columnNarrower"],
        ["←→", "Szersza kolumna", "columnWider"],
      ],
    ];
    for (const row of rows) {
      const bar = document.createElement("div");
      bar.className = "toolbar";
      for (const [label, title, cmd] of row) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        b.title = title;
        b.setAttribute("aria-label", title);
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          this.command(cmd);
        });
        bar.appendChild(b);
      }
      wrap.appendChild(bar);
    }
    return wrap;
  }

  /** Tokenizacja, harmonogram i renderer dla bieżącego trybu; pozycja na początku słowa źródłowego. */
  private build(startWord: number): void {
    this.renderer?.destroy();
    this.tokens = tokenize(this.body, { splitLongWords: this.settings.mode === "B" });
    this.schedule = buildSchedule(this.tokens);
    const end = this.schedule[this.tokens.length]!;
    this.clock = new PlaybackClock(end, { wpm: wpmFor(this.settings), rampMs: this.settings.rampMs });
    const i = Math.max(0, tokenIndexOfWord(this.tokens, startWord));
    if (this.tokens.length > 0) this.clock.seek(this.schedule[i]!);
    this.createRenderer();
  }

  /** Nowy renderer z bieżącymi ustawieniami; zegar i pozycja zostają bez zmian (E3). */
  private createRenderer(): void {
    this.renderer?.destroy();
    const view = RecordingController.viewSettings(this.settings);
    this.renderer =
      this.settings.mode === "A"
        ? new ScrollRenderer(this.stage, this.tokens, this.schedule, view)
        : new RsvpRenderer(this.stage, this.tokens, view);
  }

  private adjustLook(change: (s: Settings) => void): void {
    change(this.settings);
    saveSettings(this.settings);
    this.createRenderer();
  }

  private currentWord(): number {
    const i = tokenIndexAt(this.schedule, this.clock.p);
    return i < 0 ? 0 : this.tokens[i]!.sourceWord;
  }

  private frame(now: number): void {
    // Przy podążaniu za głosem zegar stoi, a p ustawia VoiceFollower.
    if (this.voice?.listener.listening) {
      const dt = this.lastFrameAt === null ? 0 : Math.min(now - this.lastFrameAt, 100);
      this.lastFrameAt = now;
      if (this.vad) {
        const active = this.vad.sample(now);
        // Detektor słyszy mowę, a rozpoznawanie nie zwraca nic: drugi dostęp do mikrofonu zabiera dźwięk
        // rozpoznawaniu (tak było na Androidzie). Wyłączamy detektor i zostajemy przy samym rozpoznawaniu.
        if (active && this.resultCount === 0) this.vadTalkNoResultMs += dt;
        if (this.vadTalkNoResultMs > VAD_NO_RESULT_MS) {
          this.disableVad(now, "detektor słyszy mowę, a rozpoznawanie nie zwraca słów");
        } else this.voice.follower.voiceActivity(now, active);
        if (this.vad && active !== this.lastVadLogged) {
          this.voiceLog?.add([now, "vad", active, round4(this.vad.level), round4(this.vad.noiseFloor)]);
          this.lastVadLogged = active;
        }
      }
      this.clock.seek(this.voice.follower.tick(now, this.clock.p));
      this.updateVoiceDebug(now);
    }
    const p = this.clock.tick(now);
    const i = tokenIndexAt(this.schedule, p);
    if (i >= 0) this.renderer?.draw(i, p);
    const listening = this.voice?.listener.listening ?? false;
    this.renderer?.setPaused(this.clock.state !== "playing" && !this.counting && !listening);
    // Ekran może gasnąć, gdy nic się nie dzieje: pauza, koniec tekstu, mikrofon wyłączony przez błąd.
    if (this.clock.state !== "playing" && !this.counting && !listening) this.wakeLock.release();
    if (this.rec) {
      // Przy podążaniu za głosem zegar stoi, więc koniec tekstu i „odtwarzanie” wynikają z pozycji i mikrofonu.
      const finished = this.clock.state === "finished" || (listening && p >= this.schedule[this.tokens.length]!);
      if (finished && !this.finishedSeen) this.rec.finished();
      this.finishedSeen = finished;
      this.rec.setPlaying(this.clock.state === "playing" || this.counting || listening);
    }
    this.updateHud(now);
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private updateHud(now: number): void {
    const listening = this.voice?.listener.listening ?? false;
    const playing = this.clock.state === "playing" || this.counting || listening;
    this.hud.classList.toggle("visible", !playing || now < this.hudUntil || this.voiceStatus === "error");
    const state = listening
      ? this.voiceStatus === "error"
        ? `mikrofon: ${this.voiceMessage}`
        : this.voiceStatus === "listening"
          ? "słucham"
          : "włączanie mikrofonu"
      : this.voiceStatus === "error"
        ? `mikrofon: ${this.voiceMessage}`
        : this.counting
          ? "odliczanie"
          : this.clock.state === "playing"
            ? "odtwarzanie"
            : this.clock.state === "finished"
              ? "koniec"
              : "pauza";
    const end = this.schedule[this.tokens.length]!;
    const pct = end > 0 ? Math.round((this.clock.p / end) * 100) : 0;
    const view = RecordingController.viewSettings(this.settings);
    const look =
      `${effectiveFontSize(view)} px · punkt ${view.focusPct}%` +
      (view.mode === "A" ? ` · kolumna ${view.columnCh} zn.` : "");
    const speed = this.voice ? "za głosem" : `${this.clock.wpm} sł./min`;
    const info = `Tryb ${this.settings.mode} · ${speed} · ${pct}% · zostało ${this.remainingText(now)} · ${state} · ${look}`;
    if (info !== this.lastInfo) {
      this.hudInfo.textContent = info;
      this.lastInfo = info;
    }
  }

  /** Czas do końca: z ustawionej prędkości, a przy podążaniu za głosem z tempa lektora („—” przed pomiarem). */
  private remainingText(now: number): string {
    if (!this.voice) return formatTime(remainingMs(this.schedule, this.clock.p, this.clock.wpm));
    const rate = this.voice.follower.measuredRate(now);
    if (!rate) return "—";
    // rate w slotach na ms, remainingMs przyjmuje sloty na minutę.
    return formatTime(remainingMs(this.schedule, this.clock.p, rate * 60000));
  }

  private showHud(): void {
    this.hudUntil = performance.now() + HUD_MS;
  }

  command(cmd: Command): void {
    const now = performance.now();
    this.showHud();
    switch (cmd) {
      case "toggle":
        if (this.voice) {
          if (this.voice.listener.listening) this.pause();
          else this.startVoice();
        } else if (this.counting) this.cancelCountdown();
        else if (this.clock.state === "playing") this.pause();
        else this.startWithCountdown();
        break;
      case "faster":
      case "slower": {
        const delta = cmd === "faster" ? WPM_STEP : -WPM_STEP;
        this.clock.setWpm(this.clock.wpm + delta);
        if (this.settings.mode === "A") this.settings.wpmA = this.clock.wpm;
        else this.settings.wpmB = this.clock.wpm;
        saveSettings(this.settings);
        break;
      }
      case "prevSentence":
        this.clock.seek(previousSentence(this.tokens, this.schedule, this.clock.p), now);
        break;
      case "nextSentence":
        this.clock.seek(nextSentence(this.tokens, this.schedule, this.clock.p), now);
        break;
      case "prevParagraph":
        this.clock.seek(previousParagraph(this.tokens, this.schedule, this.clock.p), now);
        break;
      case "nextParagraph":
        this.clock.seek(nextParagraph(this.tokens, this.schedule, this.clock.p), now);
        break;
      case "home":
        this.clock.seek(0, now);
        break;
      case "fullscreen":
        this.toggleFullscreen();
        break;
      case "switchMode": {
        const word = this.currentWord();
        this.pause();
        this.settings.mode = this.settings.mode === "A" ? "B" : "A";
        saveSettings(this.settings);
        this.build(word);
        break;
      }
      case "fontUp":
      case "fontDown": {
        const d = cmd === "fontUp" ? FONT_STEP : -FONT_STEP;
        this.adjustLook((s) => (s.fontSizePx = clamp(effectiveFontSize(s) + d, 16, 160)));
        break;
      }
      case "focusUp":
      case "focusDown": {
        const d = cmd === "focusUp" ? -FOCUS_STEP : FOCUS_STEP;
        // Przy nagrywaniu z kamerą z boku punkt odczytu jest stały (środek wysokości).
        if (this.settings.record && this.settings.cameraEdge !== "top") break;
        this.adjustLook((s) => {
          if (s.record) s.recFocusPct = clamp(s.recFocusPct + d, 3, 40);
          else s.focusPct = clamp(s.focusPct + d, 10, 90);
        });
        break;
      }
      case "columnNarrower":
      case "columnWider": {
        if (this.settings.mode !== "A") break;
        const d = cmd === "columnWider" ? COLUMN_STEP : -COLUMN_STEP;
        this.adjustLook((s) => {
          if (s.record) s.recColumnCh = clamp(s.recColumnCh + d, 12, 60);
          else s.columnCh = clamp(s.columnCh + d, 20, 100);
        });
        break;
      }
      case "record":
        this.rec?.toggle();
        break;
      case "preview":
        this.rec?.togglePreview();
        break;
      case "exit":
        this.exit();
        break;
    }
    // Po nawigacji ręcznej dopasowanie zaczyna od nowej pozycji.
    if (this.voice && NAVIGATION.has(cmd)) this.resyncVoice(now);
  }

  private startVoice(): void {
    if (!this.voice || this.tokens.length === 0) return;
    if (this.clock.p >= this.schedule[this.tokens.length]!) this.clock.seek(0);
    this.voiceMessage = "";
    this.rec?.countdownStarted();
    this.resyncVoice(performance.now());
    this.voice.listener.start();
    this.startVad();
    void this.wakeLock.acquire();
  }

  /** Detektor głosu: osobny dostęp do mikrofonu przez Web Audio; bez niego cisza wynika z wyników rozpoznawania. */
  private startVad(): void {
    if (this.vad || this.vadStarting || this.vadDisabled) return;
    // Android: drugi dostęp do mikrofonu odbiera dźwięk rozpoznawaniu mowy (log z Androida 10, Chrome 155:
    // 0 wyników przez 29 s, sesje kończone co ok. 5,4 s). Tam cisza wynika z samych wyników rozpoznawania.
    if (/Android/i.test(navigator.userAgent)) {
      this.disableVad(performance.now(), "Android: bez detektora, mikrofon tylko dla rozpoznawania");
      return;
    }
    this.vadStarting = true;
    void VoiceActivityDetector.start(this.settings.micId).then((vad) => {
      this.vadStarting = false;
      if (!vad) return;
      // Odtwarzacz mógł zostać zamknięty albo zatrzymany w międzyczasie.
      if (!this.el.isConnected || !this.voice?.listener.listening) vad.stop();
      else this.vad = vad;
    });
  }

  private stopVad(): void {
    this.vad?.stop();
    this.vad = null;
    this.lastVadLogged = null;
  }

  private disableVad(now: number, reason: string): void {
    this.vadDisabled = true;
    this.stopVad();
    this.voice?.follower.clearVoiceActivity(now);
    this.voiceLog?.add([now, "note", `detektor wyłączony: ${reason}`]);
  }

  private buildVoiceDebug(words: string[]): void {
    const s = this.settings;
    this.voiceLog = new VoiceLog({ lang: s.voiceLang, latencyMs: s.voiceLatencyMs, wpm: wpmFor(s), mode: s.mode }, words);
    const box = document.createElement("div");
    box.className = "voice-debug";
    this.debugEl = document.createElement("pre");
    const save = document.createElement("button");
    save.type = "button";
    save.textContent = "Zapisz log";
    save.addEventListener("pointerdown", (e) => e.stopPropagation());
    save.addEventListener("click", (e) => {
      e.stopPropagation();
      this.voiceLog?.download();
    });
    box.append(this.debugEl, save);
    this.el.append(box);
  }

  private updateVoiceDebug(now: number): void {
    const v = this.voice;
    if (!v || !this.voiceLog) return;
    const st = v.follower.state(now);
    const wpm = Math.round(st.rate * 60000);
    if (now - this.lastPosLogAt >= 250) {
      this.lastPosLogAt = now;
      this.voiceLog.add([now, "pos", round4(this.clock.p), round4(st.goal), round4(st.target), st.mode, wpm]);
    }
    if (!this.debugEl || now - this.lastDebugAt < 200) return;
    this.lastDebugAt = now;
    const vad = this.vad
      ? `${this.vad.active ? "mówi" : "cisza"} (poziom ${this.vad.level.toFixed(3)}, tło ${this.vad.noiseFloor.toFixed(3)})`
      : `${this.vadDisabled ? "wyłączony" : "brak"} (cisza z wyników)`;
    this.debugEl.textContent = [
      `słyszę (wyników ${this.resultCount}): ${this.lastHeard.slice(-6).join(" ") || "—"}`,
      `dopasowanie: ${this.lastMatchText}`,
      `tryb: ${st.mode} · tempo ${wpm} sł./min${st.measured ? "" : " (z ustawień)"}`,
      `od dopasowania ${(st.msSinceMatch / 1000).toFixed(1)} s · od mowy ${(st.msSinceSpeech / 1000).toFixed(1)} s`,
      `głos z mikrofonu: ${vad}`,
      `tekst: ${this.clock.p.toFixed(1)} · cel ${st.goal.toFixed(1)} · wynik ${st.target.toFixed(1)}`,
    ].join("\n");
  }

  private resyncVoice(now: number): void {
    if (!this.voice) return;
    this.voiceLog?.add([now, "nav", this.currentWord()]);
    this.voice.matcher.reset(this.currentWord());
    // Tempo startowe z ustawionej prędkości (słowo ≈ slot), zanim zmierzymy tempo lektora.
    this.voice.follower.reset(this.clock.p, now, wpmFor(this.settings) / 60000);
  }

  /** Nowa hipoteza rozpoznawania: dopasowanie i cel = początek słowa po wypowiedzianym. */
  private onHeard(heard: string[]): void {
    const v = this.voice;
    if (!v) return;
    const now = performance.now();
    // Każdy wynik ze słowami to znak, że lektor mówi, nawet jeśli słowa się nie dopasują.
    v.follower.heard(now);
    this.resultCount++;
    this.lastHeard = heard;
    this.voiceLog?.add([now, "result", heard]);
    const match = v.matcher.update(heard);
    if (!match) return;
    this.voiceLog?.add([now, "match", match.word, round4(match.score), match.matched]);
    if (this.voiceLog) this.lastMatchText = `słowo ${match.word + 1} „${this.tokens.find((t) => t.sourceWord === match.word)?.text ?? "?"}” (zgodnych ${match.matched})`;
    const next = tokenIndexOfWord(this.tokens, match.word + 1);
    const slot = match.word + 1 > this.tokens[this.tokens.length - 1]!.sourceWord ? this.schedule[this.tokens.length]! : this.schedule[next]!;
    v.follower.setTarget(slot, now);
  }

  private startWithCountdown(): void {
    if (this.tokens.length === 0) return;
    this.rec?.countdownStarted();
    let left = this.settings.countdownS;
    if (left <= 0) {
      this.play();
      return;
    }
    this.counting = true;
    this.overlay.hidden = false;
    this.overlay.textContent = String(left);
    void this.wakeLock.acquire();
    this.countdownTimer = window.setInterval(() => {
      left--;
      if (left <= 0) {
        this.cancelCountdown();
        this.play();
      } else {
        this.overlay.textContent = String(left);
      }
    }, 1000);
  }

  private cancelCountdown(): void {
    window.clearInterval(this.countdownTimer);
    this.counting = false;
    this.overlay.hidden = true;
  }

  private play(): void {
    this.clock.play(performance.now());
    void this.wakeLock.acquire();
  }

  private pause(): void {
    if (this.voice?.listener.listening) this.voice.listener.stop();
    this.stopVad();
    if (this.counting) this.cancelCountdown();
    this.clock.pause();
    this.wakeLock.release();
  }

  private toggleFullscreen(): void {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => undefined);
    else this.el.requestFullscreen?.().catch(() => undefined);
  }

  private onKey(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const cmd = resolveCommand(keyId(e), this.settings.keyMap);
    if (!cmd) return;
    e.preventDefault();
    this.command(cmd);
  }

  private onVisibility(): void {
    if (document.visibilityState === "hidden") this.pause();
  }

  /** Dotyk (F-20): dotknięcie = start/pauza, przesunięcie pionowe = prędkość, poziome = zdanie. */
  private onPointerDown(e: PointerEvent): void {
    this.pointerStart = { x: e.clientX, y: e.clientY, t: performance.now() };
  }

  private onPointerUp(e: PointerEvent): void {
    const start = this.pointerStart;
    this.pointerStart = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) < SWIPE_PX && Math.abs(dy) < SWIPE_PX) {
      this.command("toggle");
    } else if (Math.abs(dy) >= Math.abs(dx)) {
      const steps = Math.max(1, Math.round(Math.abs(dy) / SWIPE_PX));
      for (let k = 0; k < steps; k++) this.command(dy < 0 ? "faster" : "slower");
    } else {
      this.command(dx > 0 ? "prevSentence" : "nextSentence");
    }
  }

  private exit(): void {
    // Przy podążaniu za głosem zegar nie przechodzi w stan "finished", więc sprawdzamy też pozycję.
    const finished = this.clock.state === "finished" || (this.tokens.length > 0 && this.clock.p >= this.schedule[this.tokens.length]!);
    this.pause();
    // Po przeczytaniu całości następne otwarcie zaczyna od początku.
    const word = finished ? 0 : this.currentWord();
    this.destroy();
    this.onExit(word);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    if (this.voice?.listener.listening) this.voice.listener.stop();
    this.stopVad();
    window.clearInterval(this.countdownTimer);
    window.removeEventListener("keydown", this.onKey);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.resizeObserver.disconnect();
    this.wakeLock.release();
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => undefined);
    this.renderer?.destroy();
    // Trwające nagranie zostaje zapisane do pliku także po wyjściu z odtwarzacza.
    void this.rec?.destroy();
    this.el.remove();
  }
}
