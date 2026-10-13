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
  type Token,
} from "../core";
import { RsvpRenderer, ScrollRenderer, type Renderer } from "./renderers";
import { keyId, resolveCommand, type Command } from "./keys";
import { effectiveFontSize, saveSettings, wpmFor, type Settings } from "./settings";

export type { Command } from "./keys";

const WPM_STEP = 10;
const HUD_MS = 2000;
const SWIPE_PX = 40;
const FONT_STEP = 4;
const FOCUS_STEP = 5;
const COLUMN_STEP = 5;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
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
    this.renderer =
      this.settings.mode === "A"
        ? new ScrollRenderer(this.stage, this.tokens, this.schedule, this.settings)
        : new RsvpRenderer(this.stage, this.tokens, this.settings);
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
    const p = this.clock.tick(now);
    const i = tokenIndexAt(this.schedule, p);
    if (i >= 0) this.renderer?.draw(i, p);
    if (this.clock.state === "finished" && this.wakeLock) this.releaseWakeLock();
    this.updateHud(now);
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private updateHud(now: number): void {
    const playing = this.clock.state === "playing" || this.counting;
    this.hud.classList.toggle("visible", !playing || now < this.hudUntil);
    const state =
      this.counting ? "odliczanie" : this.clock.state === "playing" ? "odtwarzanie" : this.clock.state === "finished" ? "koniec" : "pauza";
    const end = this.schedule[this.tokens.length]!;
    const pct = end > 0 ? Math.round((this.clock.p / end) * 100) : 0;
    const look =
      `${effectiveFontSize(this.settings)} px · punkt ${this.settings.focusPct}%` +
      (this.settings.mode === "A" ? ` · kolumna ${this.settings.columnCh} zn.` : "");
    const info = `Tryb ${this.settings.mode} · ${this.clock.wpm} sł./min · ${pct}% · zostało ${formatTime(
      remainingMs(this.schedule, this.clock.p, this.clock.wpm),
    )} · ${state} · ${look}`;
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
        if (this.counting) this.cancelCountdown();
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
        this.adjustLook((s) => (s.focusPct = clamp(s.focusPct + d, 10, 90)));
        break;
      }
      case "columnNarrower":
      case "columnWider": {
        if (this.settings.mode !== "A") break;
        const d = cmd === "columnWider" ? COLUMN_STEP : -COLUMN_STEP;
        this.adjustLook((s) => (s.columnCh = clamp(s.columnCh + d, 20, 100)));
        break;
      }
      case "exit":
        this.exit();
        break;
    }
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
    const finished = this.clock.state === "finished";
    this.pause();
    // Po przeczytaniu całości następne otwarcie zaczyna od początku.
    const word = finished ? 0 : this.currentWord();
    this.destroy();
    this.onExit(word);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
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
