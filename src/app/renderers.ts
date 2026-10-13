import { columnOffset, scrollY, sentenceRange, splitAtOrp, rsvpLeftEdge, type MeasuredLine, type Token } from "../core";
import { FONT_STACKS, effectiveFontSize, type Settings } from "./settings";

/** Wspólny interfejs obu trybów: renderer tylko odczytuje pozycję zegara (sekcja 5). */
export interface Renderer {
  /** Ponowny pomiar po zmianie rozmiaru, czcionki lub ustawień. */
  layout(): void;
  draw(i: number, p: number): void;
  /** Wywoływane w każdej klatce: true, gdy odtwarzanie stoi (pauza, gotowość, koniec). */
  setPaused(paused: boolean): void;
  destroy(): void;
}

function focusPx(stage: HTMLElement, s: Settings): number {
  return (stage.clientHeight * s.focusPct) / 100;
}

function applyTypography(el: HTMLElement, s: Settings): void {
  el.style.fontFamily = FONT_STACKS[s.font];
  el.style.fontSize = `${effectiveFontSize(s)}px`;
  el.style.lineHeight = String(s.lineHeight);
}

/** Tryb A: przewijanie z linią odczytu (6.5). */
export class ScrollRenderer implements Renderer {
  private root: HTMLDivElement;
  private column: HTMLDivElement;
  private dimTop: HTMLDivElement;
  private dimBottom: HTMLDivElement;
  private spans: HTMLSpanElement[] = [];
  private lines: MeasuredLine[] = [];
  private lineHeightPx = 0;
  private focus = 0;
  private current = -1;

  constructor(
    private stage: HTMLElement,
    tokens: readonly Token[],
    private schedule: Float64Array,
    private settings: Settings,
  ) {
    this.root = document.createElement("div");
    this.root.className = "mode-a";
    this.column = document.createElement("div");
    this.column.className = "column";
    applyTypography(this.column, settings);
    this.column.style.maxWidth = `${settings.columnCh}ch`;

    let para: HTMLParagraphElement | null = null;
    let paraIndex = -1;
    tokens.forEach((t, i) => {
      if (t.paragraphIndex !== paraIndex) {
        para = document.createElement("p");
        this.column.appendChild(para);
        paraIndex = t.paragraphIndex;
      }
      const span = document.createElement("span");
      span.textContent = t.text;
      this.spans.push(span);
      para!.appendChild(span);
      if (t.lineBreakAfter) para!.appendChild(document.createElement("br"));
      else if (!t.paragraphEnd && i < tokens.length - 1) para!.appendChild(document.createTextNode(" "));
    });

    this.dimTop = document.createElement("div");
    this.dimTop.className = "dim dim-top";
    this.dimBottom = document.createElement("div");
    this.dimBottom.className = "dim dim-bottom";
    const marker = document.createElement("div");
    marker.className = "reading-line";
    this.root.append(this.column, this.dimTop, this.dimBottom, marker);
    stage.appendChild(this.root);
    this.layout();
  }

  layout(): void {
    this.lineHeightPx = parseFloat(getComputedStyle(this.column).lineHeight) || effectiveFontSize(this.settings) * this.settings.lineHeight;
    this.focus = focusPx(this.stage, this.settings);
    const lines: MeasuredLine[] = [];
    let lastTop = Number.NEGATIVE_INFINITY;
    this.spans.forEach((span, i) => {
      const top = span.offsetTop;
      if (Math.abs(top - lastTop) > 1) {
        lines.push({ y: top, firstToken: i, lastToken: i });
        lastTop = top;
      } else {
        lines[lines.length - 1]!.lastToken = i;
      }
    });
    this.lines = lines;
    // Przyciemnienie poza wierszem odczytu (6.5 pkt 5): nieruchome nakładki.
    const half = this.lineHeightPx / 2;
    this.dimTop.style.height = `${Math.max(0, this.focus - half)}px`;
    this.dimBottom.style.top = `${this.focus + half}px`;
    const marker = this.root.querySelector<HTMLElement>(".reading-line")!;
    marker.style.top = `${this.focus - half}px`;
    marker.style.height = `${this.lineHeightPx}px`;
  }

  draw(i: number, p: number): void {
    const y = scrollY(this.lines, this.schedule, p, this.lineHeightPx);
    const offset = columnOffset(this.focus, y, this.lineHeightPx);
    this.column.style.transform = `translate3d(-50%, ${offset}px, 0)`;
    if (i !== this.current) {
      this.spans[this.current]?.classList.remove("current");
      this.spans[i]?.classList.add("current");
      this.current = i;
    }
  }

  setPaused(): void {}

  destroy(): void {
    this.root.remove();
  }
}

/** Tryb B: jedno słowo, litera ORP w stałym punkcie (6.6). */
export class RsvpRenderer implements Renderer {
  private root: HTMLDivElement;
  private word: HTMLDivElement;
  private prefix: HTMLSpanElement;
  private orp: HTMLSpanElement;
  private suffix: HTMLSpanElement;
  private next: HTMLDivElement;
  private ticks: HTMLDivElement;
  /** Zdanie wokół bieżącego słowa, widoczne tylko w pauzie (możliwość „cofnięcia wzroku”). */
  private context: HTMLDivElement;
  private paused = false;
  private contextFor = -1;
  private ctx: CanvasRenderingContext2D | null;
  private widthCache = new Map<string, number>();
  private anchorX = 0;
  private focus = 0;
  private current = -1;

  constructor(
    private stage: HTMLElement,
    private tokens: readonly Token[],
    private settings: Settings,
  ) {
    this.root = document.createElement("div");
    this.root.className = "mode-b";
    applyTypography(this.root, settings);
    this.word = document.createElement("div");
    this.word.className = "word";
    this.prefix = document.createElement("span");
    this.orp = document.createElement("span");
    this.orp.className = "orp";
    this.suffix = document.createElement("span");
    this.word.append(this.prefix, this.orp, this.suffix);
    this.next = document.createElement("div");
    this.next.className = "next-word";
    this.next.hidden = !settings.showNext;
    this.ticks = document.createElement("div");
    this.ticks.className = "orp-ticks";
    this.context = document.createElement("div");
    this.context.className = "context";
    this.context.hidden = true;
    this.context.style.maxWidth = `${settings.columnCh}ch`;
    this.root.append(this.ticks, this.word, this.next, this.context);
    stage.appendChild(this.root);
    this.ctx = document.createElement("canvas").getContext("2d");
    this.layout();
  }

  layout(): void {
    this.anchorX = this.stage.clientWidth / 2;
    this.focus = focusPx(this.stage, this.settings);
    const size = effectiveFontSize(this.settings);
    this.ticks.style.left = `${this.anchorX}px`;
    this.ticks.style.top = `${this.focus - size * 0.9}px`;
    this.ticks.style.height = `${size * 1.8}px`;
    this.word.style.top = `${this.focus}px`;
    this.next.style.top = `${this.focus + size * 1.2}px`;
    this.context.style.top = `${this.focus + size * 1.2}px`;
    if (this.ctx) {
      const cs = getComputedStyle(this.word);
      this.ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    }
    this.widthCache.clear();
    const i = this.current;
    this.current = -1;
    if (i >= 0) this.draw(i);
  }

  private width(text: string): number {
    if (!this.ctx || text === "") return 0;
    let w = this.widthCache.get(text);
    if (w === undefined) {
      w = this.ctx.measureText(text).width;
      this.widthCache.set(text, w);
    }
    return w;
  }

  draw(i: number): void {
    if (i === this.current) return;
    this.current = i;
    const t = this.tokens[i];
    if (!t) return;
    const parts = splitAtOrp(t.text, t.orpIndex);
    this.prefix.textContent = parts.prefix;
    this.orp.textContent = parts.orp;
    this.suffix.textContent = parts.suffix;
    const left = parts.orp === "" ? this.anchorX - this.width(t.text) / 2 : rsvpLeftEdge(this.anchorX, this.width(parts.prefix), this.width(parts.orp));
    this.word.style.left = `${left}px`;
    if (this.settings.showNext) {
      this.next.textContent = this.tokens[i + 1]?.text ?? "";
      this.next.style.left = `${this.anchorX}px`;
    }
    if (this.paused) this.renderContext();
  }

  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    this.context.hidden = !paused;
    this.next.hidden = paused || !this.settings.showNext;
    if (paused) this.renderContext();
  }

  /** Całe zdanie z wyróżnionym bieżącym słowem; kawałki długich słów sklejone bez łącznika. */
  private renderContext(): void {
    const i = this.current;
    if (i < 0 || i === this.contextFor) return;
    this.contextFor = i;
    const [start, end] = sentenceRange(this.tokens, i);
    const cur = this.tokens[i]!.sourceWord;
    this.context.replaceChildren();
    let k = start;
    while (k <= end) {
      const word = this.tokens[k]!.sourceWord;
      let text = "";
      while (k <= end && this.tokens[k]!.sourceWord === word) {
        const t = this.tokens[k]!.text;
        const continued = k < end && this.tokens[k + 1]!.sourceWord === word;
        text += continued && t.endsWith("-") ? t.slice(0, -1) : t;
        k++;
      }
      if (this.context.childNodes.length > 0) this.context.append(" ");
      const span = document.createElement("span");
      span.textContent = text;
      if (word === cur) span.className = "current";
      this.context.append(span);
    }
  }

  destroy(): void {
    this.root.remove();
  }
}
