import { buildSchedule, DEFAULT_RAMP, remainingMs, tokenize, wpmForDuration, WPM_MAX, WPM_MIN } from "../core";
import { makeBackup, mergeScripts, parseBackup, safeFileName } from "./backup";
import { COMMAND_LABELS, assignKey, defaultKeysFor, keyId, keyLabel, unassignKey, type Command } from "./keys";
import { Player } from "./player";
import { RecordingSettingsPanel } from "./recorder";
import { saveSettings, wpmFor, type Settings } from "./settings";
import { speechSupport } from "./speech";
import { newId, titleFrom, type Script, type ScriptStore } from "./storage";

/** Pobranie pliku wygenerowanego w przeglądarce, bez serwera (E1). */
function downloadFile(name: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const SAMPLE = `Witaj w prompterze.

Wpisz lub wklej tutaj swój tekst. Pusta linia rozpoczyna nowy akapit.

Naciśnij Start albo spację. Strzałki w górę i w dół zmieniają prędkość, strzałki w lewo i w prawo przeskakują o zdanie. Escape wraca do edytora.`;

const VOICE_LANGS: [string, string][] = [
  ["pl-PL", "polski"],
  ["en-US", "angielski (USA)"],
  ["en-GB", "angielski (Wielka Brytania)"],
  ["de-DE", "niemiecki"],
  ["uk-UA", "ukraiński"],
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...children);
  return e;
}

/** "3:30", "3.5" albo "3" (minuty) → ms; null, gdy nie da się odczytać. */
export function parseDuration(text: string): number | null {
  const t = text.trim().replace(",", ".");
  const m = /^(\d+):([0-5]?\d)$/.exec(t);
  if (m) return (Number(m[1]) * 60 + Number(m[2])) * 1000;
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t) * 60000;
  return null;
}

function field(label: string, control: HTMLElement, hint?: string): HTMLLabelElement {
  const l = el("label", { className: "field" }, el("span", { className: "field-label" }, label), control);
  if (hint) l.append(el("span", { className: "field-hint" }, hint));
  return l;
}

function withNote(label: HTMLLabelElement, note: HTMLElement): HTMLLabelElement {
  label.append(note);
  return label;
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
  private keysEl: HTMLElement;
  private libraryStatus = el("p", { className: "library-status", role: "status" });
  /** Komenda czekająca na naciśnięcie klawisza w trybie uczenia (E4). */
  private learning: Command | null = null;
  private recordingPanel: RecordingSettingsPanel;

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

    // E1: kopia całej biblioteki i pojedynczy tekst do pliku.
    const exportBtn = el("button", { type: "button", textContent: "Eksportuj wszystkie (.json)" });
    exportBtn.addEventListener("click", () => void this.exportLibrary());
    const backupInput = el("input", { type: "file", accept: ".json,application/json", hidden: true });
    backupInput.addEventListener("change", () => void this.importBackup(backupInput));
    const restoreBtn = el("button", { type: "button", textContent: "Importuj kopię (.json)" });
    restoreBtn.addEventListener("click", () => backupInput.click());
    const txtBtn = el("button", { type: "button", textContent: "Pobierz .txt" });
    txtBtn.addEventListener("click", () => this.downloadTxt());

    const persistNote = store.persistent
      ? []
      : [el("p", { className: "warning", textContent: "Ta przeglądarka nie udostępnia IndexedDB: teksty znikną po zamknięciu karty." })];

    this.keysEl = this.buildKeys();
    window.addEventListener("keydown", (e) => this.onLearnKey(e), true);

    // Dedykacja tylko w edytorze: odtwarzacz zasłania edytor, więc nie rozprasza przy czytaniu i nie trafia do nagrania.
    const header = el(
      "header",
      { className: "app-header" },
      el(
        "div",
        { className: "brand" },
        el("img", { src: "./icon.svg", alt: "", width: 36, height: 36, className: "brand-icon" }),
        el("h1", { textContent: "Prompter" }),
      ),
      el("p", { className: "dedication" }, el("span", { className: "dedication-heart", ariaHidden: "true", textContent: "♥" }), "Dla Moniki"),
    );

    this.root = el(
      "div",
      { className: "editor" },
      header,
      el(
        "aside",
        { className: "library" },
        el("h2", { textContent: "Teksty" }),
        newBtn,
        this.libraryList,
        el("div", { className: "library-backup" }, exportBtn, restoreBtn, backupInput),
        this.libraryStatus,
        ...persistNote,
      ),
      el(
        "main",
        { className: "compose" },
        this.titleInput,
        this.bodyInput,
        el("div", { className: "actions" }, startBtn, importBtn, txtBtn, deleteBtn, fileInput, this.estimate),
        (this.settingsEl = this.buildSettings()),
        (this.recordingPanel = new RecordingSettingsPanel(this.settings)).el,
        this.keysEl,
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

    // Dopasowanie prędkości do zadanego czasu (porównanie z rynkiem: Teleprompter.com, Teleprompter Pro, PrompterPal).
    const target = el("input", { type: "text", placeholder: "np. 3:30", inputMode: "decimal", size: 6 });
    const fitBtn = el("button", { type: "button", textContent: "Dopasuj prędkość" });
    const fitNote = el("span", { className: "field-hint" });
    const fit = () => {
      const ms = parseDuration(target.value);
      if (ms === null || ms <= 0) {
        fitNote.textContent = "Podaj czas jako minuty:sekundy, np. 3:30, albo minuty, np. 2.5.";
        return;
      }
      const tokens = tokenize(this.bodyInput.value, { splitLongWords: s.mode === "B" });
      if (tokens.length === 0) {
        fitNote.textContent = "Najpierw wpisz tekst.";
        return;
      }
      const exact = wpmForDuration(buildSchedule(tokens), 0, ms, s.rampMs, DEFAULT_RAMP.from);
      const v = Math.min(WPM_MAX, Math.max(WPM_MIN, Math.round(exact)));
      if (s.mode === "A") s.wpmA = v;
      else s.wpmB = v;
      syncWpm();
      save();
      fitNote.textContent =
        exact > WPM_MAX ? `Za krótko: potrzeba ${Math.round(Math.min(exact, 99999))} słów/min, ustawiono maksimum ${WPM_MAX}.`
        : exact < WPM_MIN ? `Za długo: potrzeba ${Math.round(exact)} słów/min, ustawiono minimum ${WPM_MIN}.`
        : `Ustawiono ${v} słów/min. Czas liczony od początku tekstu, z rozbiegiem, bez odliczania i pauz.`;
    };
    fitBtn.addEventListener("click", fit);
    target.addEventListener("keydown", (e) => {
      if (e.key === "Enter") fit();
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

    const support = speechSupport();
    const followVoice = el("input", { type: "checkbox", checked: s.followVoice && support.ok, disabled: !support.ok });
    followVoice.addEventListener("change", () => {
      s.followVoice = followVoice.checked;
      save();
    });
    const voiceLang = el(
      "select",
      { disabled: !support.ok },
      ...VOICE_LANGS.map(([value, label]) => el("option", { value, textContent: label })),
    );
    voiceLang.value = s.voiceLang;
    voiceLang.addEventListener("change", () => {
      s.voiceLang = voiceLang.value;
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
        withNote(field("Czas docelowy, min:s", el("span", { className: "range" }, target, fitBtn)), fitNote),
        field("Punkt odczytu od góry", range(s.focusPct, 10, 90, 1, (v) => (s.focusPct = v), "%"), "Bliżej kamery = wyżej"),
        field("Rozmiar czcionki, px", fontSize, "Puste = auto (48 px, na wąskim ekranie 32 px)"),
        field("Interlinia", range(s.lineHeight, 1.1, 2, 0.1, (v) => (s.lineHeight = v), "")),
        field("Szerokość kolumny (tryb A)", range(s.columnCh, 20, 100, 1, (v) => (s.columnCh = v), " zn.")),
        field("Krój", font),
        field("Kolory", theme),
        field("Odliczanie przed startem", range(s.countdownS, 0, 10, 1, (v) => (s.countdownS = v), " s")),
        field("Rozbieg prędkości", range(s.rampMs, 0, 5000, 250, (v) => (s.rampMs = v), " ms"), "Od 50% do pełnej prędkości"),
        field("Podgląd następnego słowa (tryb B)", showNext),
        field(
          "Podążanie za głosem",
          followVoice,
          support.ok
            ? "Tekst przesuwa się za czytającym, przy ciszy stoi. Wymaga internetu: dźwięk z mikrofonu trafia do usługi rozpoznawania mowy przeglądarki (w Chrome do serwerów Google). Bez tej opcji prompter działa offline."
            : support.reason,
        ),
        field("Język mowy", voiceLang),
        field(
          "Wyprzedzenie przy głosie",
          range(s.voiceLatencyMs, 0, 2500, 100, (v) => (s.voiceLatencyMs = v), " ms"),
          "Rozpoznawanie mowy ma opóźnienie. Czytasz dalej niż podświetlenie: zwiększ. Tekst ucieka do przodu: zmniejsz.",
        ),
      ),
    );
  }

  /** Sekcja „Sterowanie”: klawisze domyślne, własne i tryb uczenia pilota (E4). */
  private buildKeys(): HTMLElement {
    const rows = (Object.keys(COMMAND_LABELS) as Command[]).map((cmd) => {
      const custom = Object.entries(this.settings.keyMap)
        .filter(([, c]) => c === cmd)
        .map(([id]) => {
          const chip = el("button", { type: "button", className: "key-chip custom", textContent: `${keyLabel(id)} ✕`, title: "Usuń przypisanie" });
          chip.addEventListener("click", () => {
            this.settings.keyMap = unassignKey(this.settings.keyMap, id);
            saveSettings(this.settings);
            this.refreshKeys();
          });
          return chip;
        });
      const defaults = defaultKeysFor(cmd).map((id) => el("span", { className: "key-chip", textContent: keyLabel(id) }));
      const learn = el("button", {
        type: "button",
        className: "learn",
        textContent: this.learning === cmd ? "Naciśnij klawisz… (anuluj)" : "Przypisz",
        title: "Przypisz klawisz lub przycisk pilota",
      });
      learn.addEventListener("click", () => {
        this.learning = this.learning === cmd ? null : cmd;
        this.refreshKeys();
      });
      return el("tr", {}, el("th", { scope: "row", textContent: COMMAND_LABELS[cmd] }), el("td", { className: "keys" }, ...defaults, ...custom), el("td", {}, learn));
    });
    return el(
      "details",
      { className: "help", open: this.learning !== null },
      el("summary", { textContent: "Sterowanie i pilot" }),
      el(
        "p",
        { className: "field-hint" },
        "Aby użyć pilota, kliknij „Przypisz” przy akcji i naciśnij przycisk na pilocie. Własne przypisania mają pierwszeństwo przed domyślnymi. Dotyk w odtwarzaczu: stuknięcie = start i pauza, przesunięcie w górę lub w dół = prędkość, w lewo lub w prawo = zdanie. Z podążaniem za głosem start i pauza włączają i wyłączają mikrofon; nawigacja działa jak zwykle, a dopasowanie zaczyna od nowej pozycji.",
      ),
      el("div", { className: "table-wrap" }, el("table", { className: "keys-table" }, el("tbody", {}, ...rows))),
    );
  }

  private refreshKeys(): void {
    const fresh = this.buildKeys();
    if ((this.keysEl as HTMLDetailsElement).open) (fresh as HTMLDetailsElement).open = true;
    this.keysEl.replaceWith(fresh);
    this.keysEl = fresh;
  }

  private onLearnKey(e: KeyboardEvent): void {
    if (this.learning === null || this.root.hidden) return;
    // Same modyfikatory nie są przypisywane; czekamy na właściwy klawisz.
    if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    this.settings.keyMap = assignKey(this.settings.keyMap, keyId(e), this.learning);
    saveSettings(this.settings);
    this.learning = null;
    this.refreshKeys();
  }

  private async exportLibrary(): Promise<void> {
    await this.saveNow();
    const list = await this.store.list();
    const date = new Date().toISOString().slice(0, 10);
    downloadFile(`prompter-kopia-${date}.json`, JSON.stringify(makeBackup(list, Date.now()), null, 2), "application/json");
    this.libraryStatus.textContent = `Wyeksportowano ${list.length} tekst(y/ów).`;
  }

  private async importBackup(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    try {
      const incoming = parseBackup(await file.text());
      await this.saveNow();
      const result = mergeScripts(await this.store.list(), incoming);
      for (const s of result.toWrite) await this.store.put(s);
      this.libraryStatus.textContent = `Import: dodano ${result.added}, zaktualizowano ${result.updated}, bez zmian ${result.unchanged}.`;
      await this.renderLibrary();
    } catch (err) {
      this.libraryStatus.textContent = `Import nieudany: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  private downloadTxt(): void {
    const body = this.bodyInput.value;
    if (body.trim() === "") return;
    const title = this.titleInput.value.trim() || titleFrom(body);
    downloadFile(`${safeFileName(title)}.txt`, body, "text/plain;charset=utf-8");
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
    const total = Math.round(ms / 1000);
    const min = Math.floor(total / 60);
    const sec = total % 60;
    this.estimate.textContent = `${words} słów · ok. ${min} min ${sec} s przy ${wpmFor(this.settings)} słów/min`;
  }

  private async start(): Promise<void> {
    if (this.bodyInput.value.trim() === "") return;
    // Pełny ekran musi być wywołany synchronicznie w obsłudze gestu użytkownika (F-17).
    this.host.requestFullscreen?.().catch(() => undefined);
    this.recordingPanel.stopPreview();
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
      // Punkt odczytu i kolumna przy nagrywaniu mogły zmienić się w odtwarzaczu (E3).
      const panel = new RecordingSettingsPanel(this.settings);
      panel.el.open = this.recordingPanel.el.open;
      this.recordingPanel.el.replaceWith(panel.el);
      this.recordingPanel = panel;
      this.refreshKeys();
      this.updateEstimate();
    }, s.title);
  }
}
