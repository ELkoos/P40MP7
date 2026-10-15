/**
 * Adapter Web Speech API (SpeechRecognition) dla podążania za głosem.
 * W Chrome rozpoznawanie odbywa się na serwerach Google: dźwięk z mikrofonu wychodzi z urządzenia i wymaga sieci.
 */

/** Minimalny opis interfejsu; lib.dom nie zawiera klasy SpeechRecognition, a Chrome i Safari udostępniają ją z prefiksem. */
interface RecognitionAlternative {
  transcript: string;
}
interface RecognitionResult {
  readonly length: number;
  readonly isFinal: boolean;
  [index: number]: RecognitionAlternative;
}
interface RecognitionResultList {
  readonly length: number;
  [index: number]: RecognitionResult;
}
interface RecognitionEvent {
  readonly results: RecognitionResultList;
}
interface RecognitionErrorEvent {
  readonly error: string;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

export function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Czy podążanie za głosem może działać w tej przeglądarce i w tym kontekście. */
export function speechSupport(): { ok: boolean; reason?: string } {
  if (!recognitionCtor()) return { ok: false, reason: "Ta przeglądarka nie udostępnia rozpoznawania mowy (jest w Chrome, Edge i Safari; w Firefoksie tylko po włączeniu flagi)." };
  if (!window.isSecureContext) return { ok: false, reason: "Mikrofon wymaga strony otwartej przez HTTPS albo z localhost." };
  return { ok: true };
}

export type ListenerStatus = "off" | "starting" | "listening" | "error";

/** Ile ostatnich słów hipotezy przekazujemy do dopasowania (VoiceMatcher i tak bierze swoją końcówkę). */
const TAIL_WORDS = 12;
const RESTART_MS = 250;
const RESTART_BACKOFF_MS = 2000;
/** Sesje krótsze niż tyle ms uznajemy za nieudane (np. brak sieci) i zwalniamy ponowne starty. */
const MIN_SESSION_MS = 1000;
const MAX_QUICK_RESTARTS = 5;

const FATAL: Record<string, string> = {
  "not-allowed": "Brak zgody na użycie mikrofonu.",
  "service-not-allowed": "Przeglądarka nie zezwala na usługę rozpoznawania mowy.",
  "audio-capture": "Nie znaleziono mikrofonu.",
  "language-not-supported": "Usługa nie obsługuje wybranego języka.",
};

/**
 * Ciągłe słuchanie z automatycznym wznawianiem: Chrome kończy sesję po ciszy lub po pewnym czasie,
 * a na Androidzie `continuous` nie działa (mdn/browser-compat-data), więc każda sesja to jedna wypowiedź.
 */
export class SpeechListener {
  private rec: Recognition | null = null;
  private active = false;
  private fatal = false;
  private sessionStart = 0;
  private quickEnds = 0;
  private restartTimer = 0;

  constructor(
    private lang: string,
    private onWords: (words: string[]) => void,
    private onStatus: (status: ListenerStatus, message?: string) => void,
    /** Sesja skończyła się i zaraz zostanie wznowiona (to nie jest cisza lektora). */
    private onRestart: () => void = () => undefined,
  ) {}

  get listening(): boolean {
    return this.active;
  }

  start(): void {
    if (this.active) return;
    const Ctor = recognitionCtor();
    if (!Ctor) {
      this.onStatus("error", speechSupport().reason);
      return;
    }
    this.active = true;
    this.fatal = false;
    this.quickEnds = 0;
    this.onStatus("starting");
    this.open(Ctor);
  }

  stop(): void {
    this.active = false;
    window.clearTimeout(this.restartTimer);
    const rec = this.rec;
    this.rec = null;
    if (rec) {
      rec.onend = null;
      rec.onresult = null;
      rec.onerror = null;
      rec.abort();
    }
    this.onStatus("off");
  }

  private open(Ctor: RecognitionCtor): void {
    const rec = new Ctor();
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onstart = () => {
      this.sessionStart = performance.now();
      this.onStatus("listening");
    };
    rec.onresult = (e) => {
      // Hipoteza całej sesji: wyniki końcowe i bieżący pośredni, w kolejności.
      const parts: string[] = [];
      for (let i = 0; i < e.results.length; i++) parts.push(e.results[i]![0]?.transcript ?? "");
      const words = parts.join(" ").split(/\s+/).filter((w) => w.length > 0);
      if (words.length > 0) this.onWords(words.slice(-TAIL_WORDS));
    };
    rec.onerror = (e) => {
      const msg = FATAL[e.error];
      if (msg) {
        this.fatal = true;
        this.onStatus("error", msg);
      } else if (e.error === "network") {
        this.onStatus("error", "Brak połączenia z usługą rozpoznawania mowy; ponawiam.");
      }
      // "no-speech" i "aborted": sesja się skończy, onend wznowi słuchanie.
    };
    rec.onend = () => {
      if (!this.active || this.rec !== rec) return;
      if (this.fatal) {
        this.active = false;
        this.rec = null;
        return;
      }
      const short = performance.now() - this.sessionStart < MIN_SESSION_MS;
      this.quickEnds = short ? this.quickEnds + 1 : 0;
      const delay = this.quickEnds > MAX_QUICK_RESTARTS ? RESTART_BACKOFF_MS : RESTART_MS;
      this.onRestart();
      this.restartTimer = window.setTimeout(() => {
        if (this.active && this.rec === rec) this.open(Ctor);
      }, delay);
    };
    this.rec = rec;
    this.sessionStart = performance.now();
    try {
      rec.start();
    } catch {
      // start() rzuca InvalidStateError, gdy poprzednia sesja jeszcze trwa; próbujemy ponownie później.
      this.restartTimer = window.setTimeout(() => {
        if (this.active && this.rec === rec) this.open(Ctor);
      }, RESTART_BACKOFF_MS);
    }
  }
}
