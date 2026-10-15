import {
  extensionFor,
  formatBytes,
  nearCameraLayout,
  pickMimeType,
  recordingFileName,
  videoBitrateFor,
} from "../core/recording";
import { saveSettings, type Settings } from "./settings";
import { field, rangeControl, segmented } from "./controls";
import { WakeLockHolder } from "./wakelock";

/** Czas nagrywania po końcu tekstu przy automatycznym zatrzymaniu, ms [H]. */
const TAIL_MS = 2000;
/** Fragmenty z MediaRecorder co tyle ms, żeby rozmiar był widoczny na bieżąco. */
const TIMESLICE_MS = 1000;
/** Po tylu ms zwalniamy adres blob: pobieranie musi już trwać [H]. */
const REVOKE_MS = 60_000;

export function recordingSupported(): boolean {
  return typeof window !== "undefined" && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
}

/** Dlaczego nagrywanie nie zadziała; null = wszystko dostępne. */
export function unsupportedReason(): string | null {
  if (!window.isSecureContext) return "Kamera działa tylko przez HTTPS albo na localhost.";
  if (!navigator.mediaDevices?.getUserMedia) return "Ta przeglądarka nie udostępnia kamery (getUserMedia).";
  if (typeof MediaRecorder === "undefined") return "Ta przeglądarka nie potrafi nagrywać (brak MediaRecorder).";
  return null;
}

export function chosenMimeType(): string {
  return typeof MediaRecorder === "undefined" ? "" : pickMimeType((m) => MediaRecorder.isTypeSupported(m));
}

export function openCamera(s: Settings): Promise<MediaStream> {
  const width = s.recHeight === 1080 ? 1920 : 1280;
  return navigator.mediaDevices.getUserMedia({
    video: {
      deviceId: s.cameraId ? { exact: s.cameraId } : undefined,
      width: { ideal: width },
      height: { ideal: s.recHeight },
      frameRate: { ideal: 30 },
    },
    audio: s.micId ? { deviceId: { exact: s.micId } } : true,
  });
}

export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((t) => t.stop());
}

function describeError(e: unknown): string {
  const name = e instanceof DOMException ? e.name : "";
  switch (name) {
    case "NotAllowedError":
      return "Brak zgody na kamerę lub mikrofon. Zezwól w ustawieniach strony i otwórz odtwarzacz ponownie.";
    case "NotFoundError":
      return "Nie znaleziono kamery lub mikrofonu.";
    case "NotReadableError":
      return "Kamera jest zajęta przez inny program.";
    case "OverconstrainedError":
      return "Wybrana kamera lub mikrofon nie są dostępne. Wybierz „domyślne” w ustawieniach.";
    default:
      return `Kamera niedostępna: ${e instanceof Error ? e.message : String(e)}`;
  }
}

export interface Recording {
  blob: Blob;
  mimeType: string;
  fileName: string;
  durationMs: number;
}

/** Zapis pliku przez pobranie (działa offline, bez serwera). */
export function downloadRecording(r: Recording): void {
  const url = URL.createObjectURL(r.blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = r.fileName;
  a.hidden = true;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), REVOKE_MS);
}

function recordingFile(r: Recording): File {
  return new File([r.blob], r.fileName, { type: r.mimeType.split(";")[0] });
}

/** Arkusz udostępniania systemu (na telefonie m.in. „Zapisz wideo” w galerii) [Z: zależy od systemu]. */
export function canShareRecording(r: Recording): boolean {
  try {
    return !!navigator.canShare?.({ files: [recordingFile(r)] });
  } catch {
    return false;
  }
}

function formatClock(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, "0")}`;
}

/**
 * Kamera i nagrywanie w odtwarzaczu. Odtwarzacz woła tylko kilka metod:
 * countdownStarted(), setPlaying(), finished(), toggle(), togglePreview(), destroy().
 */
export class RecordingController {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  /** Zapis bieżącego nagrania, spełniany po zdarzeniu "stop" rejestratora. */
  private saved: Promise<Recording | null> = Promise.resolve(null);
  private chunks: Blob[] = [];
  private bytes = 0;
  private startedAt = 0;
  private wantStart = false;
  private tailTimer = 0;
  private tickTimer = 0;
  private playing = false;
  private previewHidden = false;
  private destroyed = false;
  private wakeLock = new WakeLockHolder();
  private preview: HTMLVideoElement;
  private badge: HTMLDivElement;
  private stopBtn: HTMLButtonElement;
  private toast: HTMLDivElement;

  constructor(
    host: HTMLElement,
    private settings: Settings,
    private title: string,
    /** Zatrzymanie nagrania przez użytkownika (STOP, R, pilot) pauzuje też tekst i mikrofon. */
    private onUserStop: () => void = () => undefined,
  ) {
    this.preview = document.createElement("video");
    this.preview.className = "cam-preview";
    this.preview.muted = true;
    this.preview.playsInline = true;
    this.preview.autoplay = true;
    this.preview.classList.toggle("mirrored", settings.mirrorPreview);
    this.preview.hidden = true;
    this.badge = document.createElement("div");
    this.badge.className = "rec-badge";
    this.badge.setAttribute("role", "status");
    // STOP zawsze widoczny w trakcie nagrywania, niezależnie od chowanego paska narzędzi,
    // w dolnym rogu, z dala od linii odczytu przy kamerze.
    // To element ekranu, nie obrazu z kamery, więc nie trafia do nagrania.
    this.stopBtn = document.createElement("button");
    this.stopBtn.type = "button";
    this.stopBtn.className = "rec-stop";
    this.stopBtn.textContent = "■ STOP";
    this.stopBtn.title = "Zatrzymaj nagrywanie i zapisz plik (R)";
    this.stopBtn.setAttribute("aria-label", "Zatrzymaj nagrywanie i zapisz plik");
    this.stopBtn.hidden = true;
    this.stopBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
    this.stopBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.stopBtn.blur();
      this.userStop();
    });
    this.toast = document.createElement("div");
    this.toast.className = "rec-toast";
    this.toast.hidden = true;
    host.append(this.preview, this.badge, this.stopBtn, this.toast);

    const reason = unsupportedReason();
    if (reason) this.setBadge(reason, "error");
    else void this.open();
  }

  /** Ustawienia widoku tekstu: blisko kamery i węższa kolumna. */
  static viewSettings(s: Settings): Settings {
    if (!s.record) return s;
    const near = nearCameraLayout(s.cameraEdge, s.recFocusPct, s.recSideAnchorPct);
    return { ...s, focusPct: near.focusPct, anchorPct: near.anchorPct, columnCh: s.recColumnCh };
  }

  get recording(): boolean {
    return this.recorder?.state === "recording";
  }

  private async open(): Promise<void> {
    this.setBadge("Łączenie z kamerą…", "idle");
    try {
      const stream = await openCamera(this.settings);
      if (this.destroyed) {
        stopStream(stream);
        return;
      }
      this.stream = stream;
      this.preview.srcObject = stream;
      stream.getTracks().forEach((t) => t.addEventListener("ended", () => this.onTrackEnded()));
      this.updatePreview();
      this.setBadge("Kamera gotowa · R = nagrywanie", "idle");
      if (this.wantStart) this.start();
    } catch (e) {
      this.setBadge(describeError(e), "error");
    }
  }

  countdownStarted(): void {
    if (this.settings.recAutoStart && !this.recording) {
      window.clearTimeout(this.tailTimer);
      this.start();
    }
  }

  setPlaying(playing: boolean): void {
    if (playing === this.playing) return;
    this.playing = playing;
    this.updatePreview();
  }

  finished(): void {
    if (!this.recording || !this.settings.recAutoStart) return;
    window.clearTimeout(this.tailTimer);
    this.tailTimer = window.setTimeout(() => void this.stop(), TAIL_MS);
  }

  toggle(): void {
    window.clearTimeout(this.tailTimer);
    if (this.recording) this.userStop();
    else this.start();
  }

  private userStop(): void {
    window.clearTimeout(this.tailTimer);
    this.onUserStop();
    void this.stop();
  }

  togglePreview(): void {
    this.previewHidden = !this.previewHidden;
    this.updatePreview();
  }

  private updatePreview(): void {
    const show = !!this.stream && !this.previewHidden && (!this.playing || this.settings.recPreviewWhilePlaying);
    this.preview.hidden = !show;
  }

  private start(): void {
    // Także rejestrator już zatrzymany, ale jeszcze bez zapisanego pliku: nowe nagranie poczeka na zapis.
    if (this.recorder || this.destroyed) return;
    if (!this.stream) {
      // Kamera jeszcze się otwiera: start zaraz po otwarciu.
      this.wantStart = true;
      return;
    }
    this.wantStart = false;
    const mimeType = chosenMimeType();
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(this.stream, {
        ...(mimeType ? { mimeType } : {}),
        videoBitsPerSecond: videoBitrateFor(this.settings.recHeight),
        audioBitsPerSecond: 128_000,
      });
    } catch (e) {
      this.setBadge(`Nie można rozpocząć nagrywania: ${e instanceof Error ? e.message : String(e)}`, "error");
      return;
    }
    this.chunks = [];
    this.bytes = 0;
    rec.addEventListener("dataavailable", (e) => {
      if (e.data.size > 0) {
        this.chunks.push(e.data);
        this.bytes += e.data.size;
      }
    });
    // Plik zapisujemy na zdarzenie "stop", niezależnie od tego, kto zatrzymał nagrywanie: użytkownik,
    // koniec tekstu, błąd rejestratora albo przeglądarka (np. odłączona kamera). Inaczej błąd gubił nagranie.
    this.saved = new Promise((resolve) => rec.addEventListener("stop", () => resolve(this.finish(rec)), { once: true }));
    rec.addEventListener("error", () => void this.stop());
    rec.start(TIMESLICE_MS);
    this.recorder = rec;
    this.startedAt = performance.now();
    this.toast.hidden = true;
    void this.wakeLock.acquire();
    this.renderRecording();
    this.tickTimer = window.setInterval(() => this.renderRecording(), 500);
  }

  private renderRecording(): void {
    // MP4 w Chromium oddaje dane fragmentami co kilka sekund, więc rozmiar pojawia się z opóźnieniem.
    const size = this.bytes > 0 ? ` · ${formatBytes(this.bytes)}` : "";
    this.setBadge(`● REC ${formatClock(performance.now() - this.startedAt)}${size}`, "rec");
  }

  /** Zatrzymuje nagrywanie i od razu zapisuje plik, żeby nic nie zginęło. */
  async stop(): Promise<Recording | null> {
    const rec = this.recorder;
    if (!rec) return null;
    if (rec.state !== "inactive") rec.stop();
    return this.saved;
  }

  private finish(rec: MediaRecorder): Recording | null {
    if (this.recorder !== rec) return null;
    window.clearInterval(this.tickTimer);
    window.clearTimeout(this.tailTimer);
    const durationMs = performance.now() - this.startedAt;
    this.recorder = null;
    this.wakeLock.release();
    const mimeType = rec.mimeType || this.chunks[0]?.type || "video/webm";
    const recording: Recording = {
      blob: new Blob(this.chunks, { type: mimeType }),
      mimeType,
      fileName: recordingFileName(this.title, new Date(), extensionFor(mimeType)),
      durationMs,
    };
    this.chunks = [];
    downloadRecording(recording);
    if (!this.destroyed) {
      this.setBadge(this.stream ? "Kamera gotowa · R = nagrywanie" : "Kamera rozłączona", this.stream ? "idle" : "error");
      this.showSaved(recording);
    }
    return recording;
  }

  private showSaved(r: Recording): void {
    const text = document.createElement("span");
    text.textContent = `Zapisano ${r.fileName} (${formatClock(r.durationMs)}, ${formatBytes(r.blob.size)}, ${r.mimeType})`;
    this.toast.replaceChildren(text);
    if (canShareRecording(r)) {
      const share = document.createElement("button");
      share.type = "button";
      share.textContent = "Udostępnij / zapisz w galerii";
      share.addEventListener("click", (e) => {
        e.stopPropagation();
        navigator.share({ files: [recordingFile(r)], title: r.fileName }).catch(() => undefined);
      });
      this.toast.append(share);
    }
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "OK";
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toast.hidden = true;
    });
    this.toast.append(close);
    this.toast.hidden = false;
  }

  private onTrackEnded(): void {
    stopStream(this.stream);
    this.stream = null;
    this.preview.srcObject = null;
    this.updatePreview();
    if (this.recording) void this.stop();
    else this.setBadge("Kamera rozłączona", "error");
  }

  private setBadge(text: string, kind: "idle" | "rec" | "error"): void {
    this.badge.textContent = text;
    this.badge.dataset.kind = kind;
    this.stopBtn.hidden = kind !== "rec";
  }

  /** Wyjście z odtwarzacza: trwające nagranie jest zatrzymywane i zapisywane, kamera wyłączana. */
  async destroy(): Promise<void> {
    this.destroyed = true;
    this.wantStart = false;
    window.clearInterval(this.tickTimer);
    window.clearTimeout(this.tailTimer);
    try {
      await this.stop();
    } finally {
      stopStream(this.stream);
      this.stream = null;
      this.wakeLock.release();
    }
  }
}

/** Sekcja „Nagrywanie wideo” w ustawieniach edytora, z próbnym podglądem kamery. */
export class RecordingSettingsPanel {
  readonly el: HTMLDetailsElement;
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement;
  private camSelect: HTMLSelectElement;
  private micSelect: HTMLSelectElement;
  private info: HTMLParagraphElement;
  private testBtn: HTMLButtonElement;

  constructor(private settings: Settings) {
    const s = settings;
    const save = () => saveSettings(s);
    const make = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]) => {
      const e = document.createElement(tag);
      Object.assign(e, props);
      e.append(...children);
      return e;
    };
    const check = (value: boolean, set: (v: boolean) => void) => {
      const c = make("input", { type: "checkbox", checked: value });
      c.addEventListener("change", () => {
        set(c.checked);
        save();
      });
      return c;
    };
    const range = (value: number, min: number, max: number, set: (v: number) => void, unit: string) =>
      rangeControl({
        value,
        min,
        max,
        step: 1,
        unit,
        onChange: (v) => {
          set(v);
          save();
        },
      }).el;

    const edge = segmented<Settings["cameraEdge"]>(
      [
        ["top", "Nad ekranem"],
        ["left", "Z lewej"],
        ["right", "Z prawej"],
      ],
      s.cameraEdge,
      (v) => {
        s.cameraEdge = v;
        save();
      },
    );

    const quality = segmented<"1080" | "720">(
      [
        ["1080", "1080p"],
        ["720", "720p"],
      ],
      s.recHeight === 720 ? "720" : "1080",
      (v) => {
        s.recHeight = v === "720" ? 720 : 1080;
        save();
      },
    );

    this.camSelect = make("select");
    this.micSelect = make("select");
    this.camSelect.addEventListener("change", () => {
      s.cameraId = this.camSelect.value;
      save();
      if (this.stream) void this.startTest();
    });
    this.micSelect.addEventListener("change", () => {
      s.micId = this.micSelect.value;
      save();
      if (this.stream) void this.startTest();
    });

    this.video = make("video", { className: "cam-test", muted: true, playsInline: true, autoplay: true, hidden: true });
    this.video.classList.toggle("mirrored", s.mirrorPreview);
    this.testBtn = make("button", { type: "button", textContent: "Sprawdź kamerę" });
    this.testBtn.addEventListener("click", () => (this.stream ? this.stopPreview() : void this.startTest()));
    this.info = make("p", { className: "field-hint" });

    const mirror = check(s.mirrorPreview, (v) => {
      s.mirrorPreview = v;
      this.video.classList.toggle("mirrored", v);
    });

    this.el = make(
      "details",
      { className: "settings recording-settings", open: s.record },
      make("summary", { textContent: "Nagrywanie wideo" }),
      make(
        "div",
        { className: "settings-grid" },
        field("Nagrywaj podczas czytania", check(s.record, (v) => (s.record = v)), "Tekst przesuwa się bliżej kamery, plik zapisuje się na urządzeniu"),
        field("Gdzie jest kamera", edge, "Z boku: telefon poziomo"),
        field("Kamera u góry: punkt odczytu od góry", range(s.recFocusPct, 3, 40, (v) => (s.recFocusPct = v), "%"), "Mniej = bliżej obiektywu"),
        field("Kamera z boku: kolumna od krawędzi", range(s.recSideAnchorPct, 10, 50, (v) => (s.recSideAnchorPct = v), "%")),
        field("Szerokość kolumny przy nagrywaniu", range(s.recColumnCh, 12, 60, (v) => (s.recColumnCh = v), " zn."), "Węższa = mniejszy ruch oczu na boki"),
        field("Jakość", quality, "Przeglądarka może dać niższą, jeśli kamera nie obsługuje"),
        field("Kamera", this.camSelect),
        field("Mikrofon", this.micSelect),
        field("Start nagrywania z odliczaniem", check(s.recAutoStart, (v) => (s.recAutoStart = v)), "Koniec 2 s po ostatnim słowie; R włącza i wyłącza ręcznie"),
        field("Podgląd kamery w trakcie czytania", check(s.recPreviewWhilePlaying, (v) => (s.recPreviewWhilePlaying = v)), "Domyślnie tylko w pauzie, żeby nie odciągał wzroku"),
        field("Podgląd jak w lustrze", mirror, "Dotyczy tylko podglądu; nagranie nie jest odbijane"),
      ),
      make("div", { className: "actions" }, this.testBtn),
      this.video,
      this.info,
    );
    this.el.addEventListener("toggle", () => {
      if (!this.el.open) this.stopPreview();
    });
    this.updateInfo();
    void this.listDevices();
  }

  private updateInfo(extra = ""): void {
    const reason = unsupportedReason();
    if (reason) {
      this.info.textContent = reason;
      this.testBtn.disabled = true;
      return;
    }
    const mime = chosenMimeType();
    this.info.textContent = `Format zapisu w tej przeglądarce: ${mime || "domyślny przeglądarki"}.${extra}`;
  }

  /** Nazwy urządzeń są dostępne dopiero po udzieleniu zgody (getUserMedia). */
  private async listDevices(): Promise<void> {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    let devices: MediaDeviceInfo[] = [];
    try {
      devices = await navigator.mediaDevices.enumerateDevices();
    } catch {
      return;
    }
    const fill = (select: HTMLSelectElement, kind: MediaDeviceKind, current: string, noun: string) => {
      const list = devices.filter((d) => d.kind === kind && d.deviceId);
      const opts = [new Option(`Domyślna (${noun})`, "")];
      list.forEach((d, i) => opts.push(new Option(d.label || `${noun} ${i + 1}`, d.deviceId)));
      if (current && !list.some((d) => d.deviceId === current)) opts.push(new Option(`Zapamiętane urządzenie`, current));
      select.replaceChildren(...opts);
      select.value = current;
    };
    fill(this.camSelect, "videoinput", this.settings.cameraId, "kamera");
    fill(this.micSelect, "audioinput", this.settings.micId, "mikrofon");
  }

  private async startTest(): Promise<void> {
    stopStream(this.stream);
    this.stream = null;
    try {
      this.stream = await openCamera(this.settings);
      this.video.srcObject = this.stream;
      this.video.hidden = false;
      this.testBtn.textContent = "Wyłącz podgląd";
      const v = this.stream.getVideoTracks()[0]?.getSettings();
      this.updateInfo(v?.width && v.height ? ` Kamera daje ${v.width}×${v.height}${v.frameRate ? ` przy ${Math.round(v.frameRate)} kl./s` : ""}.` : "");
      await this.listDevices();
    } catch (e) {
      this.stopPreview();
      this.info.textContent = describeError(e);
    }
  }

  /** Zwalnia kamerę (przed startem odtwarzacza i po zwinięciu sekcji). */
  stopPreview(): void {
    stopStream(this.stream);
    this.stream = null;
    this.video.srcObject = null;
    this.video.hidden = true;
    this.testBtn.textContent = "Sprawdź kamerę";
  }
}
