import { buildSchedule, remainingMs, tokenize, WPM_MAX, WPM_MIN } from "../core";
import { Player } from "./player";
import { saveSettings, wpmFor, type Settings } from "./settings";
import { newId, titleFrom, type Script, type ScriptStore } from "./storage";

const SAMPLE = `Witaj w prompterze.

Wpisz lub wklej tutaj swój tekst. Pusta linia rozpoczyna nowy akapit.

Naciśnij Start albo spację. Strzałki w górę i w dół zmieniają prędkość, strzałki w lewo i w prawo przeskakują o zdanie. Escape wraca do edytora.`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...children);
  return e;
}

function field(label: string, control: HTMLElement, hint?: string): HTMLLabelElement {
  const l = el("label", { className: "field" }, el("span", { className: "field-label" }, label), control);
  if (hint) l.append(el("span", { className: "field-hint" }, hint));
  return l;
}

/** Edytor, biblioteka i ustawienia (F-01–F-05, F-14, F-15). */
export class EditorView {
  private root: HTMLDivElement;
  private titleInput: HTMLInputElement;
  private bodyInput: HTMLTextAreaElement;
  private libraryList: HTMLUListElement;
  private estimate: HTMLSpanElement;
  private script: Script | null = null;
  private saveTimer = 0;
  private settingsEl: HTMLElement;

  constructor(
    private host: HTMLElement,
    private store: ScriptStore,
    private settings: Settings,
  ) {
    this.titleInput = el("input", { type: "text", placeholder: "Tytuł (domyślnie pierwsze słowa)", className: "title-input" });
    this.bodyInput = el("textarea", { className: "body-input", placeholder: "Wpisz lub wklej tekst…", spellcheck: true });
    this.libraryList = el("ul", { className: "library-list" });
    this.estimate = el("span", { className: "estimate" });

    const startBtn = el("button", { type: "button", className: "primary", textContent: "Start" });
    startBtn.addEventListener("click", () => this.start());
    const newBtn = el("button", { type: "button", textContent: "Nowy tekst" });
    newBtn.addEventListener("click", () => this.newScript());
    const fileInput = el("input", { type: "file", accept: ".txt,text/plain", hidden: true });
    fileInput.addEventListener("change", () => this.importFile(fileInput));
    const importBtn = el("button", { type: "button", textContent: "Importuj .txt" });
    importBtn.addEventListener("click", () => fileInput.click());
    // Potwierdzenie w samym przycisku zamiast window.confirm (nie działa w osadzonych widokach).
    const deleteBtn = el("button", { type: "button", textContent: "Usuń" });
    let confirmTimer = 0;
    deleteBtn.addEventListener("click", () => {
      if (deleteBtn.dataset.confirm === "1") {
        window.clearTimeout(confirmTimer);
        delete deleteBtn.dataset.confirm;
        deleteBtn.textContent = "Usuń";
        void this.deleteCurrent();
        return;
      }
      deleteBtn.dataset.confirm = "1";
      deleteBtn.textContent = "Kliknij ponownie, aby usunąć";
      confirmTimer = window.setTimeout(() => {
        delete deleteBtn.dataset.confirm;
        deleteBtn.textContent = "Usuń";
      }, 4000);
    });

    this.titleInput.addEventListener("input", () => this.scheduleSave());
    this.bodyInput.addEventListener("input", () => {
      this.scheduleSave();
      this.updateEstimate();
    });

    const persistNote = store.persistent
      ? []
      : [el("p", { className: "warning", textContent: "Ta przeglądarka nie udostępnia IndexedDB: teksty znikną po zamknięciu karty." })];

    this.root = el(
      "div",
      { className: "editor" },
      el(
        "aside",
        { className: "library" },
        el("h2", { textContent: "Teksty" }),
        newBtn,
        this.libraryList,
        ...persistNote,
      ),
      el(
        "main",
        { className: "compose" },
        el("h1", { textContent: "Prompter" }),
        this.titleInput,
        this.bodyInput,
        el("div", { className: "actions" }, startBtn, importBtn, deleteBtn, fileInput, this.estimate),
        (this.settingsEl = this.buildSettings()),
        el(
          "details",
          { className: "help" },
          el("summary", { textContent: "Sterowanie" }),
          el(
            "ul",
            {},
            el("li", { textContent: "Spacja, Enter, B, kropka, F5: start i pauza (piloty prezentacyjne wysyłają zwykle PageUp, PageDown, B lub F5)" }),
            el("li", { textContent: "Strzałka w górę i w dół: prędkość ±10 słów/min" }),
            el("li", { textContent: "Strzałka w lewo i w prawo: poprzednie i następne zdanie" }),
            el("li", { textContent: "PageUp i PageDown: poprzedni i następny akapit" }),
            el("li", { textContent: "Home: początek; T: zmiana trybu; F: pełny ekran; Escape: edytor" }),
            el("li", { textContent: "Dotyk: stuknięcie = start i pauza, przesunięcie w górę lub w dół = prędkość, w lewo lub w prawo = zdanie" }),
          ),
        ),
      ),
    );
    host.appendChild(this.root);
    void this.init();
  }

  private buildSettings(): HTMLElement {
    const s = this.settings;
    const save = () => {
      saveSettings(s);
      this.updateEstimate();
    };

    const mode = el("select", {}, el("option", { value: "A", textContent: "A: przewijanie z linią odczytu" }), el("option", { value: "B", textContent: "B: jedno słowo w stałym punkcie" }));
    mode.value = s.mode;

    const wpm = el("input", { type: "number", min: String(WPM_MIN), max: String(WPM_MAX), step: "10" });
    const syncWpm = () => (wpm.value = String(wpmFor(s)));
    syncWpm();
    mode.addEventListener("change", () => {
      s.mode = mode.value as Settings["mode"];
      syncWpm();
      save();
    });
    wpm.addEventListener("change", () => {
      const v = Math.min(WPM_MAX, Math.max(WPM_MIN, Number(wpm.value) || wpmFor(s)));
      wpm.value = String(v);
      if (s.mode === "A") s.wpmA = v;
      else s.wpmB = v;
      save();
    });

    const range = (value: number, min: number, max: number, step: number, set: (v: number) => void, unit: string) => {
      const input = el("input", { type: "range", min: String(min), max: String(max), step: String(step), value: String(value) });
      const out = el("output", { textContent: `${value}${unit}` });
      input.addEventListener("input", () => {
        set(Number(input.value));
        out.textContent = `${input.value}${unit}`;
        save();
      });
      return el("span", { className: "range" }, input, out);
    };

    const fontSize = el("input", { type: "number", min: "16", max: "160", step: "2", placeholder: "auto" });
    fontSize.value = s.fontSizePx === null ? "" : String(s.fontSizePx);
    fontSize.addEventListener("change", () => {
      const v = fontSize.value.trim() === "" ? null : Math.min(160, Math.max(16, Number(fontSize.value)));
      s.fontSizePx = v === null || Number.isNaN(v) ? null : v;
      fontSize.value = s.fontSizePx === null ? "" : String(s.fontSizePx);
      save();
    });

    const font = el("select", {}, el("option", { value: "sans", textContent: "Bezszeryfowy" }), el("option", { value: "serif", textContent: "Szeryfowy" }), el("option", { value: "mono", textContent: "Stałej szerokości" }));
    font.value = s.font;
    font.addEventListener("change", () => {
      s.font = font.value as Settings["font"];
      save();
    });

    const theme = el("select", {}, el("option", { value: "dark", textContent: "Jasny tekst na czarnym" }), el("option", { value: "light", textContent: "Ciemny tekst na białym" }));
    theme.value = s.theme;
    theme.addEventListener("change", () => {
      s.theme = theme.value as Settings["theme"];
      save();
    });

    const showNext = el("input", { type: "checkbox", checked: s.showNext });
    showNext.addEventListener("change", () => {
      s.showNext = showNext.checked;
      save();
    });

    return el(
      "details",
      { className: "settings", open: true },
      el("summary", { textContent: "Ustawienia" }),
      el(
        "div",
        { className: "settings-grid" },
        field("Tryb", mode),
        field("Prędkość, słów/min", wpm, `Zakres ${WPM_MIN}–${WPM_MAX}; osobno dla każdego trybu`),
        field("Punkt odczytu od góry", range(s.focusPct, 10, 90, 1, (v) => (s.focusPct = v), "%"), "Bliżej kamery = wyżej"),
        field("Rozmiar czcionki, px", fontSize, "Puste = auto (48 px, na wąskim ekranie 32 px)"),
        field("Interlinia", range(s.lineHeight, 1.1, 2, 0.1, (v) => (s.lineHeight = v), "")),
        field("Szerokość kolumny (tryb A)", range(s.columnCh, 20, 100, 1, (v) => (s.columnCh = v), " zn.")),
        field("Krój", font),
        field("Kolory", theme),
        field("Odliczanie przed startem", range(s.countdownS, 0, 10, 1, (v) => (s.countdownS = v), " s")),
        field("Rozbieg prędkości", range(s.rampMs, 0, 5000, 250, (v) => (s.rampMs = v), " ms"), "Od 50% do pełnej prędkości"),
        field("Podgląd następnego słowa (tryb B)", showNext),
      ),
    );
  }

  private async init(): Promise<void> {
    const list = await this.store.list();
    if (list.length > 0) this.open(list[0]!);
    else {
      this.newScript();
      this.bodyInput.value = SAMPLE;
      this.updateEstimate();
      await this.saveNow();
    }
    await this.renderLibrary();
  }

  private async renderLibrary(): Promise<void> {
    const list = await this.store.list();
    this.libraryList.replaceChildren(
      ...list.map((s) => {
        const b = el("button", { type: "button", textContent: s.title, className: s.id === this.script?.id ? "active" : "" });
        b.addEventListener("click", async () => {
          await this.saveNow();
          const fresh = await this.store.get(s.id);
          if (fresh) this.open(fresh);
          await this.renderLibrary();
        });
        return el("li", {}, b);
      }),
    );
  }

  private open(s: Script): void {
    this.script = s;
    this.titleInput.value = s.title;
    this.bodyInput.value = s.body;
    this.updateEstimate();
  }

  private newScript(): void {
    void this.saveNow();
    const now = Date.now();
    this.script = { id: newId(), title: "", body: "", createdAt: now, updatedAt: now, lastWord: 0 };
    this.titleInput.value = "";
    this.bodyInput.value = "";
    this.updateEstimate();
    this.bodyInput.focus();
  }

  private scheduleSave(): void {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.saveNow(), 500);
  }

  private async saveNow(): Promise<void> {
    window.clearTimeout(this.saveTimer);
    const s = this.script;
    if (!s) return;
    const body = this.bodyInput.value;
    const title = this.titleInput.value.trim() || titleFrom(body);
    if (body.trim() === "" && s.body === "") return;
    if (body !== s.body) s.lastWord = 0; // F-04: pozycja zerowana po zmianie treści.
    s.body = body;
    s.title = title;
    s.updatedAt = Date.now();
    await this.store.put(s);
    await this.renderLibrary();
  }

  private async importFile(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    const text = await file.text();
    this.newScript();
    this.titleInput.value = file.name.replace(/\.txt$/i, "");
    this.bodyInput.value = text;
    this.updateEstimate();
    await this.saveNow();
  }

  private async deleteCurrent(): Promise<void> {
    const s = this.script;
    if (!s) return;
    await this.store.remove(s.id);
    this.script = null;
    const list = await this.store.list();
    if (list.length > 0) this.open(list[0]!);
    else this.newScript();
    await this.renderLibrary();
  }

  private updateEstimate(): void {
    const tokens = tokenize(this.bodyInput.value, { splitLongWords: this.settings.mode === "B" });
    const words = new Set(tokens.map((t) => t.sourceWord)).size;
    const ms = remainingMs(buildSchedule(tokens), 0, wpmFor(this.settings));
    const min = Math.floor(ms / 60000);
    const sec = Math.round((ms % 60000) / 1000);
    this.estimate.textContent = `${words} słów · ok. ${min} min ${sec} s przy ${wpmFor(this.settings)} słów/min`;
  }

  private async start(): Promise<void> {
    if (this.bodyInput.value.trim() === "") return;
    // Pełny ekran musi być wywołany synchronicznie w obsłudze gestu użytkownika (F-17).
    this.host.requestFullscreen?.().catch(() => undefined);
    await this.saveNow();
    const s = this.script!;
    this.root.hidden = true;
    new Player(this.host, s.body, s.lastWord, this.settings, async (lastWord) => {
      s.lastWord = lastWord;
      await this.store.put(s);
      this.root.hidden = false;
      // Tryb i prędkość mogły zmienić się w odtwarzaczu.
      const fresh = this.buildSettings();
      this.settingsEl.replaceWith(fresh);
      this.settingsEl = fresh;
      this.updateEstimate();
    });
  }
}
