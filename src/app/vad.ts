/**
 * Detektor głosu z poziomu dźwięku mikrofonu (Web Audio, lokalnie, bez sieci).
 * Rozpoznawanie mowy podaje wyniki z opóźnieniem ok. 1 s, a detektor wie od razu, że lektor mówi albo
 * przestał; dzięki temu tekst staje i rusza razem z lektorem. Progi są heurystyczne [H].
 */
export class VoiceActivityDetector {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private buf: Float32Array<ArrayBuffer> | null = null;
  /** Poziom tła (adaptacyjny) i bieżący poziom RMS. */
  private floor = 0.01;
  level = 0;
  active = false;
  private lastLoud = -Infinity;

  /** Próg: głos, gdy poziom > tło × RATIO i > MIN_LEVEL; po ostatnim głośnym fragmencie trzymamy HANG_MS. */
  private static readonly RATIO = 2.5;
  private static readonly MIN_LEVEL = 0.006;
  private static readonly HANG_MS = 200;

  /** Uruchomienie; null przy braku zgody lub mikrofonu (wtedy cisza wynika z wyników rozpoznawania). */
  static async start(deviceId = ""): Promise<VoiceActivityDetector | null> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: true, noiseSuppression: true },
      });
      const v = new VoiceActivityDetector();
      v.stream = stream;
      v.ctx = new AudioContext();
      const src = v.ctx.createMediaStreamSource(stream);
      v.analyser = v.ctx.createAnalyser();
      v.analyser.fftSize = 1024;
      src.connect(v.analyser);
      v.buf = new Float32Array(v.analyser.fftSize);
      if (v.ctx.state === "suspended") await v.ctx.resume().catch(() => undefined);
      return v;
    } catch {
      return null;
    }
  }

  /** Pomiar w bieżącej klatce; zwraca, czy lektor mówi. */
  sample(now: number): boolean {
    if (!this.analyser || !this.buf) return false;
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (const x of this.buf) sum += x * x;
    const rms = Math.sqrt(sum / this.buf.length);
    this.level = rms;
    // Tło: szybko w dół, bardzo powoli w górę (mowa nie podnosi tła).
    this.floor = rms < this.floor ? this.floor * 0.8 + rms * 0.2 : this.floor * 0.9995 + rms * 0.0005;
    if (rms > Math.max(this.floor * VoiceActivityDetector.RATIO, VoiceActivityDetector.MIN_LEVEL)) this.lastLoud = now;
    this.active = now - this.lastLoud <= VoiceActivityDetector.HANG_MS;
    return this.active;
  }

  get noiseFloor(): number {
    return this.floor;
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close().catch(() => undefined);
    this.stream = null;
    this.ctx = null;
    this.analyser = null;
  }
}
