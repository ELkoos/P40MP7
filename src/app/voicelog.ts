/**
 * Zapis przebiegu podążania za głosem do pliku JSON (diagnostyka). Plik zostaje na urządzeniu,
 * dopóki użytkownik sam go komuś nie wyśle; zawiera tekst skryptu i rozpoznane słowa.
 */
export type VoiceLogEvent =
  | [t: number, kind: "result", words: string[]]
  | [t: number, kind: "match", word: number, score: number, matched: number]
  | [t: number, kind: "vad", active: boolean, level: number, floor: number]
  | [t: number, kind: "pos", p: number, goal: number, target: number, mode: string, rateWpm: number]
  | [t: number, kind: "status", status: string, message: string]
  | [t: number, kind: "restart"]
  | [t: number, kind: "nav", word: number]
  | [t: number, kind: "note", text: string];

const MAX_EVENTS = 50000;

export class VoiceLog {
  readonly events: VoiceLogEvent[] = [];
  private readonly t0 = performance.now();

  constructor(
    private readonly meta: Record<string, unknown>,
    private readonly words: string[],
  ) {}

  add(e: VoiceLogEvent): void {
    if (this.events.length >= MAX_EVENTS) return;
    e[0] = Math.round(e[0] - this.t0);
    this.events.push(e);
  }

  toJSON(): unknown {
    return { format: "prompter-voice-log", version: 1, createdAt: new Date().toISOString(), userAgent: navigator.userAgent, ...this.meta, words: this.words, events: this.events };
  }

  download(): void {
    const url = URL.createObjectURL(new Blob([JSON.stringify(this)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `prompter-glos-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
