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
import { RsvpRenderer, ScrollRenderer, type Renderer } from "./renderers";
import { saveSettings, wpmFor, type Settings } from "./settings";
import { SpeechListener, speechSupport, type ListenerStatus } from "./speech";

export type Command =
  | "toggle"
  | "faster"
  | "slower"
  | "prevSentence"
  | "nextSentence"
  | "prevParagraph"
  | "nextParagraph"
  | "home"
  | "fullscreen"
  | "switchMode"
  | "exit";

const NAVIGATION: ReadonlySet<Command> = new Set(["prevSentence", "nextSentence", "prevParagraph", "nextParagraph", "home"]);
const WPM_STEP = 10;
const HUD_MS = 2000;
const SWIPE_PX = 40;

/** Mapowanie klawiszy (sekcja 2) plus klawisze typowych pilotów prezentacyjnych [Z]. */
export function commandForKey(e: KeyboardEvent): Command | null {
  switch (e.key) {
    case " ":
    case "Enter":
    case "b":
    case "B":
    case ".":
    case "F5":
      return "toggle";
    case "ArrowUp":
      return "faster";
    case "ArrowDown":
      return "slower";
    case "ArrowLeft":
      return "prevSentence";
    case "ArrowRight":
      return "nextSentence";
    case "PageUp":
      return "prevParagraph";
    case "PageDown":
      return "nextParagraph";
    case "Home":
      return "home";
    case "f":
    case "F":
      return "fullscreen";
    case "t":
    case "T":
      return "switchMode";
    case "Escape":
      return "exit";
    default:
      return null;
  }
}

function formatTime(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface WakeLockLike {
  release(): Promise<void>;
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
  private wakeLock: WakeLockLike | null = null;
  private resizeObserver: ResizeObserver;
  private lastInfo = "";
  private pointerStart: { x: number; y: number; t: number } | null = null;
  /** Podążanie za głosem; null, gdy wyłączone w ustawieniach lub niedostępne. */
  private voice: { listener: SpeechListener; matcher: VoiceMatcher; follower: VoiceFollower } | null = null;
  private voiceStatus: ListenerStatus = "off";
  private voiceMessage = "";

  constructor(
    private host: HTMLElement,
    private body: string,
    startWord: number,
    private settings: Settings,
    private onExit: (lastWord: number) => void,
  ) {
    this.el = document.createElement("div");
    this.el.className = `player theme-${settings.theme}`;
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

    this.build(startWord);
    if (settings.followVoice && speechSupport().ok) {
      // Dopasowanie po słowach źródłowych: tokeny bez dzielenia długich słów, indeks tokenu = sourceWord.
      const words = tokenize(body, { splitLongWords: false }).map((t) => t.text);
      this.voice = {
        matcher: new VoiceMatcher(words),
        follower: new VoiceFollower(),
        listener: new SpeechListener(
          settings.voiceLang,
          (heard) => this.onHeard(heard),
          (status, message) => {
            this.voiceStatus = status;
            this.voiceMessage = message ?? (status === "error" ? this.voiceMessage : "");
            if (status === "error") this.showHud();
          },
        ),
      };
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
    const bar = document.createElement("div");
    bar.className = "toolbar";
    const buttons: [string, string, Command][] = [
      ["⏮", "Poprzednie zdanie", "prevSentence"],
      ["−", "Wolniej", "slower"],
      ["⏯", "Start / pauza", "toggle"],
      ["+", "Szybciej", "faster"],
      ["⏭", "Następne zdanie", "nextSentence"],
      ["A/B", "Zmień tryb", "switchMode"],
      ["⛶", "Pełny ekran", "fullscreen"],
      ["✕", "Wyjdź do edytora", "exit"],
    ];
    for (const [label, title, cmd] of buttons) {
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
    return bar;
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
    this.renderer =
      this.settings.mode === "A"
        ? new ScrollRenderer(this.stage, this.tokens, this.schedule, this.settings)
        : new RsvpRenderer(this.stage, this.tokens, this.settings);
  }

  private currentWord(): number {
    const i = tokenIndexAt(this.schedule, this.clock.p);
    return i < 0 ? 0 : this.tokens[i]!.sourceWord;
  }

  private frame(now: number): void {
    // Przy podążaniu za głosem zegar stoi, a p ustawia VoiceFollower.
    if (this.voice?.listener.listening) this.clock.seek(this.voice.follower.tick(now, this.clock.p));
    const p = this.clock.tick(now);
    const i = tokenIndexAt(this.schedule, p);
    if (i >= 0) this.renderer?.draw(i, p);
    if (this.clock.state === "finished" && this.wakeLock) this.releaseWakeLock();
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
    const speed = this.voice ? "za głosem" : `${this.clock.wpm} sł./min`;
    const info = `Tryb ${this.settings.mode} · ${speed} · ${pct}% · zostało ${formatTime(
      remainingMs(this.schedule, this.clock.p, this.clock.wpm),
    )} · ${state}`;
    if (info !== this.lastInfo) {
      this.hudInfo.textContent = info;
      this.lastInfo = info;
    }
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
    this.resyncVoice(performance.now());
    this.voice.listener.start();
    this.requestWakeLock();
  }

  private resyncVoice(now: number): void {
    if (!this.voice) return;
    this.voice.matcher.reset(this.currentWord());
    this.voice.follower.reset(this.clock.p, now);
  }

  /** Nowa hipoteza rozpoznawania: dopasowanie i cel = początek słowa po wypowiedzianym. */
  private onHeard(heard: string[]): void {
    const v = this.voice;
    if (!v) return;
    const match = v.matcher.update(heard);
    if (!match) return;
    const next = tokenIndexOfWord(this.tokens, match.word + 1);
    const slot = match.word + 1 > this.tokens[this.tokens.length - 1]!.sourceWord ? this.schedule[this.tokens.length]! : this.schedule[next]!;
    v.follower.setTarget(slot, performance.now());
  }

  private startWithCountdown(): void {
    if (this.tokens.length === 0) return;
    let left = this.settings.countdownS;
    if (left <= 0) {
      this.play();
      return;
    }
    this.counting = true;
    this.overlay.hidden = false;
    this.overlay.textContent = String(left);
    this.requestWakeLock();
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
    this.requestWakeLock();
  }

  private pause(): void {
    if (this.voice?.listener.listening) this.voice.listener.stop();
    if (this.counting) this.cancelCountdown();
    this.clock.pause();
    this.releaseWakeLock();
  }

  private async requestWakeLock(): Promise<void> {
    if (this.wakeLock) return;
    const nav = navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<WakeLockLike> } };
    try {
      this.wakeLock = (await nav.wakeLock?.request("screen")) ?? null;
    } catch {
      this.wakeLock = null;
    }
  }

  private releaseWakeLock(): void {
    const lock = this.wakeLock;
    this.wakeLock = null;
    lock?.release().catch(() => undefined);
  }

  private toggleFullscreen(): void {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => undefined);
    else this.el.requestFullscreen?.().catch(() => undefined);
  }

  private onKey(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const cmd = commandForKey(e);
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
    window.clearInterval(this.countdownTimer);
    window.removeEventListener("keydown", this.onKey);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.resizeObserver.disconnect();
    this.releaseWakeLock();
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => undefined);
    this.renderer?.destroy();
    this.el.remove();
  }
}
