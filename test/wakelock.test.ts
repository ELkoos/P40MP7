import { describe, expect, it } from "vitest";
import { WakeLockHolder, type WakeLockLike } from "../src/app/wakelock";

function fakeLocks() {
  const issued: { released: boolean }[] = [];
  let resolveNext: ((l: WakeLockLike) => void) | null = null;
  const request = () =>
    new Promise<WakeLockLike>((resolve) => {
      resolveNext = resolve;
    });
  const grant = () => {
    const state = { released: false };
    issued.push(state);
    resolveNext!({ release: async () => void (state.released = true) });
  };
  return { issued, request, grant };
}

describe("blokada ekranu", () => {
  it("zwolnienie przed spełnieniem żądania zwalnia blokadę, która przyjdzie później", async () => {
    const f = fakeLocks();
    const h = new WakeLockHolder(f.request);
    const p = h.acquire();
    h.release();
    f.grant();
    await p;
    expect(h.held).toBe(false);
    expect(f.issued[0]!.released).toBe(true);
  });

  it("zwykły cykl: blokada trzymana do zwolnienia, jedno żądanie mimo kilku acquire", async () => {
    const f = fakeLocks();
    let requests = 0;
    const h = new WakeLockHolder(() => {
      requests++;
      return f.request();
    });
    const p1 = h.acquire();
    const p2 = h.acquire();
    f.grant();
    await Promise.all([p1, p2]);
    expect(requests).toBe(1);
    expect(h.held).toBe(true);
    h.release();
    expect(h.held).toBe(false);
    expect(f.issued[0]!.released).toBe(true);
  });

  it("brak API lub odmowa: bez blokady i bez wyjątku", async () => {
    const none = new WakeLockHolder(async () => null);
    await none.acquire();
    expect(none.held).toBe(false);
    const denied = new WakeLockHolder(() => Promise.reject(new Error("NotAllowedError")));
    await denied.acquire();
    expect(denied.held).toBe(false);
  });
});
