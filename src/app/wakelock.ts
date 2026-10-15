/** Blokada wygaszania ekranu (Screen Wake Lock API). */
export interface WakeLockLike {
  release(): Promise<void>;
}

export type WakeLockRequest = () => Promise<WakeLockLike | null>;

function browserRequest(): Promise<WakeLockLike | null> {
  const nav = navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<WakeLockLike> } };
  return nav.wakeLock?.request("screen") ?? Promise.resolve(null);
}

/**
 * Blokada trzymana tylko wtedy, gdy jest chciana. Żądanie jest asynchroniczne, więc zwolnienie
 * przed jego spełnieniem musi zwolnić blokadę, która przyjdzie później; inaczej ekran nie gaśnie w pauzie.
 */
export class WakeLockHolder {
  private lock: WakeLockLike | null = null;
  private pending = false;
  private wanted = false;

  constructor(private request: WakeLockRequest = browserRequest) {}

  /** true, gdy blokada jest faktycznie trzymana. */
  get held(): boolean {
    return this.lock !== null;
  }

  async acquire(): Promise<void> {
    this.wanted = true;
    if (this.lock || this.pending) return;
    this.pending = true;
    let lock: WakeLockLike | null = null;
    try {
      lock = await this.request();
    } catch {
      lock = null;
    }
    this.pending = false;
    if (!lock) return;
    if (this.wanted) this.lock = lock;
    else lock.release().catch(() => undefined);
  }

  release(): void {
    this.wanted = false;
    const lock = this.lock;
    this.lock = null;
    lock?.release().catch(() => undefined);
  }
}
